import type { FeatureCollection } from './geojson';

type Project = (lon: number, lat: number) => [number, number];

export type Renderable =
  | { kind: 'polygon'; d: string }
  | { kind: 'line'; d: string }
  | { kind: 'point'; cx: number; cy: number };

type Geometry = { type: string; coordinates?: unknown; geometries?: unknown[] };

function ringPath(coords: [number, number][], project: Project, close: boolean): string {
  if (coords.length === 0) return '';
  const parts: string[] = [];
  for (let i = 0; i < coords.length; i++) {
    const [px, py] = project(coords[i][0], coords[i][1]);
    parts.push(`${i === 0 ? 'M' : 'L'}${px.toFixed(1)} ${py.toFixed(1)}`);
  }
  if (close) parts.push('Z');
  return parts.join(' ');
}

function emit(geometry: Geometry, project: Project, out: Renderable[]): void {
  switch (geometry.type) {
    case 'Point': {
      const [lon, lat] = geometry.coordinates as [number, number];
      const [cx, cy] = project(lon, lat);
      out.push({ kind: 'point', cx, cy });
      return;
    }
    case 'MultiPoint': {
      for (const p of geometry.coordinates as [number, number][]) {
        const [cx, cy] = project(p[0], p[1]);
        out.push({ kind: 'point', cx, cy });
      }
      return;
    }
    case 'LineString': {
      out.push({ kind: 'line', d: ringPath(geometry.coordinates as [number, number][], project, false) });
      return;
    }
    case 'MultiLineString': {
      for (const line of geometry.coordinates as [number, number][][]) {
        out.push({ kind: 'line', d: ringPath(line, project, false) });
      }
      return;
    }
    case 'Polygon': {
      const rings = (geometry.coordinates as [number, number][][]).map((r) => ringPath(r, project, true));
      out.push({ kind: 'polygon', d: rings.join(' ') });
      return;
    }
    case 'MultiPolygon': {
      for (const poly of geometry.coordinates as [number, number][][][]) {
        const rings = poly.map((r) => ringPath(r, project, true));
        out.push({ kind: 'polygon', d: rings.join(' ') });
      }
      return;
    }
    case 'GeometryCollection': {
      for (const inner of (geometry.geometries ?? []) as Geometry[]) emit(inner, project, out);
      return;
    }
  }
}

export function featuresToRenderables(fc: FeatureCollection, project: Project): Renderable[] {
  const out: Renderable[] = [];
  for (const f of fc.features) {
    if (!f.geometry) continue;
    emit(f.geometry, project, out);
  }
  return out;
}
