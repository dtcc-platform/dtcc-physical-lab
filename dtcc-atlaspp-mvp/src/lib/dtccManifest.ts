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
  manifestPath?: string;
};

const MANIFEST_V2_SCHEMA_VERSION = 'dtcc-dataset-manifest-v2';
type ManifestKind = Pick<DtccManifest, 'kind' | 'format' | 'mediaType'>;
type DisplayCandidate = {
  artifact: Record<string, unknown> & { path: string };
  kind: ManifestKind;
  rank: number;
  index: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isBbox(value: unknown): value is Bbox {
  return Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function isSafeRelativeFile(file: string): boolean {
  if (file.length === 0) return false;
  if (file.includes('\\')) return false;
  if (file.startsWith('/')) return false;
  if (/^[A-Za-z]:/.test(file)) return false;
  if (file.includes('://')) return false;
  return !file.split('/').some((part) => part.length === 0 || part === '.' || part === '..' || part.startsWith('.'));
}

function basename(file: string): string {
  return file.split(/[\\/]/).pop() ?? file;
}

function fileRelativePath(file: File): string | null {
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return typeof relativePath === 'string' && relativePath.length > 0 ? relativePath.replace(/\\/g, '/') : null;
}

function dirname(file: string): string {
  const i = file.lastIndexOf('/');
  return i === -1 ? '' : file.slice(0, i);
}

function joinRelativePath(base: string, file: string): string {
  return base.length > 0 ? `${base}/${file}` : file;
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

function parseVisualizationMetadata(value: unknown, manifestPath: string): ManifestInputResult<ManifestVisualization | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (!isRecord(value)) return { ok: false, error: `${manifestPath} visualization must be an object when present` };

  const out: ManifestVisualization = {};
  if (value.profile !== undefined) {
    if (typeof value.profile !== 'string') {
      return { ok: false, error: `${manifestPath} visualization.profile must be a string` };
    }
    out.profile = value.profile;
  }
  for (const key of ['width', 'height', 'fps', 'duration'] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) {
      return { ok: false, error: `${manifestPath} visualization.${key} must be a finite number` };
    }
    out[key] = value[key];
  }
  return { ok: true, value: Object.keys(out).length > 0 ? out : undefined };
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
  const name = file.name.toLowerCase();
  return name.endsWith('.manifest.json') || name === 'manifest.json';
}

export function parseDtccManifestText(manifestPath: string, text: string): ManifestInputResult<DtccManifest> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `JSON parse error: ${(err as Error).message}` };
  }
  if (!isRecord(parsed)) return { ok: false, error: `${manifestPath} must contain a JSON object` };
  if (parsed.schema_version === MANIFEST_V2_SCHEMA_VERSION) {
    return parseDatasetManifestV2(manifestPath, parsed);
  }
  if (parsed.schema_version !== undefined || parsed.artifacts !== undefined || parsed.identity !== undefined) {
    return { ok: false, error: `${manifestPath} Dataset Manifest v2 must declare schema_version ${MANIFEST_V2_SCHEMA_VERSION}` };
  }
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
  const visualization = parseVisualizationMetadata(parsed.visualization, manifestPath);
  if (!visualization.ok) return visualization;

  return {
    ok: true,
    value: {
      file: parsed.file,
      artifactName,
      title,
      ...(parsed.description !== undefined ? { description: parsed.description } : {}),
      bounds: parsed.bounds,
      ...manifestKind.value,
      ...(visualization.value !== undefined ? { visualization: visualization.value } : {}),
    },
  };
}

function parseDatasetManifestV2(manifestPath: string, manifest: Record<string, unknown>): ManifestInputResult<DtccManifest> {
  const artifacts = manifest.artifacts;
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    return { ok: false, error: `${manifestPath} Dataset Manifest v2 must include non-empty artifacts` };
  }

  const candidates: DisplayCandidate[] = [];
  for (let i = 0; i < artifacts.length; i += 1) {
    const artifact = artifacts[i];
    if (!isRecord(artifact)) return { ok: false, error: `${manifestPath} artifact ${i} must be an object` };
    if (typeof artifact.path !== 'string' || !isSafeRelativeFile(artifact.path)) {
      return { ok: false, error: `${manifestPath} artifact ${i} path must be relative to the package root` };
    }
    const artifactPath = artifact.path;
    for (const key of ['role', 'format', 'media_type', 'data_kind'] as const) {
      if (typeof artifact[key] !== 'string' || artifact[key].trim().length === 0) {
        return { ok: false, error: `${manifestPath} artifact ${i} must include ${key}` };
      }
    }

    const kind = kindForManifest(artifact);
    if (!kind.ok) continue;
    const role = typeof artifact.role === 'string' ? artifact.role.trim() : '';
    const primary = role === 'primary';
    const rank =
      kind.value.kind === 'image'
        ? primary
          ? 0
          : 3
        : kind.value.kind === 'video'
          ? primary
            ? 1
            : 4
          : primary
            ? 2
            : 5;
    candidates.push({ artifact: { ...artifact, path: artifactPath }, kind: kind.value, rank, index: i });
  }

  if (candidates.length === 0) {
    return { ok: false, error: `${manifestPath} Dataset Manifest v2 has no displayable image/png, video/mp4, or GeoJSON artifact` };
  }

  candidates.sort((a, b) => a.rank - b.rank || a.index - b.index);
  const selected = candidates[0];
  const request = isRecord(manifest.request) ? manifest.request : {};
  const identity = isRecord(manifest.identity) ? manifest.identity : {};
  const metadata = isRecord(manifest.metadata) ? manifest.metadata : {};
  const presentation = isRecord(manifest.presentation) ? manifest.presentation : {};
  const bounds = isBbox(selected.artifact.bounds) ? selected.artifact.bounds : isBbox(request.bounds) ? request.bounds : null;
  if (!bounds) return { ok: false, error: `${manifestPath} Dataset Manifest v2 selected artifact has no four-number bounds` };

  const title =
    typeof identity.title === 'string' && identity.title.trim().length > 0
      ? identity.title.trim()
      : typeof presentation.headline === 'string' && presentation.headline.trim().length > 0
        ? presentation.headline.trim()
        : typeof identity.name === 'string' && identity.name.trim().length > 0
          ? titleFromId(slugify(identity.name))
          : titleFromId(slugify(basename(selected.artifact.path)));
  const description =
    typeof metadata.description === 'string' && metadata.description.trim().length > 0
      ? metadata.description
      : typeof presentation.summary === 'string' && presentation.summary.trim().length > 0
        ? presentation.summary
        : undefined;
  const visualization = parseVisualizationMetadata(presentation.view_hints, manifestPath);
  if (!visualization.ok) return visualization;

  return {
    ok: true,
    value: {
      file: selected.artifact.path,
      artifactName: basename(selected.artifact.path),
      title,
      ...(description !== undefined ? { description } : {}),
      bounds,
      ...selected.kind,
      ...(visualization.value !== undefined ? { visualization: visualization.value } : {}),
    },
  };
}

export async function readDtccManifestFile(file: File): Promise<ManifestInputResult<DtccManifest>> {
  return parseDtccManifestText(fileRelativePath(file) ?? file.name, await file.text());
}

function manifestArtifactPath(manifestFile: File, manifest: DtccManifest): string | null {
  const manifestPath = fileRelativePath(manifestFile);
  return manifestPath ? joinRelativePath(dirname(manifestPath), manifest.file) : null;
}

function unsupportedManifestError(error: string): boolean {
  return error.startsWith('format ') && error.includes(' is not supported by the Atlas wizard');
}

export function findManifestArtifact(files: File[], manifest: DtccManifest, manifestFile?: File): File | null {
  const expectedPath = manifestFile ? manifestArtifactPath(manifestFile, manifest) : null;
  if (expectedPath) {
    return files.find((file) => !isDtccManifestFile(file) && fileRelativePath(file) === expectedPath) ?? null;
  }

  const relativeMatch = files.find(
    (file) => !isDtccManifestFile(file) && fileRelativePath(file) === manifest.file
  );
  if (relativeMatch) return relativeMatch;

  return files.find((file) => !isDtccManifestFile(file) && file.name === manifest.artifactName) ?? null;
}

export async function resolveDtccManifestFiles(files: File[]): Promise<ManifestInputResult<DtccManifestFileSelection>> {
  const manifestFile = files.find(isDtccManifestFile);
  if (!manifestFile) return { ok: false, error: 'selection does not include a dtcc manifest' };

  const manifest = await readDtccManifestFile(manifestFile);
  if (!manifest.ok) return manifest;

  const artifact = findManifestArtifact(files, manifest.value, manifestFile);
  return {
    ok: true,
    value: {
      manifest: manifest.value,
      artifact,
      missingArtifact: artifact ? null : manifest.value.file,
    },
  };
}

export async function resolveDtccManifestFolder(files: File[]): Promise<ManifestInputResult<DtccManifestFileSelection[]>> {
  const manifestFiles = files.filter(isDtccManifestFile);
  if (manifestFiles.length === 0) return { ok: false, error: 'folder does not include a dtcc manifest' };

  const selections: DtccManifestFileSelection[] = [];
  for (const manifestFile of manifestFiles) {
    const manifest = await readDtccManifestFile(manifestFile);
    if (!manifest.ok) {
      if (unsupportedManifestError(manifest.error)) continue;
      return manifest;
    }

    const manifestPath = fileRelativePath(manifestFile);
    const artifact = findManifestArtifact(files, manifest.value, manifestFile);
    const expectedPath = manifestArtifactPath(manifestFile, manifest.value) ?? manifest.value.file;
    selections.push({
      manifest: manifest.value,
      artifact,
      missingArtifact: artifact ? null : expectedPath,
      ...(manifestPath !== null ? { manifestPath } : {}),
    });
  }

  if (selections.length === 0) {
    return { ok: false, error: 'folder does not include a supported dtcc manifest' };
  }

  return { ok: true, value: selections };
}
