import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCatalog } from '../src/lib/catalog';
import { validateGeoJSON } from '../src/lib/geojson';

const entry = {
  id: 'gothenburg-dummy-mixed',
  title: 'Gothenburg Dummy Mixed',
  description: 'Synthetic mixed geometry sample.',
  file: 'gothenburg-dummy-mixed-v1.geojson',
  bounds: [316385.555, 6397546.957, 322614.029, 6403932.781],
};

describe('parseCatalog', () => {
  it('accepts a valid catalog', () => {
    const result = parseCatalog({ version: 1, entries: [entry] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.entries[0]).toEqual(entry);
  });

  it('rejects non-version-1 catalogs', () => {
    const result = parseCatalog({ version: 2, entries: [entry] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/version/i);
  });

  it('rejects empty entries', () => {
    const result = parseCatalog({ version: 1, entries: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/entries/i);
  });

  it('rejects duplicate ids', () => {
    const result = parseCatalog({ version: 1, entries: [entry, { ...entry, title: 'Duplicate' }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/duplicate/i);
  });

  it('rejects absolute URL files', () => {
    const result = parseCatalog({ version: 1, entries: [{ ...entry, file: 'https://example.com/a.geojson' }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/relative/i);
  });

  it('rejects absolute path files', () => {
    const result = parseCatalog({ version: 1, entries: [{ ...entry, file: '/tmp/a.geojson' }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/relative/i);
  });

  it('rejects parent traversal files', () => {
    const result = parseCatalog({ version: 1, entries: [{ ...entry, file: '../fixtures/a.geojson' }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/relative/i);
  });

  it('rejects malformed bounds values', () => {
    const result = parseCatalog({ version: 1, entries: [{ ...entry, bounds: [1, 2, 3] }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/bounds/i);
  });

  it('rejects non-string descriptions when present', () => {
    const result = parseCatalog({ version: 1, entries: [{ ...entry, description: 10 }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/description/i);
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
      const geojson = readFileSync(filePath, 'utf8');
      const validation = validateGeoJSON(geojson);
      expect(validation.ok, validation.ok ? undefined : validation.error).toBe(true);
    }
  });
});
