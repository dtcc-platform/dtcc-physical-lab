import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';

function lanHost() {
  let interfaces;
  try {
    interfaces = networkInterfaces();
  } catch {
    return '127.0.0.1';
  }
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return '127.0.0.1';
}

const publicRemoteUrl = process.env.ATLAS_REMOTE_PUBLIC_URL ?? `http://${lanHost()}:5175/remote`;

const children = [
  spawn('node', ['server/control-server.mjs', '--port', '5176', '--host', '127.0.0.1'], {
    stdio: 'inherit',
    env: { ...process.env, ATLAS_REMOTE_PUBLIC_URL: publicRemoteUrl },
  }),
  spawn('npm', ['run', 'dev:vite', '--', '--host', '0.0.0.0'], { stdio: 'inherit' }),
];

function stop(signal = 'SIGTERM') {
  for (const child of children) child.kill(signal);
}

process.on('SIGINT', () => {
  stop('SIGINT');
  process.exit(130);
});

process.on('SIGTERM', () => {
  stop('SIGTERM');
  process.exit(143);
});
