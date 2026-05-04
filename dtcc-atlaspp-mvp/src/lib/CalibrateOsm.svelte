<script lang="ts">
  import maplibregl, { type Map as MLMap } from 'maplibre-gl';
  import { untrack } from 'svelte';
  import { featureCollectionBbox, type FeatureCollection } from './geojson';
  import { swerefToWgs84, reprojectFcToWgs84 } from './sweref99tm';
  import type { Dataset } from './storage';

  let { dataset } = $props<{ dataset: Dataset }>();

  let container: HTMLDivElement;
  let map: MLMap | null = null;
  // $state so the dataset effect re-fires after `load` flips this true,
  // catching prop changes that landed during the ~100 ms map init window.
  let initialized = $state(false);

  function buildStyle(): maplibregl.StyleSpecification {
    return {
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© OpenStreetMap contributors',
        },
      },
      layers: [
        { id: 'osm', type: 'raster', source: 'osm' },
      ],
    };
  }

  function applyDataLayers(m: MLMap, fc: FeatureCollection, color: string) {
    for (const id of ['data-fill', 'data-line', 'data-point']) {
      if (m.getLayer(id)) m.removeLayer(id);
    }
    if (m.getSource('data')) m.removeSource('data');
    m.addSource('data', { type: 'geojson', data: fc as any });
    m.addLayer({
      id: 'data-fill', type: 'fill', source: 'data',
      paint: { 'fill-color': color, 'fill-opacity': 0.45 },
      filter: ['==', ['geometry-type'], 'Polygon'],
    });
    m.addLayer({
      id: 'data-line', type: 'line', source: 'data',
      paint: { 'line-color': color, 'line-width': 2 },
      filter: ['in', ['geometry-type'], ['literal', ['LineString', 'Polygon']]],
    });
    m.addLayer({
      id: 'data-point', type: 'circle', source: 'data',
      paint: { 'circle-color': color, 'circle-radius': 4, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 },
      filter: ['==', ['geometry-type'], 'Point'],
    });
  }

  function fitToFc(m: MLMap, fc: FeatureCollection) {
    const bbox = featureCollectionBbox(fc);
    if (!bbox) return;
    const [minLonW, minLatW] = swerefToWgs84(bbox[0], bbox[1]);
    const [maxLonW, maxLatW] = swerefToWgs84(bbox[2], bbox[3]);
    m.fitBounds([[minLonW, minLatW], [maxLonW, maxLatW]], { padding: 60, duration: 0 });
  }

  // Map create — runs once. Reads props via untrack so prop changes don't
  // tear down the map; the reactive effect below handles updates.
  $effect(() => {
    if (!container) return;
    const initial = untrack(() => dataset);
    map = new maplibregl.Map({
      container,
      style: buildStyle(),
      attributionControl: false,
    });
    map.once('load', () => {
      if (!map) return;
      const fcWgs = reprojectFcToWgs84(initial.geojson);
      fitToFc(map, initial.geojson);
      applyDataLayers(map, fcWgs, initial.style.color);
      initialized = true;
    });
    return () => {
      initialized = false;
      map?.remove();
      map = null;
    };
  });

  // Dataset/color change — re-fit + re-apply.
  $effect(() => {
    const d = dataset;
    if (!initialized || !map) return;
    const fcWgs = reprojectFcToWgs84(d.geojson);
    fitToFc(map, d.geojson);
    applyDataLayers(map, fcWgs, d.style.color);
  });
</script>

<div class="fixed inset-0">
  <div bind:this={container} class="absolute inset-0 w-full h-full"></div>
</div>
