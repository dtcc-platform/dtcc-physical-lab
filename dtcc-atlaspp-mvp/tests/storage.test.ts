import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadDataset,
  saveDataset,
  loadCalibration,
  saveCalibration,
  clearCalibration,
  loadStartupDefaults,
  saveStartupDefaults,
  clearStartupDefaults,
  resolveStartup,
  initStartup,
  datasetFitBbox,
  bboxEqual,
  type Dataset,
  type Calibration,
  type StartupDefaults,
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

describe('startup defaults', () => {
  const geojson = { type: 'FeatureCollection', features: [] } as any;
  const dataset: Dataset = {
    version: 3,
    filename: 'default.geojson',
    bounds: [319720, 6397660, 320220, 6398160],
    content: { kind: 'geojson', geojson, style: { color: '#38bdf8' } },
    uploadedAt: '2026-06-01T10:00:00.000Z',
  };
  const calibration: Calibration = {
    version: 2,
    panX: 5,
    panY: -10,
    cornerDst: [[100, 100], [900, 110], [905, 700], [110, 695]],
    homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    sourceWidth: 1920,
    sourceHeight: 1080,
    savedAt: '2026-06-01T10:00:00.000Z',
  };
  const defaults: StartupDefaults = {
    version: 1,
    dataset,
    calibration,
    savedAt: '2026-06-01T10:05:00.000Z',
  };

  it('round-trips saved startup defaults', () => {
    saveStartupDefaults(defaults);
    expect(loadStartupDefaults()).toEqual(defaults);
  });

  it('returns null when not set', () => {
    expect(loadStartupDefaults()).toBeNull();
  });

  it('returns null when the embedded dataset is corrupt', () => {
    localStorage.setItem(
      'dtcc-atlaspp-mvp.startupDefaults',
      JSON.stringify({ ...defaults, dataset: { ...dataset, bounds: [1, 2, 3] } }),
    );
    expect(loadStartupDefaults()).toBeNull();
  });

  it('returns null when the embedded calibration is corrupt', () => {
    localStorage.setItem(
      'dtcc-atlaspp-mvp.startupDefaults',
      JSON.stringify({ ...defaults, calibration: { ...calibration, homography: [1, 0] } }),
    );
    expect(loadStartupDefaults()).toBeNull();
  });

  it('survives Clear of the live dataset and calibration keys', () => {
    saveStartupDefaults(defaults);
    clearCalibration();
    localStorage.removeItem('dtcc-atlaspp-mvp.dataset');
    expect(loadStartupDefaults()).toEqual(defaults);
  });

  it('clearStartupDefaults removes the stored value', () => {
    saveStartupDefaults(defaults);
    clearStartupDefaults();
    expect(loadStartupDefaults()).toBeNull();
  });

  describe('resolveStartup precedence (soft semantics)', () => {
    it('last-session state wins over defaults and resumes the projection', () => {
      const last = { ...dataset, filename: 'last.geojson' };
      const result = resolveStartup(last, calibration, defaults);
      expect(result).toEqual({ dataset: last, calibration, step: 5, fromDefaults: false });
    });

    it('a complete last session resumes the projection without any defaults', () => {
      const result = resolveStartup(dataset, calibration, null);
      expect(result).toEqual({ dataset, calibration, step: 5, fromDefaults: false });
    });

    it('an incomplete last session continues the wizard even when defaults exist', () => {
      const last = { ...dataset, filename: 'in-progress.geojson' };
      const result = resolveStartup(last, null, defaults);
      expect(result).toEqual({ dataset: last, calibration: null, step: 1, fromDefaults: false });
    });

    it('defaults fill the gap when no last-session dataset exists', () => {
      const result = resolveStartup(null, null, defaults);
      expect(result).toEqual({ dataset, calibration, step: 5, fromDefaults: true });
    });

    it('defaults also win over a calibration-only orphan session', () => {
      const result = resolveStartup(null, calibration, defaults);
      expect(result).toEqual({ dataset, calibration, step: 5, fromDefaults: true });
    });

    it('a calibration-only orphan without defaults starts the wizard', () => {
      const result = resolveStartup(null, calibration, null);
      expect(result).toEqual({ dataset: null, calibration, step: 1, fromDefaults: false });
    });

    it('starts the calibration wizard when nothing is saved', () => {
      expect(resolveStartup(null, null, null)).toEqual({
        dataset: null,
        calibration: null,
        step: 1,
        fromDefaults: false,
      });
    });
  });

  describe('initStartup live-key reconciliation', () => {
    it('materializes a defaults boot into the live keys', () => {
      saveStartupDefaults(defaults);

      const result = initStartup();

      expect(result.step).toBe(5);
      expect(result.dataset).toEqual(dataset);
      // A defaults boot must be indistinguishable from a resumed session, so
      // later partial writes (recolor, recalibrate) can't strand half-state.
      expect(loadDataset()).toEqual(dataset);
      expect(loadCalibration()).toEqual(calibration);
    });

    it('leaves the live keys untouched when a last session exists', () => {
      const last = { ...dataset, filename: 'last.geojson' };
      const lastCalibration = { ...calibration, panX: 99 };
      saveDataset(last);
      saveCalibration(lastCalibration);
      saveStartupDefaults(defaults);

      const result = initStartup();

      expect(result.dataset).toEqual(last);
      expect(loadDataset()).toEqual(last);
      expect(loadCalibration()).toEqual(lastCalibration);
    });

    it('replaces a stale calibration-only orphan when defaults boot', () => {
      const stale = { ...calibration, panX: -777 };
      saveCalibration(stale);
      saveStartupDefaults(defaults);

      const result = initStartup();

      expect(result.calibration).toEqual(calibration);
      expect(loadCalibration()).toEqual(calibration);
    });

    it('writes nothing when there is nothing to boot from', () => {
      const result = initStartup();

      expect(result).toEqual({ dataset: null, calibration: null, step: 1, fromDefaults: false });
      expect(loadDataset()).toBeNull();
      expect(loadCalibration()).toBeNull();
    });
  });

  it('round-trips startup defaults with media dataset content', () => {
    const media: StartupDefaults = {
      ...defaults,
      dataset: {
        ...dataset,
        filename: 'smoke.png',
        content: { kind: 'image', src: '/datasets/smoke.png', mediaType: 'image/png' },
      },
    };
    saveStartupDefaults(media);
    expect(loadStartupDefaults()).toEqual(media);
  });

  it('migrates an embedded v2 dataset inside startup defaults', () => {
    const v2dataset = {
      version: 2,
      filename: 'old.geojson',
      geojson,
      style: { color: '#38bdf8' },
      uploadedAt: '2026-04-22T10:00:00.000Z',
      projectionBbox: [316385.555, 6397546.957, 322614.029, 6403932.781],
    };
    localStorage.setItem(
      'dtcc-atlaspp-mvp.startupDefaults',
      JSON.stringify({ ...defaults, dataset: v2dataset }),
    );
    expect(loadStartupDefaults()?.dataset).toEqual({
      version: 3,
      filename: 'old.geojson',
      uploadedAt: '2026-04-22T10:00:00.000Z',
      bounds: [316385.555, 6397546.957, 322614.029, 6403932.781],
      content: { kind: 'geojson', geojson, style: { color: '#38bdf8' } },
    });
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
