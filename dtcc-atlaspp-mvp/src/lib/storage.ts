import type { FeatureCollection } from './geojson';

export type Dataset = {
  version: 2;
  filename: string;
  geojson: FeatureCollection;
  style: { color: string };
  uploadedAt: string;
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

function isDataset(v: unknown): v is Dataset {
  if (!v || typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  if (d.version !== 2) return false;
  if (typeof d.filename !== 'string') return false;
  // Validate the FeatureCollection shape we actually iterate over downstream.
  // A partially-written save where geojson is `{}` or `{ features: null }`
  // would otherwise pass and then crash on the first feature iteration.
  if (!d.geojson || typeof d.geojson !== 'object') return false;
  const g = d.geojson as Record<string, unknown>;
  if (g.type !== 'FeatureCollection') return false;
  if (!Array.isArray(g.features)) return false;
  const s = d.style as Record<string, unknown> | undefined;
  if (!s || typeof s.color !== 'string') return false;
  return typeof d.uploadedAt === 'string';
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
  return loadVersioned(KEY_DATASET, isDataset);
}

export function saveDataset(d: Dataset): void {
  save(KEY_DATASET, d);
}

export function clearDataset(): void {
  localStorage.removeItem(KEY_DATASET);
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
