import { describe, expect, it } from 'vitest';
import {
  isProjectorStatePublish as isClientProjectorStatePublish,
  isRemoteCommandInput as isClientRemoteCommandInput,
} from '../src/lib/remoteProtocol.ts';
import {
  isProjectorStatePublish as isServerProjectorStatePublish,
  isRemoteCommandInput as isServerRemoteCommandInput,
} from '../server/controlState.mjs';

const validState = {
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
  updatedAt: '2026-05-18T10:00:00.000Z',
};

describe('server/client protocol validator parity', () => {
  it('keeps projector state validation in sync', () => {
    const missingRevision = { ...validState };
    delete missingRevision.revision;
    const fixtures = [
      validState,
      { ...validState, projectorOnline: true },
      { ...validState, revision: 0 },
      { ...validState, step: 6 },
      { ...validState, dataset: { filename: 'sample.pdf', kind: 'pdf' } },
      { ...validState, samples: [{ id: 'sample', title: 'Sample', kind: 'pdf' }] },
      { ...validState, onlineDatasets: [{ id: 'online@v1', title: 'Online Slice', kind: 'geojson', format: 'pdf' }] },
      { ...validState, busy: true, busyReason: 'remoteSample' },
      { ...validState, busyReason: 'unknown' },
      missingRevision,
    ];

    for (const fixture of fixtures) {
      expect(isServerProjectorStatePublish(fixture)).toBe(isClientProjectorStatePublish(fixture));
    }
  });

  it('keeps remote command validation in sync', () => {
    const fixtures = [
      { clientCommandId: 'cmd-1', type: 'next' },
      { clientCommandId: 'cmd-2', type: 'selectSample', sampleId: 'sample-grid' },
      { clientCommandId: 'cmd-3', type: 'selectOnlineDataset', onlineDatasetId: 'online@v1' },
      { clientCommandId: 'cmd-4', type: 'setColor', color: '#E35A1D' },
      { clientCommandId: 'cmd-5', type: 'setColor', color: 'orange' },
      { clientCommandId: '', type: 'next' },
      { clientCommandId: 'cmd-6', type: 'selectOnlineDataset' },
    ];

    for (const fixture of fixtures) {
      expect(isServerRemoteCommandInput(fixture)).toBe(isClientRemoteCommandInput(fixture));
    }
  });
});
