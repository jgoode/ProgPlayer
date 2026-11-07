import { resolve } from 'node:path';

import { defineConfig } from 'vite';

/**
 * Vite configuration for the throwaway Spike S2 renderer.
 *
 * The spike lives outside `src/` because it is measurement code, not
 * production code. The build output is served by the spike's own Electron
 * main process over a custom `spike://` protocol.
 */
export default defineConfig({
  root: resolve(import.meta.dirname, 'renderer'),
  base: './',
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'chrome130',
  },
});
