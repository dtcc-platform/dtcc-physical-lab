<script lang="ts">
  import { featureCollectionBbox } from './geojson';
  import { featuresToRenderables, type Renderable } from './geojsonRender';
  import { solveHomography, toMatrix3d, isDegenerate } from './homography';
  import type { Dataset } from './storage';

  let { dataset, panX, panY, onCornersChange, seedCorners } = $props<{
    dataset: Dataset;
    panX: number;
    panY: number;
    onCornersChange: (
      cornerDst: [[number, number], [number, number], [number, number], [number, number]],
      homography: number[] | null,
      sourceWidth: number,
      sourceHeight: number,
    ) => void;
    seedCorners?: { x: number; y: number }[];
  }>();

  let width = $state(window.innerWidth);
  let height = $state(window.innerHeight);

  function onResize() {
    width = window.innerWidth;
    height = window.innerHeight;
  }
  $effect(() => {
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  const PADDING_PX = 40;

  // Same square reference frame as step 3.
  const square = $derived.by(() => {
    const side = Math.max(1, Math.min(width, height) - 2 * PADDING_PX);
    return {
      side,
      x: (width - side) / 2,
      y: (height - side) / 2,
    };
  });

  type Corner = { x: number; y: number };
  type CornerQuad = [Corner, Corner, Corner, Corner];

  // Initialize handles at the square's 4 corners (TL, TR, BR, BL) at mount
  // time, using window dimensions directly so the initializer doesn't depend
  // on the reactive `square` derived.
  function initialCorners(): CornerQuad {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const side = Math.max(1, Math.min(w, h) - 2 * PADDING_PX);
    const x = (w - side) / 2;
    const y = (h - side) / 2;
    return [
      { x, y },
      { x: x + side, y },
      { x: x + side, y: y + side },
      { x, y: y + side },
    ];
  }

  // When App provides `seedCorners` (e.g. on 4→3→4 preservation, or after a
  // 5→4 back navigation that rescales the saved calibration into the current
  // viewport), use those as the starting handle positions. Otherwise fall back
  // to the viewport-derived default. Only the value at mount matters; later
  // updates to `seedCorners` are ignored — the wizard re-creates this
  // component when the user navigates away and back, which is the
  // re-initialization boundary we want. Wrapping the read in a function keeps
  // Svelte 5's static analyzer from flagging the prop access as a reactive
  // read inside a $state initializer (state_referenced_locally).
  function startingCorners(): CornerQuad {
    if (seedCorners && seedCorners.length === 4) {
      return [
        { x: seedCorners[0].x, y: seedCorners[0].y },
        { x: seedCorners[1].x, y: seedCorners[1].y },
        { x: seedCorners[2].x, y: seedCorners[2].y },
        { x: seedCorners[3].x, y: seedCorners[3].y },
      ];
    }
    return initialCorners();
  }

  let corners: CornerQuad = $state(startingCorners());
  let dragIndex: number | null = $state(null);

  // Square corners in screen space — the homography src.
  const srcCorners = $derived.by(() => [
    [square.x, square.y],
    [square.x + square.side, square.y],
    [square.x + square.side, square.y + square.side],
    [square.x, square.y + square.side],
  ] as [number, number][]);

  const dstCorners = $derived(corners.map((c) => [c.x, c.y]) as [number, number][]);

  const homography = $derived.by(() => solveHomography(srcCorners, dstCorners));
  const degenerate = $derived(homography === null || isDegenerate(homography));
  const transformCss = $derived(homography === null ? 'none' : toMatrix3d(homography));

  // Push current corner state up to App so the parent can save calibration on Next.
  $effect(() => {
    onCornersChange(
      [
        [corners[0].x, corners[0].y],
        [corners[1].x, corners[1].y],
        [corners[2].x, corners[2].y],
        [corners[3].x, corners[3].y],
      ],
      degenerate ? null : homography,
      width,
      height,
    );
  });

  function startDrag(i: number, e: PointerEvent) {
    dragIndex = i;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  // Minimum 1px gap between paired corners — keeps the rectangle from
  // collapsing to zero width or height (which would make the homography
  // degenerate). Crossing past the opposite corner is also blocked here so
  // the user can never invert the rectangle mid-drag.
  const MIN_GAP_PX = 1;

  function move(e: PointerEvent) {
    if (dragIndex === null) return;
    const next: CornerQuad = [...corners] as CornerQuad;

    // Constrain to an axis-aligned rectangle: dragging one corner pins the
    // y of its horizontal pair and the x of its vertical pair, so all edges
    // stay parallel to the viewport axes (90° corners only). Crossing the
    // opposite corner is clamped so the rectangle can't invert.
    // Order is TL=0, TR=1, BR=2, BL=3.
    if (dragIndex === 0) {
      const x = Math.min(e.clientX, corners[1].x - MIN_GAP_PX);
      const y = Math.min(e.clientY, corners[3].y - MIN_GAP_PX);
      next[0] = { x, y };
      next[1] = { x: corners[1].x, y };
      next[3] = { x, y: corners[3].y };
    } else if (dragIndex === 1) {
      const x = Math.max(e.clientX, corners[0].x + MIN_GAP_PX);
      const y = Math.min(e.clientY, corners[2].y - MIN_GAP_PX);
      next[1] = { x, y };
      next[0] = { x: corners[0].x, y };
      next[2] = { x, y: corners[2].y };
    } else if (dragIndex === 2) {
      const x = Math.max(e.clientX, corners[3].x + MIN_GAP_PX);
      const y = Math.max(e.clientY, corners[1].y + MIN_GAP_PX);
      next[2] = { x, y };
      next[1] = { x, y: corners[1].y };
      next[3] = { x: corners[3].x, y };
    } else {
      const x = Math.min(e.clientX, corners[2].x - MIN_GAP_PX);
      const y = Math.max(e.clientY, corners[0].y + MIN_GAP_PX);
      next[3] = { x, y };
      next[0] = { x, y: corners[0].y };
      next[2] = { x: corners[2].x, y };
    }

    corners = next;
  }

  function endDrag(e: PointerEvent) {
    dragIndex = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }

  function reset() {
    corners = initialCorners();
  }

  // Direct fit-into-square + pan offset, identical to step 3. The CSS
  // matrix3d transform is then applied on top to warp the rendered SVG.
  const projection = $derived.by(() => {
    const bbox = featureCollectionBbox(dataset.geojson);
    if (!bbox) return null;
    const [minX, minY, maxX, maxY] = bbox;
    const dataW = maxX - minX;
    const dataH = maxY - minY;

    const sq = square;
    const scaleW = dataW > 0 ? sq.side / dataW : Infinity;
    const scaleH = dataH > 0 ? sq.side / dataH : Infinity;
    let scale = Math.min(scaleW, scaleH);
    if (!isFinite(scale)) scale = 1;
    const baseOffsetX = sq.x + (sq.side - dataW * scale) / 2;
    const baseOffsetY = sq.y + (sq.side - dataH * scale) / 2;

    const ox = baseOffsetX + panX;
    const oy = baseOffsetY + panY;
    return (x: number, y: number): [number, number] => [
      ox + (x - minX) * scale,
      oy + (maxY - y) * scale,
    ];
  });

  const renderables = $derived.by<Renderable[]>(() => {
    if (!projection) return [];
    return featuresToRenderables(dataset.geojson, projection);
  });

  const color = $derived(dataset.style.color);
</script>

<div class="fixed inset-0 bg-black select-none" style="touch-action: none">
  <!-- Warped layer: square + geojson, transformed live as the user drags handles. -->
  <div
    class="absolute inset-0 pointer-events-none"
    style="transform: {transformCss}; transform-origin: 0 0;"
  >
    <svg
      class="absolute inset-0"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x={square.x}
        y={square.y}
        width={square.side}
        height={square.side}
        fill="none"
        stroke="#FADA36"
        stroke-width="2"
      />
      <g fill-rule="evenodd">
        {#each renderables as r, i (i)}
          {#if r.kind === 'polygon'}
            <path d={r.d} fill={color} fill-opacity="0.45" stroke={color} stroke-width="2" />
          {:else if r.kind === 'line'}
            <path d={r.d} fill="none" stroke={color} stroke-width="2" />
          {:else}
            <circle cx={r.cx} cy={r.cy} r="4" fill={color} stroke="#fff" stroke-width="1" />
          {/if}
        {/each}
      </g>
    </svg>
  </div>

  <!-- Quad outline + draggable handles in screen space, on top of the warped layer. -->
  <svg class="absolute inset-0 pointer-events-none" width={width} height={height}>
    <polygon
      points={corners.map((c) => `${c.x},${c.y}`).join(' ')}
      fill="none"
      stroke="#FADA36"
      stroke-width="2"
      stroke-dasharray="8 4"
    />
  </svg>
  {#each corners as c, i (i)}
    <button
      class="absolute w-6 h-6 rounded-full bg-dtcc-orange border-2 border-white cursor-move -translate-x-1/2 -translate-y-1/2"
      style="left: {c.x}px; top: {c.y}px;"
      onpointerdown={(e) => startDrag(i, e)}
      onpointermove={move}
      onpointerup={endDrag}
      onpointercancel={endDrag}
      aria-label={`Calibration corner ${i + 1}`}
    ></button>
  {/each}

  <div class="absolute top-4 left-1/2 -translate-x-1/2 bg-white/90 text-dtcc-dark px-4 py-2 rounded-lg shadow-lg flex items-center gap-3">
    <span class="text-sm">Drag the orange corners onto the physical model's corners.</span>
    <button class="px-3 py-1 text-xs rounded bg-dtcc-gray-light" onclick={reset}>Reset corners</button>
    {#if degenerate}
      <span class="text-xs text-dtcc-red">Degenerate — spread the corners</span>
    {/if}
  </div>
</div>
