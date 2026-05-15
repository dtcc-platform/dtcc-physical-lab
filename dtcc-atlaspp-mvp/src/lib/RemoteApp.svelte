<script lang="ts">
  import { onMount } from 'svelte';
  import type { PairingResponse, ProjectorState, RemoteCommandInput } from './remoteProtocol';

  const REMOTE_TOKEN_KEY = 'dtcc-atlaspp-mvp.remoteToken';

  let pin = $state('');
  let token = $state(sessionStorage.getItem(REMOTE_TOKEN_KEY) ?? '');
  let state = $state<ProjectorState | null>(null);
  let error = $state<string | null>(null);
  let commandInFlight = $state<RemoteCommandInput['type'] | null>(null);

  onMount(() => {
    if (token) void pollState();
    const stateTimer = window.setInterval(() => {
      void pollState();
    }, 1000);
    return () => window.clearInterval(stateTimer);
  });

  function clearToken() {
    sessionStorage.removeItem(REMOTE_TOKEN_KEY);
    token = '';
    state = null;
  }

  async function pair(e: Event) {
    e.preventDefault();
    error = null;
    let response: Response;
    try {
      response = await fetch('/api/pairing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
    } catch {
      error = 'Pairing failed';
      return;
    }
    if (!response.ok) {
      error = 'Invalid or expired PIN';
      return;
    }
    const result = await response.json() as PairingResponse;
    token = result.remoteToken;
    sessionStorage.setItem(REMOTE_TOKEN_KEY, token);
    await pollState();
  }

  async function pollState() {
    if (!token) return;
    const response = await fetch('/api/state', { headers: { authorization: `Bearer ${token}` } });
    if (response.status === 401) {
      clearToken();
      return;
    }
    if (!response.ok) return;
    const result = await response.json() as { state: ProjectorState };
    if (state && result.state.projectorSessionId !== state.projectorSessionId) {
      clearToken();
      return;
    }
    state = result.state;
  }

  function clientCommandId() {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  async function postCommand(command: Omit<RemoteCommandInput, 'clientCommandId'>) {
    if (!token || commandInFlight === command.type) return;
    commandInFlight = command.type;
    error = null;
    try {
      const body = { clientCommandId: clientCommandId(), ...command };
      const response = await fetch('/api/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        let message = 'Command failed';
        try {
          const responseBody = await response.json();
          if (typeof responseBody.error === 'string') message = responseBody.error;
        } catch {
          // Keep the generic message when the server did not return JSON.
        }
        error = message;
      }
      await pollState();
    } finally {
      if (commandInFlight === command.type) commandInFlight = null;
    }
  }
</script>

<main class="min-h-screen bg-dtcc-gray-light text-dtcc-dark p-4">
  <section class="mx-auto max-w-md bg-white rounded-lg shadow p-4">
    <h1 class="text-base font-semibold mb-3">Atlas++ Remote</h1>

    {#if !token}
      <form onsubmit={pair} class="space-y-3">
        <label class="block text-sm font-medium" for="remote-pin">PIN</label>
        <input
          id="remote-pin"
          class="w-full rounded border border-dtcc-border px-3 py-2 text-lg"
          inputmode="numeric"
          value={pin}
          oninput={(e) => (pin = (e.currentTarget as HTMLInputElement).value)}
        />
        <button type="submit" class="w-full rounded bg-dtcc-orange px-3 py-2 text-white font-medium">Pair</button>
        {#if error}
          <p class="text-sm text-red-700">{error}</p>
        {/if}
      </form>
    {:else if state}
      <div class="text-sm mb-3">
        <div>{state.projectorOnline ? 'Projector online' : 'Projector offline'}</div>
        <div>Step {state.step} / 5</div>
        <div>{state.dataset?.title ?? state.dataset?.filename ?? 'No dataset loaded'}</div>
      </div>

      {#if state.error || error}
        <p class="mb-3 text-sm text-red-700">{state.error ?? error}</p>
      {/if}

      <div class="grid grid-cols-3 gap-2 mb-3">
        <button data-command="back" class="rounded bg-dtcc-gray-light px-3 py-2 disabled:opacity-40" disabled={state.backHidden || commandInFlight === 'back' || !state.projectorOnline} onclick={() => postCommand({ type: 'back' })}>Back</button>
        <button data-command="next" class="rounded bg-dtcc-orange px-3 py-2 text-white disabled:opacity-40" disabled={state.nextDisabled || commandInFlight === 'next' || !state.projectorOnline} onclick={() => postCommand({ type: 'next' })}>Next</button>
        <button data-command="clear" class="rounded bg-dtcc-gray-light px-3 py-2 disabled:opacity-40" disabled={commandInFlight === 'clear' || !state.projectorOnline} onclick={() => postCommand({ type: 'clear' })}>Clear</button>
      </div>

      {#if !state.samplesLoaded}
        <p class="text-sm text-dtcc-muted">Loading samples...</p>
      {:else if state.samplesError}
        <p class="text-sm text-red-700">{state.samplesError}</p>
      {:else if state.samples.length === 0 && state.dataset === null}
        <p class="text-sm text-dtcc-muted">No bundled samples available</p>
      {:else}
        <label class="block text-sm font-medium mb-1" for="remote-sample">Sample</label>
        <select
          id="remote-sample"
          class="w-full rounded border border-dtcc-border px-2 py-2 mb-3"
          value={state.dataset?.catalogId ?? ''}
          disabled={commandInFlight === 'selectSample' || !state.projectorOnline}
          onchange={(e) => postCommand({ type: 'selectSample', sampleId: (e.currentTarget as HTMLSelectElement).value })}
        >
          <option value="">Select sample...</option>
          {#each state.samples as sample}
            <option value={sample.id}>{sample.title}</option>
          {/each}
        </select>
      {/if}

      {#if state.dataset?.kind === 'geojson' && state.color}
        <label class="block text-sm font-medium mb-1" for="remote-color">Color</label>
        <input
          id="remote-color"
          type="color"
          value={state.color}
          disabled={commandInFlight === 'setColor' || !state.projectorOnline}
          onchange={(e) => postCommand({ type: 'setColor', color: (e.currentTarget as HTMLInputElement).value })}
        />
      {/if}
    {:else}
      <p class="text-sm text-dtcc-muted">Connecting...</p>
    {/if}
  </section>
</main>
