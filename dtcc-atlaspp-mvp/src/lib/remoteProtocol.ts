import type { DatasetContent } from './storage';

export type RemoteDatasetSummary = {
  filename: string;
  title?: string;
  catalogId?: string;
  kind: DatasetContent['kind'];
} | null;

export type RemoteSampleSummary = {
  id: string;
  title: string;
  kind: DatasetContent['kind'];
};

export type RemoteOnlineDatasetSummary = {
  id: string;
  title: string;
  kind: DatasetContent['kind'];
  format: 'geojson' | 'png' | 'mp4';
  product?: string;
  totalBytes?: number;
  fileCount?: number;
};

export type BusyReason = 'staticSample' | 'folderManifest' | 'onlineCatalog' | 'onlineDataset' | 'remoteSample';

export type ProjectorState = {
  projectorSessionId: string;
  revision: number;
  projectorOnline: boolean;
  remoteConnected: boolean;
  step: 1 | 2 | 3 | 4 | 5;
  dataset: RemoteDatasetSummary;
  nextDisabled: boolean;
  backHidden: boolean;
  color?: string;
  samples: RemoteSampleSummary[];
  samplesLoaded: boolean;
  samplesError: string | null;
  onlineDatasets: RemoteOnlineDatasetSummary[];
  busy: boolean;
  busyReason?: BusyReason;
  error: string | null;
  updatedAt: string;
  projectorLastSeenAt: string;
};

export type ProjectorStatePublish = Omit<ProjectorState, 'projectorOnline' | 'remoteConnected' | 'projectorLastSeenAt'>;

export type RemoteCommandInput =
  | { clientCommandId: string; type: 'next' }
  | { clientCommandId: string; type: 'back' }
  | { clientCommandId: string; type: 'clear' }
  | { clientCommandId: string; type: 'selectSample'; sampleId: string }
  | { clientCommandId: string; type: 'selectOnlineDataset'; onlineDatasetId: string }
  | { clientCommandId: string; type: 'setColor'; color: string };

export type QueuedRemoteCommand = RemoteCommandInput & { id: number };

export type ProjectorRegisterResponse = {
  projectorSessionId: string;
  projectorToken: string;
  pin: string;
  pinExpiresAt: string;
  remoteUrl: string;
};

export type PairingResponse = {
  remoteToken: string;
};

export type StatePublishResponse = { acceptedRevision: number };
export type StatePublishConflict = { acceptedRevision: number; currentRevision: number };
export type StateResponse = { state: ProjectorState };
export type CommandsResponse = { commands: QueuedRemoteCommand[] };
export type CommandPostResponse = { command: QueuedRemoteCommand };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isStep(value: unknown): value is ProjectorState['step'] {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

function isDatasetKind(value: unknown): value is DatasetContent['kind'] {
  return value === 'geojson' || value === 'image' || value === 'video';
}

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value);
}

function isDatasetSummary(value: unknown): value is RemoteDatasetSummary {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if (typeof value.filename !== 'string') return false;
  if (!isDatasetKind(value.kind)) return false;
  if (value.title !== undefined && typeof value.title !== 'string') return false;
  if (value.catalogId !== undefined && typeof value.catalogId !== 'string') return false;
  return true;
}

function isSampleSummary(value: unknown): value is RemoteSampleSummary {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    isDatasetKind(value.kind)
  );
}

function isOnlineDatasetSummary(value: unknown): value is RemoteOnlineDatasetSummary {
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

function isBusyReason(value: unknown): value is BusyReason {
  return (
    value === 'staticSample' ||
    value === 'folderManifest' ||
    value === 'onlineCatalog' ||
    value === 'onlineDataset' ||
    value === 'remoteSample'
  );
}

export function isProjectorStatePublish(value: unknown): value is ProjectorStatePublish {
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

export function isRemoteCommandInput(value: unknown): value is RemoteCommandInput {
  if (!isRecord(value)) return false;
  if (typeof value.clientCommandId !== 'string' || value.clientCommandId.length === 0) return false;
  if (value.type === 'next' || value.type === 'back' || value.type === 'clear') return true;
  if (value.type === 'selectSample') return typeof value.sampleId === 'string' && value.sampleId.length > 0;
  if (value.type === 'selectOnlineDataset') return typeof value.onlineDatasetId === 'string' && value.onlineDatasetId.length > 0;
  if (value.type === 'setColor') return isHexColor(value.color);
  return false;
}
