<script lang="ts">
  import { validateGeoJSON, defaultStyle, type FeatureCollection } from './geojson';

  let {
    dataset,
    nextDisabled = false,
    autoHide = true,
    backHidden = false,
    onLoadDataset,
    onClearDataset,
    onSetColor,
    onNext,
    onBack,
  } = $props<{
    dataset: { filename: string; geojson: FeatureCollection; style: { color: string } } | null;
    nextDisabled?: boolean;
    autoHide?: boolean;
    backHidden?: boolean;
    onLoadDataset: (d: { filename: string; geojson: FeatureCollection; style: { color: string } }) => void;
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
    aria-label="Atlas++ controls"
  >
    <header class="flex items-center justify-between mb-2">
      <h2 class="text-sm font-semibold">Atlas++ MVP</h2>
      {#if autoHide}
        <button class="text-xs text-dtcc-muted" onclick={() => (visible = false)}>hide</button>
      {/if}
    </header>

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
