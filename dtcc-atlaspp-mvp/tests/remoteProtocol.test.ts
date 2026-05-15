import { describe, expect, it } from 'vitest';
import { isHexColor, isProjectorStatePublish, isRemoteCommandInput } from '../src/lib/remoteProtocol';

const baseState = {
  projectorSessionId: 'projector-1',
  revision: 1,
  step: 2,
  dataset: { filename: 'sample.geojson', title: 'Sample', catalogId: 'sample', kind: 'geojson' },
  nextDisabled: false,
  backHidden: false,
  color: '#38bdf8',
  samples: [{ id: 'sample', title: 'Sample', kind: 'geojson' }],
  samplesLoaded: true,
  samplesError: null,
  onlineDatasets: [{ id: 'online@v1', title: 'Online Slice', kind: 'geojson', format: 'geojson' }],
  busy: false,
  error: null,
  updatedAt: '2026-05-15T10:00:00.000Z',
};

describe('remoteProtocol', () => {
  it('accepts projector state publish payloads without server-injected fields', () => {
    expect(isProjectorStatePublish(baseState)).toBe(true);
  });

  it('rejects server-injected fields in projector publish payloads', () => {
    expect(isProjectorStatePublish({ ...baseState, projectorOnline: true })).toBe(false);
    expect(isProjectorStatePublish({ ...baseState, remoteConnected: true })).toBe(false);
    expect(isProjectorStatePublish({ ...baseState, projectorLastSeenAt: baseState.updatedAt })).toBe(false);
  });

  it('requires bounded sample and busy metadata', () => {
    expect(isProjectorStatePublish({ ...baseState, samplesLoaded: false, samplesError: 'catalog failed' })).toBe(true);
    expect(isProjectorStatePublish({ ...baseState, busy: true, busyReason: 'remoteSample' })).toBe(true);
    expect(isProjectorStatePublish({ ...baseState, samples: [{ id: 'sample', title: 'Sample', kind: 'pdf' }] })).toBe(false);
    expect(isProjectorStatePublish({ ...baseState, onlineDatasets: [{ id: 'online@v1', title: 'Online Slice', kind: 'geojson', format: 'pdf' }] })).toBe(false);
    expect(isProjectorStatePublish({ ...baseState, busyReason: 'unknown' })).toBe(false);
  });

  it('validates command inputs and hex colors', () => {
    expect(isHexColor('#38bdf8')).toBe(true);
    expect(isHexColor('38bdf8')).toBe(false);
    expect(isRemoteCommandInput({ clientCommandId: 'cmd-1', type: 'next' })).toBe(true);
    expect(isRemoteCommandInput({ clientCommandId: 'cmd-2', type: 'selectSample', sampleId: 'sample-grid' })).toBe(true);
    expect(isRemoteCommandInput({ clientCommandId: 'cmd-3', type: 'selectOnlineDataset', onlineDatasetId: 'online@v1' })).toBe(true);
    expect(isRemoteCommandInput({ clientCommandId: 'cmd-4', type: 'setColor', color: '#E35A1D' })).toBe(true);
    expect(isRemoteCommandInput({ clientCommandId: 'cmd-5', type: 'setColor', color: 'orange' })).toBe(false);
    expect(isRemoteCommandInput({ clientCommandId: '', type: 'next' })).toBe(false);
  });
});
