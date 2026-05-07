<script lang="ts">
  import { parseCatalog, type CatalogEntry } from './catalog';
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
      catalogId: string;
      title: string;
      description?: string;
      content: DatasetContent;
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

  async function handleSampleChange(e: Event) {
    const id = (e.currentTarget as HTMLSelectElement).value;
    const entry = catalogEntries.find((candidate) => candidate.id === id);
    if (!entry) return;

    error = null;
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

  async function handleFile(file: File) {
    error = null;
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
    onLoadDataset({
      filename: file.name,
      geojson: result.value,
      style: defaultStyle(),
      bounds,
    });
  }

  function handleClear() {
    error = null;
    onClearDataset();
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    dragging = true;
  }

  function onDragLeave() {
    dragging = false;
  }

  async function onFileInput(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) await handleFile(file);
    resetTimer();
  }
</script>

{#if visible}
  <section
    class="fixed bottom-4 right-4 w-80 bg-white/95 text-dtcc-dark rounded-lg shadow-xl p-4 pointer-events-auto z-50"
    aria-label="DTCC Atlas++ controls"
  >
    <header class="flex items-center justify-between mb-2">
      <h2 class="text-sm font-semibold">DTCC Atlas++ MVP</h2>
      {#if autoHide}
        <button class="text-xs text-dtcc-muted" onclick={() => (visible = false)}>hide</button>
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
      aria-label="GeoJSON drop zone"
      class="border-2 border-dashed rounded p-4 text-center text-sm transition-colors {dragging ? 'border-dtcc-orange bg-dtcc-orange/10' : 'border-dtcc-border'}"
      ondragover={onDragOver}
      ondragleave={onDragLeave}
      ondrop={onDrop}
    >
      {#if dataset}
        <div class="font-medium truncate">{dataset.filename}</div>
        <div class="text-xs text-dtcc-muted mt-1">Drop a new file to replace</div>
      {:else}
        <div class="font-medium">Drop a .geojson here</div>
      {/if}
      <button
        type="button"
        class="text-xs text-dtcc-orange cursor-pointer underline mt-1 inline-block focus:outline-none focus:ring-2 focus:ring-dtcc-orange rounded"
        onclick={openFilePicker}
      >
        {dataset ? 'or pick a different file' : 'or pick a file'}
      </button>
      <input
        bind:this={fileInput}
        type="file"
        accept=".geojson,.json,application/geo+json,application/json"
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
