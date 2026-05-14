import { defineConfig } from 'vitest/config';
import { compile } from 'svelte/compiler';

const svelteTestCompiler = {
  name: 'svelte-test-compiler',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (!id.endsWith('.svelte')) return null;
    const compiled = compile(code, { filename: id, generate: 'client', dev: true });
    return { code: compiled.js.code, map: null };
  },
};

export default defineConfig({
  plugins: [svelteTestCompiler],
  resolve: {
    conditions: ['browser'],
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
});
