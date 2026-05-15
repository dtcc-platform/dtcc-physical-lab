import { mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ControlPanel from '../src/lib/ControlPanel.svelte';

const catalog = {
  version: 1,
  entries: [
    {
      id: 'sample-grid',
      title: 'Sample grid',
      description: 'Synthetic grid sample.',
      file: 'sample-grid.geojson',
      kind: 'geojson',
      format: 'geojson',
      bounds: [0, 0, 1, 1],
    },
  ],
};

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

function mountPanel(extraProps: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const onLoadSample = vi.fn();
  const component = mount(ControlPanel, {
    target,
    props: {
      dataset: null,
      autoHide: false,
      onLoadDataset: vi.fn(),
      onLoadSample,
      onClearDataset: vi.fn(),
      onSetColor: vi.fn(),
      onNext: vi.fn(),
      ...extraProps,
    },
  });

  return { target, component, onLoadSample };
}

async function flushEffects() {
  await Promise.resolve();
  await Promise.resolve();
  await tick();
}

function tab(label: string): HTMLButtonElement {
  const match = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
    (button) => button.textContent?.trim() === label,
  );
  if (!match) throw new Error(`missing ${label} tab`);
  return match;
}

describe('ControlPanel dataset source tabs', () => {
  let mounted: ReturnType<typeof mountPanel> | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(catalog))),
    );
  });

  afterEach(async () => {
    if (mounted) {
      await unmount(mounted.component);
      mounted.target.remove();
      mounted = null;
    }
    vi.unstubAllGlobals();
  });

  it('shows online fetch first and swaps local and sample loaders through tabs', async () => {
    mounted = mountPanel();
    await flushEffects();

    expect(tab('Fetch').getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector<HTMLInputElement>('#online-catalog-url')).not.toBeNull();
    expect(document.querySelector('[aria-label="Dataset drop zone"]')).toBeNull();
    expect(document.querySelector<HTMLSelectElement>('#sample-dataset')).toBeNull();

    tab('Local').click();
    await tick();

    expect(tab('Local').getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[aria-label="Dataset drop zone"]')).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>('#online-catalog-url')).toBeNull();
    expect(document.querySelector<HTMLSelectElement>('#sample-dataset')).toBeNull();

    tab('Local').click();
    await tick();
    tab('Samples').click();
    await tick();

    expect(tab('Samples').getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector<HTMLSelectElement>('#sample-dataset')).not.toBeNull();
    expect(document.querySelector('[aria-label="Dataset drop zone"]')).toBeNull();
    expect(document.querySelector<HTMLInputElement>('#online-catalog-url')).toBeNull();
  });

  it('keeps drag and drop available from the default fetch tab', async () => {
    mounted = mountPanel();
    await flushEffects();

    const panel = document.querySelector<HTMLElement>('[aria-label="DTCC Atlas++ controls"]');
    expect(panel).not.toBeNull();

    const event = new Event('dragover', { bubbles: true, cancelable: true });
    panel!.dispatchEvent(event);
    await tick();

    expect(event.defaultPrevented).toBe(true);
    expect(tab('Local').getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[aria-label="Dataset drop zone"]')).not.toBeNull();
  });

  it('loads a static sample through the projector panel using the shared loader', async () => {
    mounted = mountPanel();
    await flushEffects();

    tab('Local').click();
    await tick();
    tab('Samples').click();
    await tick();

    await vi.waitFor(() => {
      expect(document.querySelector<HTMLSelectElement>('#sample-dataset')).not.toBeNull();
    });

    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/datasets/sample-grid.geojson') {
        return new Response(JSON.stringify({
          type: 'FeatureCollection',
          crs: { type: 'name', properties: { name: 'EPSG:3006' } },
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [319950, 6398000] },
              properties: {},
            },
          ],
        }));
      }
      return new Response(JSON.stringify(catalog));
    });

    const select = document.querySelector<HTMLSelectElement>('#sample-dataset')!;
    select.value = 'sample-grid';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flushEffects();

    expect(mounted.onLoadSample).toHaveBeenCalledWith(expect.objectContaining({
      filename: 'sample-grid.geojson',
      catalogId: 'sample-grid',
      title: 'Sample grid',
      content: expect.objectContaining({ kind: 'geojson' }),
    }));
  });

  it('reports fetched online datasets for the remote state', async () => {
    const onControlStatus = vi.fn();
    mounted = mountPanel({ onControlStatus });
    await flushEffects();

    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/datasets/catalog.json') return new Response(JSON.stringify(catalog));
      if (url === 'https://atlas.example/v1/datasets?limit=100') {
        return new Response(JSON.stringify({
          items: [
            {
              dataset_key: 'online-slice',
              version_id: 'v1',
              title: 'Online Slice',
              bounds_json: '[0,0,1,1]',
              format: 'geojson',
              media_type: 'application/geo+json',
              data_kind: 'vector',
            },
          ],
        }));
      }
      return new Response('not found', { status: 404, statusText: 'Not Found' });
    });

    const urlInput = document.querySelector<HTMLInputElement>('#online-catalog-url')!;
    urlInput.value = 'https://atlas.example';
    urlInput.dispatchEvent(new Event('input', { bubbles: true }));
    const tokenInput = document.querySelector<HTMLInputElement>('#online-catalog-token')!;
    tokenInput.value = 'browse-token';
    tokenInput.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('#dataset-source-fetch button')!.click();

    await vi.waitFor(() => {
      expect(onControlStatus).toHaveBeenCalledWith(expect.objectContaining({
        onlineDatasets: [{ id: 'online-slice@v1', title: 'Online Slice', kind: 'geojson', format: 'geojson' }],
      }));
    });
  });
});
