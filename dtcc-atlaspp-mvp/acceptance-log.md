# Acceptance log

Record of manual verification runs against the acceptance rubric in the design spec.

## Template

```
### YYYY-MM-DD — <operator name>

**Setup:**
- Machine: <Mac mini / laptop>
- Monitor / projector: <model, resolution>
- Physical model version: <v, date printed>

**Calibration:**
- Bbox: [minLon, minLat, maxLon, maxLat]
- Corner deviations measured (mm): TL=_, TR=_, BR=_, BL=_
- Pass (≤ 10 mm all corners)? Y / N

**Visual legibility (informational — does NOT block GO/NO-GO):**
- `gothenburg-polygons-v1.geojson`: Y / N — notes
- `gothenburg-lines-v1.geojson`: Y / N — notes
- `gothenburg-points-v1.geojson`: Y / N — notes
- Summary: 3/3 pass → visual goal met; 1-2 fail → warning (inform scenario/styling priorities in the full build); 0/3 pass → reconsider visual approach.

**Photos:** `./acceptance-log-YYYY-MM-DD/`

**Full-build GO / NO-GO (determined by alignment only, per spec):** GO / NO-GO

**Notes:**
```
