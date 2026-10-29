import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // relative asset paths so the build works under a GitHub Pages subpath
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  server: { host: true },
  // generation-heavy tests take 5-10x longer when the machine is busy, so the default 5 s limit is raised
  test: { environment: 'node', include: ['tests/**/*.test.js'], testTimeout: 30000 },
});
