# Catalog datasets

This directory contains curated GeoJSON files that appear in the DTCC Atlas++ MVP sample selector.

Rules enforced by `tests/catalog.test.ts`:

- `catalog.json` must use `version: 1`.
- Each entry must have a unique `id`, `title`, `file`, and EPSG:3006 `bounds`.
- `file` paths are relative to `/datasets/`.
- Listed GeoJSON files must validate through the app's EPSG:3006 `validateGeoJSON()` path, including a declared `crs` field.
- GeoJSON entries may omit `kind` and `format`; the parser normalizes them to `kind: "geojson"` and `format: "geojson"`.
- PNG entries use `kind: "image"`, `format: "png"`, and `mediaType: "image/png"`.
- MP4 entries use `kind: "video"`, `format: "mp4"`, and `mediaType: "video/mp4"`.

The initial files are temporary copies from `public/fixtures/` so the static catalog path can be exercised before real pre-generated `dtcc-core` outputs are added. Replace or extend them with generated dataset exports as those become available.

## Online catalog deployment config

To give end users a plain dataset picker (no URL, token, or Fetch button), copy
`online-config.example.json` to `online-config.json` in this directory and fill
in the catalog base URL and a browse token. When the file is present, the app
fetches the online catalog automatically on startup; when it is missing, the
manual URL/token flow remains available. `online-config.json` is gitignored —
it is served as a public static file, so only use a low-privilege read-only
browse token.

Built deployments serve `dist/`, so create the file before `npm run build` or
copy it to `dist/datasets/online-config.json` afterwards. The projector reads
it at startup and never persists it, so deleting or rotating the file takes
effect on the next page load.

To ingest `dtcc-core` sidecar manifests, run:

```bash
npm run catalog:ingest -- /path/to/dtcc-core/exports
```

The command scans recursively for `*.manifest.json`, copies referenced GeoJSON, PNG, and MP4 artifacts into this directory, and upserts matching entries in `catalog.json`. Unsupported dtcc-core formats are skipped with a warning.
