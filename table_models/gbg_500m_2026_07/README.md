# Gothenburg 500 m Table Profile

This profile describes the 500 m x 500 m Gothenburg tangible-table model used by
the Atlas projector workflow.

## Physical Model

- Model id: `gbg_500m_2026_07`
- CRS: `EPSG:3006`
- Bounds: `[319720, 6397660, 320220, 6398160]`
- Physical table size: `400 mm x 400 mm`
- Scale: `1:1250`
- Output directory: `temp/table_catalog/gbg_500m_2026_07`

Generated output under `temp/` is local build evidence and must not be committed.

## Generate Packages

Preview the planned default packages without writing output:

```bash
python scripts/generate_table_catalog.py gbg_500m_2026_07 --dry-run
```

Generate the default local catalog packages:

```bash
python scripts/generate_table_catalog.py gbg_500m_2026_07 --clean
```

Generate an opt-in disabled package by id:

```bash
python scripts/generate_table_catalog.py gbg_500m_2026_07 --only footprints_geojson --clean
```

Publishing is explicit. `--publish` requires `DTCC_UPLOAD_URL` and
`DTCC_UPLOAD_TOKEN`, and each dataset still respects its own `table.publish`
flag.

```bash
DTCC_UPLOAD_URL=https://upload.example DTCC_UPLOAD_TOKEN=... \
  python scripts/generate_table_catalog.py gbg_500m_2026_07 --publish --clean
```

## Default Outputs

Default generation creates table-facing artifacts only:

- `calibration_grid`: EPSG:3006 GeoJSON alignment grid with 41 lines per axis.
- `smoke_slice_geojson`: EPSG:3006 GeoJSON smoke speed slice for overlay checks.
- `smoke_streamlines_geojson`: EPSG:3006 GeoJSON streamline overlay.
- `smoke_slice`: 1920 x 1920 PNG synthetic smoke speed projection.
- `smoke_streamlines`: 1920 x 1920 PNG synthetic streamline projection.

The generator validates each package manifest against the expected format, media
type, data kind, and CRS declared in `datasets.yaml`.

## Disabled By Default

- `smoke_field_vtu`: local volume-field inspection artifact; not useful in the
  projector-table UI.
- `smoke_field_pb`: local Dataset v2 serialization check; not useful in the
  projector-table UI.
- `smoke_streamlines_mp4`: optional motion loop; disabled because video
  encoding is extra runtime surface.
- `footprints_geojson`: table-alignment context from cached/live building
  footprints; disabled until provider/cache availability and source/license
  review are ready for default publishing.

## Visual Inspection Notes

- Calibration grid: verify the outer grid frame covers the printed model square,
  grid spacing is uniform, and no axis is flipped, shifted, or stretched.
- Smoke slice PNG: verify the image fills the table frame and remains a
  synthetic UX fixture. It is not CFD validation.
- Smoke streamlines PNG: verify streamline direction is readable at table scale
  and does not hide the calibration frame during setup.
- Smoke GeoJSON overlays: verify EPSG:3006 coordinates load in Atlas and reuse
  the same table bounds as the PNG projections.
- Building footprints: when generated opt-in, verify polygons sit on the
  physical buildings and inspect obvious offsets before treating the layer as an
  alignment reference.
