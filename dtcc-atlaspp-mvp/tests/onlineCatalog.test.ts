import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearOnlineCatalogSettings,
  fetchOnlineArtifactUrl,
  fetchOnlineCatalogUrl,
  fetchOnlineManifestUrl,
  fetchOnlineVersionDetailUrl,
  loadOnlineCatalogSettings,
  normalizeOnlineBaseUrl,
  saveOnlineCatalogSettings,
  type OnlineCatalogEntry,
} from '../src/lib/onlineCatalog';

const entry: OnlineCatalogEntry = {
  id: 'smoke/slice@v 1',
  datasetKey: 'smoke/slice',
  versionId: 'v 1',
  title: 'Smoke Slice',
  bounds: [0, 0, 1, 1],
  kind: 'geojson',
  format: 'geojson',
  mediaType: 'application/geo+json',
};

describe('online catalog settings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips saved settings under namespaced keys', () => {
    saveOnlineCatalogSettings({ baseUrl: 'http://127.0.0.1:8000', token: 'browser-token' });

    expect(localStorage.getItem('dtcc-atlaspp-mvp.onlineCatalog.baseUrl')).toBe('http://127.0.0.1:8000');
    expect(localStorage.getItem('dtcc-atlaspp-mvp.onlineCatalog.token')).toBe('browser-token');
    expect(loadOnlineCatalogSettings()).toEqual({
      baseUrl: 'http://127.0.0.1:8000',
      token: 'browser-token',
    });
  });

  it('clears saved settings', () => {
    saveOnlineCatalogSettings({ baseUrl: 'http://127.0.0.1:8000', token: 'browser-token' });

    clearOnlineCatalogSettings();

    expect(loadOnlineCatalogSettings()).toEqual({ baseUrl: '', token: '' });
  });
});

describe('online catalog URLs', () => {
  it('normalizes a valid base URL by trimming and removing trailing slashes', () => {
    expect(normalizeOnlineBaseUrl('  http://127.0.0.1:8000///  ')).toEqual({
      ok: true,
      value: 'http://127.0.0.1:8000',
    });
  });

  it('rejects invalid base URLs', () => {
    expect(normalizeOnlineBaseUrl('not a url')).toEqual({
      ok: false,
      error: 'online catalog URL is invalid',
    });
  });

  it('builds browse, detail, and manifest URLs with encoded dataset keys and version IDs', () => {
    const baseUrl = 'http://127.0.0.1:8000';

    expect(fetchOnlineCatalogUrl(baseUrl).href).toBe('http://127.0.0.1:8000/v1/datasets?limit=100');
    expect(fetchOnlineVersionDetailUrl(baseUrl, entry).href).toBe(
      'http://127.0.0.1:8000/v1/datasets/smoke%2Fslice/versions/v%201'
    );
    expect(fetchOnlineManifestUrl(baseUrl, entry).href).toBe(
      'http://127.0.0.1:8000/v1/datasets/smoke%2Fslice/versions/v%201/manifest'
    );
  });

  it('preserves path-prefixed base URLs', () => {
    expect(fetchOnlineCatalogUrl('https://example.com/api').href).toBe('https://example.com/api/v1/datasets?limit=100');
  });

  it('encodes artifact paths per segment without collapsing slashes to %2F', () => {
    expect(fetchOnlineArtifactUrl('http://127.0.0.1:8000', entry, 'media/smoke slice.geojson').href).toBe(
      'http://127.0.0.1:8000/v1/datasets/smoke%2Fslice/versions/v%201/files/media/smoke%20slice.geojson'
    );
  });
});
