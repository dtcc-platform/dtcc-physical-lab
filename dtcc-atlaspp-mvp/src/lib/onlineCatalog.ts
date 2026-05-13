import type { Bbox } from './storage';

export type OnlineCatalogResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type OnlineCatalogSettings = {
  baseUrl: string;
  token: string;
};

export type OnlineCatalogEntry = {
  id: string;
  datasetKey: string;
  versionId: string;
  title: string;
  bounds: Bbox;
  kind: 'geojson' | 'image' | 'video';
  format: 'geojson' | 'png' | 'mp4';
  mediaType: 'application/geo+json' | 'application/json' | 'image/png' | 'video/mp4';
  product?: string;
  totalBytes?: number;
  fileCount?: number;
};

const KEY_BASE_URL = 'dtcc-atlaspp-mvp.onlineCatalog.baseUrl';
const KEY_TOKEN = 'dtcc-atlaspp-mvp.onlineCatalog.token';

export function loadOnlineCatalogSettings(): OnlineCatalogSettings {
  return {
    baseUrl: localStorage.getItem(KEY_BASE_URL) ?? '',
    token: localStorage.getItem(KEY_TOKEN) ?? '',
  };
}

export function saveOnlineCatalogSettings(settings: OnlineCatalogSettings): void {
  localStorage.setItem(KEY_BASE_URL, settings.baseUrl);
  localStorage.setItem(KEY_TOKEN, settings.token);
}

export function clearOnlineCatalogSettings(): void {
  localStorage.removeItem(KEY_BASE_URL);
  localStorage.removeItem(KEY_TOKEN);
}

export function normalizeOnlineBaseUrl(value: string): OnlineCatalogResult<string> {
  const trimmed = value.trim().replace(/\/+$/, '');
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, error: 'online catalog URL is invalid' };
    }
    return { ok: true, value: url.href.replace(/\/+$/, '') };
  } catch {
    return { ok: false, error: 'online catalog URL is invalid' };
  }
}

function encodedPath(...segments: string[]): string {
  return segments.map((segment) => encodeURIComponent(segment)).join('/');
}

function encodedLogicalPath(path: string): string {
  return path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

export function fetchOnlineCatalogUrl(baseUrl: string): URL {
  const url = new URL('v1/datasets', `${baseUrl}/`);
  url.searchParams.set('limit', '100');
  return url;
}

export function fetchOnlineVersionDetailUrl(baseUrl: string, entry: OnlineCatalogEntry): URL {
  return new URL(`v1/datasets/${encodedPath(entry.datasetKey)}/versions/${encodedPath(entry.versionId)}`, `${baseUrl}/`);
}

export function fetchOnlineManifestUrl(baseUrl: string, entry: OnlineCatalogEntry): URL {
  return new URL(
    `v1/datasets/${encodedPath(entry.datasetKey)}/versions/${encodedPath(entry.versionId)}/manifest`,
    `${baseUrl}/`
  );
}

export function fetchOnlineArtifactUrl(baseUrl: string, entry: OnlineCatalogEntry, path: string): URL {
  return new URL(
    `v1/datasets/${encodedPath(entry.datasetKey)}/versions/${encodedPath(entry.versionId)}/files/${encodedLogicalPath(path)}`,
    `${baseUrl}/`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isBbox(value: unknown): value is Bbox {
  return Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function parseBoundsJson(value: unknown): Bbox | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return isBbox(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function mapSupportedKind(row: Record<string, unknown>): Pick<OnlineCatalogEntry, 'kind' | 'format' | 'mediaType'> | null {
  if (row.format === 'geojson' && (row.media_type === 'application/geo+json' || row.media_type === 'application/json')) {
    return { kind: 'geojson', format: 'geojson', mediaType: row.media_type };
  }
  if (row.format === 'png' && row.media_type === 'image/png' && row.data_kind === 'raster') {
    return { kind: 'image', format: 'png', mediaType: 'image/png' };
  }
  if (row.format === 'mp4' && row.media_type === 'video/mp4' && row.data_kind === 'video') {
    return { kind: 'video', format: 'mp4', mediaType: 'video/mp4' };
  }
  return null;
}

function mapOnlineRow(row: unknown): OnlineCatalogEntry | null {
  if (!isRecord(row)) return null;
  if (typeof row.dataset_key !== 'string' || row.dataset_key.length === 0) return null;
  if (typeof row.version_id !== 'string' || row.version_id.length === 0) return null;

  const supported = mapSupportedKind(row);
  if (!supported) return null;

  const bounds = parseBoundsJson(row.bounds_json);
  if (!bounds) return null;

  const title = typeof row.title === 'string' && row.title.trim().length > 0 ? row.title.trim() : row.dataset_key;

  return {
    id: `${row.dataset_key}@${row.version_id}`,
    datasetKey: row.dataset_key,
    versionId: row.version_id,
    title,
    bounds,
    ...supported,
    ...(typeof row.product === 'string' ? { product: row.product } : {}),
    ...(typeof row.total_bytes === 'number' && Number.isFinite(row.total_bytes) ? { totalBytes: row.total_bytes } : {}),
    ...(typeof row.file_count === 'number' && Number.isFinite(row.file_count) ? { fileCount: row.file_count } : {}),
  };
}

export function parseOnlineCatalogResponse(value: unknown): OnlineCatalogResult<OnlineCatalogEntry[]> {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return { ok: false, error: 'online catalog response is invalid' };
  }

  const entries = value.items.flatMap((row) => {
    const entry = mapOnlineRow(row);
    return entry ? [entry] : [];
  });

  if (entries.length === 0) {
    return { ok: false, error: 'online catalog has no supported GeoJSON, PNG, or MP4 datasets' };
  }
  return { ok: true, value: entries };
}

export type OnlineFileRecord = { path: string };

function authHeaders(settings: OnlineCatalogSettings): { Authorization: string } {
  return { Authorization: `Bearer ${settings.token}` };
}

function responseStatus(response: Response): string {
  return `${response.status} ${response.statusText}`.trim();
}

export async function fetchOnlineCatalog(settings: OnlineCatalogSettings): Promise<OnlineCatalogResult<OnlineCatalogEntry[]>> {
  try {
    const response = await fetch(fetchOnlineCatalogUrl(settings.baseUrl), { headers: authHeaders(settings) });
    if (!response.ok) {
      return { ok: false, error: `online catalog fetch failed (${responseStatus(response)})` };
    }
    return parseOnlineCatalogResponse(await response.json());
  } catch (err) {
    return { ok: false, error: `online catalog request failed: ${(err as Error).message}` };
  }
}

export function parseOnlineVersionDetailResponse(value: unknown): OnlineCatalogResult<OnlineFileRecord[]> {
  if (!isRecord(value) || !Array.isArray(value.files)) {
    return { ok: false, error: 'online version detail is missing files' };
  }
  const files: OnlineFileRecord[] = [];
  for (const raw of value.files) {
    if (!isRecord(raw) || typeof raw.path !== 'string' || raw.path.length === 0) continue;
    files.push({ path: raw.path });
  }
  return { ok: true, value: files };
}

export async function fetchOnlineVersionDetail(
  settings: OnlineCatalogSettings,
  entry: OnlineCatalogEntry
): Promise<OnlineCatalogResult<OnlineFileRecord[]>> {
  try {
    const response = await fetch(fetchOnlineVersionDetailUrl(settings.baseUrl, entry), { headers: authHeaders(settings) });
    if (!response.ok) {
      return { ok: false, error: `online version fetch failed (${responseStatus(response)})` };
    }
    return parseOnlineVersionDetailResponse(await response.json());
  } catch (err) {
    return { ok: false, error: `online catalog request failed: ${(err as Error).message}` };
  }
}

export async function fetchOnlineManifestText(
  settings: OnlineCatalogSettings,
  entry: OnlineCatalogEntry
): Promise<OnlineCatalogResult<string>> {
  try {
    const response = await fetch(fetchOnlineManifestUrl(settings.baseUrl, entry), { headers: authHeaders(settings) });
    if (!response.ok) {
      return { ok: false, error: `online manifest fetch failed (${responseStatus(response)})` };
    }
    return { ok: true, value: await response.text() };
  } catch (err) {
    return { ok: false, error: `online catalog request failed: ${(err as Error).message}` };
  }
}

export function findOnlineArtifactPath(files: OnlineFileRecord[], manifestFile: string): OnlineCatalogResult<string> {
  const match = files.find((file) => file.path === manifestFile);
  if (!match) {
    return { ok: false, error: `manifest references ${manifestFile}; online version does not include it` };
  }
  return { ok: true, value: match.path };
}

export async function fetchOnlineArtifactBlob(
  settings: OnlineCatalogSettings,
  entry: OnlineCatalogEntry,
  path: string
): Promise<OnlineCatalogResult<Blob>> {
  try {
    const response = await fetch(fetchOnlineArtifactUrl(settings.baseUrl, entry, path), { headers: authHeaders(settings) });
    if (!response.ok) {
      return { ok: false, error: `online artifact fetch failed (${responseStatus(response)})` };
    }
    return { ok: true, value: await response.blob() };
  } catch (err) {
    return { ok: false, error: `online catalog request failed: ${(err as Error).message}` };
  }
}
