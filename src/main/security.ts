import type { WebPreferences } from 'electron';

/**
 * Content Security Policy for the renderer in production.
 *
 * The renderer is served from local files. `style-src` permits inline styles
 * because React inline styles are used for layout; scripts stay restricted to
 * same-origin files, so no remote or inline script can run.
 *
 * `connect-src` permits the `app-asset:` scheme, which serves the bundled
 * SoundFonts and the preset library (ADR-0005). No remote origin is
 * allowed, so the app makes no network calls.
 */
export const contentSecurityPolicy = [
  "default-src 'self'",
  // `wasm-unsafe-eval` allows WebAssembly compilation, which the SF3
  // Vorbis decoder needs. It does **not** allow `eval()` or
  // `new Function()`, so the script policy stays otherwise strict.
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' app-asset:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Content Security Policy used by the Vite development server.
 *
 * The dev server injects an inline React-refresh preamble and uses a
 * WebSocket for HMR, so those two sources are allowed here. The production
 * policy above is unaffected.
 */
export const developmentContentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' app-asset: ws://localhost:*",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Hardening baseline for the renderer (NFR-SEC-1).
 *
 * `contextIsolation` on, `nodeIntegration` off, `sandbox` on, no remote
 * content, and background throttling disabled so that later Worker-based
 * scheduling is not slowed down while the window is in the background.
 */
export const rendererWebPreferences: WebPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  backgroundThrottling: false,
};
