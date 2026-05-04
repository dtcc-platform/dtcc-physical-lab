<script lang="ts">
  import { featureCollectionBbox } from './geojson';
  import { featuresToRenderables, type Renderable } from './geojsonRender';
  import type { Dataset } from './storage';

  let { dataset } = $props<{ dataset: Dataset | null }>();

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

  // EPSG:3006 (SWEREF99 TM) is metric Cartesian, so the projection is a
  // direct fit-into-viewport. No cosine-latitude correction. Y-axis flip
  // because northing grows northward but screen Y grows downward.
  const projection = $derived.by(() => {
    if (!dataset) return null;
    const bbox = featureCollectionBbox(dataset.geojson);
    if (!bbox) return null;
    const [minX, minY, maxX, maxY] = bbox;
    const dataW = maxX - minX;
    const dataH = maxY - minY;

    const availW = Math.max(1, width - 2 * PADDING_PX);
    const availH = Math.max(1, height - 2 * PADDING_PX);
    const scaleW = dataW > 0 ? availW / dataW : Infinity;
    const scaleH = dataH > 0 ? availH / dataH : Infinity;
    let scale = Math.min(scaleW, scaleH);
    if (!isFinite(scale)) scale = 1; // single point or empty extent
    const offsetX = (width - dataW * scale) / 2;
    const offsetY = (height - dataH * scale) / 2;

    return (x: number, y: number): [number, number] => [
      offsetX + (x - minX) * scale,
      offsetY + (maxY - y) * scale,
    ];
  });

  const renderables = $derived.by<Renderable[]>(() => {
    if (!dataset || !projection) return [];
    return featuresToRenderables(dataset.geojson, projection);
  });

  const color = $derived(dataset?.style.color ?? '#38bdf8');
</script>

<div class="fixed inset-0 bg-black">
  {#if dataset && projection}
    <svg
      class="absolute inset-0"
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
  {/if}
</div>
