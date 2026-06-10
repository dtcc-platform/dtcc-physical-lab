<script lang="ts">
  import { onMount } from 'svelte';
  import Calibrate from './lib/Calibrate.svelte';
  import CalibrateOsm from './lib/CalibrateOsm.svelte';
  import CalibratePan from './lib/CalibratePan.svelte';
  import CalibrateCorners from './lib/CalibrateCorners.svelte';
  import CalibrateProjection from './lib/CalibrateProjection.svelte';
  import ControlPanel from './lib/ControlPanel.svelte';
  import { createProjectorRemote } from './lib/projectorRemote';
  import { fetchStaticCatalog, loadStaticSample } from './lib/sampleCatalog';
  import { scaleFactor } from './lib/scaleFactor';
  import {
    loadDataset,
    saveDataset,
    clearDataset,
    loadCalibration,
    saveCalibration,
    clearCalibration,
    bboxEqual,
    type Dataset,
    type Bbox,
    type Calibration,
    type DatasetContent,
  } from './lib/storage';
  import type { FeatureCollection } from './lib/geojson';
  import type { ProjectorStatePublish, QueuedRemoteCommand } from './lib/remoteProtocol';

  const initialDataset = loadDataset();
  const initialCalibration = loadCalibration();
  let dataset = $state<Dataset | null>(initialDataset);
  let calibration = $state<Calibration | null>(initialCalibration);
  // Boot resume: if both a dataset and a calibration are persisted, land
  // directly on the projection view. Otherwise start the wizard from step 1.
  let step = $state<1 | 2 | 3 | 4 | 5>(initialDataset && initialCalibration ? 5 : 1);
  let panX = $state(0);
  let panY = $state(0);
  let controlStatus = $state({
    samples: [] as Array<{ id: string; title: string; kind: 'geojson' | 'image' | 'video' }>,
    samplesLoaded: false,
    samplesError: null as string | null,
    onlineDatasets: [] as ProjectorStatePublish['onlineDatasets'],
    busy: false,
    busyReason: undefined as undefined | 'staticSample' | 'folderManifest' | 'onlineCatalog' | 'onlineDataset' | 'remoteSample',
    error: null as string | null,
  });
  let remoteStatus = $state<null | { projectorSessionId: string; remoteUrl: string; pin: string; pinExpiresAt: string }>(null);
  let remoteRevision = 0;
  let externalDatasetChangeRevision = $state(0);
  let externalOnlineDatasetRequest = $state<{ id: string; revision: number } | null>(null);
  let projectorRemote = $state<ReturnType<typeof createProjectorRemote> | null>(null);

  // Step 4 reports its current corner positions + homography here so Next can
  // commit them as a saved calibration.
  let pendingCorners = $state<{
    cornerDst: [[number, number], [number, number], [number, number], [number, number]];
    homography: number[] | null;
    sourceWidth: number;
    sourceHeight: number;
  } | null>(null);

  // The instructions-bar choice lives here so it survives step 4's {#key}
  // remounts and step navigation within one calibration session; Clear or
  // loading a different dataset starts a new session and brings the bar back.
  let cornersBarHidden = $state(false);

  // Single wrapper keeps storage and $state paired — fewer chances for drift
  // between localStorage and the in-memory calibration.
  function setCalibration(c: Calibration | null) {
    if (c) saveCalibration(c);
    else clearCalibration();
    calibration = c;
  }

  function resetWizardState() {
    setCalibration(null);
    step = 1;
    panX = 0;
    panY = 0;
    pendingCorners = null;
    cornersBarHidden = false;
  }

  function handleLoadDataset(d: { filename: string; geojson: FeatureCollection; style: { color: string }; bounds: Bbox }) {
    const next: Dataset = {
      version: 3,
      filename: d.filename,
      uploadedAt: new Date().toISOString(),
      bounds: d.bounds,
      content: { kind: 'geojson', geojson: d.geojson, style: d.style },
    };
    saveDataset(next);
    // A new file invalidates pan and any prior calibration — they were keyed
    // to the old dataset's bbox/projection and the old viewport.
    dataset = next;
    resetWizardState();
  }

  function handleLoadSample(d: {
    filename: string;
    bounds: Bbox;
    catalogId?: string;
    title: string;
    description?: string;
    content: DatasetContent;
    persist?: boolean;
  }) {
    const { persist = true, ...datasetFields } = d;
    const next: Dataset = {
      version: 3,
      ...datasetFields,
      uploadedAt: new Date().toISOString(),
    };
    const compatible = calibration !== null && bboxEqual(dataset?.bounds, next.bounds);
    if (persist) saveDataset(next);
    else clearDataset();
    dataset = next;
    if (compatible) {
      step = 5;
    } else {
      resetWizardState();
    }
  }

  function handleClearDataset() {
    clearDataset();
    setCalibration(null);
    dataset = null;
    step = 1;
    panX = 0;
    panY = 0;
    pendingCorners = null;
    cornersBarHidden = false;
  }

  function handleSetColor(color: string) {
    if (!dataset || dataset.content.kind !== 'geojson') return;
    const next: Dataset = {
      ...dataset,
      content: { ...dataset.content, style: { color } },
    };
    saveDataset(next);
    dataset = next;
  }

  function datasetSummary() {
    if (!dataset) return null;
    return {
      filename: dataset.filename,
      ...(dataset.title !== undefined ? { title: dataset.title } : {}),
      ...(dataset.catalogId !== undefined ? { catalogId: dataset.catalogId } : {}),
      kind: dataset.content.kind,
    };
  }

  function projectorStatePublish(): ProjectorStatePublish {
    remoteRevision += 1;
    return {
      projectorSessionId: remoteStatus?.projectorSessionId ?? 'unregistered',
      revision: remoteRevision,
      step,
      dataset: datasetSummary(),
      nextDisabled,
      backHidden: step === 1 || dataset === null,
      ...(dataset?.content.kind === 'geojson' ? { color: dataset.content.style.color } : {}),
      samples: controlStatus.samples,
      samplesLoaded: controlStatus.samplesLoaded,
      samplesError: controlStatus.samplesError,
      onlineDatasets: controlStatus.onlineDatasets,
      busy: controlStatus.busy,
      ...(controlStatus.busyReason !== undefined ? { busyReason: controlStatus.busyReason } : {}),
      error: controlStatus.error,
      updatedAt: new Date().toISOString(),
    };
  }

  async function handleRemoteCommand(command: QueuedRemoteCommand) {
    if (command.type === 'next') {
      if (!nextDisabled) handleNext();
      return;
    }
    if (command.type === 'back') {
      if (dataset && step !== 1) handleBack();
      return;
    }
    if (command.type === 'clear') {
      handleClearDataset();
      return;
    }
    if (command.type === 'setColor') {
      handleSetColor(command.color);
      return;
    }
    if (command.type === 'selectSample') {
      const catalog = await fetchStaticCatalog();
      if (!catalog.ok) {
        controlStatus = { ...controlStatus, samplesLoaded: true, samplesError: catalog.error, busy: false, busyReason: undefined };
        return;
      }
      const entry = catalog.value.entries.find((candidate) => candidate.id === command.sampleId);
      if (!entry) {
        controlStatus = { ...controlStatus, error: `unknown sample ${command.sampleId}` };
        return;
      }
      controlStatus = { ...controlStatus, busy: true, busyReason: 'remoteSample', error: null };
      const result = await loadStaticSample(entry);
      controlStatus = { ...controlStatus, busy: false, busyReason: undefined };
      if (!result.ok) {
        controlStatus = { ...controlStatus, error: result.error };
        return;
      }
      handleLoadSample(result.payload);
      externalDatasetChangeRevision += 1;
      return;
    }
    if (command.type === 'selectOnlineDataset') {
      externalOnlineDatasetRequest = {
        id: command.onlineDatasetId,
        revision: (externalOnlineDatasetRequest?.revision ?? 0) + 1,
      };
    }
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
        version: 2,
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

  onMount(() => {
    projectorRemote = createProjectorRemote({
      getState: projectorStatePublish,
      onCommand: handleRemoteCommand,
      onStatus: (status) => {
        remoteStatus = status
          ? {
              projectorSessionId: status.projectorSessionId,
              remoteUrl: status.remoteUrl,
              pin: status.pin,
              pinExpiresAt: status.pinExpiresAt,
            }
          : null;
      },
    });

    void projectorRemote.register()
      .then(() => projectorRemote?.publishStateOnce())
      .catch(() => {
        remoteStatus = null;
      });

    const heartbeatTimer = window.setInterval(() => {
      if (!projectorRemote?.isRegistered()) return;
      void projectorRemote.publishStateOnce().catch(() => {
        projectorRemote?.disconnect();
      });
    }, 1000);

    const commandTimer = window.setInterval(() => {
      if (!projectorRemote?.isRegistered()) return;
      void projectorRemote.pollCommandsOnce().catch(() => {
        projectorRemote?.disconnect();
      });
    }, 500);

    const reconnectTimer = window.setInterval(() => {
      if (projectorRemote?.isRegistered()) return;
      void projectorRemote?.register().catch(() => {
        projectorRemote?.disconnect();
      });
    }, 2000);

    return () => {
      window.clearInterval(heartbeatTimer);
      window.clearInterval(commandTimer);
      window.clearInterval(reconnectTimer);
    };
  });

  $effect(() => {
    if (!projectorRemote) return;
    step;
    dataset;
    nextDisabled;
    controlStatus.samples;
    controlStatus.samplesLoaded;
    controlStatus.samplesError;
    controlStatus.onlineDatasets;
    controlStatus.busy;
    controlStatus.busyReason;
    controlStatus.error;
    if (!projectorRemote.isRegistered()) return;
    void projectorRemote.publishStateOnce().catch(() => {
      projectorRemote?.disconnect();
    });
  });
</script>

{#if step === 1}
  <Calibrate {dataset} />
{:else if step === 2 && dataset}
  <CalibrateOsm {dataset} />
{:else if step === 3 && dataset}
  <CalibratePan {dataset} {panX} {panY} onPan={setPan} />
{:else if step === 4 && dataset}
  {#key dataset.uploadedAt}
    <CalibrateCorners
      {dataset}
      {panX}
      {panY}
      {seedCorners}
      onCornersChange={setPendingCorners}
      barHidden={cornersBarHidden}
      onBarHiddenChange={(hidden) => (cornersBarHidden = hidden)}
    />
  {/key}
{:else if step === 5 && dataset && calibration}
  <CalibrateProjection {dataset} {calibration} />
{/if}
<aside class="fixed left-4 bottom-4 max-w-sm rounded bg-white/90 text-dtcc-dark shadow px-3 py-2 text-xs z-40">
  {#if remoteStatus}
    <div class="font-semibold">Remote PIN {remoteStatus.pin}</div>
    <div class="text-dtcc-muted truncate">{remoteStatus.remoteUrl}</div>
  {:else}
    <div class="text-dtcc-muted">Remote control reconnecting</div>
  {/if}
</aside>
<ControlPanel
  {dataset}
  {nextDisabled}
  autoHide={false}
  backHidden={step === 1 || dataset === null}
  {externalDatasetChangeRevision}
  {externalOnlineDatasetRequest}
  onLoadDataset={handleLoadDataset}
  onLoadSample={handleLoadSample}
  onClearDataset={handleClearDataset}
  onSetColor={handleSetColor}
  onNext={handleNext}
  onBack={handleBack}
  onControlStatus={(status) => (controlStatus = status)}
/>
