import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectorRemote } from '../src/lib/projectorRemote';

const registerResponse = {
  projectorSessionId: 'projector-1',
  projectorToken: 'projector-token',
  pin: '123',
  pinExpiresAt: '2026-05-15T10:10:00.000Z',
  remoteUrl: 'http://127.0.0.1:5175/remote',
};

describe('projectorRemote', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('registers and stores projector token in sessionStorage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(registerResponse))));

    const remote = createProjectorRemote({ getState: () => null as any, onCommand: vi.fn() });
    await remote.register();

    expect(sessionStorage.getItem('dtcc-atlaspp-mvp.projectorToken')).toBe('projector-token');
  });

  it('coalesces concurrent register attempts into one request', async () => {
    let registerCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      registerCalls += 1;
      return new Response(JSON.stringify(registerResponse));
    }));

    const remote = createProjectorRemote({ getState: () => null as any, onCommand: vi.fn() });
    await Promise.all([remote.register(), remote.register()]);

    expect(registerCalls).toBe(1);
  });

  it('executes commands through the supplied handler', async () => {
    const onCommand = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/projector/register') return new Response(JSON.stringify(registerResponse));
      if (url === '/api/state') return new Response(JSON.stringify({ acceptedRevision: 1 }));
      return new Response(JSON.stringify({ commands: [{ id: 1, clientCommandId: 'cmd-1', type: 'next' }] }));
    }));

    const remote = createProjectorRemote({ getState: () => null as any, onCommand });
    await remote.register();
    await remote.pollCommandsOnce();

    expect(onCommand).toHaveBeenCalledWith({ id: 1, clientCommandId: 'cmd-1', type: 'next' });
  });

  it('resets the command cursor after disconnect and re-register', async () => {
    const onCommand = vi.fn();
    const urls: string[] = [];
    let registerCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url === '/api/projector/register') {
        registerCount += 1;
        return new Response(JSON.stringify({
          ...registerResponse,
          projectorSessionId: `projector-${registerCount}`,
          projectorToken: `projector-token-${registerCount}`,
        }));
      }
      if (url === '/api/state') return new Response(JSON.stringify({ acceptedRevision: 1 }));
      if (url.startsWith('/api/commands')) {
        return new Response(JSON.stringify({
          commands: registerCount === 1
            ? [{ id: 7, clientCommandId: 'cmd-old', type: 'next' }]
            : [{ id: 1, clientCommandId: 'cmd-new', type: 'back' }],
        }));
      }
      return new Response('not found', { status: 404 });
    }));

    const remote = createProjectorRemote({ getState: () => null as any, onCommand });
    await remote.register();
    await remote.pollCommandsOnce();
    remote.disconnect();
    await remote.register();
    await remote.pollCommandsOnce();

    expect(urls.filter((url) => url.startsWith('/api/commands'))).toEqual(['/api/commands?after=0', '/api/commands?after=0']);
    expect(onCommand).toHaveBeenLastCalledWith({ id: 1, clientCommandId: 'cmd-new', type: 'back' });
  });

  it('treats stale revision conflicts as non-fatal publishes', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/projector/register') return new Response(JSON.stringify(registerResponse));
      return new Response(JSON.stringify({ acceptedRevision: 2, currentRevision: 2 }), { status: 409 });
    }));

    const remote = createProjectorRemote({
      getState: () => ({
        projectorSessionId: 'projector-1',
        revision: 1,
        step: 1,
        dataset: null,
        nextDisabled: true,
        backHidden: true,
        samples: [],
        samplesLoaded: true,
        samplesError: null,
        onlineDatasets: [],
        busy: false,
        error: null,
        updatedAt: '2026-05-15T10:00:00.000Z',
      }),
      onCommand: vi.fn(),
    });

    await remote.register();
    await expect(remote.publishStateOnce()).resolves.toBeUndefined();
  });

  it('disconnects after a command poll auth failure so the reconnect loop can re-register', async () => {
    const statuses: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/projector/register') return new Response(JSON.stringify(registerResponse));
      return new Response(JSON.stringify({ error: 'invalid projector token' }), { status: 401 });
    }));

    const remote = createProjectorRemote({ getState: () => null as any, onCommand: vi.fn(), onStatus: (status) => statuses.push(status) });
    await remote.register();
    await expect(remote.pollCommandsOnce()).rejects.toThrow();

    expect(statuses[statuses.length - 1]).toBeNull();
    expect(remote.isRegistered()).toBe(false);
  });
});
