// Launch the projector view chrome-free on macOS.
//
// Starts the dev servers (Vite + control API) with Vite's normal browser
// auto-open suppressed, waits for the projector page to respond, then opens it
// in a dedicated Chrome window using app mode (no address bar / tabs) at full
// screen. A dedicated user-data-dir keeps the window's flags honored even when
// Chrome is already running, and persists the projector's calibration across
// restarts.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PROJECTOR_URL = process.env.ATLAS_PROJECTOR_URL ?? 'http://localhost:5175/projector';
const PROFILE_DIR = join(homedir(), '.dtcc-atlaspp-projector');
const CHROME_APP = '/Applications/Google Chrome.app';
const CHROME_BIN = `${CHROME_APP}/Contents/MacOS/Google Chrome`;

if (process.platform !== 'darwin') {
  console.error(
    'npm run dev:projector currently supports macOS only.\n' +
      'Start the servers with `npm run dev`, then open the projector URL in your ' +
      "browser's kiosk/app mode manually.",
  );
  process.exit(1);
}

// Start the dev servers in their own process group so the whole tree can be torn
// down on exit. ATLAS_NO_OPEN stops Vite from opening a normal browser tab.
const servers = spawn('npm', ['run', 'dev'], {
  stdio: 'inherit',
  detached: true,
  env: { ...process.env, ATLAS_NO_OPEN: '1' },
});

// Tracked so the projector window is torn down together with the servers.
let chrome;

function shutdown(signal) {
  try {
    process.kill(-servers.pid, signal);
  } catch {
    // already gone
  }
  try {
    chrome?.kill('SIGTERM');
  } catch {
    // not launched / already gone
  }
}

process.on('SIGINT', () => {
  shutdown('SIGINT');
  process.exit(130);
});
process.on('SIGTERM', () => {
  shutdown('SIGTERM');
  process.exit(143);
});
servers.on('exit', (code) => {
  // If the servers die on their own, close the projector window we launched too.
  try {
    chrome?.kill('SIGTERM');
  } catch {
    // not launched / already gone
  }
  process.exit(code ?? 0);
});

async function waitForServer(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.ok || (res.status >= 300 && res.status < 400)) return true;
    } catch {
      // server not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

const ready = await waitForServer(PROJECTOR_URL);
if (!ready) {
  console.error(`Timed out waiting for ${PROJECTOR_URL}. Is the dev server healthy?`);
  shutdown('SIGTERM');
  process.exit(1);
}

if (!existsSync(CHROME_BIN)) {
  console.warn(`Google Chrome not found at ${CHROME_APP}.`);
  console.warn(`Servers are running — open ${PROJECTOR_URL} manually in a fullscreen / kiosk window.`);
} else {
  // Close any projector window left over from a previous run so each launch
  // yields a single fresh fullscreen window on the current servers. The match is
  // scoped to our dedicated profile dir, so the operator's normal Chrome is never
  // touched.
  if (spawnSync('pkill', ['-f', PROFILE_DIR]).status === 0) {
    // A stale window existed; let Chrome release its profile lock before relaunch.
    await new Promise((resolve) => setTimeout(resolve, 800));
  }

  const chromeArgs = [`--app=${PROJECTOR_URL}`, '--start-fullscreen', `--user-data-dir=${PROFILE_DIR}`];
  console.log(`Opening projector window: "${CHROME_BIN}" ${chromeArgs.join(' ')}`);
  chrome = spawn(CHROME_BIN, chromeArgs, { stdio: 'ignore' });
  chrome.on('error', (err) => {
    console.error(`Failed to launch Chrome: ${err.message}`);
    console.error(`Open ${PROJECTOR_URL} manually in a fullscreen / kiosk window.`);
  });
  chrome.on('exit', (code) => {
    if (code) {
      console.error(`Chrome exited with code ${code}.`);
      console.error(`Open ${PROJECTOR_URL} manually in a fullscreen / kiosk window.`);
    }
  });
}
