<script lang="ts">
  import { featuresToRenderables, type Renderable } from './geojsonRender';
  import { onKey } from './keybinds';
  import { datasetFitBbox, type Dataset } from './storage';

  let { dataset, panX, panY, onPan } = $props<{
    dataset: Dataset;
    panX: number;
    panY: number;
    onPan: (x: number, y: number) => void;
  }>();

  let width = $state(window.innerWidth);
  let height = $state(window.innerHeight);

  const PADDING_PX = 40;
  // Pan step in screen pixels per arrow press. Held modifiers shift the
  // granularity: Alt for sub-cm fine-tune at 4K, Shift for fast coarse moves.
  // Alt takes priority if both are held (precision wins). On macOS the OS
  // can intercept Alt+Arrow for Mission Control before the browser sees the
  // event — fine-pan may silently no-op there until the OS shortcut is off.
  const PAN_STEP_DEFAULT = 10;
  const PAN_STEP_FINE = 1;
  const PAN_STEP_COARSE = 50;

  function stepFromEvent(e: KeyboardEvent): number {
    if (e.altKey) return PAN_STEP_FINE;
    if (e.shiftKey) return PAN_STEP_COARSE;
    return PAN_STEP_DEFAULT;
  }

  function onResize() {
    width = window.innerWidth;
    height = window.innerHeight;
  }

  $effect(() => {
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  $effect(() => {
    const nudge = (dirX: number, dirY: number) => (e: KeyboardEvent) => {
      e.preventDefault();
      const step = stepFromEvent(e);
      onPan(panX + dirX * step, panY + dirY * step);
    };
    const reset = (e: KeyboardEvent) => {
      e.preventDefault();
      onPan(0, 0);
    };
    const offs = [
      onKey('ArrowLeft', nudge(-1, 0)),
      onKey('ArrowRight', nudge(1, 0)),
      onKey('ArrowUp', nudge(0, -1)),
      onKey('ArrowDown', nudge(0, 1)),
      onKey('r', reset),
      onKey('R', reset),
    ];
    return () => offs.forEach((off) => off());
  });

  // Square reference frame — fixed in the viewport, centered, equal sides.
  const square = $derived.by(() => {
    const side = Math.max(1, Math.min(width, height) - 2 * PADDING_PX);
    return {
      side,
      x: (width - side) / 2,
      y: (height - side) / 2,
    };
  });

  // Direct fit-into-square + pan offset. EPSG:3006 is metric Cartesian, no
  // cos-lat correction; the y-axis flip stays because northing grows
  // northward but screen Y grows downward.
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
    if (!isFinite(scale)) scale = 1; // single point or empty extent
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

<div class="fixed inset-0 bg-black">
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
