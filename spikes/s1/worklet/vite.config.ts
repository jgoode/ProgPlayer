import { resolve } from 'node:path';

import { defineConfig } from 'vite';

/**
 * Builds the Spike S1 measurement AudioWorklet as a self-contained ES module.
 *
 * The worklet imports `spessasynth_core` directly, so the bundle inlines the
 * core and its `fflate` / `stb-vorbis` dependencies. The result is served to
 * the renderer by the spike's Electron main process.
 */
export default defineConfig({
  build: {
    outDir: resolve(import.meta.dirname, '../renderer/public/vendor'),
    emptyOutDir: false,
    target: 'chrome130',
    lib: {
      entry: resolve(import.meta.dirname, 'measure-worklet.ts'),
      formats: ['es'],
      fileName: () => 'spike-measure-worklet.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
