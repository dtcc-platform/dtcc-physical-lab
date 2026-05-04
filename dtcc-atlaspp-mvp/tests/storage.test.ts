import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadDataset,
  saveDataset,
  loadCalibration,
  saveCalibration,
  clearCalibration,
  type Dataset,
  type Calibration,
} from '../src/lib/storage';

beforeEach(() => {
  localStorage.clear();
});

describe('dataset', () => {
  const d: Dataset = {
    version: 2,
    filename: 'test.geojson',
    geojson: { type: 'FeatureCollection', features: [] } as any,
    style: { color: '#38bdf8' },
    uploadedAt: '2026-04-22T10:01:00.000Z',
  };

  it('round-trips a saved dataset', () => {
    saveDataset(d);
    expect(loadDataset()).toEqual(d);
  });

  it('returns null when not set', () => {
    expect(loadDataset()).toBeNull();
  });

  it('returns null when style.color is missing', () => {
    const partial = { ...d, style: {} } as any;
    localStorage.setItem('dtcc-atlaspp-mvp.dataset', JSON.stringify(partial));
    expect(loadDataset()).toBeNull();
  });

  it('returns null when geojson is not an object', () => {
    const partial = { ...d, geojson: null } as any;
    localStorage.setItem('dtcc-atlaspp-mvp.dataset', JSON.stringify(partial));
    expect(loadDataset()).toBeNull();
  });

  it('returns null when geojson.type is not FeatureCollection', () => {
    const partial = { ...d, geojson: { type: 'Feature', features: [] } } as any;
    localStorage.setItem('dtcc-atlaspp-mvp.dataset', JSON.stringify(partial));
    expect(loadDataset()).toBeNull();
  });

  it('returns null when geojson.features is missing', () => {
    const partial = { ...d, geojson: { type: 'FeatureCollection' } } as any;
    localStorage.setItem('dtcc-atlaspp-mvp.dataset', JSON.stringify(partial));
    expect(loadDataset()).toBeNull();
  });

  it('returns null when geojson.features is not an array', () => {
    const partial = { ...d, geojson: { type: 'FeatureCollection', features: null } } as any;
    localStorage.setItem('dtcc-atlaspp-mvp.dataset', JSON.stringify(partial));
    expect(loadDataset()).toBeNull();
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

describe('migration: version 1 → 2', () => {
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
