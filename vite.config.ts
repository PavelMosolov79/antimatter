import { defineConfig } from 'vitest/config';

// The preview pane hands the dev server a free port through PORT; 5173 otherwise.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;

export default defineConfig({
  // Relative asset paths so the build works under GitHub Pages' /antimatter/ subpath.
  base: './',
  server: { port: Number(env?.PORT) || 5173 },
  build: { target: 'es2022' },
  test: { include: ['tests/**/*.test.ts'] },
});
