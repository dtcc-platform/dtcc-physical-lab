import type { Bbox } from './storage';

export type CatalogResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type CatalogEntry = {
  id: string;
  title: string;
  description?: string;
  file: string;
  bounds: Bbox;
};

export type Catalog = {
  version: 1;
  entries: CatalogEntry[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isBbox(value: unknown): value is Bbox {
  return Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === 'number');
}

function isRelativeDatasetFile(file: string): boolean {
  if (file.length === 0) return false;
  if (file.startsWith('/')) return false;
  if (file.includes('://')) return false;
  if (file.startsWith('../')) return false;
  if (file.includes('/../')) return false;
  return true;
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
    if (!isBbox(raw.bounds)) {
      return { ok: false, error: `entry ${i} bounds must be four numbers` };
    }
    if (raw.description !== undefined && typeof raw.description !== 'string') {
      return { ok: false, error: `entry ${i} description must be a string when present` };
    }

    entries.push({
      id: raw.id,
      title: raw.title,
      ...(raw.description !== undefined ? { description: raw.description } : {}),
      file: raw.file,
      bounds: raw.bounds,
    });
  }

  return { ok: true, value: { version: 1, entries } };
}
