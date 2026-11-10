import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const alias = {
  '@core': resolve('src/core'),
  '@audio': resolve('src/audio'),
  '@midi': resolve('src/midi'),
  '@main': resolve('src/main'),
  '@preload': resolve('src/preload'),
  '@renderer': resolve('src/renderer'),
};

const strictCsp = [
  "default-src 'self'",
  // `wasm-unsafe-eval` allows WebAssembly compilation, which the SF3
  // Vorbis decoder needs. It does not allow `eval()`.
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  // The `app-asset:` scheme serves the bundled SoundFonts and the preset
  // library (ADR-0005). No remote origin is allowed, so the app makes no
  // network calls.
  "connect-src 'self' app-asset:",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');

/**
 * The production renderer is loaded from disk, so the CSP is also declared in
 * the document itself. The development server needs inline scripts for Vite's
 * React refresh preamble, therefore the meta tag is build-only.
 */
function cspMetaPlugin() {
  return {
    name: 'practiceplayer:csp-meta',
    apply: 'build' as const,
    transformIndexHtml(html: string) {
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: strictCsp },
            injectTo: 'head-prepend' as const,
          },
        ],
      };
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react(), cspMetaPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') },
      },
    },
  },
});
