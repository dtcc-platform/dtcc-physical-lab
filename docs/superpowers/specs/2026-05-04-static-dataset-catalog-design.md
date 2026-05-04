# Static Dataset Catalog for Atlas++ MVP

**Status:** Design approved in brainstorming, pending written-spec review
**Date:** 2026-05-04
**Scope:** `dtcc-atlaspp-mvp/`

---

## Purpose

Let the Atlas++ MVP load curated, pre-generated EPSG:3006 GeoJSON datasets from a static catalog. This is the lowest-friction path for showing datasets exported from `temp/dtcc-core/` without adding a backend, Python runtime calls from the browser, or a live dependency on `dtcc-core`.

The operator gets a compact sample selector in the existing control panel. Selecting a sample fetches the GeoJSON, validates it with the same EPSG:3006 validator as drag/drop upload, persists it as the active `Dataset`, and renders it through the existing calibration flow.

## Non-goals

- No backend service.
- No runtime calls from the browser into `dtcc-core`.
- No automatic generation of datasets from the webapp.
- No folder browsing from the browser.
- No multi-layer composition, multi-select, opacity controls, legends, or data-driven styling.
- No change to drag/drop behavior. Drag/drop remains the arbitrary-file path and still resets calibration.
- No generalized CRS support. Catalog files must be EPSG:3006 with a declared `crs` field.

## Static Assets

Add a new directory:

```text
dtcc-atlaspp-mvp/public/datasets/
  catalog.json
  README.md
  *.geojson
```

`public/fixtures/` remains for calibration aids and test fixtures. `public/datasets/` is for curated, user-loadable content samples. For the first implementation, one existing EPSG:3006 fixture may be copied into `public/datasets/` as a placeholder to prove the static catalog path; the README must mark it as temporary until real pre-generated `dtcc-core` GeoJSON outputs are added.

## Manifest Schema

`public/datasets/catalog.json` has this shape:

```json
{
  "version": 1,
  "entries": [
    {
      "id": "smoke-slice-gbg",
      "title": "Smoke Slice",
      "description": "Synthetic smoke velocity slice over central Gothenburg",
      "file": "smoke-slice-gbg.geojson",
      "projectionBbox": [319750, 6398750, 320250, 6399250]
    }
  ]
}
```

Rules:

- `version` must be `1`.
- `entries` must be a non-empty array.
- `id`, `title`, `file`, and `projectionBbox` are required.
- `description` is optional.
- `id` values must be unique.
- `file` is relative to `/datasets/`; absolute URLs and paths are invalid.
- `projectionBbox` must be exactly `[number, number, number, number]` in EPSG:3006.
- Catalog entries are single-layer GeoJSON files.

`projectionBbox` is not just a compatibility key. It is the geographic frame used to fit the dataset into the calibrated square. Two catalog datasets intended to reuse calibration must declare the same tuple-exact `projectionBbox`.

## Dataset Runtime Shape

Extend the persisted `Dataset` type in `src/lib/storage.ts` with optional fields:

```ts
projectionBbox?: [number, number, number, number];
catalogId?: string;
```

`Dataset.version` stays `2`; optional fields do not require migration. `isDataset()` must validate optional fields when present:

- `projectionBbox`, if present, must be an array of length 4 with numeric entries.
- `catalogId`, if present, must be a string.

Malformed optional fields are treated as an invalid persisted dataset and `loadDataset()` returns `null`, matching existing localStorage corruption behavior.

Add helpers in `storage.ts`, next to the bbox-bearing type:

```ts
export function datasetFitBbox(dataset: Dataset): [number, number, number, number] | null;
export function bboxEqual(
  a: [number, number, number, number] | undefined,
  b: [number, number, number, number] | undefined,
): boolean;
```

`datasetFitBbox(dataset)` returns `dataset.projectionBbox ?? featureCollectionBbox(dataset.geojson)`.

`bboxEqual(a, b)` is tuple-exact equality. No tolerance is used because manifest JSON is handcrafted and should not introduce floating-point drift.

The helper lives in `storage.ts` to avoid a circular import: `storage.ts` already imports `FeatureCollection` from `geojson.ts`, so `geojson.ts` should not import `Dataset` from `storage.ts`.

## Projection Behavior

All projection components fit to `datasetFitBbox(dataset)` instead of calling `featureCollectionBbox(dataset.geojson)` directly:

- `Calibrate.svelte`
- `CalibratePan.svelte`
- `CalibrateCorners.svelte`
- `CalibrateProjection.svelte`

This makes `projectionBbox` the actual rendering anchor. Without this change, two samples with equal `projectionBbox` but different feature extents would preserve calibration while rendering at different sizes, which would be incorrect.

Drag/drop datasets have no `projectionBbox`, so they keep the current feature-bbox behavior.

## Control Panel UI

`ControlPanel.svelte` fetches `/datasets/catalog.json` on mount.

Behavior:

- Missing manifest, invalid manifest, parse failure, fetch failure, or `entries: []`: hide the sample selector.
- Valid manifest: show a compact `Sample dataset` selector above the drop zone.
- The selector has a disabled placeholder option, `Select a sample...`, when there is no active catalog sample. This is the selected state when `dataset` is `null`, when `dataset.catalogId` is absent because a drag/drop dataset is active, or when `dataset.catalogId` does not match any current manifest entry.
- Each option displays the manifest entry `title`.
- When a manifest entry is active and has `description`, show that description as small helper text below the selector. If no catalog sample is active, or the active entry has no description, show no helper text.
- While a sample file is loading: disable the selector and show `Loading...`; no spinner.
- Listed file fetch errors and GeoJSON validation errors use the existing inline `error` slot.
- Selecting the currently active sample re-fetches and reloads idempotently.
- The existing drop zone remains visible and unchanged.

Keep drag/drop and catalog sample loading as separate paths. Do not widen `onLoadDataset`.

Add a sibling callback prop:

```ts
onLoadSample: (d: {
  filename: string;
  geojson: FeatureCollection;
  style: { color: string };
  projectionBbox: [number, number, number, number];
  catalogId: string;
}) => void;
```

`ControlPanel` builds this payload by copying `projectionBbox` and `id` from the manifest entry after the fetched GeoJSON validates.

## App State Behavior

`App.svelte` keeps the existing `handleLoadDataset()` unchanged for drag/drop:

- Save dataset.
- Clear calibration.
- Reset to step 1.
- Reset pan and pending corners.

Add `handleLoadSample()` for catalog samples:

1. Build a `Dataset` with `version: 2`, `filename`, `geojson`, `style`, `uploadedAt`, `projectionBbox`, and `catalogId`.
2. Compute compatibility before replacing `dataset`:
   - compatible when `bboxEqual(dataset?.projectionBbox, next.projectionBbox)` is true and `calibration` exists.
3. Save the new dataset.
4. If compatible:
   - keep the current calibration.
   - set `dataset = next`.
   - set `step = 5`.
   - preserve current `panX`, `panY`, and `pendingCorners` state as-is.
5. If incompatible:
   - clear calibration.
   - set `dataset = next`.
   - set `step = 1`.
   - reset `panX`, `panY`, and `pendingCorners`.

If calibration is cleared because `projectionBbox` differs, there is no extra banner or toast. Returning to step 1 is the signal.

Known v1 gap: if the operator loads a drag/drop dataset between two compatible catalog samples, the next catalog selection resets calibration because the current in-memory dataset has no `projectionBbox`. This is acceptable for the first static-catalog pass.

## Catalog Validation Module

Add `src/lib/catalog.ts` with pure types and validation:

- `Catalog`
- `CatalogEntry`
- `CatalogResult<T> = { ok: true; value: T } | { ok: false; error: string }`
- `parseCatalog(value: unknown): CatalogResult<Catalog>`

Validation covers:

- `version === 1`
- non-empty entries
- unique ids
- required string fields
- optional string `description`
- relative `file`
- exact four-number `projectionBbox`

The browser runtime may silently hide the selector for invalid manifests, but tests should fail loudly.

## Tests

Add `tests/catalog.test.ts`:

- Validates `public/datasets/catalog.json`.
- Rejects duplicate ids through the pure parser.
- Rejects empty entries.
- Rejects absolute URLs and absolute paths.
- Rejects malformed `projectionBbox` values.
- Verifies each listed file exists under `public/datasets/`.
- Reads each listed GeoJSON and verifies `validateGeoJSON()` succeeds.

Update `tests/storage.test.ts`:

- Optional `projectionBbox` round-trips.
- Optional `catalogId` round-trips.
- Malformed optional `projectionBbox` is rejected by `loadDataset()`.
- Malformed optional `catalogId` is rejected by `loadDataset()`, including a non-string value such as a number.
- `bboxEqual()` uses tuple-exact equality.
- `datasetFitBbox()` returns `projectionBbox` when present.
- `datasetFitBbox()` falls back to `featureCollectionBbox()` when absent.

There is no Svelte component-test harness in this project. The `.svelte` projection-chain edits are verified by TypeScript/build coverage, helper unit tests, and manual smoke checks.

## Manual Verification

After implementation:

1. Run the app and confirm the sample selector appears above the drop zone when the manifest is valid.
2. Select the bundled sample and confirm it loads.
3. Calibrate once, then select another catalog sample with the same `projectionBbox`; confirm the app stays in projection view and calibration is preserved.
4. Select a catalog sample with a different `projectionBbox`, or use drag/drop; confirm the wizard restarts at step 1.
5. Temporarily break a listed file path or CRS and confirm the error appears in the control-panel error slot.

## Risks

- A catalog entry with a wrong but shape-valid `projectionBbox` will pass schema validation and render in the wrong frame. Mitigation: `tests/catalog.test.ts` catches structural errors, while visual/manual review catches semantic bbox mistakes.
- Preserving calibration only across current-sample compatibility is intentionally narrow. A future design could persist calibration anchor metadata on the calibration record itself, but that is beyond this first pass.
- The placeholder sample in `public/datasets/` should not become permanent product content. It exists only to prove the static-catalog path until real pre-generated `dtcc-core` outputs are added.
