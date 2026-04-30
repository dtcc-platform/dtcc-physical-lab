import { describe, it, expect } from 'vitest';
import { validateGeoJSON, featureCollectionBbox, defaultStyle } from '../src/lib/geojson';

describe('validateGeoJSON', () => {
  const validFC = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [11.97, 57.71] },
        properties: {},
      },
    ],
  };

  it('accepts a valid WGS84 FeatureCollection', () => {
    const result = validateGeoJSON(JSON.stringify(validFC));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.features.length).toBe(1);
  });

  it('rejects malformed JSON', () => {
    const result = validateGeoJSON('{not json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/json|parse/i);
  });

  it('rejects missing top-level type', () => {
    const bad = { features: [] };
    const result = validateGeoJSON(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/type/i);
  });

  it('rejects a non-FeatureCollection top-level type', () => {
    const result = validateGeoJSON(JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] } }));
    expect(result.ok).toBe(false);
  });

  it('rejects SWEREF99 TM coordinates (meters, no crs field)', () => {
    const sweref = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [317000, 6398000] },
          properties: {},
        },
      ],
    };
    const result = validateGeoJSON(JSON.stringify(sweref));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/range|reproject|WGS84|EPSG:4326/i);
  });

  it('rejects longitude just out of range', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [180.001, 0] }, properties: {} },
      ],
    };
    expect(validateGeoJSON(JSON.stringify(fc)).ok).toBe(false);
  });

  it('rejects explicit non-WGS84 crs field', () => {
    const fc = {
      type: 'FeatureCollection',
      crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::3006' } },
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [11.97, 57.71] }, properties: {} }],
    };
    const result = validateGeoJSON(JSON.stringify(fc));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/EPSG:4326|CRS84|reproject/i);
  });

  it('accepts explicit EPSG:4326 crs', () => {
    const fc = {
      ...validFC,
      crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::4326' } },
    };
    expect(validateGeoJSON(JSON.stringify(fc)).ok).toBe(true);
  });

  it('accepts CRS84', () => {
    const fc = {
      ...validFC,
      crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC::CRS84' } },
    };
    expect(validateGeoJSON(JSON.stringify(fc)).ok).toBe(true);
  });

  it('walks nested polygon coordinates (range check goes deep)', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[[11.9, 57.7], [11.98, 57.7], [11.98, 57.75], [11.9, 57.75], [11.9, 57.7]]],
          },
          properties: {},
        },
      ],
    };
    expect(validateGeoJSON(JSON.stringify(fc)).ok).toBe(true);
  });

  it('rejects out-of-range coordinates inside a GeometryCollection', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'GeometryCollection',
            geometries: [
              { type: 'Point', coordinates: [317000, 6398000] }, // SWEREF99 TM, way out of WGS84 range
            ],
          },
          properties: {},
        },
      ],
    };
    const result = validateGeoJSON(JSON.stringify(fc));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/range|reproject|WGS84/i);
  });

  it('accepts in-range coordinates inside a GeometryCollection', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'GeometryCollection',
            geometries: [
              { type: 'Point', coordinates: [11.97, 57.71] },
              { type: 'LineString', coordinates: [[11.9, 57.7], [12.0, 57.72]] },
            ],
          },
          properties: {},
        },
      ],
    };
    expect(validateGeoJSON(JSON.stringify(fc)).ok).toBe(true);
  });
});

describe('featureCollectionBbox', () => {
  it('returns the coordinate extent across mixed geometries', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [11.97, 57.71] }, properties: {} },
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [[11.92, 57.74], [12.02, 57.685]],
          },
          properties: {},
        },
      ],
    } as any;
    expect(featureCollectionBbox(fc)).toEqual([11.92, 57.685, 12.02, 57.74]);
  });

  it('returns null when no feature has coordinates', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: null, properties: {} }],
    } as any;
    expect(featureCollectionBbox(fc)).toBeNull();
  });
});

describe('defaultStyle', () => {
  it('returns a fallback color object', () => {
    const s = defaultStyle();
    expect(s.color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});
