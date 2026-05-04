# Test fixtures

Three GeoJSON files in EPSG:3006 (SWEREF99 TM) required for acceptance testing. Not committed to git (they may have licensing terms). Drop them here manually before running Task 18 from the plan.

Committed synthetic fixtures are also available for quick calibration smoke tests:

| File | Source | Geometry |
|---|---|---|
| `calibration-square-40cm-grid-v1.geojson` | Synthetic, committed in repo | 100 m × 100 m square at central Gothenburg: frame + diagonals + 4×4 grid + NW orientation marker. Sized for a 40 cm × 40 cm physical model — each grid cell maps to 10 cm on the model. |
| `calibration-gothenburg-grid-v1.geojson` | Synthetic, committed in repo | Calibration grid: frame + diagonals + center axes + points |
| `gothenburg-dummy-mixed-v1.geojson` | Synthetic, committed in repo | Mixed: Polygon + LineString + Point |

| File | Source | Geometry |
|---|---|---|
| `gothenburg-polygons-v1.geojson` | Göteborg Open Data — stadsdelsnämndsområden / parishes | Polygon |
| `gothenburg-lines-v1.geojson` | Västtrafik — one tram or bus route family | LineString |
| `gothenburg-points-v1.geojson` | Västtrafik stops OR Göteborg landmarks (100–500 features) | Point |

Reproject with e.g.:

```bash
ogr2ogr -f GeoJSON -t_srs EPSG:3006 -lco RFC7946=NO gothenburg-polygons-v1.geojson input.shp
```

`-lco RFC7946=NO` keeps the `crs` field in the output (RFC 7946 strips it).

If a dataset omits a `crs` field, or uses WGS84 degrees, the app's validator
rejects it with a reproject-to-EPSG:3006 hint — that is the intended
guardrail, not a bug. Add `"crs": { "type": "name", "properties": { "name":
"urn:ogc:def:crs:EPSG::3006" } }` at the FeatureCollection root if your
toolchain doesn't emit it.
