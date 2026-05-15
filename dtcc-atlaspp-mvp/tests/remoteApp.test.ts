import { mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RemoteApp from '../src/lib/RemoteApp.svelte';

function state(overrides = {}) {
  return {
    projectorSessionId: 'projector-1',
    revision: 1,
    projectorOnline: true,
    remoteConnected: true,
    step: 2,
    dataset: { filename: 'sample.geojson', title: 'Sample', catalogId: 'sample', kind: 'geojson' },
    nextDisabled: false,
    backHidden: false,
    color: '#38bdf8',
    samples: [{ id: 'sample', title: 'Sample', kind: 'geojson' }],
    samplesLoaded: true,
    samplesError: null,
    onlineDatasets: [],
    busy: false,
    error: null,
    updatedAt: '2026-05-15T10:00:00.000Z',
    projectorLastSeenAt: '2026-05-15T10:00:00.000Z',
    ...overrides,
  };
}

function setupFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/pairing') {
      return new Response(JSON.stringify({ remoteToken: 'remote-token' }));
    }
    if (url === '/api/state') {
      return new Response(JSON.stringify({ state: state() }));
    }
    if (url === '/api/commands') {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ command: { id: 1, ...body } }));
    }
    return new Response('not found', { status: 404 });
  }));
}

describe('RemoteApp', () => {
  let component: ReturnType<typeof mount> | null = null;
  let target: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
    target = document.createElement('div');
    document.body.appendChild(target);
    setupFetch();
  });

  afterEach(async () => {
    if (component) await unmount(component);
    component = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('pairs with a PIN and posts a Next command', async () => {
    component = mount(RemoteApp, { target });
    const input = document.querySelector<HTMLInputElement>('#remote-pin')!;
    input.value = '123456';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();

    await vi.waitFor(() => {
      expect(sessionStorage.getItem('dtcc-atlaspp-mvp.remoteToken')).toBe('remote-token');
    });
    await tick();

    document.querySelector<HTMLButtonElement>('[data-command="next"]')!.click();
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/commands', expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer remote-token' }),
      }));
    });
  });

  it('shows projector offline state from the server-provided flag', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/pairing') return new Response(JSON.stringify({ remoteToken: 'remote-token' }));
      if (url === '/api/state') return new Response(JSON.stringify({
        state: state({
          projectorOnline: false,
          dataset: null,
          nextDisabled: true,
          samples: [],
        }),
      }));
      return new Response('not found', { status: 404 });
    });

    component = mount(RemoteApp, { target });
    const input = document.querySelector<HTMLInputElement>('#remote-pin')!;
    input.value = '123456';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Projector offline');
      expect(document.body.textContent).toContain('No bundled samples available');
    });
  });

  it('shows pairing errors while still on the PIN form', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/pairing') return new Response(JSON.stringify({ error: 'invalid or expired PIN' }), { status: 401 });
      return new Response('not found', { status: 404 });
    });

    component = mount(RemoteApp, { target });
    const input = document.querySelector<HTMLInputElement>('#remote-pin')!;
    input.value = '000000';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Invalid or expired PIN');
    });
    expect(document.querySelector<HTMLInputElement>('#remote-pin')).not.toBeNull();
  });

  it('shows fetched online datasets and posts an online selection command', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/pairing') return new Response(JSON.stringify({ remoteToken: 'remote-token' }));
      if (url === '/api/state') return new Response(JSON.stringify({
        state: state({
          onlineDatasets: [{ id: 'online@v1', title: 'Online Slice', kind: 'geojson', format: 'geojson' }],
        }),
      }));
      if (url === '/api/commands') {
        const body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ command: { id: 1, ...body } }));
      }
      return new Response('not found', { status: 404 });
    });

    component = mount(RemoteApp, { target });
    const input = document.querySelector<HTMLInputElement>('#remote-pin')!;
    input.value = '123456';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();

    await vi.waitFor(() => {
      expect(document.querySelector<HTMLSelectElement>('#remote-online-dataset')).not.toBeNull();
    });

    const select = document.querySelector<HTMLSelectElement>('#remote-online-dataset')!;
    select.value = 'online@v1';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/commands', expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"type":"selectOnlineDataset"'),
      }));
    });
  });

  it('clears a stale remote token on unexpected projector session change', async () => {
    vi.useFakeTimers();
    sessionStorage.setItem('dtcc-atlaspp-mvp.remoteToken', 'remote-token');
    let call = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url !== '/api/state') return new Response('not found', { status: 404 });
      call += 1;
      return new Response(JSON.stringify({
        state: state({
          projectorSessionId: call === 1 ? 'projector-1' : 'projector-2',
          revision: call,
          dataset: null,
          nextDisabled: true,
          backHidden: true,
          samples: [],
        }),
      }));
    });

    component = mount(RemoteApp, { target });
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Projector online');
    });
    await vi.advanceTimersByTimeAsync(1000);
    await tick();

    expect(sessionStorage.getItem('dtcc-atlaspp-mvp.remoteToken')).toBeNull();
    expect(document.querySelector<HTMLInputElement>('#remote-pin')).not.toBeNull();
  });
});
