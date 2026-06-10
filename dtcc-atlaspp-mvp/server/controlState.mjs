import { randomInt, randomUUID } from 'node:crypto';

const PIN_TTL_MS = 10 * 60 * 1000;
// With a 3-digit keyspace (1000 PINs) the global failure cap is the only
// bound on multi-IP guessing: 10 attempts ≈ 1% success per pairing window.
const PIN_KILL_FAILURES = 10;
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

// crypto-quality randomness: with only 1000 combinations, a predictable PRNG
// would matter far more than it did at 6 digits.
function defaultRandomDigits() {
  return String(randomInt(0, 1000)).padStart(3, '0');
}

function defaultRandomToken() {
  return randomUUID();
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value);
}

function isStep(value) {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

function isDatasetKind(value) {
  return value === 'geojson' || value === 'image' || value === 'video';
}

function isDatasetSummary(value) {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if (typeof value.filename !== 'string') return false;
  if (!isDatasetKind(value.kind)) return false;
  if (value.title !== undefined && typeof value.title !== 'string') return false;
  if (value.catalogId !== undefined && typeof value.catalogId !== 'string') return false;
  return true;
}

function isSampleSummary(value) {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    isDatasetKind(value.kind)
  );
}

function isOnlineDatasetSummary(value) {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    isDatasetKind(value.kind) &&
    (value.format === 'geojson' || value.format === 'png' || value.format === 'mp4') &&
    (value.product === undefined || typeof value.product === 'string') &&
    (value.totalBytes === undefined || typeof value.totalBytes === 'number') &&
    (value.fileCount === undefined || typeof value.fileCount === 'number')
  );
}

function isBusyReason(value) {
  return (
    value === 'staticSample' ||
    value === 'folderManifest' ||
    value === 'onlineCatalog' ||
    value === 'onlineDataset' ||
    value === 'remoteSample'
  );
}

export function isProjectorStatePublish(value) {
  if (!isRecord(value)) return false;
  if ('projectorOnline' in value || 'remoteConnected' in value || 'projectorLastSeenAt' in value) return false;
  return (
    typeof value.projectorSessionId === 'string' &&
    typeof value.revision === 'number' &&
    Number.isInteger(value.revision) &&
    value.revision > 0 &&
    isStep(value.step) &&
    isDatasetSummary(value.dataset) &&
    typeof value.nextDisabled === 'boolean' &&
    typeof value.backHidden === 'boolean' &&
    (value.color === undefined || isHexColor(value.color)) &&
    Array.isArray(value.samples) &&
    value.samples.every(isSampleSummary) &&
    typeof value.samplesLoaded === 'boolean' &&
    (value.samplesError === null || typeof value.samplesError === 'string') &&
    Array.isArray(value.onlineDatasets) &&
    value.onlineDatasets.every(isOnlineDatasetSummary) &&
    typeof value.busy === 'boolean' &&
    (value.busyReason === undefined || isBusyReason(value.busyReason)) &&
    (value.error === null || typeof value.error === 'string') &&
    typeof value.updatedAt === 'string'
  );
}

export function isRemoteCommandInput(value) {
  if (!isRecord(value)) return false;
  if (typeof value.clientCommandId !== 'string' || value.clientCommandId.length === 0) return false;
  if (value.type === 'next' || value.type === 'back' || value.type === 'clear') return true;
  if (value.type === 'selectSample') return typeof value.sampleId === 'string' && value.sampleId.length > 0;
  if (value.type === 'selectOnlineDataset') return typeof value.onlineDatasetId === 'string' && value.onlineDatasetId.length > 0;
  if (value.type === 'setColor') return isHexColor(value.color);
  return false;
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

  function pruneCommandIds() {
    if (!remote) return;
    for (const [clientCommandId, command] of remote.commandIds) {
      if (now() - command.createdAt > COMMAND_TTL_MS) remote.commandIds.delete(clientCommandId);
    }
    while (remote.commandIds.size > COMMAND_CAP) {
      const oldestClientCommandId = remote.commandIds.keys().next().value;
      if (oldestClientCommandId === undefined) break;
      remote.commandIds.delete(oldestClientCommandId);
    }
  }

  function pruneQueuedCommands(after = null) {
    commands = commands
      .filter((command) => (after === null || command.id > after) && now() - command.createdAt <= COMMAND_TTL_MS)
      .slice(-COMMAND_CAP);
    pruneCommandIds();
  }

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
    if (now() > projector.pinExpiresAt || pin !== projector.pin) {
      attempt.count += 1;
      failedPinAttempts += 1;
      if (attempt.count >= 5) attempt.blockedUntil = now() + 30000;
      attemptsByIp.set(ip, attempt);
      // -1 keeps the strict `now() > pinExpiresAt` comparison true even at
      // clock value 0 (a 0 sentinel would be inert at exactly epoch).
      if (failedPinAttempts >= PIN_KILL_FAILURES) projector.pinExpiresAt = -1;
      return err(401, 'invalid or expired PIN');
    }
    if (remote) return err(409, 'remote already paired');

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
    if (!isProjectorStatePublish(state)) return err(400, 'invalid projector state');
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
    if (!isRemoteCommandInput(command)) return err(400, 'invalid command');
    pruneCommandIds();
    const existing = remote.commandIds.get(command.clientCommandId);
    if (existing) return { command: existing };
    const queued = { id: nextCommandId++, ...command, createdAt: now() };
    remote.commandIds.set(command.clientCommandId, queued);
    commands.push(queued);
    pruneQueuedCommands();
    return { command: queued };
  }

  function getCommands({ token, after }) {
    if (!assertProjector(token)) return err(401, 'invalid projector token');
    projector.lastSeenAt = now();
    pruneQueuedCommands(after);
    return { commands: commands.map(({ createdAt, ...command }) => command) };
  }

  return { registerProjector, pairRemote, publishState, getState, enqueueCommand, getCommands };
}
