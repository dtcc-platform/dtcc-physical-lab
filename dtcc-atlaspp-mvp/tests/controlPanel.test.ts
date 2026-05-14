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

function mountPanel() {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(ControlPanel, {
    target,
    props: {
      dataset: null,
      autoHide: false,
      onLoadDataset: vi.fn(),
      onClearDataset: vi.fn(),
      onSetColor: vi.fn(),
      onNext: vi.fn(),
    },
  });

  return { target, component };
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
});
