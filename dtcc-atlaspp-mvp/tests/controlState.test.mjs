import { describe, expect, it } from 'vitest';
import { createControlState } from '../server/controlState.mjs';

function state(revision) {
  return {
    projectorSessionId: 'client-placeholder',
    revision,
    step: 1,
    dataset: null,
    nextDisabled: true,
    backHidden: true,
    samples: [],
    samplesLoaded: true,
    samplesError: null,
    busy: false,
    error: null,
    updatedAt: new Date(revision).toISOString(),
  };
}

function deterministicControl({ nowRef = { value: 0 } } = {}) {
  let token = 0;
  return createControlState({
    now: () => nowRef.value,
    randomDigits: () => '123456',
    randomToken: () => `token-${++token}`,
    remoteUrl: 'http://127.0.0.1:5175/remote',
  });
}

describe('controlState', () => {
  it('registers a projector and pairs one remote by PIN', () => {
    const control = deterministicControl();
    const registered = control.registerProjector({});
    const paired = control.pairRemote({ pin: '123456', ip: '127.0.0.1' });

    expect(registered).toEqual(expect.objectContaining({
      projectorSessionId: 'token-1',
      projectorToken: 'token-2',
      pin: '123456',
      remoteUrl: 'http://127.0.0.1:5175/remote',
    }));
    expect(paired).toEqual({ ok: true, value: { remoteToken: 'token-3' } });
  });

  it('rate-limits repeated invalid PIN attempts', () => {
    const nowRef = { value: 0 };
    const control = deterministicControl({ nowRef });
    control.registerProjector({});

    for (let i = 0; i < 5; i += 1) {
      expect(control.pairRemote({ pin: '000000', ip: '127.0.0.1' }).status).toBe(401);
    }
    expect(control.pairRemote({ pin: '123456', ip: '127.0.0.1' }).status).toBe(429);

    nowRef.value = 30001;
    expect(control.pairRemote({ pin: '123456', ip: '127.0.0.1' }).ok).toBe(true);
  });

  it('rejects stale state revisions with current revision details', () => {
    const control = deterministicControl();
    const registered = control.registerProjector({});

    expect(control.publishState({ token: registered.projectorToken, state: state(2) })).toEqual({ ok: true, acceptedRevision: 2 });
    expect(control.publishState({ token: registered.projectorToken, state: state(1) })).toEqual({
      ok: false,
      status: 409,
      acceptedRevision: 2,
      currentRevision: 2,
    });
  });

  it('deduplicates retried commands and prunes acknowledged commands', () => {
    const control = deterministicControl();
    const registered = control.registerProjector({});
    const paired = control.pairRemote({ pin: '123456', ip: '127.0.0.1' });
    if (!paired.ok) throw new Error('pair failed');

    const first = control.enqueueCommand({ token: paired.value.remoteToken, command: { clientCommandId: 'cmd-1', type: 'next' } });
    const retry = control.enqueueCommand({ token: paired.value.remoteToken, command: { clientCommandId: 'cmd-1', type: 'next' } });
    expect(first).toEqual(retry);

    expect(control.getCommands({ token: registered.projectorToken, after: 0 }).commands).toHaveLength(1);
    expect(control.getCommands({ token: registered.projectorToken, after: 1 }).commands).toHaveLength(0);
  });

  it('refuses unauthenticated replacement of a live projector session', () => {
    const control = deterministicControl();
    const registered = control.registerProjector({});
    control.publishState({ token: registered.projectorToken, state: state(1) });

    const blocked = control.registerProjector({});
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.status).toBe(409);

    const replaced = control.registerProjector({ previousProjectorToken: registered.projectorToken });
    expect(replaced.ok).not.toBe(false);
  });

  it('invalidates old remote tokens after projector re-registers', () => {
    const control = deterministicControl();
    const registered = control.registerProjector({});
    const paired = control.pairRemote({ pin: '123456', ip: '127.0.0.1' });
    if (!paired.ok) throw new Error('pair failed');

    control.publishState({ token: registered.projectorToken, state: state(1) });
    control.registerProjector({ previousProjectorToken: registered.projectorToken });

    const result = control.enqueueCommand({ token: paired.value.remoteToken, command: { clientCommandId: 'cmd-old', type: 'next' } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it('marks projector offline after three seconds without heartbeat', () => {
    const nowRef = { value: 0 };
    const control = deterministicControl({ nowRef });
    const registered = control.registerProjector({});
    control.publishState({ token: registered.projectorToken, state: state(1) });

    expect(control.getState({ token: registered.projectorToken }).state.projectorOnline).toBe(true);
    nowRef.value = 3001;
    expect(control.getState({ token: registered.projectorToken }).state.projectorOnline).toBe(false);
  });
});
