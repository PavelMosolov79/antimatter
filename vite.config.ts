import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the build works under GitHub Pages' /antimatter/ subpath.
  base: './',
  server: { port: 5173 },
  build: { target: 'es2022' },
  test: { include: ['tests/**/*.test.ts'] },
});
