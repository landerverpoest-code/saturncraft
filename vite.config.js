import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // relative asset paths so the build works under a GitHub Pages subpath
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  server: { host: true },
  test: { environment: 'node', include: ['tests/**/*.test.js'] },
});
