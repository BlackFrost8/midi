import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { storePlugin } from './vite-store';

export default defineConfig({
  // Relative asset paths, so the build runs from any folder — including a
  // GitHub Pages project site at /<repo>/.
  base: './',
  // The store saves songs into ./saved, so every browser shares them.
  plugins: [react(), storePlugin(fileURLToPath(new URL('.', import.meta.url)))],
  server: {
    port: 5180,
    strictPort: false,
    // Saved songs are data, not source: writing them must not reload the page.
    watch: { ignored: ['**/saved/**'] },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
