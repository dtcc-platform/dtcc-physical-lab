import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  server: {
    port: 5175,
    open: true,
    strictPort: true,
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
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
});
