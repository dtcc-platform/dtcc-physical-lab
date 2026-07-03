<script lang="ts">
  import { featuresToRenderables, type Renderable } from './geojsonRender';
  import {
    solveHomography,
    toMatrix3d,
    isDegenerate,
    isConvexQuad,
    isMirroredQuad,
  } from './homography';
  import { onKey, stepFromEvent } from './keybinds';
  import MediaLayer from './MediaLayer.svelte';
  import { datasetFitBbox, type Dataset } from './storage';

  type MediaFrame = { x: number; y: number; width: number; height: number };

  let { dataset, panX, panY, onCornersChange, seedCorners, barHidden, onBarHiddenChange } = $props<{
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
    // Bar visibility lives in App (like seedCorners, read at mount only) so
    // the user's choice survives the {#key} remount and step navigation for
    // the rest of the session.
    barHidden?: boolean;
    onBarHiddenChange?: (hidden: boolean) => void;
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

  // Canonical physical-domain vertex order (issue #22): user-facing numbers
  // start at the lower-left and go counter-clockwise — 1 lower-left,
  // 2 lower-right, 3 upper-right, 4 upper-left. The internal `corners` array
  // stays in screen order (TL, TR, BR, BL) so the homography, src corners, and
  // saved calibrations are untouched; only the displayed number, the handle's
  // accessible name, and the 1–4 selection shortcut are remapped.
  //   CANONICAL_TO_INTERNAL[n-1] → internal index of canonical corner n.
  //   INTERNAL_TO_CANONICAL[i]   → canonical number shown at internal corner i.
  const CANONICAL_TO_INTERNAL = [3, 2, 1, 0] as const;
  const INTERNAL_TO_CANONICAL = [4, 3, 2, 1] as const;

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

  function startingBarHidden(): boolean {
    return barHidden ?? false;
  }

  let corners: CornerQuad = $state(startingCorners());
  let dragIndex: number | null = $state(null);
  let hideBar = $state(startingBarHidden());

  function toggleBar() {
    hideBar = !hideBar;
    onBarHiddenChange?.(hideBar);
  }
  // Keyboard target: exactly one corner is always selected so the arrow keys
  // have something to move; grabbing a handle with the pointer re-selects it.
  let selectedIndex = $state(CANONICAL_TO_INTERNAL[0]);

  // Square corners in screen space — the homography src.
  const srcCorners = $derived.by(() => [
    [square.x, square.y],
    [square.x + square.side, square.y],
    [square.x + square.side, square.y + square.side],
    [square.x, square.y + square.side],
  ] as [number, number][]);

  const dstCorners = $derived(corners.map((c) => [c.x, c.y]) as [number, number][]);

  // Quad centroid decides which way each square handle points inward (see the
  // handle markup below).
  const centroid = $derived({
    x: (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4,
    y: (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4,
  });

  // Rotate each handle about its corner-anchored origin so the square's
  // diagonal points at the centroid. The outer corner stays exactly on the
  // calibration point and the body extends inward, which keeps the box inside
  // any quad with right-angled vertices (rotated rectangles included) at any
  // rotation. Vertices squeezed well below 90° by extreme keystone can still
  // clip slightly — acceptable for a 24px handle.
  function handleRotation(c: Corner): number {
    return (Math.atan2(centroid.y - c.y, centroid.x - c.x) * 180) / Math.PI - 45;
  }

  const homography = $derived.by(() => solveHomography(srcCorners, dstCorners));
  // Bow-tie, concave, and collapsed quads all fold the projection; a convex
  // but reverse-wound quad would project mirror-imaged. Either way the
  // homography is withheld so App keeps Next disabled.
  const nonConvex = $derived(!isConvexQuad(dstCorners));
  const mirrored = $derived(!nonConvex && isMirroredQuad(dstCorners));
  const degenerate = $derived(homography === null || isDegenerate(homography));
  const invalid = $derived(degenerate || nonConvex || mirrored);
  const transformCss = $derived(homography === null ? 'none' : toMatrix3d(homography));

  // Shown in the help bar, and standalone when the bar is hidden — Next is
  // disabled while invalid, so the explanation must never be hidden with it.
  const warning = $derived(
    nonConvex
      ? 'Corners fold — keep the quad convex'
      : mirrored
        ? 'Corners swapped — projection would mirror'
        : degenerate
          ? 'Degenerate — spread the corners'
          : null,
  );

  // Push current corner state up to App so the parent can save calibration on Next.
  $effect(() => {
    onCornersChange(
      [
        [corners[0].x, corners[0].y],
        [corners[1].x, corners[1].y],
        [corners[2].x, corners[2].y],
        [corners[3].x, corners[3].y],
      ],
      invalid ? null : homography,
      width,
      height,
    );
  });

  // Pointer-to-corner offset captured at grab time, so dragging moves the
  // corner relative to where the handle was grabbed instead of snapping the
  // corner onto the pointer.
  let dragOffset = { x: 0, y: 0 };

  function startDrag(i: number, e: PointerEvent) {
    dragIndex = i;
    selectedIndex = i;
    dragOffset = { x: corners[i].x - e.clientX, y: corners[i].y - e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  // Each corner moves freely and independently, so the quad can match a
  // rotated or tilted physical model. Collapsed or self-intersecting quads
  // are allowed mid-drag; the `invalid` guard above withholds the homography
  // (disabling Next in App) and the help bar explains what to fix.
  function move(e: PointerEvent) {
    if (dragIndex === null) return;
    const next: CornerQuad = [...corners] as CornerQuad;
    next[dragIndex] = { x: e.clientX + dragOffset.x, y: e.clientY + dragOffset.y };
    corners = next;
  }

  function endDrag(e: PointerEvent) {
    dragIndex = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }

  function reset() {
    corners = initialCorners();
  }

  // Full keyboard calibration, mirroring the step-3 pan bindings: 1–4 selects
  // a corner, arrows nudge it (stepFromEvent granularity), r resets. Tab is
  // deliberately NOT intercepted: the handles are buttons in the native tab
  // order and focusing one selects it (onfocus below), so Tab both cycles
  // corners and can travel onward to the help bar and control panel — the
  // whole step stays completable keyboard-only without trapping focus.
  // Keyboard input that mutates corners is ignored mid-drag so a pointermove
  // can't clobber it; the bar toggle (h) is exempt since it only affects UI.
  $effect(() => {
    const nudge = (dx: number, dy: number) => (e: KeyboardEvent) => {
      if (dragIndex !== null) return;
      e.preventDefault();
      const step = stepFromEvent(e);
      const next: CornerQuad = [...corners] as CornerQuad;
      next[selectedIndex] = {
        x: corners[selectedIndex].x + dx * step,
        y: corners[selectedIndex].y + dy * step,
      };
      corners = next;
    };
    const select = (i: number) => (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      selectedIndex = i;
    };
    const resetKey = (e: KeyboardEvent) => {
      // Leave Cmd+R / Ctrl+R to the browser (reload) — only a bare keypress
      // is a deliberate corner reset.
      if (e.metaKey || e.ctrlKey) return;
      if (dragIndex !== null) return;
      e.preventDefault();
      reset();
    };
    const toggleBarKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      toggleBar();
    };
    const offs = [
      onKey('ArrowLeft', nudge(-1, 0)),
      onKey('ArrowRight', nudge(1, 0)),
      onKey('ArrowUp', nudge(0, -1)),
      onKey('ArrowDown', nudge(0, 1)),
      onKey('1', select(CANONICAL_TO_INTERNAL[0])),
      onKey('2', select(CANONICAL_TO_INTERNAL[1])),
      onKey('3', select(CANONICAL_TO_INTERNAL[2])),
      onKey('4', select(CANONICAL_TO_INTERNAL[3])),
      onKey('r', resetKey),
      onKey('R', resetKey),
      onKey('h', toggleBarKey),
      onKey('H', toggleBarKey),
    ];
    return () => offs.forEach((off) => off());
  });

  // Corner numbers sit just outside the calibration area, pushed away from
  // the centroid, so they project onto the table surface rather than the
  // raised physical model (issue #12) while labeling the 1–4 shortcuts.
  const LABEL_MARGIN_PX = 28;

  function labelPos(c: Corner): Corner {
    const dx = c.x - centroid.x;
    const dy = c.y - centroid.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: c.x + (dx / len) * LABEL_MARGIN_PX, y: c.y + (dy / len) * LABEL_MARGIN_PX };
  }

  // Direct fit-into-square + pan offset, identical to step 3. The CSS
  // matrix3d transform is then applied on top to warp the rendered SVG.
  const projection = $derived.by(() => {
    const bbox = datasetFitBbox(dataset);
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
    if (dataset.content.kind !== 'geojson' || !projection) return [];
    return featuresToRenderables(dataset.content.geojson, projection);
  });

  const mediaFrame = $derived.by<MediaFrame | null>(() => {
    if (dataset.content.kind === 'geojson' || !projection) return null;
    const [minX, minY, maxX, maxY] = dataset.bounds;
    const [x, y] = projection(minX, maxY);
    const [right, bottom] = projection(maxX, minY);
    return { x, y, width: right - x, height: bottom - y };
  });

  const color = $derived(dataset.content.kind === 'geojson' ? dataset.content.style.color : '#38bdf8');
</script>

<div class="fixed inset-0 bg-black select-none" style="touch-action: none">
  <!-- Warped layer: square + geojson, transformed live as the user drags handles. -->
  <div
    class="absolute inset-0 pointer-events-none"
    style="transform: {transformCss}; transform-origin: 0 0;"
  >
    {#if dataset.content.kind !== 'geojson' && mediaFrame}
      <MediaLayer content={dataset.content} frame={mediaFrame} />
    {/if}
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
      {#if dataset.content.kind === 'geojson'}
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
      {/if}
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
  <!-- Square handles: the outer corner of each square sits exactly on the
       calibration point and the body extends toward the quad centroid (see
       handleRotation), so the whole indicator stays inside the calibration
       area (and on the physical model surface) instead of straddling the
       corner. z-10 keeps handles grabbable above the help bar. -->
  {#each CANONICAL_TO_INTERNAL as i (i)}
    {@const c = corners[i]}
    <button
      class="absolute z-10 w-6 h-6 bg-dtcc-orange border-2 cursor-move {selectedIndex === i
        ? 'border-dtcc-yellow ring-2 ring-dtcc-yellow'
        : 'border-white'}"
      style="left: {c.x}px; top: {c.y}px; transform-origin: 0 0; transform: rotate({handleRotation(c)}deg);"
      onpointerdown={(e) => startDrag(i, e)}
      onpointermove={move}
      onpointerup={endDrag}
      onpointercancel={endDrag}
      onfocus={() => (selectedIndex = i)}
      aria-label={`Calibration corner ${INTERNAL_TO_CANONICAL[i]}`}
      aria-pressed={selectedIndex === i}
    ></button>
  {/each}

  <!-- Number labels for the 1–4 keyboard shortcuts, outside the quad so they
       land on the table, not the model. Decorative for screen readers — the
       handles above carry the accessible names. -->
  {#each CANONICAL_TO_INTERNAL as i (i)}
    {@const c = corners[i]}
    {@const pos = labelPos(c)}
    <span
      class="absolute -translate-x-1/2 -translate-y-1/2 text-sm font-bold select-none pointer-events-none {selectedIndex ===
      i
        ? 'text-dtcc-yellow'
        : 'text-white/70'}"
      style="left: {pos.x}px; top: {pos.y}px;"
      data-corner-label={INTERNAL_TO_CANONICAL[i]}
      aria-hidden="true"
    >{INTERNAL_TO_CANONICAL[i]}</span>
  {/each}

  {#if !hideBar}
    <!-- Docked top-left (issue #21): top-center overlapped the grid's top edge
         and the two top corner handles. A capped width with a wrapping button
         row keeps the box tucked in the corner instead of spanning the top
         edge. The H / × toggle stays the escape hatch for the rare case a
         corner dragged to the top-left still reaches it. -->
    <div class="absolute top-4 left-4 max-w-xs bg-white/90 text-dtcc-dark px-4 py-2 rounded-lg shadow-lg flex flex-col items-start gap-2">
      <span class="text-sm">
        Drag or select a corner (Tab / 1–4), arrows move it (Shift coarse, ⌥ fine), R resets, H hides.
      </span>
      <div class="flex flex-wrap items-center gap-2">
        <button class="px-3 py-1 text-xs rounded bg-dtcc-gray-light" onclick={reset}>Reset corners</button>
        {#if warning}
          <span class="text-xs text-dtcc-red">{warning}</span>
        {/if}
        <button
          class="px-2 py-1 text-xs rounded bg-dtcc-gray-light"
          onclick={toggleBar}
          aria-label="Hide instructions"
        >×</button>
      </div>
    </div>
  {:else}
    <!-- Recovery chip + standalone validity warning, stacked in the same
         top-left area so they never overlap each other. The warning stays
         visible while the bar is hidden — hiding the bar must never hide the
         reason Next is disabled. -->
    <div class="absolute top-4 left-4 flex flex-col items-start gap-2">
      <button
        class="w-7 h-7 rounded-full bg-white/20 text-white/70 text-sm"
        onclick={toggleBar}
        aria-label="Show instructions"
        title="Show instructions (H)"
      >?</button>
      {#if warning}
        <div class="bg-white/90 px-3 py-1.5 rounded-lg shadow-lg flex items-center gap-2">
          <span class="text-xs text-dtcc-red">{warning}</span>
          <span class="text-xs text-dtcc-muted">R resets</span>
        </div>
      {/if}
    </div>
  {/if}
</div>
