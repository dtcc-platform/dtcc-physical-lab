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

## 2026-04-30 — Back button in calibration wizard

**Spec:** `../docs/superpowers/specs/2026-04-30-back-button-calibration-wizard-design.md`
**Plan:** `../docs/superpowers/plans/2026-04-30-back-button-calibration-wizard.md`
**Operator:** automated browser run via Playwright MCP against `npm run dev` (vite 6.4.2, port 5175)
**Viewport at run time:** 1200 × 1124
**Fixture:** `public/fixtures/gothenburg-dummy-mixed-v1.geojson` (5 features), injected into `localStorage['dtcc-atlaspp-mvp.dataset']` to bypass the MCP file-root sandbox (the picker UI is not under test here).

| # | Case | Result | Evidence |
|---|------|--------|----------|
| 1 | Forward 1→5 (Next×4) then back 5→4→3→2→1 (Back×4); no console errors | pass | Walked the chain end-to-end; `console_messages` returned 0 errors / 0 warnings across the session. Back is rendered at steps 2/3/4/5 and hidden at step 1. |
| 2 | Step 4 → Next (saves) → Back; saved corners restored; localStorage `calibration` unchanged | pass | After Next at step 4 with default corners (`[78,40], [1122,40], [1122,1084], [78,1084]`, `sourceWidth=1200`), localStorage `calibration` reflected those values. Back from step 5 returned to step 4 with corner handles at the identical positions; localStorage `calibration` still equal to the pre-Back snapshot. |
| 3 | Step 4 → Back to 3 → Next back to 4; corner positions preserved | pass | To make this conclusive (defaults coincide with the saved values at this viewport), the saved `cornerDst` was overwritten to `[[50,50],[1100,50],[1100,1000],[50,1000]]`. After page reload (boot to step 5) → Back → step 4 with handles at exactly those positions. Then Back to 3 → Next to 4 → handles still at `[50,50], [1100,50], [1100,1000], [50,1000]`. The 4→3→4 path preserves `pendingCorners` correctly. |
| 4 | Reload at step 5 → Back; saved corners (rescaled into current viewport) appear at step 4 | pass | With `dataset` and `calibration` (cornerDst overwritten to the non-default quad above) both in localStorage, page reload → app booted directly at step 5 (`handleCount = 0`, Next disabled). Back → step 4 with handles at exactly the saved cornerDst. `sx = sy = 1` — no resize between save and back, so the rescale was a no-op as expected. |
| 5 | At step 1 (with no dataset), Back is not visible; with dataset present, Back is hidden until step 2 | pass | Initial load with empty localStorage: control panel buttons = `[Next (disabled), Clear (disabled)]`, no Back. After loading dataset and remaining at step 1: same buttons, still no Back. After Next to step 2: buttons = `[Back, Next, Clear]`. |

**Notes:**

- 5 of 5 cases pass. No console errors, no Svelte compiler warnings during the dev server run (the initial `state_referenced_locally` warning from Task 3 was fixed mid-execution by extracting the seed branch into a `startingCorners()` function).
- The MCP browser cannot upload files outside its sandboxed root, so this run injects the dataset via `localStorage` and lets `App.svelte`'s boot path hydrate it. The drag-and-drop and file-picker code paths in `ControlPanel` are not exercised by this entry; they are unchanged by the Back-button feature.
- `npm run build` succeeds (`tsc --noEmit && vite build`); `npm test` reports 48 passing (45 baseline + 3 new in `tests/scaleFactor.test.ts`).
