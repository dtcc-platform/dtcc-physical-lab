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
