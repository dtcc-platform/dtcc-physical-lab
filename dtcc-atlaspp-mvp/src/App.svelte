<script lang="ts">
  import Calibrate from './lib/Calibrate.svelte';
  import CalibrateOsm from './lib/CalibrateOsm.svelte';
  import CalibratePan from './lib/CalibratePan.svelte';
  import CalibrateCorners from './lib/CalibrateCorners.svelte';
  import CalibrateProjection from './lib/CalibrateProjection.svelte';
  import ControlPanel from './lib/ControlPanel.svelte';
  import { scaleFactor } from './lib/scaleFactor';
  import {
    loadDataset,
    saveDataset,
    clearDataset,
    loadCalibration,
    saveCalibration,
    clearCalibration,
    type Dataset,
    type Calibration,
  } from './lib/storage';
  import type { FeatureCollection } from './lib/geojson';

  const initialDataset = loadDataset();
  const initialCalibration = loadCalibration();
  let dataset = $state<Dataset | null>(initialDataset);
  let calibration = $state<Calibration | null>(initialCalibration);
  // Boot resume: if both a dataset and a calibration are persisted, land
  // directly on the projection view. Otherwise start the wizard from step 1.
  let step = $state<1 | 2 | 3 | 4 | 5>(initialDataset && initialCalibration ? 5 : 1);
  let panX = $state(0);
  let panY = $state(0);

  // Step 4 reports its current corner positions + homography here so Next can
  // commit them as a saved calibration.
  let pendingCorners = $state<{
    cornerDst: [[number, number], [number, number], [number, number], [number, number]];
    homography: number[] | null;
    sourceWidth: number;
    sourceHeight: number;
  } | null>(null);

  // Single wrapper keeps storage and $state paired — fewer chances for drift
  // between localStorage and the in-memory calibration.
  function setCalibration(c: Calibration | null) {
    if (c) saveCalibration(c);
    else clearCalibration();
    calibration = c;
  }

  function handleLoadDataset(d: { filename: string; geojson: FeatureCollection; style: { color: string } }) {
    const next: Dataset = {
      version: 1,
      ...d,
      uploadedAt: new Date().toISOString(),
    };
    saveDataset(next);
    // A new file invalidates pan and any prior calibration — they were keyed
    // to the old dataset's bbox/projection and the old viewport.
    setCalibration(null);
    dataset = next;
    step = 1;
    panX = 0;
    panY = 0;
    pendingCorners = null;
  }

  function handleClearDataset() {
    clearDataset();
    setCalibration(null);
    dataset = null;
    step = 1;
    panX = 0;
    panY = 0;
    pendingCorners = null;
  }

  function handleSetColor(color: string) {
    if (!dataset) return;
    const next: Dataset = { ...dataset, style: { color } };
    saveDataset(next);
    dataset = next;
  }

  function setPan(x: number, y: number) {
    panX = x;
    panY = y;
  }

  function setPendingCorners(
    cornerDst: [[number, number], [number, number], [number, number], [number, number]],
    homography: number[] | null,
    sourceWidth: number,
    sourceHeight: number,
  ) {
    pendingCorners = { cornerDst, homography, sourceWidth, sourceHeight };
  }

  function handleNext() {
    if (!dataset) return;
    if (step === 1) step = 2;
    else if (step === 2) step = 3;
    else if (step === 3) step = 4;
    else if (step === 4) {
      if (!pendingCorners || !pendingCorners.homography) return;
      const c: Calibration = {
        version: 1,
        panX,
        panY,
        cornerDst: pendingCorners.cornerDst,
        homography: pendingCorners.homography,
        sourceWidth: pendingCorners.sourceWidth,
        sourceHeight: pendingCorners.sourceHeight,
        savedAt: new Date().toISOString(),
      };
      setCalibration(c);
      step = 5;
    }
  }

  function handleBack() {
    if (!dataset) return;
    if (step === 2) {
      step = 1;
    } else if (step === 3) {
      step = 2;
    } else if (step === 4) {
      step = 3;
    } else if (step === 5) {
      // Non-destructive: keep `calibration` in localStorage. Seed App-level
      // pan and pendingCorners from the saved calibration, rescaled from the
      // saved viewport into the current one. CalibrateCorners will re-derive
      // homography on mount via its $effect, so we leave `homography: null`
      // here.
      if (!calibration) {
        step = 4;
        return;
      }
      const w = window.innerWidth;
      const h = window.innerHeight;
      const sx = scaleFactor(calibration.sourceWidth, w);
      const sy = scaleFactor(calibration.sourceHeight, h);
      panX = calibration.panX * sx;
      panY = calibration.panY * sy;
      pendingCorners = {
        cornerDst: [
          [calibration.cornerDst[0][0] * sx, calibration.cornerDst[0][1] * sy],
          [calibration.cornerDst[1][0] * sx, calibration.cornerDst[1][1] * sy],
          [calibration.cornerDst[2][0] * sx, calibration.cornerDst[2][1] * sy],
          [calibration.cornerDst[3][0] * sx, calibration.cornerDst[3][1] * sy],
        ],
        homography: null,
        sourceWidth: w,
        sourceHeight: h,
      };
      step = 4;
    }
  }

  const nextDisabled = $derived(
    !dataset
    || step === 5
    || (step === 4 && (!pendingCorners || pendingCorners.homography === null))
  );

  const seedCorners = $derived(
    pendingCorners?.cornerDst.map(([x, y]) => ({ x, y })),
  );
</script>

{#if step === 1}
  <Calibrate {dataset} />
{:else if step === 2 && dataset}
  <CalibrateOsm {dataset} />
{:else if step === 3 && dataset}
  <CalibratePan {dataset} {panX} {panY} onPan={setPan} />
{:else if step === 4 && dataset}
  {#key dataset.uploadedAt}
    <CalibrateCorners {dataset} {panX} {panY} {seedCorners} onCornersChange={setPendingCorners} />
  {/key}
{:else if step === 5 && dataset && calibration}
  <CalibrateProjection {dataset} {calibration} />
{/if}
<ControlPanel
  {dataset}
  {nextDisabled}
  autoHide={false}
  backHidden={step === 1 || dataset === null}
  onLoadDataset={handleLoadDataset}
  onClearDataset={handleClearDataset}
  onSetColor={handleSetColor}
  onNext={handleNext}
  onBack={handleBack}
/>
