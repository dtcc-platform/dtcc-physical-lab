# Catalog datasets

This directory contains curated GeoJSON files that appear in the Atlas++ MVP sample selector.

Rules enforced by `tests/catalog.test.ts`:

- `catalog.json` must use `version: 1`.
- Each entry must have a unique `id`, `title`, `file`, and EPSG:3006 `projectionBbox`.
- `file` paths are relative to `/datasets/`.
- Listed GeoJSON files must validate through the app's EPSG:3006 `validateGeoJSON()` path, including a declared `crs` field.

The initial files are temporary copies from `public/fixtures/` so the static catalog path can be exercised before real pre-generated `dtcc-core` outputs are added. Replace or extend them with generated dataset exports as those become available.
