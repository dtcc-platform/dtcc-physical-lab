import { describe, it, expect } from 'vitest';
import { swerefToWgs84, wgs84ToSweref, reprojectFcToWgs84 } from '../src/lib/sweref99tm';
import type { FeatureCollection } from '../src/lib/geojson';

describe('wgs84ToSweref / swerefToWgs84', () => {
  it('central-meridian anchor: (lon=15, lat=0) → (E=500000, N=0) exactly', () => {
    const [E, N] = wgs84ToSweref(15, 0);
    expect(E).toBeCloseTo(500000, 6);
    expect(N).toBeCloseTo(0, 6);
  });

  it('round-trips lon/lat → SWEREF → lon/lat for a Sweden-bound grid (1e-9 deg)', () => {
    for (const lat of [55, 60, 65, 68]) {
      for (const lon of [12, 15, 18, 22]) {
        const [E, N] = wgs84ToSweref(lon, lat);
        const [lon2, lat2] = swerefToWgs84(E, N);
        expect(lon2).toBeCloseTo(lon, 9);
        expect(lat2).toBeCloseTo(lat, 9);
      }
    }
  });

  it('round-trips SWEREF → lon/lat → SWEREF for Sweden-bound metric grid (1e-3 m)', () => {
    for (const N of [6_300_000, 6_500_000, 6_800_000, 7_300_000]) {
      for (const E of [320_000, 500_000, 700_000, 900_000]) {
        const [lon, lat] = swerefToWgs84(E, N);
        const [E2, N2] = wgs84ToSweref(lon, lat);
        expect(E2).toBeCloseTo(E, 3);
        expect(N2).toBeCloseTo(N, 3);
      }
    }
  });
});

describe('reprojectFcToWgs84', () => {
  function fc(geom: any): FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: geom }],
    };
  }

  it('reprojects a Point from 3006 to WGS84', () => {
    const out = reprojectFcToWgs84(fc({ type: 'Point', coordinates: [500000, 0] }));
    const [lon, lat] = (out.features[0].geometry as any).coordinates;
    expect(lon).toBeCloseTo(15, 6);
    expect(lat).toBeCloseTo(0, 6);
  });

  it('reprojects a LineString', () => {
    const out = reprojectFcToWgs84(
      fc({ type: 'LineString', coordinates: [[500000, 0], [500000, 100]] }),
    );
    const coords = (out.features[0].geometry as any).coordinates;
    expect(coords).toHaveLength(2);
    expect(coords[0][0]).toBeCloseTo(15, 6);
    expect(coords[0][1]).toBeCloseTo(0, 6);
  });

  it('reprojects a Polygon (one outer ring)', () => {
    const out = reprojectFcToWgs84(
      fc({
        type: 'Polygon',
        coordinates: [[[500000, 0], [500100, 0], [500100, 100], [500000, 0]]],
      }),
    );
    expect((out.features[0].geometry as any).coordinates[0]).toHaveLength(4);
  });

  it('reprojects MultiPoint, MultiLineString, MultiPolygon (depth correctness)', () => {
    const mp = reprojectFcToWgs84(
      fc({ type: 'MultiPoint', coordinates: [[500000, 0], [500000, 1000]] }),
    );
    expect((mp.features[0].geometry as any).coordinates).toHaveLength(2);
    const ml = reprojectFcToWgs84(
      fc({ type: 'MultiLineString', coordinates: [[[500000, 0], [500100, 0]]] }),
    );
    expect((ml.features[0].geometry as any).coordinates[0]).toHaveLength(2);
    const mpoly = reprojectFcToWgs84(
      fc({
        type: 'MultiPolygon',
        coordinates: [[[[500000, 0], [500100, 0], [500100, 100], [500000, 0]]]],
      }),
    );
    expect((mpoly.features[0].geometry as any).coordinates[0][0]).toHaveLength(4);
  });

  it('recurses into GeometryCollection', () => {
    const out = reprojectFcToWgs84(
      fc({
        type: 'GeometryCollection',
        geometries: [
          { type: 'Point', coordinates: [500000, 0] },
          { type: 'LineString', coordinates: [[500000, 0], [500000, 100]] },
        ],
      }),
    );
    const inner = (out.features[0].geometry as any).geometries;
    expect(inner).toHaveLength(2);
    const [pLon, pLat] = inner[0].coordinates;
    expect(pLon).toBeCloseTo(15, 6);
    expect(pLat).toBeCloseTo(0, 6);
  });

  it('does not mutate the input FeatureCollection', () => {
    const input = fc({ type: 'Point', coordinates: [500000, 0] });
    const before = JSON.stringify(input);
    reprojectFcToWgs84(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
