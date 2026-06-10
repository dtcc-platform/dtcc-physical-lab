// 4-point planar homography solver for perspective alignment.
// Given 4 src→dst point pairs (sx, sy) → (dx, dy), solves the 3×3 matrix h
// such that for each pair:
//   dx = (h0*sx + h1*sy + h2) / (h6*sx + h7*sy + 1)
//   dy = (h3*sx + h4*sy + h5) / (h6*sx + h7*sy + 1)
// Fixing h8 = 1 leaves 8 unknowns, solved as an 8×8 linear system.

type Pair = [number, number];

function gaussianElimination(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k][i]) > Math.abs(M[pivot][i])) pivot = k;
    }
    [M[i], M[pivot]] = [M[pivot], M[i]];
    if (Math.abs(M[i][i]) < 1e-12) return null;
    for (let k = i + 1; k < n; k++) {
      const factor = M[k][i] / M[i][i];
      for (let j = i; j <= n; j++) M[k][j] -= factor * M[i][j];
    }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = M[i][n];
    for (let j = i + 1; j < n; j++) sum -= M[i][j] * x[j];
    x[i] = sum / M[i][i];
  }
  return x;
}

export function solveHomography(src: Pair[], dst: Pair[]): number[] | null {
  if (src.length !== 4 || dst.length !== 4) return null;
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [sx, sy] = src[i];
    const [dx, dy] = dst[i];
    A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]);
    b.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]);
    b.push(dy);
  }
  const h = gaussianElimination(A, b);
  if (!h || h.some((v) => !isFinite(v))) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

// CSS matrix3d expects 16 column-major values. Embedding a 3×3 homography:
//   col0: h0, h3, 0, h6
//   col1: h1, h4, 0, h7
//   col2: 0,  0,  1, 0
//   col3: h2, h5, 0, h8
export function toMatrix3d(h: number[]): string {
  return `matrix3d(${h[0]}, ${h[3]}, 0, ${h[6]}, ${h[1]}, ${h[4]}, 0, ${h[7]}, 0, 0, 1, 0, ${h[2]}, ${h[5]}, 0, ${h[8]})`;
}

// A self-intersecting (bow-tie) or collapsed quad still solves to a finite,
// non-singular homography, but the projection folds over itself. Convexity is
// checked by requiring the cross products of consecutive edges to share one
// sign (either winding); a zero cross product means collinear corners, which
// is rejected too.
export function isConvexQuad(quad: Pair[]): boolean {
  if (quad.length !== 4) return false;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = quad[i];
    const [bx, by] = quad[(i + 1) % 4];
    const [cx, cy] = quad[(i + 2) % 4];
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (Math.abs(cross) < 1e-9) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

// A convex quad with reversed winding can only arise from a reflection: for
// the TL,TR,BR,BL corner order in screen coordinates the shoelace signed area
// is positive, so a negative sign means the corners were swapped and the
// projection would come out mirror-imaged. Only meaningful for convex quads.
export function isMirroredQuad(quad: Pair[]): boolean {
  if (quad.length !== 4) return false;
  let area2 = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = quad[i];
    const [bx, by] = quad[(i + 1) % 4];
    area2 += ax * by - bx * ay;
  }
  return area2 < 0;
}

// Degenerate when the 3×3 matrix is near-singular: dragging two handles to the
// same point or making three collinear collapses the perspective transform.
export function isDegenerate(h: number[]): boolean {
  if (!h.every(isFinite)) return true;
  const det =
    h[0] * (h[4] * h[8] - h[5] * h[7]) -
    h[1] * (h[3] * h[8] - h[5] * h[6]) +
    h[2] * (h[3] * h[7] - h[4] * h[6]);
  return Math.abs(det) < 1e-9;
}
