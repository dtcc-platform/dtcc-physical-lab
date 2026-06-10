import { describe, it, expect } from 'vitest';
import {
  solveHomography,
  toMatrix3d,
  isDegenerate,
  isConvexQuad,
  isMirroredQuad,
} from '../src/lib/homography';

const square: [number, number][] = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
];

function applyH(h: number[], x: number, y: number): [number, number] {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

describe('solveHomography', () => {
  it('returns identity when src equals dst', () => {
    const h = solveHomography(square, square);
    expect(h).not.toBeNull();
    if (!h) return;
    // Apply to an interior point — should return the point unchanged.
    const [x, y] = applyH(h, 50, 50);
    expect(x).toBeCloseTo(50, 6);
    expect(y).toBeCloseTo(50, 6);
  });

  it('handles a pure translation', () => {
    const dst = square.map(([x, y]) => [x + 10, y + 20]) as [number, number][];
    const h = solveHomography(square, dst);
    expect(h).not.toBeNull();
    if (!h) return;
    const [x, y] = applyH(h, 50, 50);
    expect(x).toBeCloseTo(60, 6);
    expect(y).toBeCloseTo(70, 6);
  });

  it('handles a perspective warp (src corners → trapezoid)', () => {
    // Top edge gets squeezed inward, simulating perspective.
    const dst: [number, number][] = [
      [25, 0],
      [75, 0],
      [100, 100],
      [0, 100],
    ];
    const h = solveHomography(square, dst);
    expect(h).not.toBeNull();
    if (!h) return;
    // Each src corner must map exactly to its dst corner.
    for (let i = 0; i < 4; i++) {
      const [x, y] = applyH(h, square[i][0], square[i][1]);
      expect(x).toBeCloseTo(dst[i][0], 4);
      expect(y).toBeCloseTo(dst[i][1], 4);
    }
  });

  it('returns null when fewer than 4 points are given', () => {
    expect(solveHomography(square.slice(0, 3), square.slice(0, 3))).toBeNull();
  });

  it('returns null when three dst corners are collinear (degenerate)', () => {
    const dst: [number, number][] = [
      [0, 0],
      [50, 0],
      [100, 0], // three points on a horizontal line
      [0, 100],
    ];
    const result = solveHomography(square, dst);
    // Either solver returns null OR the returned h is detected as degenerate.
    expect(result === null || isDegenerate(result)).toBe(true);
  });
});

describe('toMatrix3d', () => {
  it('emits a column-major matrix3d string for the identity', () => {
    const id = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    expect(toMatrix3d(id)).toBe(
      'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)'
    );
  });

  it('places translation values in the last column', () => {
    const tx = [1, 0, 30, 0, 1, 40, 0, 0, 1];
    // CSS matrix3d column-major: c0=(1,0,0,0), c1=(0,1,0,0), c2=(0,0,1,0), c3=(30,40,0,1)
    expect(toMatrix3d(tx)).toBe(
      'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 30, 40, 0, 1)'
    );
  });
});

describe('isConvexQuad', () => {
  it('returns true for an axis-aligned square (CW winding)', () => {
    expect(isConvexQuad(square)).toBe(true);
  });

  it('returns true for the same square in CCW winding', () => {
    expect(isConvexQuad([...square].reverse() as [number, number][])).toBe(true);
  });

  it('returns true for a rotated/tilted quad', () => {
    expect(
      isConvexQuad([
        [50, 0],
        [100, 50],
        [50, 100],
        [0, 50],
      ]),
    ).toBe(true);
  });

  it('returns false for a self-intersecting (bow-tie) quad', () => {
    // Two adjacent corners swapped: top edge crosses the bottom edge.
    expect(
      isConvexQuad([
        [100, 0],
        [0, 0],
        [100, 100],
        [0, 100],
      ]),
    ).toBe(false);
  });

  it('returns false when three corners are collinear', () => {
    expect(
      isConvexQuad([
        [0, 0],
        [50, 0],
        [100, 0],
        [0, 100],
      ]),
    ).toBe(false);
  });

  it('returns false for a concave (dart) quad', () => {
    // One corner dented inward: the projection folds even though no edges cross.
    expect(
      isConvexQuad([
        [0, 0],
        [100, 0],
        [50, 40],
        [0, 100],
      ]),
    ).toBe(false);
  });
});

describe('isMirroredQuad', () => {
  it('returns false for the TL,TR,BR,BL screen-space order', () => {
    expect(isMirroredQuad(square)).toBe(false);
  });

  it('returns true when the quad winding is reversed (reflection)', () => {
    // TL↔TR and BL↔BR swapped: convex, but projects mirror-imaged.
    expect(
      isMirroredQuad([
        [100, 0],
        [0, 0],
        [0, 100],
        [100, 100],
      ]),
    ).toBe(true);
  });
});

describe('isDegenerate', () => {
  it('returns false for the identity', () => {
    expect(isDegenerate([1, 0, 0, 0, 1, 0, 0, 0, 1])).toBe(false);
  });

  it('returns true for a singular matrix', () => {
    // All zero rows → det = 0
    expect(isDegenerate([0, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(true);
  });

  it('returns true for any non-finite entry', () => {
    expect(isDegenerate([1, 0, 0, 0, NaN, 0, 0, 0, 1])).toBe(true);
    expect(isDegenerate([1, 0, 0, 0, 1, 0, 0, 0, Infinity])).toBe(true);
  });
});
