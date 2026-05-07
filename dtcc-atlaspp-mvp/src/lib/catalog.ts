import type { Bbox } from './storage';

export type CatalogResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type VisualizationMetadata = {
  profile?: string;
  width?: number;
  height?: number;
  fps?: number;
  duration?: number;
};

export type CatalogEntry =
  | {
      kind: 'geojson';
      id: string;
      title: string;
      description?: string;
      file: string;
      bounds: Bbox;
      format: 'geojson';
      mediaType?: 'application/geo+json' | 'application/json';
    }
  | {
      kind: 'image';
      id: string;
      title: string;
      description?: string;
      file: string;
      bounds: Bbox;
      format: 'png';
      mediaType: 'image/png';
      visualization?: VisualizationMetadata;
    }
  | {
      kind: 'video';
      id: string;
      title: string;
      description?: string;
      file: string;
      bounds: Bbox;
      format: 'mp4';
      mediaType: 'video/mp4';
      visualization?: VisualizationMetadata;
    };

export type Catalog = {
  version: 1;
  entries: CatalogEntry[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isRelativeDatasetFile(file: string): boolean {
  if (file.length === 0) return false;
  if (file.startsWith('/')) return false;
  if (file.includes('://')) return false;
  if (file.startsWith('../')) return false;
  if (file.includes('/../')) return false;
  return true;
}

function isFiniteBbox(value: unknown): value is Bbox {
  return Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function parseVisualization(value: unknown, entryIndex: number): CatalogResult<VisualizationMetadata | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (!isRecord(value)) return { ok: false, error: `entry ${entryIndex} visualization must be an object when present` };

  const out: VisualizationMetadata = {};
  if (value.profile !== undefined) {
    if (typeof value.profile !== 'string') {
      return { ok: false, error: `entry ${entryIndex} visualization.profile must be a string` };
    }
    out.profile = value.profile;
  }
  if (value.width !== undefined) {
    if (typeof value.width !== 'number' || !Number.isFinite(value.width)) {
      return { ok: false, error: `entry ${entryIndex} visualization.width must be a finite number` };
    }
    out.width = value.width;
  }
  if (value.height !== undefined) {
    if (typeof value.height !== 'number' || !Number.isFinite(value.height)) {
      return { ok: false, error: `entry ${entryIndex} visualization.height must be a finite number` };
    }
    out.height = value.height;
  }
  if (value.fps !== undefined) {
    if (typeof value.fps !== 'number' || !Number.isFinite(value.fps)) {
      return { ok: false, error: `entry ${entryIndex} visualization.fps must be a finite number` };
    }
    out.fps = value.fps;
  }
  if (value.duration !== undefined) {
    if (typeof value.duration !== 'number' || !Number.isFinite(value.duration)) {
      return { ok: false, error: `entry ${entryIndex} visualization.duration must be a finite number` };
    }
    out.duration = value.duration;
  }
  return { ok: true, value: out };
}

function kindForFormat(format: string): CatalogEntry['kind'] | null {
  if (format === 'geojson') return 'geojson';
  if (format === 'png') return 'image';
  if (format === 'mp4') return 'video';
  return null;
}

export function parseCatalog(value: unknown): CatalogResult<Catalog> {
  if (!isRecord(value)) return { ok: false, error: 'catalog must be an object' };
  if (value.version !== 1) return { ok: false, error: 'catalog version must be 1' };
  if (!Array.isArray(value.entries) || value.entries.length === 0) {
    return { ok: false, error: 'catalog entries must be a non-empty array' };
  }

  const seen = new Set<string>();
  const entries: CatalogEntry[] = [];

  for (let i = 0; i < value.entries.length; i++) {
    const raw = value.entries[i];
    if (!isRecord(raw)) return { ok: false, error: `entry ${i} must be an object` };

    if (typeof raw.id !== 'string' || raw.id.length === 0) {
      return { ok: false, error: `entry ${i} id must be a non-empty string` };
    }
    if (seen.has(raw.id)) return { ok: false, error: `duplicate catalog id "${raw.id}"` };
    seen.add(raw.id);

    if (typeof raw.title !== 'string' || raw.title.length === 0) {
      return { ok: false, error: `entry ${i} title must be a non-empty string` };
    }
    if (typeof raw.file !== 'string' || !isRelativeDatasetFile(raw.file)) {
      return { ok: false, error: `entry ${i} file must be relative to /datasets/` };
    }
    if (!isFiniteBbox(raw.bounds)) {
      return { ok: false, error: `entry ${i} bounds must be four finite numbers` };
    }
    if (raw.description !== undefined && typeof raw.description !== 'string') {
      return { ok: false, error: `entry ${i} description must be a string when present` };
    }

    const format = raw.format === undefined ? 'geojson' : raw.format;
    if (format !== 'geojson' && format !== 'png' && format !== 'mp4') {
      return { ok: false, error: `entry ${i} format must be geojson, png, or mp4` };
    }
    const expectedKind = kindForFormat(format);
    const kind = raw.kind === undefined ? expectedKind : raw.kind;
    if (kind !== expectedKind) {
      return { ok: false, error: `entry ${i} kind must match format` };
    }

    const base = {
      id: raw.id,
      title: raw.title,
      ...(raw.description !== undefined ? { description: raw.description } : {}),
      file: raw.file,
      bounds: raw.bounds,
    };

    if (kind === 'geojson') {
      if (
        raw.mediaType !== undefined &&
        raw.mediaType !== 'application/geo+json' &&
        raw.mediaType !== 'application/json'
      ) {
        return { ok: false, error: `entry ${i} mediaType must match geojson` };
      }
      entries.push({
        ...base,
        kind: 'geojson',
        format: 'geojson',
        ...(raw.mediaType !== undefined ? { mediaType: raw.mediaType } : {}),
      });
      continue;
    }

    const visualization = parseVisualization(raw.visualization, i);
    if (!visualization.ok) return visualization;

    if (kind === 'image') {
      if (raw.mediaType !== 'image/png') return { ok: false, error: `entry ${i} mediaType must be image/png` };
      entries.push({
        ...base,
        kind: 'image',
        format: 'png',
        mediaType: 'image/png',
        ...(visualization.value !== undefined ? { visualization: visualization.value } : {}),
      });
      continue;
    }

    if (raw.mediaType !== 'video/mp4') return { ok: false, error: `entry ${i} mediaType must be video/mp4` };
    entries.push({
      ...base,
      kind: 'video',
      format: 'mp4',
      mediaType: 'video/mp4',
      ...(visualization.value !== undefined ? { visualization: visualization.value } : {}),
    });
  }

  return { ok: true, value: { version: 1, entries } };
}
