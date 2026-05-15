# DTCC Atlas++ MVP

Standalone web app that projects EPSG:3006 (SWEREF99 TM) GeoJSONs onto a 3 m × 3 m 3D-printed Gothenburg city model via a calibrated overhead projector.

- **Design spec:** `../docs/superpowers/specs/2026-04-22-dtcc-atlaspp-mvp-design.md`
- **Plan:** `../docs/superpowers/plans/2026-04-22-dtcc-atlaspp-mvp.md`
- **Acceptance log:** `./acceptance-log.md`

## Run locally

```bash
npm install
npm run dev     # dev server on http://localhost:5175
npm run dev:remote # Vite on 5175 plus control API on 5176
npm run build   # static site in dist/
npm run preview # serve the built dist/
npm test        # vitest unit tests
```

Deploy `dist/` under a **local HTTP server** (`caddy file-server`, `python -m http.server`, `npx vite preview`). `file://` is not supported.

## Operator remote

The operator remote is a LAN-only browser page for a second device such as an iPad. The projector Mac remains the source of truth; the remote only posts discrete commands through the local control server.

Dev mode:

```bash
npm run dev:remote
```

Open the projector page on the Mac:

```text
http://localhost:5175/projector
```

Open the remote on the iPad using the Mac LAN IP:

```text
http://192.168.1.42:5175/remote
```

Production mode:

```bash
npm run build
npm run control:serve
```

Use the 6-digit PIN shown on the projector to pair the iPad. After server restart or projector reload, old remote tokens are invalidated and the iPad must pair again.

## Calibration flow

1. Open the app on the machine wired to the projector. F11 to fullscreen.
2. On first run, the app opens directly in bbox-framing mode. Pan/zoom the map to match the geographic extent of the printed model. Press **Lock bbox**.
3. The test-pattern view appears. Drag the four orange corner handles onto the physical corners of the printed model. The yellow grid will warp live. Press **Save calibration**.
4. Drop an EPSG:3006 (SWEREF99 TM) `.geojson` file onto the control panel in the bottom-right. It renders onto the model. Use the color picker and basemap toggle to taste. Press **c** to re-run calibration.

## Network requirements

| Asset | When fetched | Offline behavior |
|---|---|---|
| App bundle | First load, cached | Served locally after |
| Montserrat (Google Fonts) | Every page load | Falls back to system sans-serif |
| OSM tiles for bbox framing | During `calibrate.bbox` | Calibration blocked without tiles |
| OSM tiles for view-mode basemap | Toggle on | Toggle on without network → grey tiles |
| User GeoJSON, calibration, settings | Never — localStorage | Always offline |

## Known limitations

- Single city per install; re-point by re-calibrating.
- EPSG:3006 (SWEREF99 TM) only — reproject upstream with `ogr2ogr -t_srs EPSG:3006 out.geojson in.shp`. WGS84 files are rejected with a reprojection hint.
- Calibration tied to window resolution at save time; a resize triggers a re-calibrate banner.
- OSM public tile server is used as-is; swap to a Stadia/MapTiler key if deploying.
