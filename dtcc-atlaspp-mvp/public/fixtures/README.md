# Test fixtures

Three GeoJSON files in WGS84 (EPSG:4326) required for acceptance testing. Not committed to git (they may have licensing terms). Drop them here manually before running Task 18 from the plan.

A committed synthetic fixture is also available for quick calibration smoke tests:

| File | Source | Geometry |
|---|---|---|
| `calibration-gothenburg-grid-v1.geojson` | Synthetic, committed in repo | Calibration grid: frame + diagonals + center axes + points |
| `gothenburg-dummy-mixed-v1.geojson` | Synthetic, committed in repo | Mixed: Polygon + LineString + Point |

| File | Source | Geometry |
|---|---|---|
| `gothenburg-polygons-v1.geojson` | Göteborg Open Data — stadsdelsnämndsområden / parishes | Polygon |
| `gothenburg-lines-v1.geojson` | Västtrafik — one tram or bus route family | LineString |
| `gothenburg-points-v1.geojson` | Västtrafik stops OR Göteborg landmarks (100–500 features) | Point |

Reproject with e.g.:

```bash
ogr2ogr -t_srs EPSG:4326 gothenburg-polygons-v1.geojson input.shp
```

If a dataset omits a `crs` field but still uses SWEREF99 TM meters, the app's
range check will reject the file with a reprojection hint — that is the
intended guardrail, not a bug.
