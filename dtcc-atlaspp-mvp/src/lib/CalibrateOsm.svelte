<script lang="ts">
  import maplibregl, { type Map as MLMap } from 'maplibre-gl';
  import { untrack } from 'svelte';
  import type { FeatureCollection } from './geojson';
  import { swerefToWgs84, reprojectFcToWgs84 } from './sweref99tm';
  import type { Bbox, Dataset } from './storage';

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
    clearDataLayers(m);
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

  function clearDataLayers(m: MLMap) {
    for (const id of ['data-fill', 'data-line', 'data-point']) {
      if (m.getLayer(id)) m.removeLayer(id);
    }
    if (m.getSource('data')) m.removeSource('data');
  }

  function fitToBbox(m: MLMap, bbox: Bbox) {
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
      fitToBbox(map, initial.bounds);
      if (initial.content.kind === 'geojson') {
        const fcWgs = reprojectFcToWgs84(initial.content.geojson);
        applyDataLayers(map, fcWgs, initial.content.style.color);
      } else {
        clearDataLayers(map);
      }
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
    fitToBbox(map, d.bounds);
    if (d.content.kind === 'geojson') {
      const fcWgs = reprojectFcToWgs84(d.content.geojson);
      applyDataLayers(map, fcWgs, d.content.style.color);
    } else {
      clearDataLayers(map);
    }
  });
</script>

<div class="fixed inset-0">
  <div bind:this={container} class="absolute inset-0 w-full h-full"></div>
</div>
