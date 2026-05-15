import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createControlState } from './controlState.mjs';

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.json', 'application/json; charset=utf-8'],
]);

function parseArgs(argv) {
  const out = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[i + 1]?.startsWith('--') ? true : argv[i + 1] ?? true;
    out.set(key, value);
    if (value !== true) i += 1;
  }
  return out;
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) {
      const error = new Error('request body too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function bearer(req) {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

export function safeStaticPath(staticRoot, pathname) {
  const root = resolve(staticRoot);
  const filePath = resolve(root, pathname.replace(/^\/+/, ''));
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) return null;
  return filePath;
}

function staticPathname(url) {
  if (url.pathname === '/' || url.pathname === '/projector') return '/index.html';
  if (url.pathname === '/remote') return '/remote.html';
  return url.pathname;
}

async function handleStatic(req, res, url, staticDir) {
  if (!staticDir) return sendJson(res, 404, { error: 'not found' });
  const filePath = safeStaticPath(staticDir, staticPathname(url));
  if (!filePath) return sendJson(res, 404, { error: 'not found' });
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'content-type': mime.get(extname(filePath)) ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: 'not found' });
  }
}

async function handleApi(req, res, url, control) {
  if (req.method === 'POST' && url.pathname === '/api/projector/register') {
    const result = control.registerProjector(await readJson(req));
    return sendJson(res, result.ok === false ? result.status : 200, result);
  }
  if (req.method === 'POST' && url.pathname === '/api/pairing') {
    const result = control.pairRemote({ ...(await readJson(req)), ip: req.socket.remoteAddress ?? 'unknown' });
    return sendJson(res, result.ok === false ? result.status : 200, result.ok === false ? result : result.value);
  }
  if (req.method === 'POST' && url.pathname === '/api/state') {
    const result = control.publishState({ token: bearer(req), state: await readJson(req) });
    if (result.ok === false) {
      if (result.status === 409) {
        return sendJson(res, 409, {
          acceptedRevision: result.acceptedRevision,
          currentRevision: result.currentRevision,
        });
      }
      return sendJson(res, result.status, { error: result.error });
    }
    return sendJson(res, 200, { acceptedRevision: result.acceptedRevision });
  }
  if (req.method === 'GET' && url.pathname === '/api/state') {
    const result = control.getState({ token: bearer(req) });
    return sendJson(res, result.ok === false ? result.status : 200, result);
  }
  if (req.method === 'POST' && url.pathname === '/api/commands') {
    const result = control.enqueueCommand({ token: bearer(req), command: await readJson(req) });
    return sendJson(res, result.ok === false ? result.status : 200, result);
  }
  if (req.method === 'GET' && url.pathname === '/api/commands') {
    const after = Number(url.searchParams.get('after') ?? '0');
    const result = control.getCommands({ token: bearer(req), after: Number.isFinite(after) ? after : 0 });
    return sendJson(res, result.ok === false ? result.status : 200, result);
  }
  return sendJson(res, 404, { error: 'not found' });
}

export function createRequestHandler({ control = createControlState(), staticDir = null } = {}) {
  return async function requestHandler(req, res) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    try {
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url, control);
      else await handleStatic(req, res, url, staticDir);
    } catch (err) {
      const status = typeof err === 'object' && err && 'status' in err ? Number(err.status) : 500;
      sendJson(res, Number.isFinite(status) ? status : 500, { error: err instanceof Error ? err.message : 'server error' });
    }
  };
}

export function startControlServer({
  port = 5176,
  host = '127.0.0.1',
  staticDir = null,
  remoteUrl = process.env.ATLAS_REMOTE_PUBLIC_URL ?? `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/remote`,
} = {}) {
  const control = createControlState({ remoteUrl });
  const server = createServer(createRequestHandler({ control, staticDir }));
  server.listen(port, host, () => {
    console.log(`Atlas remote control server listening on http://${host}:${port}`);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  startControlServer({
    port: Number(args.get('port') ?? process.env.PORT ?? 5176),
    host: String(args.get('host') ?? process.env.HOST ?? '127.0.0.1'),
    staticDir: args.get('static') ? String(args.get('static')) : null,
  });
}
