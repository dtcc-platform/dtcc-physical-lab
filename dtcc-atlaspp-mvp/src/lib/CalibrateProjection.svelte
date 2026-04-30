<script lang="ts">
  import { featureCollectionBbox } from './geojson';
  import { featuresToRenderables, type Renderable } from './geojsonRender';
  import { solveHomography, toMatrix3d, isDegenerate } from './homography';
  import type { Dataset, Calibration } from './storage';

  let { dataset, calibration } = $props<{
    dataset: Dataset;
    calibration: Calibration;
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

  // Resolution scale for one axis: ratio of current to saved viewport size,
  // clamped to identity when the saved dimension is non-positive (corrupt save
  // or uninitialized). Window dimensions are never legitimately 0, so the
  // <= 0 guard only fires on bad data.
  function scaleFactor(saved: number, current: number): number {
    return saved > 0 ? current / saved : 1;
  }

  // Same square reference frame as steps 3/4. The saved homography is
  // re-solved against this current-viewport square below.
  const square = $derived.by(() => {
    const side = Math.max(1, Math.min(width, height) - 2 * PADDING_PX);
    return { side, x: (width - side) / 2, y: (height - side) / 2 };
  });

  // Resolution-tolerant homography. The saved cornerDst lives in the source
  // viewport's pixel space; rescale by the per-axis ratio and re-solve so the
  // projection survives a window resize (or a different display) without an
  // explicit re-calibration step.
  //
  // `calibration.homography` is persisted but intentionally unused here — we
  // always re-solve from cornerDst against the current viewport's square so
  // the math composes correctly with the live equirectangular projection.
  const transformCss = $derived.by(() => {
    const sx = scaleFactor(calibration.sourceWidth, width);
    const sy = scaleFactor(calibration.sourceHeight, height);
    const scaledCornerDst: [number, number][] = calibration.cornerDst.map(
      (p: [number, number]): [number, number] => [p[0] * sx, p[1] * sy]
    );
    const sq = square;
    const srcCorners: [number, number][] = [
      [sq.x, sq.y],
      [sq.x + sq.side, sq.y],
      [sq.x + sq.side, sq.y + sq.side],
      [sq.x, sq.y + sq.side],
    ];
    const h = solveHomography(srcCorners, scaledCornerDst);
    if (h === null || isDegenerate(h)) return 'none';
    return toMatrix3d(h);
  });

  // Equirectangular fit-into-square + saved pan offset. Pan is also in saved
  // viewport pixel space, so it gets scaled the same way.
  const projection = $derived.by(() => {
    const bbox = featureCollectionBbox(dataset.geojson);
    if (!bbox) return null;
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const lonRange = maxLon - minLon;
    const latRange = maxLat - minLat;
    const cosLat = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
    const dataW = lonRange * cosLat;
    const dataH = latRange;

    const sq = square;
    const scaleW = dataW > 0 ? sq.side / dataW : Infinity;
    const scaleH = dataH > 0 ? sq.side / dataH : Infinity;
    let scale = Math.min(scaleW, scaleH);
    if (!isFinite(scale)) scale = 1;
    const baseOffsetX = sq.x + (sq.side - dataW * scale) / 2;
    const baseOffsetY = sq.y + (sq.side - dataH * scale) / 2;

    const sx = scaleFactor(calibration.sourceWidth, width);
    const sy = scaleFactor(calibration.sourceHeight, height);
    const ox = baseOffsetX + calibration.panX * sx;
    const oy = baseOffsetY + calibration.panY * sy;
    return (lon: number, lat: number): [number, number] => [
      ox + (lon - minLon) * cosLat * scale,
      oy + (maxLat - lat) * scale,
    ];
  });

  const renderables = $derived.by<Renderable[]>(() => {
    if (!projection) return [];
    return featuresToRenderables(dataset.geojson, projection);
  });

  const color = $derived(dataset.style.color);

  // Format savedAt as YYYY-MM-DD HH:MM in local time so an operator can spot
  // a stale calibration at a glance.
  function formatSavedAt(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // True only when actual scaling happened. Suppresses the misleading
  // "scaled from 0×0" footer if the persisted record has corrupt dimensions
  // (we fall back to scale = 1 in that case, no scaling actually occurs).
  const resScaled = $derived(
    calibration.sourceWidth > 0 &&
    calibration.sourceHeight > 0 &&
    (width !== calibration.sourceWidth || height !== calibration.sourceHeight)
  );
</script>

<div class="fixed inset-0 bg-black" tabindex="-1">
  <div
    class="absolute inset-0 pointer-events-none"
    style="transform: {transformCss}; transform-origin: 0 0;"
  >
    <svg
      class="absolute inset-0 pointer-events-none"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      xmlns="http://www.w3.org/2000/svg"
    >
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
  <div class="fixed bottom-2 left-2 text-[10px] text-white/40 pointer-events-none select-none">
    cal: {formatSavedAt(calibration.savedAt)}{#if resScaled} · scaled from {calibration.sourceWidth}×{calibration.sourceHeight}{/if}
  </div>
</div>
