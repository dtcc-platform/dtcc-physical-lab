import type { Bbox } from './storage';

export type ManifestInputResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type ManifestVisualization = {
  profile?: string;
  width?: number;
  height?: number;
  fps?: number;
  duration?: number;
};

export type DtccManifest = {
  file: string;
  artifactName: string;
  title: string;
  description?: string;
  bounds: Bbox;
  kind: 'geojson' | 'image' | 'video';
  format: 'geojson' | 'png' | 'mp4';
  mediaType?: 'application/geo+json' | 'application/json' | 'image/png' | 'video/mp4';
  visualization?: ManifestVisualization;
};

export type DtccManifestFileSelection = {
  manifest: DtccManifest;
  artifact: File | null;
  missingArtifact: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isBbox(value: unknown): value is Bbox {
  return Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function isSafeRelativeFile(file: string): boolean {
  if (file.length === 0) return false;
  if (file.startsWith('/')) return false;
  if (file.includes('://')) return false;
  if (file.startsWith('../')) return false;
  if (file.includes('/../')) return false;
  return true;
}

function basename(file: string): string {
  return file.split(/[\\/]/).pop() ?? file;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function titleFromId(id: string): string {
  return id
    .split('-')
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function formatName(manifest: Record<string, unknown>): string {
  return typeof manifest.format === 'string' && manifest.format.length > 0 ? manifest.format.toLowerCase() : 'unknown';
}

function visualizationMetadata(value: unknown): ManifestVisualization | undefined {
  if (!isRecord(value)) return undefined;
  const out: ManifestVisualization = {};
  for (const key of ['profile', 'width', 'height', 'fps', 'duration'] as const) {
    if (value[key] !== undefined) out[key] = value[key] as never;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function kindForManifest(manifest: Record<string, unknown>): ManifestInputResult<{
  kind: DtccManifest['kind'];
  format: DtccManifest['format'];
  mediaType?: DtccManifest['mediaType'];
}> {
  const format = formatName(manifest);
  if (format === 'geojson') {
    const mediaType =
      manifest.media_type === 'application/geo+json' || manifest.media_type === 'application/json'
        ? manifest.media_type
        : undefined;
    return { ok: true, value: { kind: 'geojson', format, ...(mediaType !== undefined ? { mediaType } : {}) } };
  }
  if (format === 'png') {
    if (manifest.data_kind !== 'raster') return { ok: false, error: 'png manifests must have data_kind raster' };
    if (manifest.media_type !== 'image/png') return { ok: false, error: 'png manifests must have media_type image/png' };
    return { ok: true, value: { kind: 'image', format, mediaType: 'image/png' } };
  }
  if (format === 'mp4') {
    if (manifest.data_kind !== 'video') return { ok: false, error: 'mp4 manifests must have data_kind video' };
    if (manifest.media_type !== 'video/mp4') return { ok: false, error: 'mp4 manifests must have media_type video/mp4' };
    return { ok: true, value: { kind: 'video', format, mediaType: 'video/mp4' } };
  }
  return { ok: false, error: `format ${format} is not supported by the Atlas wizard` };
}

export function isDtccManifestFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.manifest.json');
}

export function parseDtccManifestText(manifestPath: string, text: string): ManifestInputResult<DtccManifest> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `JSON parse error: ${(err as Error).message}` };
  }
  if (!isRecord(parsed)) return { ok: false, error: `${manifestPath} must contain a JSON object` };
  if (typeof parsed.file !== 'string' || !isSafeRelativeFile(parsed.file)) {
    return { ok: false, error: `${manifestPath} file must be relative to the manifest directory` };
  }
  if (!isBbox(parsed.bounds)) return { ok: false, error: `${manifestPath} bounds must be four finite numbers` };
  if (parsed.description !== undefined && typeof parsed.description !== 'string') {
    return { ok: false, error: `${manifestPath} description must be a string when present` };
  }

  const manifestKind = kindForManifest(parsed);
  if (!manifestKind.ok) return manifestKind;

  const artifactName = basename(parsed.file);
  const id =
    typeof parsed.id === 'string' && parsed.id.trim().length > 0
      ? parsed.id.trim()
      : slugify(typeof parsed.name === 'string' && parsed.name.trim().length > 0 ? parsed.name : artifactName);
  const title =
    typeof parsed.title === 'string' && parsed.title.trim().length > 0 ? parsed.title.trim() : titleFromId(id);
  const visualization = visualizationMetadata(parsed.visualization);

  return {
    ok: true,
    value: {
      file: parsed.file,
      artifactName,
      title,
      ...(parsed.description !== undefined ? { description: parsed.description } : {}),
      bounds: parsed.bounds,
      ...manifestKind.value,
      ...(visualization !== undefined ? { visualization } : {}),
    },
  };
}

export async function readDtccManifestFile(file: File): Promise<ManifestInputResult<DtccManifest>> {
  return parseDtccManifestText(file.name, await file.text());
}

export function findManifestArtifact(files: File[], manifest: DtccManifest): File | null {
  return (
    files.find((file) => {
      if (isDtccManifestFile(file)) return false;
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      return file.name === manifest.artifactName || relativePath === manifest.file;
    }) ?? null
  );
}

export async function resolveDtccManifestFiles(files: File[]): Promise<ManifestInputResult<DtccManifestFileSelection>> {
  const manifestFile = files.find(isDtccManifestFile);
  if (!manifestFile) return { ok: false, error: 'selection does not include a dtcc manifest' };

  const manifest = await readDtccManifestFile(manifestFile);
  if (!manifest.ok) return manifest;

  const artifact = findManifestArtifact(files, manifest.value);
  return {
    ok: true,
    value: {
      manifest: manifest.value,
      artifact,
      missingArtifact: artifact ? null : manifest.value.file,
    },
  };
}
