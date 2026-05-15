import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createControlState } from '../server/controlState.mjs';
import { createRequestHandler, safeStaticPath } from '../server/control-server.mjs';

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
    const control = createControlState({ randomDigits: () => '123456', randomToken: () => Math.random().toString(16).slice(2) });
    const handler = createRequestHandler({ control });

    const first = await invoke(handler, { method: 'POST', url: '/api/projector/register' });
    expect(first.status).toBe(200);
    const second = await invoke(handler, { method: 'POST', url: '/api/projector/register' });
    expect(second.status).toBe(409);
    expect(JSON.parse(second.body)).toEqual(expect.objectContaining({ error: 'projector session is live' }));
  });
});
