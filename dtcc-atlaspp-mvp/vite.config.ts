import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [
    {
      name: 'atlas-projector-alias',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === '/projector') req.url = '/';
          next();
        });
      },
    },
    svelte(),
    tailwindcss(),
  ],
  server: {
    port: 5175,
    // The projector launcher (`npm run dev:projector`) sets ATLAS_NO_OPEN=1 so it
    // can open its own chrome-free window instead of the default browser tab.
    open: process.env.ATLAS_NO_OPEN !== '1',
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:5176',
    },
  },
  preview: {
    // Matches the dev port so the verification checklist and README can
    // refer to one port regardless of whether the operator ran `npm run dev`
    // or `npm run preview`. Vite's default preview port is 4173, which would
    // silently not match the checklist.
    port: 5175,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        remote: resolve(__dirname, 'remote.html'),
      },
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
});
