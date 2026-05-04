import { describe, it, expect } from 'vitest';
import { validateGeoJSON, featureCollectionBbox, defaultStyle } from '../src/lib/geojson';

const SWEREF_CRS = { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::3006' } };

describe('validateGeoJSON', () => {
  const validFC = {
    type: 'FeatureCollection',
    crs: SWEREF_CRS,
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [319950, 6398000] },
        properties: {},
      },
    ],
  };

  it('accepts a valid SWEREF99 TM FeatureCollection', () => {
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
    const bad = { crs: SWEREF_CRS, features: [] };
    const result = validateGeoJSON(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/type/i);
  });

  it('rejects a non-FeatureCollection top-level type', () => {
    const result = validateGeoJSON(JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [319950, 6398000] } }));
    expect(result.ok).toBe(false);
  });

  it('rejects an absent crs field', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [319950, 6398000] }, properties: {} },
      ],
    };
    const result = validateGeoJSON(JSON.stringify(fc));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/missing crs/i);
      expect(result.error).toMatch(/EPSG:3006/i);
    }
  });

  it('rejects a WGS84 crs name', () => {
    const fc = {
      type: 'FeatureCollection',
      crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::4326' } },
      features: [],
    };
    const result = validateGeoJSON(JSON.stringify(fc));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/does not name EPSG:3006/i);
  });

  it('rejects WGS84-shaped magnitudes even when crs is 3006 (defense in depth)', () => {
    const fc = {
      type: 'FeatureCollection',
      crs: SWEREF_CRS,
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [12.0, 57.7] }, properties: {} },
      ],
    };
    const result = validateGeoJSON(JSON.stringify(fc));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/look like WGS84/i);
  });

  it('walks nested polygon coordinates (range check goes deep)', () => {
    const fc = {
      type: 'FeatureCollection',
      crs: SWEREF_CRS,
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[[319950, 6397950], [320050, 6397950], [320050, 6398050], [319950, 6398050], [319950, 6397950]]],
          },
          properties: {},
        },
      ],
    };
    expect(validateGeoJSON(JSON.stringify(fc)).ok).toBe(true);
  });

  it('rejects WGS84-shaped coordinates inside a GeometryCollection', () => {
    const fc = {
      type: 'FeatureCollection',
      crs: SWEREF_CRS,
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'GeometryCollection',
            geometries: [
              { type: 'Point', coordinates: [11.97, 57.71] }, // WGS84 degrees, defense-in-depth catches this
            ],
          },
          properties: {},
        },
      ],
    };
    const result = validateGeoJSON(JSON.stringify(fc));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/look like WGS84/i);
  });

  it('accepts SWEREF99 TM coordinates inside a GeometryCollection', () => {
    const fc = {
      type: 'FeatureCollection',
      crs: SWEREF_CRS,
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'GeometryCollection',
            geometries: [
              { type: 'Point', coordinates: [319950, 6398000] },
              { type: 'LineString', coordinates: [[319950, 6397950], [320050, 6398050]] },
            ],
          },
          properties: {},
        },
      ],
    };
    expect(validateGeoJSON(JSON.stringify(fc)).ok).toBe(true);
  });

  it('accepts the canonical EPSG:3006 name and the short EPSG:3006 form', () => {
    const a = { ...validFC, crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::3006' } } };
    const b = { ...validFC, crs: { type: 'name', properties: { name: 'EPSG:3006' } } };
    const c = { ...validFC, crs: { type: 'name', properties: { name: 'SWEREF99 TM' } } };
    expect(validateGeoJSON(JSON.stringify(a)).ok).toBe(true);
    expect(validateGeoJSON(JSON.stringify(b)).ok).toBe(true);
    expect(validateGeoJSON(JSON.stringify(c)).ok).toBe(true);
  });
});

describe('featureCollectionBbox', () => {
  it('returns the coordinate extent across mixed geometries', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [319950, 6398000] }, properties: {} },
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [[319920, 6398100], [320020, 6397980]],
          },
          properties: {},
        },
      ],
    } as any;
    expect(featureCollectionBbox(fc)).toEqual([319920, 6397980, 320020, 6398100]);
  });

  it('returns null when no feature has coordinates', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: null, properties: {} }],
    } as any;
    expect(featureCollectionBbox(fc)).toBeNull();
  });

  it('walks GeometryCollection inner geometries', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'GeometryCollection',
            geometries: [
              { type: 'Point', coordinates: [100000, 200000] },
              { type: 'Point', coordinates: [300000, 400000] },
            ],
          },
        },
      ],
    } as any;
    expect(featureCollectionBbox(fc)).toEqual([100000, 200000, 300000, 400000]);
  });
});

describe('defaultStyle', () => {
  it('returns a fallback color object', () => {
    const s = defaultStyle();
    expect(s.color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});
