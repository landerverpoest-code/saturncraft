import { defineConfig } from 'vite';

export default defineConfig({
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  server: { host: true },
  test: { environment: 'node', include: ['tests/**/*.test.js'] },
});
