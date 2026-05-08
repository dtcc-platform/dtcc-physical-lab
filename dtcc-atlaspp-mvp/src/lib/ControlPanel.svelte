<script lang="ts">
  import { parseCatalog, type CatalogEntry } from './catalog';
  import {
    findManifestArtifact,
    isDtccManifestFile,
    resolveDtccManifestFiles,
    type DtccManifest,
  } from './dtccManifest';
  import { validateGeoJSON, defaultStyle, featureCollectionBbox, type FeatureCollection } from './geojson';
  import type { Bbox, Dataset, DatasetContent } from './storage';

  let {
    dataset,
    nextDisabled = false,
    autoHide = true,
    backHidden = false,
    onLoadDataset,
    onLoadSample = () => {},
    onClearDataset,
    onSetColor,
    onNext,
    onBack,
  } = $props<{
    dataset: Dataset | null;
    nextDisabled?: boolean;
    autoHide?: boolean;
    backHidden?: boolean;
    onLoadDataset: (d: { filename: string; geojson: FeatureCollection; style: { color: string }; bounds: Bbox }) => void;
    onLoadSample?: (d: {
      filename: string;
      bounds: Bbox;
      catalogId?: string;
      title: string;
      description?: string;
      content: DatasetContent;
      persist?: boolean;
    }) => void;
    onClearDataset: () => void;
    onSetColor: (color: string) => void;
    onNext: () => void;
    onBack?: () => void;
  }>();

  let visible = $state(true);
  let hideTimer: number | null = null;
  let error = $state<string | null>(null);
  let dragging = $state(false);
  let fileInput = $state<HTMLInputElement | null>(null);
  let catalogEntries = $state<CatalogEntry[]>([]);
  let sampleLoading = $state(false);
  let pendingManifest = $state<DtccManifest | null>(null);
  let localObjectUrl: string | null = null;

  type PanelPosition = { x: number; y: number };
  type PanelDrag = {
    pointerId: number;
    offsetX: number;
    offsetY: number;
    target: HTMLElement;
  };

  const PANEL_POSITION_KEY = 'dtcc-atlaspp-mvp.controlPanelPosition';
  const PANEL_MARGIN = 16;

  let panelEl = $state<HTMLElement | null>(null);
  let position = $state<PanelPosition | null>(null);
  let panelDrag = $state<PanelDrag | null>(null);
  const panelStyle = $derived(position ? `left: ${position.x}px; top: ${position.y}px;` : undefined);

  function clearHideTimer() {
    if (hideTimer != null) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function pauseAutoHide() {
    visible = true;
    clearHideTimer();
  }

  function isPanelPosition(value: unknown): value is PanelPosition {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const candidate = value as Record<string, unknown>;
    return (
      typeof candidate.x === 'number' &&
      Number.isFinite(candidate.x) &&
      typeof candidate.y === 'number' &&
      Number.isFinite(candidate.y)
    );
  }

  function loadPanelPosition(): PanelPosition | null {
    const raw = localStorage.getItem(PANEL_POSITION_KEY);
    if (raw == null) return null;
    try {
      const parsed = JSON.parse(raw);
      return isPanelPosition(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  function clampPanelPosition(next: PanelPosition): PanelPosition {
    const rect = panelEl?.getBoundingClientRect();
    const width = rect?.width ?? 320;
    const height = rect?.height ?? 0;
    const maxX = Math.max(PANEL_MARGIN, window.innerWidth - width - PANEL_MARGIN);
    const maxY = Math.max(PANEL_MARGIN, window.innerHeight - height - PANEL_MARGIN);

    return {
      x: Math.min(Math.max(next.x, PANEL_MARGIN), maxX),
      y: Math.min(Math.max(next.y, PANEL_MARGIN), maxY),
    };
  }

  function savePanelPosition(next: PanelPosition) {
    const clamped = clampPanelPosition(next);
    position = clamped;
    localStorage.setItem(PANEL_POSITION_KEY, JSON.stringify(clamped));
  }

  function reclampSavedPanelPosition() {
    if (!position) return;
    const clamped = clampPanelPosition(position);
    if (clamped.x === position.x && clamped.y === position.y) return;
    position = clamped;
    localStorage.setItem(PANEL_POSITION_KEY, JSON.stringify(clamped));
  }

  function isInteractivePanelTarget(target: EventTarget | null): boolean {
    return (
      target instanceof Element &&
      !!target.closest('button,input,select,textarea,a,[role="button"]')
    );
  }

  function startPanelDrag(e: PointerEvent) {
    if (e.button !== 0) return;
    if (!panelEl || isInteractivePanelTarget(e.target)) return;

    e.preventDefault();
    const rect = panelEl.getBoundingClientRect();
    const origin = clampPanelPosition(position ?? { x: rect.left, y: rect.top });
    const target = e.currentTarget as HTMLElement;

    position = origin;
    panelDrag = {
      pointerId: e.pointerId,
      offsetX: e.clientX - origin.x,
      offsetY: e.clientY - origin.y,
      target,
    };
    target.setPointerCapture(e.pointerId);
    pauseAutoHide();
  }

  function movePanel(e: PointerEvent) {
    if (!panelDrag || e.pointerId !== panelDrag.pointerId) return;
    position = clampPanelPosition({
      x: e.clientX - panelDrag.offsetX,
      y: e.clientY - panelDrag.offsetY,
    });
    pauseAutoHide();
  }

  function endPanelDrag(e: PointerEvent) {
    if (!panelDrag || e.pointerId !== panelDrag.pointerId) return;
    const drag = panelDrag;
    if (drag.target.hasPointerCapture(e.pointerId)) {
      drag.target.releasePointerCapture(e.pointerId);
    }
    panelDrag = null;
    if (position) savePanelPosition(position);
    resetTimer();
  }

  function openFilePicker() {
    pauseAutoHide();
    if (!fileInput) return;
    fileInput.value = '';
    fileInput.click();
  }

  function resetTimer() {
    visible = true;
    clearHideTimer();
    if (!autoHide) return;
    hideTimer = window.setTimeout(() => (visible = false), 5000);
  }

  const activeCatalogEntry = $derived(
    catalogEntries.find((entry) => entry.id === dataset?.catalogId) ?? null
  );
  const selectedCatalogId = $derived(activeCatalogEntry?.id ?? '');
  const colorValue = $derived(dataset?.content.kind === 'geojson' ? dataset.content.style.color : '#38bdf8');

  $effect(() => {
    if (!autoHide) {
      visible = true;
      clearHideTimer();
      return;
    }
    window.addEventListener('pointermove', resetTimer);
    resetTimer();
    return () => {
      window.removeEventListener('pointermove', resetTimer);
      clearHideTimer();
    };
  });

  $effect(() => {
    const saved = loadPanelPosition();
    if (saved) position = clampPanelPosition(saved);

    function onResize() {
      reclampSavedPanelPosition();
    }

    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  });

  $effect(() => {
    if (!panelEl) return;
    const observer = new ResizeObserver(reclampSavedPanelPosition);
    observer.observe(panelEl);
    return () => observer.disconnect();
  });

  $effect(() => {
    let cancelled = false;

    async function loadCatalog() {
      try {
        const response = await fetch('/datasets/catalog.json', { cache: 'no-cache' });
        if (!response.ok) return;
        const parsed = parseCatalog(await response.json());
        if (!cancelled && parsed.ok) catalogEntries = parsed.value.entries;
      } catch {
        // Missing or invalid catalogs simply hide the selector; drag/drop remains available.
      }
    }

    loadCatalog();
    return () => {
      cancelled = true;
    };
  });

  function datasetUrl(file: string): string {
    return `/datasets/${file}`;
  }

  function loadImage(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('image sample failed to load'));
      image.src = src;
    });
  }

  function loadVideo(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'metadata';
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('video sample failed to load'));
      video.src = src;
      video.load();
    });
  }

  function revokeLocalObjectUrl() {
    if (!localObjectUrl) return;
    URL.revokeObjectURL(localObjectUrl);
    localObjectUrl = null;
  }

  function rememberLocalObjectUrl(src: string) {
    revokeLocalObjectUrl();
    localObjectUrl = src;
  }

  function isMediaArtifactFile(file: File): boolean {
    const name = file.name.toLowerCase();
    return name.endsWith('.png') || name.endsWith('.mp4') || file.type === 'image/png' || file.type === 'video/mp4';
  }

  function isGeoJsonFile(file: File): boolean {
    const name = file.name.toLowerCase();
    return (name.endsWith('.geojson') || name.endsWith('.json')) && !isDtccManifestFile(file);
  }

  async function handleSampleChange(e: Event) {
    const id = (e.currentTarget as HTMLSelectElement).value;
    const entry = catalogEntries.find((candidate) => candidate.id === id);
    if (!entry) return;

    error = null;
    pendingManifest = null;
    sampleLoading = true;
    try {
      const src = datasetUrl(entry.file);
      if (entry.kind === 'geojson') {
        const response = await fetch(src, { cache: 'no-cache' });
        if (!response.ok) {
          error = `sample fetch failed (${response.status} ${response.statusText})`;
          return;
        }
        const result = validateGeoJSON(await response.text());
        if (!result.ok) {
          error = result.error;
          return;
        }
        revokeLocalObjectUrl();
        onLoadSample({
          filename: entry.file,
          bounds: entry.bounds,
          catalogId: entry.id,
          title: entry.title,
          ...(entry.description !== undefined ? { description: entry.description } : {}),
          content: { kind: 'geojson', geojson: result.value, style: defaultStyle() },
        });
      } else if (entry.kind === 'image') {
        await loadImage(src);
        revokeLocalObjectUrl();
        onLoadSample({
          filename: entry.file,
          bounds: entry.bounds,
          catalogId: entry.id,
          title: entry.title,
          ...(entry.description !== undefined ? { description: entry.description } : {}),
          content: { kind: 'image', src, mediaType: 'image/png' },
        });
      } else {
        await loadVideo(src);
        revokeLocalObjectUrl();
        onLoadSample({
          filename: entry.file,
          bounds: entry.bounds,
          catalogId: entry.id,
          title: entry.title,
          ...(entry.description !== undefined ? { description: entry.description } : {}),
          content: { kind: 'video', src, mediaType: 'video/mp4', muted: true, autoplay: true, loop: true },
        });
      }
    } catch (err) {
      error = (err as Error).message;
    } finally {
      sampleLoading = false;
      resetTimer();
    }
  }

  async function handleGeoJsonFile(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      error = 'file too large (>10 MB); simplify the GeoJSON first';
      return;
    }
    const text = await file.text();
    const result = validateGeoJSON(text);
    if (!result.ok) {
      error = result.error;
      return;
    }
    const bounds = featureCollectionBbox(result.value);
    if (!bounds) {
      error = 'GeoJSON has no projectable coordinates';
      return;
    }
    revokeLocalObjectUrl();
    onLoadDataset({
      filename: file.name,
      geojson: result.value,
      style: defaultStyle(),
      bounds,
    });
  }

  async function loadManifestArtifact(manifest: DtccManifest, artifact: File) {
    pendingManifest = null;

    if (manifest.kind === 'geojson') {
      if (artifact.size > 10 * 1024 * 1024) {
        error = 'file too large (>10 MB); simplify the GeoJSON first';
        return;
      }
      const result = validateGeoJSON(await artifact.text());
      if (!result.ok) {
        error = result.error;
        return;
      }
      revokeLocalObjectUrl();
      onLoadSample({
        filename: artifact.name,
        bounds: manifest.bounds,
        title: manifest.title,
        ...(manifest.description !== undefined ? { description: manifest.description } : {}),
        content: { kind: 'geojson', geojson: result.value, style: defaultStyle() },
      });
      return;
    }

    if (manifest.kind === 'image') {
      const src = URL.createObjectURL(artifact);
      try {
        await loadImage(src);
      } catch (err) {
        URL.revokeObjectURL(src);
        throw err;
      }
      rememberLocalObjectUrl(src);
      onLoadSample({
        filename: artifact.name,
        bounds: manifest.bounds,
        title: manifest.title,
        ...(manifest.description !== undefined ? { description: manifest.description } : {}),
        content: { kind: 'image', src, mediaType: 'image/png' },
        persist: false,
      });
      return;
    }

    const src = URL.createObjectURL(artifact);
    try {
      await loadVideo(src);
    } catch (err) {
      URL.revokeObjectURL(src);
      throw err;
    }
    rememberLocalObjectUrl(src);
    onLoadSample({
      filename: artifact.name,
      bounds: manifest.bounds,
      title: manifest.title,
      ...(manifest.description !== undefined ? { description: manifest.description } : {}),
      content: { kind: 'video', src, mediaType: 'video/mp4', muted: true, autoplay: true, loop: true },
      persist: false,
    });
  }

  async function handleFiles(inputFiles: FileList | File[]) {
    const files = Array.from(inputFiles);
    if (files.length === 0) return;

    error = null;

    try {
      if (pendingManifest) {
        const artifact = findManifestArtifact(files, pendingManifest);
        if (artifact) {
          await loadManifestArtifact(pendingManifest, artifact);
          return;
        }
        if (!files.some(isDtccManifestFile)) {
          if (files.length === 1 && isGeoJsonFile(files[0])) {
            pendingManifest = null;
            await handleGeoJsonFile(files[0]);
            return;
          }
          error = `manifest references ${pendingManifest.file}; select that file too`;
          return;
        }
      }

      if (files.some(isDtccManifestFile)) {
        const selection = await resolveDtccManifestFiles(files);
        if (!selection.ok) {
          error = selection.error;
          return;
        }
        if (!selection.value.artifact) {
          pendingManifest = selection.value.manifest;
          error = `manifest references ${selection.value.missingArtifact}; select that file too`;
          return;
        }
        await loadManifestArtifact(selection.value.manifest, selection.value.artifact);
        return;
      }

      const file = files[0];
      if (isMediaArtifactFile(file)) {
        error = `${file.name} needs its .manifest.json file; select both files together`;
        return;
      }
      await handleGeoJsonFile(file);
    } catch (err) {
      error = (err as Error).message;
    }
  }

  function handleClear() {
    error = null;
    pendingManifest = null;
    revokeLocalObjectUrl();
    onClearDataset();
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    const files = e.dataTransfer?.files;
    if (files?.length) void handleFiles(files);
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    dragging = true;
  }

  function onDragLeave() {
    dragging = false;
  }

  async function onFileInput(e: Event) {
    const files = (e.target as HTMLInputElement).files;
    if (files?.length) await handleFiles(files);
    resetTimer();
  }

  $effect(() => {
    return () => revokeLocalObjectUrl();
  });
</script>

{#if visible}
  <section
    bind:this={panelEl}
    class="fixed {position === null ? 'bottom-4 right-4' : ''} w-80 bg-white/95 text-dtcc-dark rounded-lg shadow-xl p-4 pointer-events-auto z-50"
    style={panelStyle}
    aria-label="DTCC Atlas++ controls"
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <header
      class="flex items-center justify-between mb-2 cursor-move select-none touch-none"
      onpointerdown={startPanelDrag}
      onpointermove={movePanel}
      onpointerup={endPanelDrag}
      onpointercancel={endPanelDrag}
    >
      <h2 class="text-sm font-semibold">DTCC Atlas++ MVP</h2>
      {#if autoHide}
        <button class="text-xs text-dtcc-muted cursor-pointer" onclick={() => (visible = false)}>hide</button>
      {/if}
    </header>

    {#if catalogEntries.length > 0}
      <div class="mb-3">
        <label class="block text-xs font-medium mb-1" for="sample-dataset">Sample dataset</label>
        <select
          id="sample-dataset"
          class="w-full text-xs rounded border border-dtcc-border bg-white px-2 py-1 disabled:opacity-60"
          value={selectedCatalogId}
          disabled={sampleLoading}
          onchange={handleSampleChange}
        >
          <option value="" disabled>{sampleLoading ? 'Loading...' : 'Select a sample...'}</option>
          {#each catalogEntries as entry}
            <option value={entry.id}>{entry.title} ({entry.format.toUpperCase()})</option>
          {/each}
        </select>
        {#if sampleLoading}
          <p class="text-xs text-dtcc-muted mt-1">Loading...</p>
        {:else if activeCatalogEntry?.description}
          <p class="text-xs text-dtcc-muted mt-1">{activeCatalogEntry.description}</p>
        {/if}
      </div>
    {/if}

    <div
      role="region"
      aria-label="Dataset drop zone"
      class="border-2 border-dashed rounded p-4 text-center text-sm transition-colors {dragging ? 'border-dtcc-orange bg-dtcc-orange/10' : 'border-dtcc-border'}"
      ondragover={onDragOver}
      ondragleave={onDragLeave}
      ondrop={onDrop}
    >
      {#if pendingManifest}
        <div class="font-medium truncate">Pick {pendingManifest.artifactName}</div>
        <div class="text-xs text-dtcc-muted mt-1">Referenced by {pendingManifest.title}</div>
      {:else if dataset}
        <div class="font-medium truncate">{dataset.filename}</div>
        <div class="text-xs text-dtcc-muted mt-1">Drop a new file to replace</div>
      {:else}
        <div class="font-medium">Drop a .geojson or dtcc manifest here</div>
      {/if}
      <button
        type="button"
        class="text-xs text-dtcc-orange cursor-pointer underline mt-1 inline-block focus:outline-none focus:ring-2 focus:ring-dtcc-orange rounded"
        onclick={openFilePicker}
      >
        {pendingManifest ? `or pick ${pendingManifest.artifactName}` : dataset ? 'or pick a different file' : 'or pick a file'}
      </button>
      <input
        bind:this={fileInput}
        type="file"
        multiple
        accept=".geojson,.json,.manifest.json,.png,.mp4,application/geo+json,application/json,image/png,video/mp4"
        class="sr-only"
        oncancel={resetTimer}
        onchange={onFileInput}
      />
    </div>

    {#if error}
      <p class="text-xs text-dtcc-red mt-2">{error}</p>
    {/if}

    {#if dataset === null || dataset.content.kind === 'geojson'}
      <div class="mt-3 flex items-center gap-2">
        <label class="text-xs flex items-center gap-2">
          Color
          <input
            type="color"
            value={colorValue}
            disabled={!dataset}
            onchange={(e) => onSetColor((e.currentTarget as HTMLInputElement).value)}
          />
        </label>
      </div>
    {/if}

    <div class="mt-3 flex gap-2">
      {#if onBack && !backHidden}
        <button
          class="px-3 py-1 text-xs rounded bg-dtcc-gray-light"
          onclick={onBack}
        >Back</button>
      {/if}
      <button
        class="px-3 py-1 text-xs rounded bg-dtcc-muted text-white disabled:opacity-40"
        disabled={nextDisabled}
        onclick={onNext}
      >Next</button>
      <button class="px-3 py-1 text-xs rounded bg-dtcc-gray-light disabled:opacity-40" disabled={!dataset} onclick={handleClear}>Clear</button>
    </div>
  </section>
{/if}
