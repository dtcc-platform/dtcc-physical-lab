import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCatalog } from '../src/lib/catalog';
import { validateGeoJSON } from '../src/lib/geojson';

const legacyGeojsonEntry = {
  id: 'gothenburg-dummy-mixed',
  title: 'Gothenburg Dummy Mixed',
  description: 'Synthetic mixed geometry sample.',
  file: 'gothenburg-dummy-mixed-v1.geojson',
  bounds: [316385.555, 6397546.957, 322614.029, 6403932.781],
};

const typedGeojsonEntry = {
  ...legacyGeojsonEntry,
  kind: 'geojson',
  format: 'geojson',
  mediaType: 'application/geo+json',
};

const imageEntry = {
  id: 'smoke-streamlines-png',
  title: 'Smoke Streamlines PNG',
  file: 'smoke_streamlines.png',
  bounds: [319720, 6397660, 320220, 6398160],
  kind: 'image',
  format: 'png',
  mediaType: 'image/png',
  visualization: { profile: 'table', width: 320, height: 240 },
};

const videoEntry = {
  id: 'smoke-streamlines-mp4',
  title: 'Smoke Streamlines MP4',
  file: 'smoke_streamlines.mp4',
  bounds: [319720, 6397660, 320220, 6398160],
  kind: 'video',
  format: 'mp4',
  mediaType: 'video/mp4',
  visualization: { profile: 'table', width: 320, height: 240, fps: 12, duration: 2 },
};

describe('parseCatalog', () => {
  it('accepts a legacy GeoJSON entry and normalizes kind and format', () => {
    const result = parseCatalog({ version: 1, entries: [legacyGeojsonEntry] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.entries[0]).toEqual({
        ...legacyGeojsonEntry,
        kind: 'geojson',
        format: 'geojson',
      });
    }
  });

  it('accepts typed GeoJSON, image, and video entries', () => {
    const result = parseCatalog({ version: 1, entries: [typedGeojsonEntry, imageEntry, videoEntry] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.entries).toEqual([typedGeojsonEntry, imageEntry, videoEntry]);
  });

  it('rejects non-version-1 catalogs', () => {
    const result = parseCatalog({ version: 2, entries: [legacyGeojsonEntry] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/version/i);
  });

  it('rejects empty entries', () => {
    const result = parseCatalog({ version: 1, entries: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/entries/i);
  });

  it('rejects duplicate ids', () => {
    const result = parseCatalog({ version: 1, entries: [legacyGeojsonEntry, { ...legacyGeojsonEntry, title: 'Duplicate' }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/duplicate/i);
  });

  it('rejects absolute URL files', () => {
    const result = parseCatalog({ version: 1, entries: [{ ...legacyGeojsonEntry, file: 'https://example.com/a.geojson' }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/relative/i);
  });

  it('rejects absolute path files', () => {
    const result = parseCatalog({ version: 1, entries: [{ ...legacyGeojsonEntry, file: '/tmp/a.geojson' }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/relative/i);
  });

  it('rejects parent traversal files', () => {
    const result = parseCatalog({ version: 1, entries: [{ ...legacyGeojsonEntry, file: '../fixtures/a.geojson' }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/relative/i);
  });

  it('rejects Windows-style traversal files', () => {
    const result = parseCatalog({ version: 1, entries: [{ ...legacyGeojsonEntry, file: '..\\fixtures\\a.geojson' }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/relative/i);
  });

  it('rejects Windows drive path files', () => {
    const result = parseCatalog({ version: 1, entries: [{ ...legacyGeojsonEntry, file: 'C:\\Users\\victim\\a.geojson' }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/relative/i);
  });

  it('rejects malformed bounds values', () => {
    const result = parseCatalog({ version: 1, entries: [{ ...legacyGeojsonEntry, bounds: [1, 2, 3] }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/bounds/i);
  });

  it('rejects non-string descriptions when present', () => {
    const result = parseCatalog({ version: 1, entries: [{ ...legacyGeojsonEntry, description: 10 }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/description/i);
  });

  it('rejects mismatched kind and format', () => {
    const result = parseCatalog({ version: 1, entries: [{ ...imageEntry, kind: 'video' }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/kind.*format/i);
  });

  it('rejects image entries without mediaType', () => {
    const withoutMediaType = { ...imageEntry } as Record<string, unknown>;
    delete withoutMediaType.mediaType;
    const result = parseCatalog({ version: 1, entries: [withoutMediaType] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/mediaType/i);
  });

  it('rejects video entries without mediaType', () => {
    const withoutMediaType = { ...videoEntry } as Record<string, unknown>;
    delete withoutMediaType.mediaType;
    const result = parseCatalog({ version: 1, entries: [withoutMediaType] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/mediaType/i);
  });

  it('rejects invalid media types', () => {
    const result = parseCatalog({ version: 1, entries: [{ ...imageEntry, mediaType: 'video/mp4' }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/mediaType/i);
  });

  it('rejects malformed visualization metadata', () => {
    const result = parseCatalog({ version: 1, entries: [{ ...imageEntry, visualization: { width: '320' } }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/visualization/i);
  });
});

describe('public dataset catalog', () => {
  const datasetsDir = join(process.cwd(), 'public', 'datasets');
  const catalogPath = join(datasetsDir, 'catalog.json');

  it('has a valid manifest and valid listed GeoJSON files', () => {
    expect(existsSync(catalogPath)).toBe(true);
    const parsedJson = JSON.parse(readFileSync(catalogPath, 'utf8'));
    const catalog = parseCatalog(parsedJson);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) return;

    for (const entry of catalog.value.entries) {
      const filePath = join(datasetsDir, entry.file);
      expect(existsSync(filePath), `${entry.file} should exist`).toBe(true);
      if (entry.kind !== 'geojson') continue;
      const geojson = readFileSync(filePath, 'utf8');
      const validation = validateGeoJSON(geojson);
      expect(validation.ok, validation.ok ? undefined : validation.error).toBe(true);
    }
  });
});
