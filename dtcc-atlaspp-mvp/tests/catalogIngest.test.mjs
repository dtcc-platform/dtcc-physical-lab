import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ingestManifests } from '../scripts/ingest-dtcc-manifests.mjs';

const tempRoots = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'atlas-catalog-ingest-'));
  tempRoots.push(root);
  return root;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('ingestManifests', () => {
  it('copies GeoJSON artifacts and upserts catalog entries from dtcc manifests', async () => {
    const root = makeTempRoot();
    const sourceDir = join(root, 'exports');
    const datasetsDir = join(root, 'public', 'datasets');
    const catalogPath = join(datasetsDir, 'catalog.json');
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(datasetsDir, { recursive: true });

    writeJson(catalogPath, {
      version: 1,
      entries: [
        {
          id: 'existing',
          title: 'Existing',
          file: 'existing.geojson',
          bounds: [1, 2, 3, 4],
        },
      ],
    });
    writeFileSync(join(sourceDir, 'smoke_slice.geojson'), '{"type":"FeatureCollection","features":[]}\n', 'utf8');
    writeJson(join(sourceDir, 'smoke_slice.manifest.json'), {
      name: 'smoke',
      title: 'Smoke Slice',
      description: 'Smoke data prepared for Atlas++.',
      file: 'smoke_slice.geojson',
      format: 'geojson',
      data_kind: 'vector',
      product: 'slice',
      bounds: [319720, 6397660, 320220, 6398160],
    });
    writeFileSync(join(sourceDir, 'smoke_streamlines.png'), 'png', 'utf8');
    writeJson(join(sourceDir, 'smoke_streamlines.manifest.json'), {
      title: 'Smoke Streamlines PNG',
      file: 'smoke_streamlines.png',
      format: 'png',
      data_kind: 'raster',
      product: 'streamlines',
      bounds: [319720, 6397660, 320220, 6398160],
    });

    const result = await ingestManifests({ sourceDir, datasetsDir, catalogPath });

    expect(result.imported.map((entry) => entry.id)).toEqual(['smoke-slice']);
    expect(result.skipped).toEqual([
      {
        manifest: join(sourceDir, 'smoke_streamlines.manifest.json'),
        reason: 'format png is not supported by the GeoJSON catalog',
      },
    ]);
    expect(existsSync(join(datasetsDir, 'smoke_slice.geojson'))).toBe(true);
    expect(existsSync(join(datasetsDir, 'smoke_streamlines.png'))).toBe(false);

    const catalog = readJson(catalogPath);
    expect(catalog).toEqual({
      version: 1,
      entries: [
        {
          id: 'existing',
          title: 'Existing',
          file: 'existing.geojson',
          bounds: [1, 2, 3, 4],
        },
        {
          id: 'smoke-slice',
          title: 'Smoke Slice',
          description: 'Smoke data prepared for Atlas++.',
          file: 'smoke_slice.geojson',
          bounds: [319720, 6397660, 320220, 6398160],
        },
      ],
    });
  });

  it('updates an existing entry without duplicating it', async () => {
    const root = makeTempRoot();
    const sourceDir = join(root, 'exports');
    const datasetsDir = join(root, 'public', 'datasets');
    const catalogPath = join(datasetsDir, 'catalog.json');
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(datasetsDir, { recursive: true });

    writeJson(catalogPath, {
      version: 1,
      entries: [
        {
          id: 'smoke-slice',
          title: 'Old Smoke Slice',
          file: 'old.geojson',
          bounds: [0, 0, 1, 1],
        },
      ],
    });
    writeFileSync(join(sourceDir, 'smoke_slice.geojson'), '{"type":"FeatureCollection","features":[]}\n', 'utf8');
    writeJson(join(sourceDir, 'smoke_slice.manifest.json'), {
      id: 'smoke-slice',
      title: 'Smoke Slice',
      file: 'smoke_slice.geojson',
      format: 'geojson',
      bounds: [319720, 6397660, 320220, 6398160],
    });

    await ingestManifests({ sourceDir, datasetsDir, catalogPath });

    const catalog = readJson(catalogPath);
    expect(catalog.entries.filter((entry) => entry.id === 'smoke-slice')).toHaveLength(1);
    expect(catalog.entries[0]).toEqual({
      id: 'smoke-slice',
      title: 'Smoke Slice',
      file: 'smoke_slice.geojson',
      bounds: [319720, 6397660, 320220, 6398160],
    });
  });

  it('rejects manifests without numeric four-value bounds', async () => {
    const root = makeTempRoot();
    const sourceDir = join(root, 'exports');
    const datasetsDir = join(root, 'public', 'datasets');
    const catalogPath = join(datasetsDir, 'catalog.json');
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(datasetsDir, { recursive: true });
    writeJson(catalogPath, { version: 1, entries: [] });
    writeFileSync(join(sourceDir, 'smoke_slice.geojson'), '{"type":"FeatureCollection","features":[]}\n', 'utf8');
    writeJson(join(sourceDir, 'smoke_slice.manifest.json'), {
      title: 'Smoke Slice',
      file: 'smoke_slice.geojson',
      format: 'geojson',
      bounds: [319720, 6397660, 320220],
    });

    await expect(ingestManifests({ sourceDir, datasetsDir, catalogPath })).rejects.toThrow(/bounds/);
  });
});
