import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearOnlineCatalogSettings,
  fetchOnlineArtifactUrl,
  fetchOnlineCatalogUrl,
  fetchOnlineManifestUrl,
  fetchOnlineVersionDetailUrl,
  loadOnlineCatalogSettings,
  normalizeOnlineBaseUrl,
  parseOnlineCatalogResponse,
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

const baseRow = {
  dataset_key: 'smoke-slice',
  owner_principal_id: 'vasnas',
  latest_committed_version_id: 'v1',
  version_id: 'v1',
  version_number: 1,
  status: 'committed',
  product: 'slice',
  title: 'Smoke Slice',
  bounds_json: '[0.0, 0.0, 1.0, 1.0]',
  total_bytes: 28,
  file_count: 1,
  committed_at: '2026-05-13 12:00:00',
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

describe('parseOnlineCatalogResponse', () => {
  it('maps supported GeoJSON, PNG, and MP4 rows', () => {
    const result = parseOnlineCatalogResponse({
      items: [
        { ...baseRow, format: 'geojson', media_type: 'application/geo+json', data_kind: 'vector' },
        {
          ...baseRow,
          dataset_key: 'smoke-png',
          version_id: 'v2',
          format: 'png',
          media_type: 'image/png',
          data_kind: 'raster',
        },
        {
          ...baseRow,
          dataset_key: 'smoke-mp4',
          version_id: 'v3',
          format: 'mp4',
          media_type: 'video/mp4',
          data_kind: 'video',
        },
      ],
      next_cursor: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((mapped) => [mapped.id, mapped.kind, mapped.format, mapped.mediaType])).toEqual([
      ['smoke-slice@v1', 'geojson', 'geojson', 'application/geo+json'],
      ['smoke-png@v2', 'image', 'png', 'image/png'],
      ['smoke-mp4@v3', 'video', 'mp4', 'video/mp4'],
    ]);
    expect(result.value[0].bounds).toEqual([0, 0, 1, 1]);
    expect(result.value[0].totalBytes).toBe(28);
    expect(result.value[0].fileCount).toBe(1);
  });

  it('filters unsupported formats and rows with unusable bounds', () => {
    const result = parseOnlineCatalogResponse({
      items: [
        { ...baseRow, dataset_key: 'vtu', format: 'vtu', media_type: 'model/vtu', data_kind: 'mesh' },
        {
          ...baseRow,
          dataset_key: 'bad-bounds',
          format: 'geojson',
          media_type: 'application/geo+json',
          data_kind: 'vector',
          bounds_json: '[0, 1]',
        },
        {
          ...baseRow,
          dataset_key: 'nan-bounds',
          format: 'geojson',
          media_type: 'application/geo+json',
          data_kind: 'vector',
          bounds_json: '[0, 1, 2, null]',
        },
        { ...baseRow, dataset_key: 'good', format: 'geojson', media_type: 'application/json', data_kind: 'vector' },
      ],
      next_cursor: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((mapped) => mapped.datasetKey)).toEqual(['good']);
  });

  it('returns an empty supported-list error when no supported rows remain', () => {
    const result = parseOnlineCatalogResponse({
      items: [{ ...baseRow, format: 'pb', media_type: 'application/octet-stream', data_kind: 'binary' }],
      next_cursor: null,
    });

    expect(result).toEqual({
      ok: false,
      error: 'online catalog has no supported GeoJSON, PNG, or MP4 datasets',
    });
  });

  it('rejects malformed catalog response shapes', () => {
    expect(parseOnlineCatalogResponse({ items: 'nope' })).toEqual({
      ok: false,
      error: 'online catalog response is invalid',
    });
  });
});
