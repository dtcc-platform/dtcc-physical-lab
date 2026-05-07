import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadDataset,
  saveDataset,
  loadCalibration,
  saveCalibration,
  clearCalibration,
  datasetFitBbox,
  bboxEqual,
  type Dataset,
  type Calibration,
} from '../src/lib/storage';

beforeEach(() => {
  localStorage.clear();
});

describe('dataset', () => {
  const geojson = { type: 'FeatureCollection', features: [] } as any;
  const d: Dataset = {
    version: 3,
    filename: 'test.geojson',
    bounds: [319720, 6397660, 320220, 6398160],
    content: { kind: 'geojson', geojson, style: { color: '#38bdf8' } },
    uploadedAt: '2026-04-22T10:01:00.000Z',
  };

  it('round-trips a saved GeoJSON dataset', () => {
    saveDataset(d);
    expect(loadDataset()).toEqual(d);
  });

  it('round-trips a saved image dataset', () => {
    const image: Dataset = {
      version: 3,
      filename: 'smoke.png',
      bounds: [319720, 6397660, 320220, 6398160],
      uploadedAt: '2026-05-07T10:00:00.000Z',
      catalogId: 'smoke-image',
      title: 'Smoke Image',
      content: { kind: 'image', src: '/datasets/smoke.png', mediaType: 'image/png' },
    };
    saveDataset(image);
    expect(loadDataset()).toEqual(image);
  });

  it('round-trips a saved video dataset', () => {
    const video: Dataset = {
      version: 3,
      filename: 'smoke.mp4',
      bounds: [319720, 6397660, 320220, 6398160],
      uploadedAt: '2026-05-07T10:00:00.000Z',
      catalogId: 'smoke-video',
      description: 'Smoke animation',
      content: {
        kind: 'video',
        src: '/datasets/smoke.mp4',
        mediaType: 'video/mp4',
        muted: true,
        autoplay: true,
        loop: true,
      },
    };
    saveDataset(video);
    expect(loadDataset()).toEqual(video);
  });

  it('returns null when v3 bounds are malformed', () => {
    localStorage.setItem('dtcc-atlaspp-mvp.dataset', JSON.stringify({ ...d, bounds: [1, 2, 3] }));
    expect(loadDataset()).toBeNull();
  });

  it('returns null when v3 bounds contain non-finite numbers', () => {
    localStorage.setItem('dtcc-atlaspp-mvp.dataset', JSON.stringify({ ...d, bounds: [1, 2, 3, Infinity] }));
    expect(loadDataset()).toBeNull();
  });

  it('returns null when v3 content is missing', () => {
    const partial = { ...d } as Record<string, unknown>;
    delete partial.content;
    localStorage.setItem('dtcc-atlaspp-mvp.dataset', JSON.stringify(partial));
    expect(loadDataset()).toBeNull();
  });

  it('returns null when a GeoJSON content style color is missing', () => {
    const partial = { ...d, content: { kind: 'geojson', geojson, style: {} } } as any;
    localStorage.setItem('dtcc-atlaspp-mvp.dataset', JSON.stringify(partial));
    expect(loadDataset()).toBeNull();
  });

  it('returns null when image content mediaType is missing', () => {
    const partial = { ...d, content: { kind: 'image', src: '/datasets/a.png' } } as any;
    localStorage.setItem('dtcc-atlaspp-mvp.dataset', JSON.stringify(partial));
    expect(loadDataset()).toBeNull();
  });

  it('returns null when image content mediaType is wrong', () => {
    const partial = { ...d, content: { kind: 'image', src: '/datasets/a.png', mediaType: 'video/mp4' } } as any;
    localStorage.setItem('dtcc-atlaspp-mvp.dataset', JSON.stringify(partial));
    expect(loadDataset()).toBeNull();
  });

  it('returns null when video content autoplay flags are malformed', () => {
    const partial = {
      ...d,
      content: { kind: 'video', src: '/datasets/a.mp4', mediaType: 'video/mp4', muted: true, autoplay: true, loop: 'yes' },
    } as any;
    localStorage.setItem('dtcc-atlaspp-mvp.dataset', JSON.stringify(partial));
    expect(loadDataset()).toBeNull();
  });

  it('returns null when optional catalogId is not a string', () => {
    localStorage.setItem('dtcc-atlaspp-mvp.dataset', JSON.stringify({ ...d, catalogId: 42 }));
    expect(loadDataset()).toBeNull();
  });

  it('returns null when not set', () => {
    expect(loadDataset()).toBeNull();
  });

  it('migrates a v2 catalog dataset projectionBbox to v3 bounds', () => {
    const old = {
      version: 2,
      filename: 'old.geojson',
      geojson,
      style: { color: '#38bdf8' },
      uploadedAt: '2026-04-22T10:00:00.000Z',
      projectionBbox: [316385.555, 6397546.957, 322614.029, 6403932.781],
      catalogId: 'old-catalog',
    };
    localStorage.setItem('dtcc-atlaspp-mvp.dataset', JSON.stringify(old));
    expect(loadDataset()).toEqual({
      version: 3,
      filename: 'old.geojson',
      uploadedAt: '2026-04-22T10:00:00.000Z',
      bounds: [316385.555, 6397546.957, 322614.029, 6403932.781],
      catalogId: 'old-catalog',
      content: { kind: 'geojson', geojson, style: { color: '#38bdf8' } },
    });
  });

  it('migrates a v2 drag/drop dataset by deriving bounds from feature coordinates', () => {
    const oldGeojson = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [319950, 6398000] }, properties: {} },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [320050, 6398050] }, properties: {} },
      ],
    };
    localStorage.setItem(
      'dtcc-atlaspp-mvp.dataset',
      JSON.stringify({
        version: 2,
        filename: 'old.geojson',
        geojson: oldGeojson,
        style: { color: '#38bdf8' },
        uploadedAt: '2026-04-22T10:00:00.000Z',
      }),
    );
    expect(loadDataset()).toEqual({
      version: 3,
      filename: 'old.geojson',
      uploadedAt: '2026-04-22T10:00:00.000Z',
      bounds: [319950, 6398000, 320050, 6398050],
      content: { kind: 'geojson', geojson: oldGeojson, style: { color: '#38bdf8' } },
    });
  });

  it('returns null when a v2 dataset has no derivable bounds', () => {
    localStorage.setItem(
      'dtcc-atlaspp-mvp.dataset',
      JSON.stringify({
        version: 2,
        filename: 'empty.geojson',
        geojson,
        style: { color: '#38bdf8' },
        uploadedAt: '2026-04-22T10:00:00.000Z',
      }),
    );
    expect(loadDataset()).toBeNull();
  });
});

describe('bbox helpers', () => {
  const dataset: Dataset = {
    version: 3,
    filename: 'bbox.geojson',
    bounds: [319720, 6397660, 320220, 6398160],
    content: { kind: 'geojson', geojson: { type: 'FeatureCollection', features: [] } as any, style: { color: '#38bdf8' } },
    uploadedAt: '2026-05-04T10:00:00.000Z',
  };

  it('datasetFitBbox returns dataset bounds', () => {
    expect(datasetFitBbox(dataset)).toEqual([319720, 6397660, 320220, 6398160]);
  });

  it('bboxEqual uses tuple-exact equality and requires both sides', () => {
    const a = [1, 2, 3, 4] as [number, number, number, number];
    expect(bboxEqual(a, [1, 2, 3, 4])).toBe(true);
    expect(bboxEqual(a, [1, 2, 3, 4.000001])).toBe(false);
    expect(bboxEqual(undefined, a)).toBe(false);
    expect(bboxEqual(a, undefined)).toBe(false);
  });
});

describe('calibration', () => {
  const c: Calibration = {
    version: 2,
    panX: 5,
    panY: -10,
    cornerDst: [[100, 100], [900, 110], [905, 700], [110, 695]],
    homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    sourceWidth: 1920,
    sourceHeight: 1080,
    savedAt: '2026-04-26T12:00:00.000Z',
  };

  it('round-trips a saved calibration', () => {
    saveCalibration(c);
    expect(loadCalibration()).toEqual(c);
  });

  it('returns null when not set', () => {
    expect(loadCalibration()).toBeNull();
  });

  it('returns null on version mismatch', () => {
    localStorage.setItem('dtcc-atlaspp-mvp.calibration', JSON.stringify({ ...c, version: 99 }));
    expect(loadCalibration()).toBeNull();
  });

  it('returns null when homography is the wrong length', () => {
    localStorage.setItem('dtcc-atlaspp-mvp.calibration', JSON.stringify({ ...c, homography: [1, 0, 0] }));
    expect(loadCalibration()).toBeNull();
  });

  it('returns null when cornerDst is malformed', () => {
    localStorage.setItem('dtcc-atlaspp-mvp.calibration', JSON.stringify({ ...c, cornerDst: [[1, 2], [3, 4]] }));
    expect(loadCalibration()).toBeNull();
  });

  it('clearCalibration removes the stored value', () => {
    saveCalibration(c);
    clearCalibration();
    expect(loadCalibration()).toBeNull();
  });
});

describe('old storage versions', () => {
  it('a v1 dataset blob in localStorage is rejected by loadDataset', () => {
    localStorage.setItem(
      'dtcc-atlaspp-mvp.dataset',
      JSON.stringify({
        version: 1,
        filename: 'old.geojson',
        geojson: { type: 'FeatureCollection', features: [] },
        style: { color: '#38bdf8' },
        uploadedAt: '2026-04-22T10:00:00.000Z',
      }),
    );
    expect(loadDataset()).toBeNull();
  });

  it('a v1 calibration blob in localStorage is rejected by loadCalibration', () => {
    localStorage.setItem(
      'dtcc-atlaspp-mvp.calibration',
      JSON.stringify({
        version: 1,
        panX: 0,
        panY: 0,
        cornerDst: [[0, 0], [10, 0], [10, 10], [0, 10]],
        homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        sourceWidth: 100,
        sourceHeight: 100,
        savedAt: '2026-04-22T10:00:00.000Z',
      }),
    );
    expect(loadCalibration()).toBeNull();
  });
});
