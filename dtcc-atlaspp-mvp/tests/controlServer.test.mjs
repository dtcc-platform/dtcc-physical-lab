import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createControlState } from '../server/controlState.mjs';
import { createRequestHandler, safeStaticPath, startControlServer } from '../server/control-server.mjs';

let tempDir = null;

function invoke(handler, { method = 'GET', url = '/', headers = {}, body = '' } = {}) {
  const chunks = body ? [Buffer.from(body)] : [];
  const req = {
    method,
    url,
    headers: { host: '127.0.0.1', ...headers },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      yield* chunks;
    },
  };

  return new Promise((resolve) => {
    const res = {
      status: 200,
      headers: {},
      body: '',
      writeHead(status, responseHeaders) {
        this.status = status;
        this.headers = responseHeaders;
      },
      end(responseBody = '') {
        this.body = Buffer.isBuffer(responseBody) ? responseBody.toString('utf8') : String(responseBody);
        resolve(this);
      },
    };
    void handler(req, res);
  });
}

describe('control-server', () => {
  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  });

  it('rejects static paths that resolve outside the dist root', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'atlas-remote-static-'));
    expect(safeStaticPath(tempDir, '/index.html')).toBe(`${tempDir}${sep}index.html`);
    expect(safeStaticPath(tempDir, '/../package.json')).toBeNull();
  });

  it('serves projector and remote aliases from the static directory', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'atlas-remote-static-'));
    await writeFile(join(tempDir, 'index.html'), 'projector');
    await writeFile(join(tempDir, 'remote.html'), 'remote');

    const handler = createRequestHandler({ staticDir: tempDir, control: createControlState() });
    await expect(invoke(handler, { url: '/projector' }).then((res) => res.body)).resolves.toBe('projector');
    await expect(invoke(handler, { url: '/remote' }).then((res) => res.body)).resolves.toBe('remote');
  });

  it('returns live-session registration conflicts with 409 status', async () => {
    const control = createControlState({ randomDigits: () => '123', randomToken: () => Math.random().toString(16).slice(2) });
    const handler = createRequestHandler({ control });

    const first = await invoke(handler, { method: 'POST', url: '/api/projector/register' });
    expect(first.status).toBe(200);
    const second = await invoke(handler, { method: 'POST', url: '/api/projector/register' });
    expect(second.status).toBe(409);
    expect(JSON.parse(second.body)).toEqual(expect.objectContaining({ error: 'projector session is live' }));
  });

  it('enforces bearer auth for projector state publishes at the HTTP layer', async () => {
    const control = createControlState({ randomDigits: () => '123', randomToken: () => Math.random().toString(16).slice(2) });
    const handler = createRequestHandler({ control });
    const registered = JSON.parse((await invoke(handler, { method: 'POST', url: '/api/projector/register' })).body);
    const state = {
      projectorSessionId: 'client-placeholder',
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
      updatedAt: '2026-05-16T10:00:00.000Z',
    };

    const missingBearer = await invoke(handler, {
      method: 'POST',
      url: '/api/state',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(state),
    });
    expect(missingBearer.status).toBe(401);

    const validBearer = await invoke(handler, {
      method: 'POST',
      url: '/api/state',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${registered.projectorToken}` },
      body: JSON.stringify(state),
    });
    expect(validBearer.status).toBe(200);
    expect(JSON.parse(validBearer.body)).toEqual({ acceptedRevision: 1 });
  });

  it('rejects API request bodies larger than 64 KB', async () => {
    const handler = createRequestHandler({ control: createControlState() });
    const response = await invoke(handler, {
      method: 'POST',
      url: '/api/projector/register',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(65 * 1024) }),
    });

    expect(response.status).toBe(413);
    expect(JSON.parse(response.body)).toEqual({ error: 'request body too large' });
  });

  it('warns when an all-interface server would advertise a loopback remote URL', async () => {
    const originalRemoteUrl = process.env.ATLAS_REMOTE_PUBLIC_URL;
    delete process.env.ATLAS_REMOTE_PUBLIC_URL;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const server = startControlServer({ port: 0, host: '0.0.0.0' });
      await new Promise((resolve) => server.close(resolve));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('ATLAS_REMOTE_PUBLIC_URL'));
    } finally {
      warn.mockRestore();
      if (originalRemoteUrl === undefined) delete process.env.ATLAS_REMOTE_PUBLIC_URL;
      else process.env.ATLAS_REMOTE_PUBLIC_URL = originalRemoteUrl;
    }
  });
});
