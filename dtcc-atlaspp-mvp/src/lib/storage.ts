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

const KEY_DATASET = 'dtcc-atlaspp-mvp.dataset';
const KEY_CALIBRATION = 'dtcc-atlaspp-mvp.calibration';

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
