# Static Dataset Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a static `/datasets/catalog.json` workflow so `dtcc-atlaspp-mvp` can load curated pre-generated EPSG:3006 GeoJSON samples from the control panel.

**Architecture:** Keep drag/drop unchanged and add a separate catalog-sample path. Catalog samples carry `projectionBbox` into the persisted `Dataset`; the projection chain fits to that bbox when present so compatible catalog samples share the calibrated physical frame. Catalog parsing and dataset-storage helpers are pure TypeScript and covered by unit tests; Svelte UI wiring is verified by build and manual smoke checks because the project has no component-test harness.

**Tech Stack:** Svelte 5, TypeScript, Vite, Vitest with happy-dom, static files under Vite `public/`.

---

## Reference

Design spec: `docs/superpowers/specs/2026-05-04-static-dataset-catalog-design.md`

Run commands from `dtcc-atlaspp-mvp/` unless explicitly noted.

---

## File Structure

- Modify `dtcc-atlaspp-mvp/src/lib/storage.ts`
  - Owns the persisted `Dataset` type.
  - Adds optional catalog metadata validation.
  - Exports bbox helpers used by App and projection components.
- Modify `dtcc-atlaspp-mvp/tests/storage.test.ts`
  - Covers optional field validation and bbox helper contracts.
- Modify projection components:
  - `dtcc-atlaspp-mvp/src/lib/Calibrate.svelte`
  - `dtcc-atlaspp-mvp/src/lib/CalibratePan.svelte`
  - `dtcc-atlaspp-mvp/src/lib/CalibrateCorners.svelte`
  - `dtcc-atlaspp-mvp/src/lib/CalibrateProjection.svelte`
  - Each component replaces direct feature-bbox fitting with `datasetFitBbox(dataset)`.
- Create `dtcc-atlaspp-mvp/src/lib/catalog.ts`
  - Pure catalog schema parser and types.
- Create `dtcc-atlaspp-mvp/tests/catalog.test.ts`
  - Pure parser tests plus static manifest/file validation.
- Modify `dtcc-atlaspp-mvp/src/lib/ControlPanel.svelte`
  - Fetches manifest, renders selector, loads samples through `onLoadSample`.
- Modify `dtcc-atlaspp-mvp/src/App.svelte`
  - Adds `handleLoadSample` while keeping `handleLoadDataset` unchanged.
- Create `dtcc-atlaspp-mvp/public/datasets/`
  - `catalog.json`
  - `README.md`
  - Two temporary sample GeoJSON files copied from existing EPSG:3006 fixtures so calibration-preservation can be manually checked.

---

### Task 1: Storage Metadata And Bbox Helpers

**Files:**
- Modify: `dtcc-atlaspp-mvp/tests/storage.test.ts`
- Modify: `dtcc-atlaspp-mvp/src/lib/storage.ts`

- [ ] **Step 1: Write failing storage tests**

Add these imports in `tests/storage.test.ts`:

```ts
import {
  loadDataset,
  saveDataset,
  loadCalibration,
  saveCalibration,
  clearCalibration,
  datasetFitBbox,
  bboxEqual,
  type Dataset,
  type Calibration,
} from '../src/lib/storage';
```

Add these tests inside the existing `describe('dataset', ...)` block, after the existing round-trip test:

```ts
  it('round-trips optional catalog metadata', () => {
    const withCatalog: Dataset = {
      ...d,
      projectionBbox: [316385.555, 6397546.957, 322614.029, 6403932.781],
      catalogId: 'gothenburg-dummy-mixed',
    };
    saveDataset(withCatalog);
    expect(loadDataset()).toEqual(withCatalog);
  });

  it('returns null when optional projectionBbox is malformed', () => {
    const partial = { ...d, projectionBbox: [1, 2, 3] } as any;
    localStorage.setItem('dtcc-atlaspp-mvp.dataset', JSON.stringify(partial));
    expect(loadDataset()).toBeNull();
  });

  it('returns null when optional projectionBbox contains non-numbers', () => {
    const partial = { ...d, projectionBbox: [1, 2, '3', 4] } as any;
    localStorage.setItem('dtcc-atlaspp-mvp.dataset', JSON.stringify(partial));
    expect(loadDataset()).toBeNull();
  });

  it('returns null when optional catalogId is not a string', () => {
    const partial = { ...d, catalogId: 42 } as any;
    localStorage.setItem('dtcc-atlaspp-mvp.dataset', JSON.stringify(partial));
    expect(loadDataset()).toBeNull();
  });
```

Add this new `describe` block before the existing `describe('calibration', ...)` block:

```ts
describe('bbox helpers', () => {
  const fc = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [319950, 6398000] },
        properties: {},
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [320050, 6398050] },
        properties: {},
      },
    ],
  } as any;

  const base: Dataset = {
    version: 2,
    filename: 'bbox.geojson',
    geojson: fc,
    style: { color: '#38bdf8' },
    uploadedAt: '2026-05-04T10:00:00.000Z',
  };

  it('datasetFitBbox returns projectionBbox when present', () => {
    const dataset: Dataset = {
      ...base,
      projectionBbox: [316385.555, 6397546.957, 322614.029, 6403932.781],
    };
    expect(datasetFitBbox(dataset)).toEqual([316385.555, 6397546.957, 322614.029, 6403932.781]);
  });

  it('datasetFitBbox falls back to featureCollectionBbox when projectionBbox is absent', () => {
    expect(datasetFitBbox(base)).toEqual([319950, 6398000, 320050, 6398050]);
  });

  it('bboxEqual uses tuple-exact equality and requires both sides', () => {
    const a = [1, 2, 3, 4] as [number, number, number, number];
    expect(bboxEqual(a, [1, 2, 3, 4])).toBe(true);
    expect(bboxEqual(a, [1, 2, 3, 4.000001])).toBe(false);
    expect(bboxEqual(undefined, a)).toBe(false);
    expect(bboxEqual(a, undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run storage tests and verify failure**

Run:

```bash
npm test -- tests/storage.test.ts
```

Expected: FAIL with TypeScript/import errors for `datasetFitBbox` and `bboxEqual`, plus type errors for missing `projectionBbox` and `catalogId` on `Dataset`.

- [ ] **Step 3: Implement storage type, validation, and helpers**

Update the top import in `src/lib/storage.ts`:

```ts
import { featureCollectionBbox, type FeatureCollection } from './geojson';
```

Add a bbox type above `export type Dataset`:

```ts
export type Bbox = [number, number, number, number];
```

Update `Dataset`:

```ts
export type Dataset = {
  version: 2;
  filename: string;
  geojson: FeatureCollection;
  style: { color: string };
  uploadedAt: string;
  projectionBbox?: Bbox;
  catalogId?: string;
};
```

Add this helper near `isCornerDst`:

```ts
function isBbox(v: unknown): v is Bbox {
  return Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number');
}
```

Update the end of `isDataset` so it validates optional fields:

```ts
  const s = d.style as Record<string, unknown> | undefined;
  if (!s || typeof s.color !== 'string') return false;
  if (typeof d.uploadedAt !== 'string') return false;
  if (d.projectionBbox !== undefined && !isBbox(d.projectionBbox)) return false;
  if (d.catalogId !== undefined && typeof d.catalogId !== 'string') return false;
  return true;
```

Add these exports after `clearDataset()`:

```ts
export function datasetFitBbox(dataset: Dataset): Bbox | null {
  return dataset.projectionBbox ?? featureCollectionBbox(dataset.geojson);
}

export function bboxEqual(a: Bbox | undefined, b: Bbox | undefined): boolean {
  if (!a || !b) return false;
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}
```

- [ ] **Step 4: Run storage tests and verify pass**

Run:

```bash
npm test -- tests/storage.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/lib/storage.ts tests/storage.test.ts
git commit -m "Add dataset catalog metadata helpers"
```

---

### Task 2: Projection Components Use Dataset Fit Bbox

**Files:**
- Modify: `dtcc-atlaspp-mvp/src/lib/Calibrate.svelte`
- Modify: `dtcc-atlaspp-mvp/src/lib/CalibratePan.svelte`
- Modify: `dtcc-atlaspp-mvp/src/lib/CalibrateCorners.svelte`
- Modify: `dtcc-atlaspp-mvp/src/lib/CalibrateProjection.svelte`

- [ ] **Step 1: Rewire `Calibrate.svelte` imports and bbox lookup**

Replace:

```ts
  import { featureCollectionBbox } from './geojson';
  import { featuresToRenderables, type Renderable } from './geojsonRender';
  import type { Dataset } from './storage';
```

with:

```ts
  import { featuresToRenderables, type Renderable } from './geojsonRender';
  import { datasetFitBbox, type Dataset } from './storage';
```

Replace:

```ts
    const bbox = featureCollectionBbox(dataset.geojson);
```

with:

```ts
    const bbox = datasetFitBbox(dataset);
```

- [ ] **Step 2: Rewire `CalibratePan.svelte` imports and bbox lookup**

Replace:

```ts
  import { featureCollectionBbox } from './geojson';
  import { featuresToRenderables, type Renderable } from './geojsonRender';
  import { onKey } from './keybinds';
  import type { Dataset } from './storage';
```

with:

```ts
  import { featuresToRenderables, type Renderable } from './geojsonRender';
  import { onKey } from './keybinds';
  import { datasetFitBbox, type Dataset } from './storage';
```

Replace:

```ts
    const bbox = featureCollectionBbox(dataset.geojson);
```

with:

```ts
    const bbox = datasetFitBbox(dataset);
```

- [ ] **Step 3: Rewire `CalibrateCorners.svelte` imports and bbox lookup**

Replace:

```ts
  import { featureCollectionBbox } from './geojson';
  import { featuresToRenderables, type Renderable } from './geojsonRender';
  import { solveHomography, toMatrix3d, isDegenerate } from './homography';
  import type { Dataset } from './storage';
```

with:

```ts
  import { featuresToRenderables, type Renderable } from './geojsonRender';
  import { solveHomography, toMatrix3d, isDegenerate } from './homography';
  import { datasetFitBbox, type Dataset } from './storage';
```

Replace:

```ts
    const bbox = featureCollectionBbox(dataset.geojson);
```

with:

```ts
    const bbox = datasetFitBbox(dataset);
```

- [ ] **Step 4: Rewire `CalibrateProjection.svelte` imports and bbox lookup**

Replace:

```ts
  import { featureCollectionBbox } from './geojson';
  import { featuresToRenderables, type Renderable } from './geojsonRender';
  import { solveHomography, toMatrix3d, isDegenerate } from './homography';
  import { scaleFactor } from './scaleFactor';
  import type { Dataset, Calibration } from './storage';
```

with:

```ts
  import { featuresToRenderables, type Renderable } from './geojsonRender';
  import { solveHomography, toMatrix3d, isDegenerate } from './homography';
  import { scaleFactor } from './scaleFactor';
  import { datasetFitBbox, type Dataset, type Calibration } from './storage';
```

Replace:

```ts
    const bbox = featureCollectionBbox(dataset.geojson);
```

with:

```ts
    const bbox = datasetFitBbox(dataset);
```

- [ ] **Step 5: Run tests and build**

Run:

```bash
npm test
npm run build
```

Expected: both PASS. The build confirms the Svelte imports and TypeScript syntax are valid.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/lib/Calibrate.svelte src/lib/CalibratePan.svelte src/lib/CalibrateCorners.svelte src/lib/CalibrateProjection.svelte
git commit -m "Use catalog projection bbox for rendering"
```

---

### Task 3: Catalog Parser

**Files:**
- Create: `dtcc-atlaspp-mvp/src/lib/catalog.ts`
- Create: `dtcc-atlaspp-mvp/tests/catalog.test.ts`

- [ ] **Step 1: Write failing pure parser tests**

Create `tests/catalog.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { parseCatalog } from '../src/lib/catalog';

const entry = {
  id: 'gothenburg-dummy-mixed',
  title: 'Gothenburg Dummy Mixed',
  description: 'Synthetic mixed geometry sample.',
  file: 'gothenburg-dummy-mixed-v1.geojson',
  projectionBbox: [316385.555, 6397546.957, 322614.029, 6403932.781],
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

  it('rejects malformed projectionBbox values', () => {
    const result = parseCatalog({ version: 1, entries: [{ ...entry, projectionBbox: [1, 2, 3] }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/projectionBbox/i);
  });

  it('rejects non-string descriptions when present', () => {
    const result = parseCatalog({ version: 1, entries: [{ ...entry, description: 10 }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/description/i);
  });
});
```

- [ ] **Step 2: Run parser tests and verify failure**

Run:

```bash
npm test -- tests/catalog.test.ts
```

Expected: FAIL because `src/lib/catalog.ts` does not exist.

- [ ] **Step 3: Implement `src/lib/catalog.ts`**

Create `src/lib/catalog.ts`:

```ts
import type { Bbox } from './storage';

export type CatalogResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type CatalogEntry = {
  id: string;
  title: string;
  description?: string;
  file: string;
  projectionBbox: Bbox;
};

export type Catalog = {
  version: 1;
  entries: CatalogEntry[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isBbox(value: unknown): value is Bbox {
  return Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === 'number');
}

function isRelativeDatasetFile(file: string): boolean {
  if (file.length === 0) return false;
  if (file.startsWith('/')) return false;
  if (file.includes('://')) return false;
  if (file.startsWith('../')) return false;
  if (file.includes('/../')) return false;
  return true;
}

export function parseCatalog(value: unknown): CatalogResult<Catalog> {
  if (!isRecord(value)) return { ok: false, error: 'catalog must be an object' };
  if (value.version !== 1) return { ok: false, error: 'catalog version must be 1' };
  if (!Array.isArray(value.entries) || value.entries.length === 0) {
    return { ok: false, error: 'catalog entries must be a non-empty array' };
  }

  const seen = new Set<string>();
  const entries: CatalogEntry[] = [];

  for (let i = 0; i < value.entries.length; i++) {
    const raw = value.entries[i];
    if (!isRecord(raw)) return { ok: false, error: `entry ${i} must be an object` };

    if (typeof raw.id !== 'string' || raw.id.length === 0) {
      return { ok: false, error: `entry ${i} id must be a non-empty string` };
    }
    if (seen.has(raw.id)) return { ok: false, error: `duplicate catalog id "${raw.id}"` };
    seen.add(raw.id);

    if (typeof raw.title !== 'string' || raw.title.length === 0) {
      return { ok: false, error: `entry ${i} title must be a non-empty string` };
    }
    if (typeof raw.file !== 'string' || !isRelativeDatasetFile(raw.file)) {
      return { ok: false, error: `entry ${i} file must be relative to /datasets/` };
    }
    if (!isBbox(raw.projectionBbox)) {
      return { ok: false, error: `entry ${i} projectionBbox must be four numbers` };
    }
    if (raw.description !== undefined && typeof raw.description !== 'string') {
      return { ok: false, error: `entry ${i} description must be a string when present` };
    }

    entries.push({
      id: raw.id,
      title: raw.title,
      ...(raw.description !== undefined ? { description: raw.description } : {}),
      file: raw.file,
      projectionBbox: raw.projectionBbox,
    });
  }

  return { ok: true, value: { version: 1, entries } };
}
```

- [ ] **Step 4: Run parser tests and verify pass**

Run:

```bash
npm test -- tests/catalog.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/lib/catalog.ts tests/catalog.test.ts
git commit -m "Add static dataset catalog parser"
```

---

### Task 4: Static Dataset Files And Manifest Tests

**Files:**
- Modify: `dtcc-atlaspp-mvp/tests/catalog.test.ts`
- Create: `dtcc-atlaspp-mvp/public/datasets/README.md`
- Create: `dtcc-atlaspp-mvp/public/datasets/catalog.json`
- Create: `dtcc-atlaspp-mvp/public/datasets/gothenburg-dummy-mixed-v1.geojson`
- Create: `dtcc-atlaspp-mvp/public/datasets/calibration-gothenburg-grid-v1.geojson`

- [ ] **Step 1: Extend catalog tests to validate static files**

Add these imports at the top of `tests/catalog.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateGeoJSON } from '../src/lib/geojson';
```

Append this block to the bottom of `tests/catalog.test.ts`:

```ts
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
```

- [ ] **Step 2: Run catalog tests and verify failure**

Run:

```bash
npm test -- tests/catalog.test.ts
```

Expected: FAIL because `public/datasets/catalog.json` does not exist.

- [ ] **Step 3: Create dataset directory and copy temporary samples**

Run:

```bash
mkdir -p public/datasets
cp public/fixtures/gothenburg-dummy-mixed-v1.geojson public/datasets/gothenburg-dummy-mixed-v1.geojson
cp public/fixtures/calibration-gothenburg-grid-v1.geojson public/datasets/calibration-gothenburg-grid-v1.geojson
```

- [ ] **Step 4: Create `public/datasets/catalog.json`**

Create `public/datasets/catalog.json`:

```json
{
  "version": 1,
  "entries": [
    {
      "id": "gothenburg-dummy-mixed",
      "title": "Gothenburg Dummy Mixed",
      "description": "Temporary synthetic mixed geometry sample copied from public/fixtures until real dtcc-core exports are added.",
      "file": "gothenburg-dummy-mixed-v1.geojson",
      "projectionBbox": [316385.555, 6397546.957, 322614.029, 6403932.781]
    },
    {
      "id": "gothenburg-calibration-grid",
      "title": "Gothenburg Calibration Grid",
      "description": "Temporary grid sample with the same projection frame for checking catalog sample calibration reuse.",
      "file": "calibration-gothenburg-grid-v1.geojson",
      "projectionBbox": [316385.555, 6397546.957, 322614.029, 6403932.781]
    }
  ]
}
```

- [ ] **Step 5: Create `public/datasets/README.md`**

Create `public/datasets/README.md`:

```md
# Catalog datasets

This directory contains curated GeoJSON files that appear in the Atlas++ MVP sample selector.

Rules enforced by `tests/catalog.test.ts`:

- `catalog.json` must use `version: 1`.
- Each entry must have a unique `id`, `title`, `file`, and EPSG:3006 `projectionBbox`.
- `file` paths are relative to `/datasets/`.
- Listed GeoJSON files must validate through the app's EPSG:3006 `validateGeoJSON()` path, including a declared `crs` field.

The initial files are temporary copies from `public/fixtures/` so the static catalog path can be exercised before real pre-generated `dtcc-core` outputs are added. Replace or extend them with generated dataset exports as those become available.
```

- [ ] **Step 6: Run catalog tests and verify pass**

Run:

```bash
npm test -- tests/catalog.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add tests/catalog.test.ts public/datasets
git commit -m "Add static dataset catalog files"
```

---

### Task 5: Control Panel Catalog Selector

**Files:**
- Modify: `dtcc-atlaspp-mvp/src/lib/ControlPanel.svelte`

- [ ] **Step 1: Update imports and props**

Replace the current import in `ControlPanel.svelte`:

```ts
  import { validateGeoJSON, defaultStyle, type FeatureCollection } from './geojson';
```

with:

```ts
  import { parseCatalog, type CatalogEntry } from './catalog';
  import { validateGeoJSON, defaultStyle, type FeatureCollection } from './geojson';
  import type { Bbox } from './storage';
```

Update the prop destructuring to include `onLoadSample` with a no-op default. This keeps `ControlPanel` build-compatible until `App.svelte` passes the real callback in Task 6.

```ts
    onLoadDataset,
    onLoadSample = () => {},
    onClearDataset,
```

Update the prop types:

```ts
    dataset: { filename: string; geojson: FeatureCollection; style: { color: string }; catalogId?: string } | null;
    nextDisabled?: boolean;
    autoHide?: boolean;
    backHidden?: boolean;
    onLoadDataset: (d: { filename: string; geojson: FeatureCollection; style: { color: string } }) => void;
    onLoadSample?: (d: {
      filename: string;
      geojson: FeatureCollection;
      style: { color: string };
      projectionBbox: Bbox;
      catalogId: string;
    }) => void;
    onClearDataset: () => void;
```

- [ ] **Step 2: Add catalog state and loader**

Add state after `let fileInput = $state<HTMLInputElement | null>(null);`:

```ts
  let catalogEntries = $state<CatalogEntry[]>([]);
  let sampleLoading = $state(false);
```

Add derived values after `resetTimer()`:

```ts
  const activeCatalogEntry = $derived(
    catalogEntries.find((entry) => entry.id === dataset?.catalogId) ?? null
  );
  const selectedCatalogId = $derived(activeCatalogEntry?.id ?? '');
```

Add a mount effect after the existing auto-hide `$effect`:

```ts
  $effect(() => {
    let cancelled = false;

    async function loadCatalog() {
      try {
        const response = await fetch('/datasets/catalog.json', { cache: 'no-cache' });
        if (!response.ok) return;
        const parsed = parseCatalog(await response.json());
        if (!cancelled && parsed.ok) catalogEntries = parsed.value.entries;
      } catch {
        // Missing or invalid catalogs simply hide the selector; drag/drop remains available.
      }
    }

    loadCatalog();
    return () => {
      cancelled = true;
    };
  });
```

- [ ] **Step 3: Add sample selection handler**

Add this function before `handleFile(file: File)`:

```ts
  async function handleSampleChange(e: Event) {
    const id = (e.currentTarget as HTMLSelectElement).value;
    const entry = catalogEntries.find((candidate) => candidate.id === id);
    if (!entry) return;

    // Do not short-circuit when `entry.id === dataset?.catalogId`; reloading the active sample is intentional.
    error = null;
    sampleLoading = true;
    try {
      const response = await fetch(`/datasets/${entry.file}`, { cache: 'no-cache' });
      if (!response.ok) {
        error = `sample fetch failed (${response.status} ${response.statusText})`;
        return;
      }
      const text = await response.text();
      const result = validateGeoJSON(text);
      if (!result.ok) {
        error = result.error;
        return;
      }
      onLoadSample({
        filename: entry.file,
        geojson: result.value,
        style: defaultStyle(),
        projectionBbox: entry.projectionBbox,
        catalogId: entry.id,
      });
    } catch (err) {
      error = `sample fetch failed: ${(err as Error).message}`;
    } finally {
      sampleLoading = false;
      resetTimer();
    }
  }
```

- [ ] **Step 4: Render selector above the drop zone**

Insert this block immediately before the existing drop-zone `<div role="region" ...>`:

```svelte
    {#if catalogEntries.length > 0}
      <div class="mb-3">
        <label class="block text-xs font-medium mb-1" for="sample-dataset">Sample dataset</label>
        <select
          id="sample-dataset"
          class="w-full text-xs rounded border border-dtcc-border bg-white px-2 py-1 disabled:opacity-60"
          value={selectedCatalogId}
          disabled={sampleLoading}
          onchange={handleSampleChange}
        >
          <option value="" disabled>{sampleLoading ? 'Loading...' : 'Select a sample...'}</option>
          {#each catalogEntries as entry}
            <option value={entry.id}>{entry.title}</option>
          {/each}
        </select>
        {#if sampleLoading}
          <p class="text-xs text-dtcc-muted mt-1">Loading...</p>
        {:else if activeCatalogEntry?.description}
          <p class="text-xs text-dtcc-muted mt-1">{activeCatalogEntry.description}</p>
        {/if}
      </div>
    {/if}
```

- [ ] **Step 5: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/lib/ControlPanel.svelte
git commit -m "Add catalog selector to control panel"
```

---

### Task 6: App Sample Load Semantics

**Files:**
- Modify: `dtcc-atlaspp-mvp/src/App.svelte`

- [ ] **Step 1: Update imports**

In `App.svelte`, add `bboxEqual` to the storage import:

```ts
    clearCalibration,
    bboxEqual,
    type Dataset,
```

- [ ] **Step 2: Add reset helper**

Add this helper after `setCalibration(c: Calibration | null)`:

```ts
  function resetWizardState() {
    setCalibration(null);
    step = 1;
    panX = 0;
    panY = 0;
    pendingCorners = null;
  }
```

- [ ] **Step 3: Refactor `handleLoadDataset` to use reset helper without changing behavior**

Replace the reset lines at the end of `handleLoadDataset`:

```ts
    // A new file invalidates pan and any prior calibration — they were keyed
    // to the old dataset's bbox/projection and the old viewport.
    setCalibration(null);
    dataset = next;
    step = 1;
    panX = 0;
    panY = 0;
    pendingCorners = null;
```

with:

```ts
    // A new file invalidates pan and any prior calibration — they were keyed
    // to the old dataset's bbox/projection and the old viewport.
    dataset = next;
    resetWizardState();
```

This keeps drag/drop reset behavior unchanged.

- [ ] **Step 4: Add `handleLoadSample`**

Add this function after `handleLoadDataset`:

```ts
  function handleLoadSample(d: {
    filename: string;
    geojson: FeatureCollection;
    style: { color: string };
    projectionBbox: [number, number, number, number];
    catalogId: string;
  }) {
    const next: Dataset = {
      version: 2,
      ...d,
      uploadedAt: new Date().toISOString(),
    };
    const compatible = calibration !== null && bboxEqual(dataset?.projectionBbox, next.projectionBbox);
    saveDataset(next);
    dataset = next;
    if (compatible) {
      step = 5;
    } else {
      resetWizardState();
    }
  }
```

- [ ] **Step 5: Pass `onLoadSample` to `ControlPanel`**

Update the `ControlPanel` invocation:

```svelte
  onLoadDataset={handleLoadDataset}
  onLoadSample={handleLoadSample}
  onClearDataset={handleClearDataset}
```

- [ ] **Step 6: Run full tests and build**

Run:

```bash
npm test
npm run build
```

Expected: both PASS.

- [ ] **Step 7: Commit Task 6**

```bash
git add src/App.svelte
git commit -m "Preserve calibration for compatible catalog samples"
```

---

### Task 7: Final Manual Smoke Check

**Files:**
- Modify: `dtcc-atlaspp-mvp/acceptance-log.md`

- [ ] **Step 1: Start dev server**

Run:

```bash
npm run dev
```

Expected: Vite reports a local URL, normally `http://localhost:5175/`.

- [ ] **Step 2: Open the app in a browser**

Open the Vite URL. Confirm:

- The control panel shows `Sample dataset` above the drop zone.
- With no active dataset, the selector shows `Select a sample...`.
- Both temporary catalog samples are listed.

- [ ] **Step 3: Load the first sample**

Select `Gothenburg Dummy Mixed`.

Expected:

- The sample loads.
- The file name shown in the drop zone is `gothenburg-dummy-mixed-v1.geojson`.
- The description helper text appears under the selector.
- The wizard is at step 1 because no compatible prior catalog dataset was active.

- [ ] **Step 4: Complete a quick calibration**

Advance through the wizard with the current sample using the fastest acceptable local smoke-test alignment.

Expected: step 5 projection view appears.

- [ ] **Step 5: Switch to compatible catalog sample**

Select `Gothenburg Calibration Grid`.

Expected:

- The app remains in step 5 projection view.
- Calibration is preserved.
- The rendered content changes while retaining the same calibrated frame.

- [ ] **Step 6: Verify drag/drop reset path**

Drop or pick `public/fixtures/calibration-square-40cm-grid-v1.geojson`.

Expected:

- Drag/drop load succeeds.
- Calibration clears.
- Wizard returns to step 1.

- [ ] **Step 7: Record acceptance result**

Append this entry to `acceptance-log.md` with actual observed notes:

```md

## Static Dataset Catalog — 2026-05-04

| Check | Expected | Result | Notes |
|---|---|---|---|
| Selector appears | `Sample dataset` select appears above drop zone with placeholder when no catalog sample is active | pass/fail |  |
| Sample load | Selecting `Gothenburg Dummy Mixed` loads `gothenburg-dummy-mixed-v1.geojson` | pass/fail |  |
| Compatible sample switch | Switching to `Gothenburg Calibration Grid` after calibration stays in projection view | pass/fail |  |
| Drag/drop reset | Loading `calibration-square-40cm-grid-v1.geojson` by drag/drop returns to step 1 | pass/fail |  |
```

- [ ] **Step 8: Run final verification**

Stop the dev server, then run:

```bash
npm test
npm run build
```

Expected: both PASS.

- [ ] **Step 9: Commit Task 7**

```bash
git add acceptance-log.md
git commit -m "Record static catalog acceptance check"
```
