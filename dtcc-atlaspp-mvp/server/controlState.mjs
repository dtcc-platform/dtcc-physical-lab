import { randomUUID } from 'node:crypto';

const PIN_TTL_MS = 10 * 60 * 1000;
const REMOTE_IDLE_MS = 30 * 60 * 1000;
const PROJECTOR_ONLINE_MS = 3000;
const LIVE_REPLACE_BLOCK_MS = 5000;
const COMMAND_TTL_MS = 5 * 60 * 1000;
const COMMAND_CAP = 100;

function ok(value) {
  return { ok: true, value };
}

function err(status, error, extra = {}) {
  return { ok: false, status, error, ...extra };
}

function defaultRandomDigits() {
  return String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
}

function defaultRandomToken() {
  return randomUUID();
}

export function createControlState(options = {}) {
  const now = options.now ?? (() => Date.now());
  const randomDigits = options.randomDigits ?? defaultRandomDigits;
  const randomToken = options.randomToken ?? defaultRandomToken;

  let projector = null;
  let remote = null;
  let latestState = null;
  let commands = [];
  let nextCommandId = 1;
  const attemptsByIp = new Map();
  let failedPinAttempts = 0;

  function projectorOnline() {
    return !!projector && projector.lastSeenAt != null && now() - projector.lastSeenAt <= PROJECTOR_ONLINE_MS;
  }

  function decorateState() {
    if (!latestState || !projector) return null;
    return {
      ...latestState,
      projectorOnline: projectorOnline(),
      remoteConnected: !!remote && now() - remote.lastSeenAt <= REMOTE_IDLE_MS,
      projectorLastSeenAt: new Date(projector.lastSeenAt ?? projector.createdAt).toISOString(),
    };
  }

  function registerProjector(input = {}) {
    if (
      projector &&
      now() - (projector.lastSeenAt ?? projector.createdAt) <= LIVE_REPLACE_BLOCK_MS &&
      input.previousProjectorToken !== projector.token
    ) {
      return err(409, 'projector session is live');
    }

    const projectorSessionId = randomToken();
    const token = randomToken();
    const pin = randomDigits();
    const createdAt = now();
    projector = { projectorSessionId, token, pin, pinExpiresAt: createdAt + PIN_TTL_MS, createdAt, lastSeenAt: createdAt };
    remote = null;
    latestState = null;
    commands = [];
    nextCommandId = 1;
    failedPinAttempts = 0;
    attemptsByIp.clear();

    return {
      projectorSessionId,
      projectorToken: token,
      pin,
      pinExpiresAt: new Date(projector.pinExpiresAt).toISOString(),
      remoteUrl: options.remoteUrl ?? 'http://127.0.0.1:5175/remote',
    };
  }

  function pairRemote({ pin, ip }) {
    if (!projector) return err(404, 'projector offline');
    const attempt = attemptsByIp.get(ip) ?? { count: 0, windowStart: now(), blockedUntil: 0 };
    if (now() < attempt.blockedUntil) return err(429, 'too many pairing attempts');
    if (now() - attempt.windowStart >= 60000) {
      attempt.count = 0;
      attempt.windowStart = now();
    }
    if (remote) return err(409, 'remote already paired');
    if (now() > projector.pinExpiresAt || pin !== projector.pin) {
      attempt.count += 1;
      failedPinAttempts += 1;
      if (attempt.count >= 5) attempt.blockedUntil = now() + 30000;
      attemptsByIp.set(ip, attempt);
      if (failedPinAttempts >= 20) projector.pinExpiresAt = 0;
      return err(401, 'invalid or expired PIN');
    }

    const remoteToken = randomToken();
    remote = { token: remoteToken, lastSeenAt: now(), commandIds: new Map() };
    return ok({ remoteToken });
  }

  function assertProjector(token) {
    return !!projector && token === projector.token;
  }

  function touchRemote(token) {
    if (!remote || token !== remote.token) return false;
    if (now() - remote.lastSeenAt > REMOTE_IDLE_MS) {
      remote = null;
      return false;
    }
    remote.lastSeenAt = now();
    return true;
  }

  function publishState({ token, state }) {
    if (!assertProjector(token)) return err(401, 'invalid projector token');
    projector.lastSeenAt = now();
    if (latestState && state.revision <= latestState.revision) {
      return { ok: false, status: 409, acceptedRevision: latestState.revision, currentRevision: latestState.revision };
    }
    latestState = { ...state, projectorSessionId: projector.projectorSessionId };
    return { ok: true, acceptedRevision: state.revision };
  }

  function getState({ token }) {
    if (!assertProjector(token) && !touchRemote(token)) return err(401, 'invalid token');
    const state = decorateState();
    if (!state) return err(404, 'projector state unavailable');
    return { state };
  }

  function enqueueCommand({ token, command }) {
    if (!touchRemote(token)) return err(401, 'invalid remote token');
    const existing = remote.commandIds.get(command.clientCommandId);
    if (existing) return { command: existing };
    const queued = { id: nextCommandId++, ...command, createdAt: now() };
    remote.commandIds.set(command.clientCommandId, queued);
    commands.push(queued);
    commands = commands.filter((item) => now() - item.createdAt <= COMMAND_TTL_MS).slice(-COMMAND_CAP);
    return { command: queued };
  }

  function getCommands({ token, after }) {
    if (!assertProjector(token)) return err(401, 'invalid projector token');
    projector.lastSeenAt = now();
    commands = commands.filter((command) => command.id > after && now() - command.createdAt <= COMMAND_TTL_MS);
    return { commands: commands.map(({ createdAt, ...command }) => command) };
  }

  return { registerProjector, pairRemote, publishState, getState, enqueueCommand, getCommands };
}
