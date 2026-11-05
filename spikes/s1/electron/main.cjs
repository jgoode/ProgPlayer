/**
 * Spike S1 Electron shell.
 *
 * This is throwaway measurement code and lives outside `src/`. It serves the
 * spike renderer, the SoundFont fixtures and the SpessaSynth AudioWorklet
 * bundle over a custom `spike://` protocol, and exposes a two-method
 * measurement API through a preload script.
 *
 * The protocol exists for two reasons:
 *
 * 1. `audioWorklet.addModule()` needs a real URL; `file://` module loading is
 *    unreliable in Chromium.
 * 2. The renderer must never read files directly (NFR-PRV-1, implementation.md
 *    §2.7): bytes are served by the main process over a custom protocol.
 */

const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const { join, resolve, extname, normalize } = require('node:path');

const SPIKE_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(SPIKE_ROOT, '..', '..');
const DIST_ROOT = join(SPIKE_ROOT, 'dist');
const FIXTURE_ROOT = join(SPIKE_ROOT, 'fixtures');
const WORKLET_FILE = join(
  REPO_ROOT,
  'node_modules',
  'spessasynth_lib',
  'dist',
  'spessasynth_processor.min.js',
);
const VENDOR_ROOT = join(SPIKE_ROOT, 'renderer', 'public', 'vendor');

const SCHEME = 'spike';

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.sf2', 'application/octet-stream'],
  ['.sf3', 'application/octet-stream'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
]);

/**
 * Maps a `spike://` URL to a file on disk.
 * Returns null for unknown paths so the protocol handler can answer 404.
 */
function resolveRequestPath(url) {
  const parsed = new URL(url);
  const pathname = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');

  if (pathname.startsWith('fixtures/')) {
    const relative = normalize(pathname.slice('fixtures/'.length));
    if (relative.startsWith('..')) return null;
    return join(FIXTURE_ROOT, relative);
  }

  if (pathname === 'vendor/spessasynth_processor.min.js') {
    return WORKLET_FILE;
  }

  if (pathname.startsWith('vendor/')) {
    const relative = normalize(pathname.slice('vendor/'.length));
    if (relative.startsWith('..')) return null;
    return join(VENDOR_ROOT, relative);
  }

  const relative = normalize(pathname);
  if (relative.startsWith('..')) return null;
  return join(DIST_ROOT, relative);
}

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self' ${SCHEME}:`,
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

function registerProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const filePath = resolveRequestPath(request.url);
    if (!filePath) {
      return new Response('Not found', { status: 404 });
    }
    try {
      const body = await readFile(filePath);
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': CONTENT_TYPES.get(extname(filePath)) ?? 'application/octet-stream',
          'content-security-policy': CONTENT_SECURITY_POLICY,
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1100,
    height: 900,
    show: false,
    backgroundColor: '#12141a',
    title: 'PracticePlayer Spike S1',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
      preload: join(__dirname, 'preload.cjs'),
    },
  });

  window.once('ready-to-show', () => window.show());
  void window.loadURL(`${SCHEME}://app/index.html`);
  return window;
}

/**
 * Returns CPU and memory metrics for the renderer process.
 *
 * `app.getAppMetrics()` reports `cpu.percentCPUUsage` as the CPU share used
 * since the previous call, so the spike polls it once per second.
 */
function rendererMetrics(rendererProcessId) {
  const metrics = app.getAppMetrics();
  const match = metrics.find((metric) => metric.pid === rendererProcessId);
  if (!match) return null;
  return {
    cpuPercent: match.cpu.percentCPUUsage,
    workingSetBytes: match.memory.workingSetSize,
    peakWorkingSetBytes: match.memory.peakWorkingSetSize,
  };
}

let rendererProcessId = 0;

function registerIpcHandlers() {
  ipcMain.handle('spike:get-metrics', () => rendererMetrics(rendererProcessId));

  ipcMain.handle('spike:save-report', async (_event, report) => {
    const resultsRoot = join(SPIKE_ROOT, 'results');
    await mkdir(resultsRoot, { recursive: true });
    const target = join(resultsRoot, `report-${Date.now()}.json`);
    await writeFile(target, JSON.stringify(report, null, 2), 'utf8');
    return target;
  });
}

void app.whenReady().then(() => {
  registerProtocol();
  registerIpcHandlers();
  const window = createWindow();
  rendererProcessId = window.webContents.getOSProcessId();
});

app.on('window-all-closed', () => {
  app.quit();
});
