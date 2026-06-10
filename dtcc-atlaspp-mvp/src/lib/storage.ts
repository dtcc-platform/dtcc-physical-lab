import { featureCollectionBbox, type FeatureCollection } from './geojson';

export type Bbox = [number, number, number, number];

export type DatasetContent =
  | { kind: 'geojson'; geojson: FeatureCollection; style: { color: string } }
  | { kind: 'image'; src: string; mediaType: 'image/png' }
  | { kind: 'video'; src: string; mediaType: 'video/mp4'; loop: boolean; muted: boolean; autoplay: boolean };

export type Dataset = {
  version: 3;
  filename: string;
  uploadedAt: string;
  bounds: Bbox;
  catalogId?: string;
  title?: string;
  description?: string;
  content: DatasetContent;
};

export type Calibration = {
  version: 2;
  panX: number;
  panY: number;
  cornerDst: [[number, number], [number, number], [number, number], [number, number]];
  homography: number[];
  sourceWidth: number;
  sourceHeight: number;
  savedAt: string;
};

// User-chosen startup snapshot (#8): a full copy of dataset + calibration
// under its own key, so subsequent loads, Clear, and wizard resets never
// silently overwrite the chosen default.
export type StartupDefaults = {
  version: 1;
  dataset: Dataset;
  calibration: Calibration;
  savedAt: string;
};

const KEY_DATASET = 'dtcc-atlaspp-mvp.dataset';
const KEY_CALIBRATION = 'dtcc-atlaspp-mvp.calibration';
const KEY_STARTUP_DEFAULTS = 'dtcc-atlaspp-mvp.startupDefaults';

// Type guards validate the full shape, not just the version. A half-corrupt
// blob (valid JSON, right version, missing/wrong-typed fields) is treated as
// absent rather than hydrated and crashed downstream.

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isFeatureCollection(v: unknown): v is FeatureCollection {
  if (!isRecord(v)) return false;
  if (v.type !== 'FeatureCollection') return false;
  return Array.isArray(v.features);
}

function isStyle(v: unknown): v is { color: string } {
  return isRecord(v) && typeof v.color === 'string';
}

function isBbox(v: unknown): v is Bbox {
  return Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function isDatasetContent(v: unknown): v is DatasetContent {
  if (!isRecord(v)) return false;
  if (v.kind === 'geojson') return isFeatureCollection(v.geojson) && isStyle(v.style);
  if (v.kind === 'image') return typeof v.src === 'string' && v.mediaType === 'image/png';
  if (v.kind === 'video') {
    return (
      typeof v.src === 'string' &&
      v.mediaType === 'video/mp4' &&
      typeof v.loop === 'boolean' &&
      typeof v.muted === 'boolean' &&
      typeof v.autoplay === 'boolean'
    );
  }
  return false;
}

function parseDataset(v: unknown): Dataset | null {
  if (!isRecord(v)) return null;

  if (v.version === 3) {
    if (typeof v.filename !== 'string') return null;
    if (typeof v.uploadedAt !== 'string') return null;
    if (!isBbox(v.bounds)) return null;
    if (v.catalogId !== undefined && typeof v.catalogId !== 'string') return null;
    if (v.title !== undefined && typeof v.title !== 'string') return null;
    if (v.description !== undefined && typeof v.description !== 'string') return null;
    if (!isDatasetContent(v.content)) return null;

    return {
      version: 3,
      filename: v.filename,
      uploadedAt: v.uploadedAt,
      bounds: v.bounds,
      ...(v.catalogId !== undefined ? { catalogId: v.catalogId } : {}),
      ...(v.title !== undefined ? { title: v.title } : {}),
      ...(v.description !== undefined ? { description: v.description } : {}),
      content: v.content,
    };
  }

  if (v.version === 2) {
    if (typeof v.filename !== 'string') return null;
    if (typeof v.uploadedAt !== 'string') return null;
    if (!isFeatureCollection(v.geojson)) return null;
    if (!isStyle(v.style)) return null;
    if (v.catalogId !== undefined && typeof v.catalogId !== 'string') return null;
    const bounds = isBbox(v.projectionBbox) ? v.projectionBbox : featureCollectionBbox(v.geojson);
    if (!bounds) return null;
    return {
      version: 3,
      filename: v.filename,
      uploadedAt: v.uploadedAt,
      bounds,
      ...(v.catalogId !== undefined ? { catalogId: v.catalogId } : {}),
      content: { kind: 'geojson', geojson: v.geojson, style: v.style },
    };
  }

  return null;
}

function isCornerDst(v: unknown): v is Calibration['cornerDst'] {
  if (!Array.isArray(v) || v.length !== 4) return false;
  return v.every(
    (p) => Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number'
  );
}

function isCalibration(v: unknown): v is Calibration {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return (
    c.version === 2 &&
    typeof c.panX === 'number' &&
    typeof c.panY === 'number' &&
    isCornerDst(c.cornerDst) &&
    Array.isArray(c.homography) &&
    c.homography.length === 9 &&
    c.homography.every((n) => typeof n === 'number') &&
    typeof c.sourceWidth === 'number' &&
    typeof c.sourceHeight === 'number' &&
    typeof c.savedAt === 'string'
  );
}

function loadVersioned<T>(key: string, isValid: (v: unknown) => v is T): T | null {
  const raw = localStorage.getItem(key);
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw);
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function save<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function loadDataset(): Dataset | null {
  const raw = localStorage.getItem(KEY_DATASET);
  if (raw == null) return null;
  try {
    return parseDataset(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveDataset(d: Dataset): void {
  save(KEY_DATASET, d);
}

export function clearDataset(): void {
  localStorage.removeItem(KEY_DATASET);
}

export function datasetFitBbox(dataset: Dataset): Bbox {
  return dataset.bounds;
}

export function bboxEqual(a: Bbox | undefined, b: Bbox | undefined): boolean {
  if (!a || !b) return false;
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

export function loadCalibration(): Calibration | null {
  return loadVersioned(KEY_CALIBRATION, isCalibration);
}

export function saveCalibration(c: Calibration): void {
  save(KEY_CALIBRATION, c);
}

export function clearCalibration(): void {
  localStorage.removeItem(KEY_CALIBRATION);
}

export function loadStartupDefaults(): StartupDefaults | null {
  const raw = localStorage.getItem(KEY_STARTUP_DEFAULTS);
  if (raw == null) return null;
  try {
    const v = JSON.parse(raw);
    if (!isRecord(v) || v.version !== 1 || typeof v.savedAt !== 'string') return null;
    // parseDataset also migrates an embedded older dataset shape, mirroring
    // loadDataset's behavior for the live key.
    const dataset = parseDataset(v.dataset);
    if (!dataset || !isCalibration(v.calibration)) return null;
    return { version: 1, dataset, calibration: v.calibration, savedAt: v.savedAt };
  } catch {
    return null;
  }
}

export function saveStartupDefaults(d: StartupDefaults): void {
  save(KEY_STARTUP_DEFAULTS, d);
}

export function clearStartupDefaults(): void {
  localStorage.removeItem(KEY_STARTUP_DEFAULTS);
}

export type StartupState = {
  dataset: Dataset | null;
  calibration: Calibration | null;
  step: 1 | 5;
  fromDefaults: boolean;
};

// Soft startup precedence (#8/#9): a complete last session resumes the
// projection; an in-progress session (dataset without calibration) continues
// the wizard rather than being clobbered by defaults; saved defaults fill in
// when no last-session dataset exists; otherwise the calibration wizard.
export function resolveStartup(
  lastDataset: Dataset | null,
  lastCalibration: Calibration | null,
  defaults: StartupDefaults | null,
): StartupState {
  if (lastDataset && lastCalibration) {
    return { dataset: lastDataset, calibration: lastCalibration, step: 5, fromDefaults: false };
  }
  if (lastDataset) {
    return { dataset: lastDataset, calibration: lastCalibration, step: 1, fromDefaults: false };
  }
  if (defaults) {
    return { dataset: defaults.dataset, calibration: defaults.calibration, step: 5, fromDefaults: true };
  }
  return { dataset: lastDataset, calibration: lastCalibration, step: 1, fromDefaults: false };
}

// Boot entry point: resolves the startup state and, when defaults filled the
// gap, materializes them into the live keys. A defaults boot is then
// indistinguishable from a resumed session, so later partial writes (color
// change, sample re-select, re-calibration) keep storage and app state
// paired instead of stranding a half-persisted session.
export function initStartup(): StartupState {
  const resolved = resolveStartup(loadDataset(), loadCalibration(), loadStartupDefaults());
  if (resolved.fromDefaults && resolved.dataset && resolved.calibration) {
    saveDataset(resolved.dataset);
    saveCalibration(resolved.calibration);
  }
  return resolved;
}
