// GeoJSON validation for the MVP. The single hard requirement is that the
// input is WGS84 (EPSG:4326 / CRS84). Modern GeoJSON typically omits the
// `crs` field, so relying on it is not enough — we also walk the first 50
// features' coordinates and assert |lon| <= 180 and |lat| <= 90.

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export type FeatureCollection = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: string; coordinates?: unknown; geometries?: unknown[] } | null;
    properties: Record<string, unknown> | null;
  }>;
  crs?: { type: string; properties: { name: string } };
};

const WGS84_NAMES = [
  'urn:ogc:def:crs:EPSG::4326',
  'urn:ogc:def:crs:OGC::CRS84',
  'EPSG:4326',
  'CRS84',
];

function checkCoord(pair: unknown): string | null {
  if (!Array.isArray(pair) || pair.length < 2) return 'coordinate entry is not [lon, lat]';
  const [lon, lat] = pair as [unknown, unknown];
  if (typeof lon !== 'number' || typeof lat !== 'number') return 'coordinate entry has non-number values';
  if (Math.abs(lon) > 180 || Math.abs(lat) > 90) {
    return `coordinates outside WGS84 range (saw [${lon}, ${lat}]) — reproject to EPSG:4326 first (common cause: Swedish SWEREF99 TM files use meters like [317000, 6398000] and will fail this check)`;
  }
  return null;
}

function walkCoords(coords: unknown, onError: (msg: string) => void): void {
  if (!Array.isArray(coords)) return;
  // Leaf check: a pair is [number, number, ...].
  if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    const err = checkCoord(coords);
    if (err) onError(err);
    return;
  }
  for (const child of coords) walkCoords(child, onError);
}

export function validateGeoJSON(text: string): Result<FeatureCollection, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `JSON parse error: ${(e as Error).message}` };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'top-level value must be an object' };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.type !== 'FeatureCollection') {
    return { ok: false, error: `top-level type must be "FeatureCollection" (got ${JSON.stringify(obj.type)})` };
  }

  // Optional crs field: if present, must name WGS84.
  if (obj.crs && typeof obj.crs === 'object') {
    const name = ((obj.crs as { properties?: { name?: unknown } }).properties?.name ?? '') as string;
    if (name && !WGS84_NAMES.some((w) => name === w || name.toUpperCase().includes('4326') || name.toUpperCase().includes('CRS84'))) {
      return {
        ok: false,
        error: `unsupported CRS ${name} — reproject to EPSG:4326 / CRS84 first`,
      };
    }
  }

  const features = obj.features;
  if (!Array.isArray(features)) {
    return { ok: false, error: 'FeatureCollection has no features array' };
  }

  let firstError: string | null = null;
  const limit = Math.min(features.length, 50);
  function walkGeometry(
    g: { type?: unknown; coordinates?: unknown; geometries?: unknown } | null | undefined,
    onError: (msg: string) => void
  ): void {
    if (!g) return;
    if (g.type === 'GeometryCollection') {
      const inners = Array.isArray(g.geometries) ? g.geometries : [];
      for (const inner of inners) {
        walkGeometry(inner as any, onError);
      }
      return;
    }
    if (g.coordinates != null) walkCoords(g.coordinates, onError);
  }
  for (let i = 0; i < limit && !firstError; i++) {
    const f = features[i] as { geometry?: { type?: unknown; coordinates?: unknown; geometries?: unknown } | null } | null;
    walkGeometry(f?.geometry, (msg) => {
      if (!firstError) firstError = `feature ${i}: ${msg}`;
    });
  }
  if (firstError) return { ok: false, error: firstError };

  return { ok: true, value: obj as unknown as FeatureCollection };
}

type Bbox = [number, number, number, number];

function geomBbox(coords: unknown, out: { minLon: number; minLat: number; maxLon: number; maxLat: number }) {
  if (!Array.isArray(coords)) return;
  if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    const [lon, lat] = coords as [number, number];
    if (lon < out.minLon) out.minLon = lon;
    if (lat < out.minLat) out.minLat = lat;
    if (lon > out.maxLon) out.maxLon = lon;
    if (lat > out.maxLat) out.maxLat = lat;
    return;
  }
  for (const child of coords) geomBbox(child, out);
}

export function featureCollectionBbox(fc: FeatureCollection): Bbox | null {
  const acc = {
    minLon: Infinity,
    minLat: Infinity,
    maxLon: -Infinity,
    maxLat: -Infinity,
  };
  function walk(g: { type: string; coordinates?: unknown; geometries?: unknown[] } | null) {
    if (!g) return;
    if (g.type === 'GeometryCollection') {
      for (const inner of g.geometries ?? []) {
        walk(inner as { type: string; coordinates?: unknown; geometries?: unknown[] });
      }
      return;
    }
    geomBbox(g.coordinates, acc);
  }
  for (const f of fc.features) walk(f.geometry);
  if (!isFinite(acc.minLon)) return null;
  return [acc.minLon, acc.minLat, acc.maxLon, acc.maxLat];
}

export function defaultStyle(): { color: string } {
  return { color: '#38bdf8' };
}
