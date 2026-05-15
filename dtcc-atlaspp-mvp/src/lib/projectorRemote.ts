import type { ProjectorRegisterResponse, ProjectorStatePublish, QueuedRemoteCommand } from './remoteProtocol';

const PROJECTOR_TOKEN_KEY = 'dtcc-atlaspp-mvp.projectorToken';

export type ProjectorRemoteStatus = {
  projectorSessionId: string;
  token: string;
  pin: string;
  pinExpiresAt: string;
  remoteUrl: string;
};

export function createProjectorRemote({
  getState,
  onCommand,
  onStatus = () => {},
}: {
  getState: () => ProjectorStatePublish;
  onCommand: (command: QueuedRemoteCommand) => void | Promise<void>;
  onStatus?: (status: ProjectorRemoteStatus | null) => void;
}) {
  let status: ProjectorRemoteStatus | null = null;
  let lastAppliedCommandId = 0;
  let registering: Promise<ProjectorRemoteStatus> | null = null;

  function disconnect() {
    sessionStorage.removeItem(PROJECTOR_TOKEN_KEY);
    status = null;
    lastAppliedCommandId = 0;
    onStatus(null);
  }

  async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(url, init);
    if (!response.ok) throw new Error(`remote control request failed (${response.status})`);
    return response.json() as Promise<T>;
  }

  async function register() {
    if (registering) return registering;
    registering = (async () => {
      const previousProjectorToken = sessionStorage.getItem(PROJECTOR_TOKEN_KEY) ?? undefined;
      const registered = await request<ProjectorRegisterResponse>('/api/projector/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ previousProjectorToken }),
      });
      sessionStorage.setItem(PROJECTOR_TOKEN_KEY, registered.projectorToken);
      status = {
        projectorSessionId: registered.projectorSessionId,
        token: registered.projectorToken,
        pin: registered.pin,
        pinExpiresAt: registered.pinExpiresAt,
        remoteUrl: registered.remoteUrl,
      };
      lastAppliedCommandId = 0;
      onStatus(status);
      return status;
    })();
    try {
      return await registering;
    } finally {
      registering = null;
    }
  }

  async function publishStateOnce() {
    if (!status) await register();
    const state = getState();
    let response: Response;
    try {
      response = await fetch('/api/state', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${status!.token}` },
        body: JSON.stringify(state),
      });
    } catch (err) {
      disconnect();
      throw err;
    }
    if (response.status === 401 || response.status === 404) {
      disconnect();
      await register();
      return;
    }
    if (!response.ok && response.status !== 409) throw new Error(`state publish failed (${response.status})`);
  }

  async function pollCommandsOnce() {
    if (!status) await register();
    let response: { commands: QueuedRemoteCommand[] };
    try {
      response = await request<{ commands: QueuedRemoteCommand[] }>(`/api/commands?after=${lastAppliedCommandId}`, {
        headers: { authorization: `Bearer ${status!.token}` },
      });
    } catch (err) {
      disconnect();
      throw err;
    }
    for (const command of response.commands) {
      await onCommand(command);
      lastAppliedCommandId = command.id;
      // Publish immediately after command execution; App's reactive publish may also report the resulting state.
      await publishStateOnce();
    }
  }

  function isRegistered() {
    return status !== null;
  }

  return { register, publishStateOnce, pollCommandsOnce, isRegistered, disconnect };
}
