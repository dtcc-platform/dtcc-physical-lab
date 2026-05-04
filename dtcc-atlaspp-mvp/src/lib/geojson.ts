// GeoJSON validation for the MVP. The single hard requirement is that the
// input is EPSG:3006 (SWEREF99 TM). Files must declare CRS via the
// FeatureCollection `crs` field; absent or non-3006 names are rejected. We
// also walk the first 50 features' coordinates and reject anything that looks
// like WGS84 degrees (|x| <= 180 && |y| <= 90) — defense in depth against a
// mislabeled file.

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

const SWEREF99_TM_NAMES = [
  'urn:ogc:def:crs:EPSG::3006',
  'EPSG:3006',
  'SWEREF99 TM',
];

function checkCoord(pair: unknown): string | null {
  if (!Array.isArray(pair) || pair.length < 2) return 'coordinate entry is not [easting, northing]';
  const [x, y] = pair as [unknown, unknown];
  if (typeof x !== 'number' || typeof y !== 'number') return 'coordinate entry has non-number values';
  if (Math.abs(x) <= 180 && Math.abs(y) <= 90) {
    return `coordinates look like WGS84 degrees (saw [${x}, ${y}]) — this app expects EPSG:3006 (SWEREF99 TM, meters). Reproject first: ogr2ogr -t_srs EPSG:3006 out.geojson in.geojson`;
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

  // Required crs field: must name SWEREF99 TM (EPSG:3006).
  if (!obj.crs || typeof obj.crs !== 'object') {
    return {
      ok: false,
      error:
        'missing crs field — this app requires EPSG:3006 (SWEREF99 TM). Add: { "crs": { "type": "name", "properties": { "name": "urn:ogc:def:crs:EPSG::3006" } } }',
    };
  }
  {
    const name = ((obj.crs as { properties?: { name?: unknown } }).properties?.name ?? '') as string;
    const looksLikeSweref =
      typeof name === 'string' &&
      (SWEREF99_TM_NAMES.some((w) => name === w) ||
        name.toUpperCase().includes('3006') ||
        name.toUpperCase().includes('SWEREF99 TM'));
    if (!looksLikeSweref) {
      return {
        ok: false,
        error: `crs field does not name EPSG:3006 (got "${name}") — this app requires SWEREF99 TM`,
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

function geomBbox(coords: unknown, out: { minX: number; minY: number; maxX: number; maxY: number }) {
  if (!Array.isArray(coords)) return;
  if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    const [x, y] = coords as [number, number];
    if (x < out.minX) out.minX = x;
    if (y < out.minY) out.minY = y;
    if (x > out.maxX) out.maxX = x;
    if (y > out.maxY) out.maxY = y;
    return;
  }
  for (const child of coords) geomBbox(child, out);
}

export function featureCollectionBbox(fc: FeatureCollection): Bbox | null {
  const acc = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
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
  if (!isFinite(acc.minX)) return null;
  return [acc.minX, acc.minY, acc.maxX, acc.maxY];
}

export function defaultStyle(): { color: string } {
  return { color: '#38bdf8' };
}
