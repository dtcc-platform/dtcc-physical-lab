<script lang="ts">
  import { parseCatalog, type CatalogEntry } from './catalog';
  import { validateGeoJSON, defaultStyle, type FeatureCollection } from './geojson';
  import type { Bbox } from './storage';

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
    dataset: { filename: string; geojson: FeatureCollection; style: { color: string }; catalogId?: string } | null;
    nextDisabled?: boolean;
    autoHide?: boolean;
    backHidden?: boolean;
    onLoadDataset: (d: { filename: string; geojson: FeatureCollection; style: { color: string } }) => void;
    onLoadSample?: (d: {
      filename: string;
      geojson: FeatureCollection;
      style: { color: string };
      projectionBbox: Bbox;
      catalogId: string;
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

  async function handleSampleChange(e: Event) {
    const id = (e.currentTarget as HTMLSelectElement).value;
    const entry = catalogEntries.find((candidate) => candidate.id === id);
    if (!entry) return;

    error = null;
    sampleLoading = true;
    try {
      const response = await fetch(`/datasets/${entry.file}`, { cache: 'no-cache' });
      if (!response.ok) {
        error = `sample fetch failed (${response.status} ${response.statusText})`;
        return;
      }
      const text = await response.text();
      const result = validateGeoJSON(text);
      if (!result.ok) {
        error = result.error;
        return;
      }
      onLoadSample({
        filename: entry.file,
        geojson: result.value,
        style: defaultStyle(),
        projectionBbox: entry.projectionBbox,
        catalogId: entry.id,
      });
    } catch (err) {
      error = `sample fetch failed: ${(err as Error).message}`;
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
    onLoadDataset({
      filename: file.name,
      geojson: result.value,
      style: defaultStyle(),
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
            <option value={entry.id}>{entry.title}</option>
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

    <div class="mt-3 flex items-center gap-2">
      <label class="text-xs flex items-center gap-2">
        Color
        <input
          type="color"
          value={dataset?.style.color ?? '#38bdf8'}
          disabled={!dataset}
          onchange={(e) => onSetColor((e.currentTarget as HTMLInputElement).value)}
        />
      </label>
    </div>

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
