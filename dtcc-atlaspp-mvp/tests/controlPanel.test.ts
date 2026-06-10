import { mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ControlPanel from '../src/lib/ControlPanel.svelte';
import ControlPanelExternalRevisionHarness from './ControlPanelExternalRevisionHarness.svelte';

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
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes('/datasets/online-config.json')
          ? new Response('not found', { status: 404 })
          : new Response(JSON.stringify(catalog)),
      ),
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

  it('clears online selection and loading state after an external sample replacement', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/datasets/online-config.json') return new Response('not found', { status: 404 });
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
      return new Promise(() => {});
    });

    const target = document.createElement('div');
    document.body.appendChild(target);
    const harness = mount(ControlPanelExternalRevisionHarness, { target });
    mounted = { target, component: harness, onLoadSample: vi.fn() };
    await flushEffects();
    await vi.waitFor(() => {
      expect(document.querySelector<HTMLInputElement>('#online-catalog-url')).not.toBeNull();
    });

    const urlInput = document.querySelector<HTMLInputElement>('#online-catalog-url')!;
    urlInput.value = 'https://atlas.example';
    urlInput.dispatchEvent(new Event('input', { bubbles: true }));
    const tokenInput = document.querySelector<HTMLInputElement>('#online-catalog-token')!;
    tokenInput.value = 'browse-token';
    tokenInput.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('#dataset-source-fetch button')!.click();

    await vi.waitFor(() => {
      expect(document.querySelector<HTMLSelectElement>('#online-dataset')).not.toBeNull();
    });

    const onlineSelect = document.querySelector<HTMLSelectElement>('#online-dataset')!;
    onlineSelect.value = 'online-slice@v1';
    onlineSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(onlineSelect.disabled).toBe(true));

    harness.bumpExternalDatasetChangeRevision();
    await tick();

    expect(onlineSelect.value).toBe('');
    expect(onlineSelect.disabled).toBe(false);
  });
});

describe('ControlPanel startup default button', () => {
  let mounted: ReturnType<typeof mountPanel> | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes('/datasets/online-config.json')
          ? new Response('not found', { status: 404 })
          : new Response(JSON.stringify(catalog)),
      ),
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

  function defaultButton(): HTMLButtonElement | undefined {
    return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.trim() === 'Set startup default',
    );
  }

  it('renders the button disabled while saving a default is unavailable', async () => {
    mounted = mountPanel({ onSaveDefault: vi.fn(), canSaveDefault: false });
    await flushEffects();

    const button = defaultButton();
    expect(button).toBeDefined();
    expect(button!.disabled).toBe(true);
  });

  it('invokes onSaveDefault when enabled and clicked', async () => {
    const onSaveDefault = vi.fn();
    mounted = mountPanel({ onSaveDefault, canSaveDefault: true });
    await flushEffects();

    const button = defaultButton()!;
    expect(button.disabled).toBe(false);
    button.click();
    await flushEffects();

    expect(onSaveDefault).toHaveBeenCalledTimes(1);
  });

  it('omits the button when no handler is provided', async () => {
    mounted = mountPanel();
    await flushEffects();

    expect(defaultButton()).toBeUndefined();
  });
});

describe('ControlPanel configured online catalog', () => {
  let mounted: ReturnType<typeof mountPanel> | null = null;

  const onlineConfig = { baseUrl: 'https://catalog.example', token: 'browse-tok' };
  const onlineRow = {
    dataset_key: 'smoke-slice',
    version_id: 'v1',
    format: 'geojson',
    media_type: 'application/geo+json',
    title: 'Smoke Slice',
    bounds_json: '[0, 0, 1, 1]',
  };

  function routeFetch(routes: Record<string, () => Response | Promise<Response>>) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        for (const [needle, make] of Object.entries(routes)) {
          if (url.includes(needle)) return make();
        }
        return new Response('not found', { status: 404 });
      }),
    );
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  });

  afterEach(async () => {
    if (mounted) {
      await unmount(mounted.component);
      mounted.target.remove();
      mounted = null;
    }
    vi.unstubAllGlobals();
  });

  it('auto-populates the online picker from the config file and hides manual inputs', async () => {
    routeFetch({
      '/datasets/online-config.json': () => new Response(JSON.stringify(onlineConfig)),
      '/datasets/catalog.json': () => new Response(JSON.stringify(catalog)),
      '/v1/datasets': () => new Response(JSON.stringify({ items: [onlineRow] })),
    });
    mounted = mountPanel();
    await flushEffects();

    await vi.waitFor(() => {
      expect(document.querySelector<HTMLSelectElement>('#online-dataset')).not.toBeNull();
    });

    expect(document.querySelector('#online-catalog-url')).toBeNull();
    expect(document.querySelector('#online-catalog-token')).toBeNull();
    const fetchButton = Array.from(document.querySelectorAll('button:not([role="tab"])')).find(
      (b) => b.textContent?.trim() === 'Fetch',
    );
    expect(fetchButton).toBeUndefined();
    expect(document.querySelector('#online-dataset')?.textContent).toContain('Smoke Slice');
  });

  it('degrades quietly when the configured catalog is unreachable', async () => {
    routeFetch({
      '/datasets/online-config.json': () => new Response(JSON.stringify(onlineConfig)),
      '/datasets/catalog.json': () => new Response(JSON.stringify(catalog)),
      '/v1/datasets': () => new Response('boom', { status: 500 }),
    });
    mounted = mountPanel();
    await flushEffects();

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Online catalog unavailable');
    });

    expect(document.querySelector('#online-catalog-url')).toBeNull();
    // The underlying reason renders as muted detail for field debugging, but
    // never through the loud red error area.
    expect(document.body.textContent).toContain('online catalog fetch failed');
    const redError = Array.from(document.querySelectorAll('[class*="text-dtcc-red"]')).find(
      (el) => el.textContent?.includes('online catalog fetch failed'),
    );
    expect(redError).toBeUndefined();
  });

  it('retries a failed configured fetch from the unavailable hint', async () => {
    routeFetch({
      '/datasets/online-config.json': () => new Response(JSON.stringify(onlineConfig)),
      '/datasets/catalog.json': () => new Response(JSON.stringify(catalog)),
      '/v1/datasets': () => new Response('boom', { status: 500 }),
    });
    mounted = mountPanel();
    await flushEffects();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Online catalog unavailable');
    });

    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/v1/datasets')) return new Response(JSON.stringify({ items: [onlineRow] }));
      return new Response('not found', { status: 404 });
    });
    const retry = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Retry',
    )!;
    expect(retry).toBeDefined();
    retry.click();
    await flushEffects();

    await vi.waitFor(() => {
      expect(document.querySelector<HTMLSelectElement>('#online-dataset')).not.toBeNull();
    });
  });

  it('shows no manual inputs while the config probe is still resolving', async () => {
    routeFetch({
      '/datasets/online-config.json': () => new Promise<Response>(() => {}),
      '/datasets/catalog.json': () => new Response(JSON.stringify(catalog)),
    });
    mounted = mountPanel();
    await flushEffects();

    expect(document.querySelector('#online-catalog-url')).toBeNull();
    expect(document.body.textContent).toContain('Loading datasets');
  });

  it('falls back to the manual flow when the config file is invalid', async () => {
    routeFetch({
      '/datasets/online-config.json': () => new Response(JSON.stringify({ baseUrl: 123 })),
      '/datasets/catalog.json': () => new Response(JSON.stringify(catalog)),
    });
    mounted = mountPanel();
    await flushEffects();

    await vi.waitFor(() => {
      expect(document.querySelector('#online-catalog-url')).not.toBeNull();
    });
    expect(document.body.textContent).not.toContain('Online catalog unavailable');
  });

  it('stays quiet when saved manual settings fail to auto-fetch', async () => {
    localStorage.setItem('dtcc-atlaspp-mvp.onlineCatalog.baseUrl', 'https://manual.example');
    localStorage.setItem('dtcc-atlaspp-mvp.onlineCatalog.token', 'manual-tok');
    routeFetch({
      '/datasets/catalog.json': () => new Response(JSON.stringify(catalog)),
      '/v1/datasets': () => new Response('boom', { status: 500 }),
    });
    mounted = mountPanel();
    await flushEffects();

    await vi.waitFor(() => {
      expect(document.querySelector('#online-catalog-url')).not.toBeNull();
    });
    const redError = Array.from(document.querySelectorAll('[class*="text-dtcc-red"]')).find(
      (el) => el.textContent?.includes('online catalog fetch failed'),
    );
    expect(redError).toBeUndefined();
    expect(document.body.textContent).not.toContain('Online catalog unavailable');
  });

  it('keeps the config-derived token out of localStorage', async () => {
    routeFetch({
      '/datasets/online-config.json': () => new Response(JSON.stringify(onlineConfig)),
      '/datasets/catalog.json': () => new Response(JSON.stringify(catalog)),
      '/v1/datasets': () => new Response(JSON.stringify({ items: [onlineRow] })),
    });
    mounted = mountPanel();
    await flushEffects();
    await vi.waitFor(() => {
      expect(document.querySelector<HTMLSelectElement>('#online-dataset')).not.toBeNull();
    });

    expect(localStorage.getItem('dtcc-atlaspp-mvp.onlineCatalog.baseUrl')).toBeNull();
    expect(localStorage.getItem('dtcc-atlaspp-mvp.onlineCatalog.token')).toBeNull();
  });

  it('loads an online dataset end-to-end after selection from the configured picker', async () => {
    const onlineManifest = {
      name: 'smoke-slice',
      title: 'Smoke Slice',
      file: 'data.geojson',
      format: 'geojson',
      media_type: 'application/geo+json',
      bounds: [319720, 6397660, 320220, 6398160],
    };
    const artifact = {
      type: 'FeatureCollection',
      crs: { type: 'name', properties: { name: 'EPSG:3006' } },
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [319950, 6398000] }, properties: {} },
      ],
    };
    routeFetch({
      '/datasets/online-config.json': () => new Response(JSON.stringify(onlineConfig)),
      '/datasets/catalog.json': () => new Response(JSON.stringify(catalog)),
      '/manifest': () => new Response(JSON.stringify(onlineManifest)),
      '/files/': () => new Response(JSON.stringify(artifact)),
      '/versions/': () => new Response(JSON.stringify({ files: [{ path: 'data.geojson' }] })),
      '/v1/datasets': () => new Response(JSON.stringify({ items: [onlineRow] })),
    });
    mounted = mountPanel();
    await flushEffects();
    await vi.waitFor(() => {
      expect(document.querySelector<HTMLSelectElement>('#online-dataset')).not.toBeNull();
    });

    const select = document.querySelector<HTMLSelectElement>('#online-dataset')!;
    select.value = 'smoke-slice@v1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flushEffects();

    await vi.waitFor(() => {
      expect(mounted!.onLoadSample).toHaveBeenCalledWith(
        expect.objectContaining({
          filename: 'data.geojson',
          title: 'Smoke Slice',
          content: expect.objectContaining({ kind: 'geojson' }),
        }),
      );
    });
  });

  it('auto-fetches with saved manual settings when no config file exists', async () => {
    localStorage.setItem('dtcc-atlaspp-mvp.onlineCatalog.baseUrl', 'https://manual.example');
    localStorage.setItem('dtcc-atlaspp-mvp.onlineCatalog.token', 'manual-tok');
    routeFetch({
      '/datasets/catalog.json': () => new Response(JSON.stringify(catalog)),
      '/v1/datasets': () => new Response(JSON.stringify({ items: [onlineRow] })),
    });
    mounted = mountPanel();
    await flushEffects();

    await vi.waitFor(() => {
      expect(document.querySelector<HTMLSelectElement>('#online-dataset')).not.toBeNull();
    });

    // Manual flow stays visible — only a config file hides the inputs.
    expect(document.querySelector('#online-catalog-url')).not.toBeNull();
  });
});
