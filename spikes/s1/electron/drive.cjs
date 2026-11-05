/**
 * Spike S1 headless driver.
 *
 * Runs the measurement page in Electron and drives the three runs through the
 * DOM, so the numbers in the report come from the real Web Audio path with a
 * real output device — not from the Node harness.
 *
 * Usage:
 *   node_modules/electron/dist/electron.exe spikes/s1/electron/drive.cjs [--soak 600]
 */

const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const { join, resolve, extname, normalize } = require('node:path');

const SPIKE_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(SPIKE_ROOT, '..', '..');
const DIST_ROOT = join(SPIKE_ROOT, 'dist');
const FIXTURE_ROOT = join(SPIKE_ROOT, 'fixtures');
const VENDOR_ROOT = join(SPIKE_ROOT, 'renderer', 'public', 'vendor');
const WORKLET_FILE = join(
  REPO_ROOT,
  'node_modules',
  'spessasynth_lib',
  'dist',
  'spessasynth_processor.min.js',
);

const SCHEME = 'spike';

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1 || index + 1 >= args.length) return fallback;
  return args[index + 1];
}
const SOAK_SECONDS = argValue('soak', '600');
const FONT = argValue('font', 'sf2');
/**
 * Skips the soak run, so the offline comparison can be measured in
 * isolation. The soak leaves the engine's reverb tail running, which is one
 * of the variables that affects the comparison.
 */
const SKIP_SOAK = args.includes('--skip-soak');
/**
 * Reloads the sound font — and therefore creates a fresh `AudioContext` and
 * a fresh engine — before the offline comparison. This isolates the effect
 * of the engine state left behind by the soak on the comparison.
 */
const RELOAD_BEFORE_OFFLINE = args.includes('--reload-before-offline');

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

function resolveRequestPath(url) {
  const parsed = new URL(url);
  const pathname = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');

  if (pathname.startsWith('fixtures/')) {
    const relative = normalize(pathname.slice('fixtures/'.length));
    if (relative.startsWith('..')) return null;
    return join(FIXTURE_ROOT, relative);
  }

  if (pathname === 'vendor/spessasynth_processor.min.js') return WORKLET_FILE;

  if (pathname.startsWith('vendor/')) {
    const relative = normalize(pathname.slice('vendor/'.length));
    if (relative.startsWith('..')) return null;
    return join(VENDOR_ROOT, relative);
  }

  const relative = normalize(pathname);
  if (relative.startsWith('..')) return null;
  return join(DIST_ROOT, relative);
}

function registerProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const filePath = resolveRequestPath(request.url);
    if (!filePath) return new Response('Not found', { status: 404 });
    try {
      const body = await readFile(filePath);
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': CONTENT_TYPES.get(extname(filePath)) ?? 'application/octet-stream',
        },
      });
    } catch (error) {
      console.log(`[protocol] ${request.url} -> ${String(error)}`);
      return new Response('Not found', { status: 404 });
    }
  });
}

let rendererProcessId = 0;

function rendererMetrics() {
  const metrics = app.getAppMetrics();
  // `getAppMetrics()` reports the OS process id; fall back to the process type
  // when the ids do not line up.
  const match =
    metrics.find((metric) => metric.pid === rendererProcessId) ??
    metrics.find((metric) => metric.type === 'Renderer');
  if (!match) return null;
  return {
    cpuPercent: match.cpu.percentCPUUsage,
    // Electron reports the working set in kilobytes.
    workingSetBytes: match.memory.workingSetSize * 1024,
    peakWorkingSetBytes: match.memory.peakWorkingSetSize * 1024,
  };
}

/** Aggregated CPU and memory figures for the whole process tree. */
function treeMetrics() {
  const metrics = app.getAppMetrics();
  let cpuPercent = 0;
  let workingSetBytes = 0;
  let peakWorkingSetBytes = 0;
  const processes = [];
  for (const metric of metrics) {
    cpuPercent += metric.cpu.percentCPUUsage;
    workingSetBytes += metric.memory.workingSetSize * 1024;
    peakWorkingSetBytes += metric.memory.peakWorkingSetSize * 1024;
    processes.push({
      type: metric.type,
      pid: metric.pid,
      cpuPercent: metric.cpu.percentCPUUsage,
      workingSetMB: Number((metric.memory.workingSetSize / 1024).toFixed(1)),
    });
  }
  return { cpuPercent, workingSetBytes, peakWorkingSetBytes, processes };
}

/** Polls the page until the predicate holds, or the timeout expires. */
async function waitFor(window, expression, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await window.webContents.executeJavaScript(expression);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function run() {
  registerProtocol();
  ipcMain.handle('spike:get-metrics', () => rendererMetrics());
  ipcMain.handle('spike:get-tree-metrics', () => treeMetrics());
  ipcMain.handle('spike:save-report', async (_event, report) => {
    const resultsRoot = join(SPIKE_ROOT, 'results');
    await mkdir(resultsRoot, { recursive: true });
    const target = join(resultsRoot, `browser-${Date.now()}.json`);
    await writeFile(target, JSON.stringify(report, null, 2), 'utf8');
    return target;
  });

  const window = new BrowserWindow({
    width: 1100,
    height: 900,
    show: true,
    backgroundColor: '#12141a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      preload: join(__dirname, 'preload.cjs'),
    },
  });
  rendererProcessId = window.webContents.getOSProcessId();
  window.webContents.on('console-message', (_event, level, message) => {
    console.log(`[renderer:${level}] ${message}`);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    console.log(`[renderer] gone: ${JSON.stringify(details)}`);
  });
  window.webContents.on('did-fail-load', (_event, code, description) => {
    console.log(`[renderer] did-fail-load ${code} ${description}`);
  });
  await window.loadURL(`${SCHEME}://app/index.html`);

  // Select the font and the soak duration, then load.
  await window.webContents.executeJavaScript(
    `document.querySelector('#font').value = ${JSON.stringify(FONT)};
     document.querySelector('#duration').value = ${JSON.stringify(String(SOAK_SECONDS))};
     document.querySelector('#duration').dispatchEvent(new Event('input', { bubbles: true }));`,
  );
  await window.webContents.executeJavaScript(`document.querySelector('#load').click(); true`);
  await waitFor(
    window,
    `document.querySelector('#timing').disabled === false`,
    120_000,
    'sound font load',
  );
  console.log('Sound font loaded.');

  await window.webContents.executeJavaScript(`document.querySelector('#timing').click(); true`);
  await waitFor(
    window,
    `document.querySelector('#results').textContent.includes('"timing"')`,
    180_000,
    'timing test',
  );
  console.log('Timing test complete.');

  if (!SKIP_SOAK) {
    await window.webContents.executeJavaScript(`document.querySelector('#soak').click(); true`);
    await waitFor(
      window,
      `document.querySelector('#results').textContent.includes('"soak"')`,
      Number(SOAK_SECONDS) * 1000 + 300_000,
      'soak test',
    );
    console.log('Soak test complete.');
  } else {
    console.log('Soak test skipped.');
  }

  if (RELOAD_BEFORE_OFFLINE) {
    await window.webContents.executeJavaScript(`document.querySelector('#load').click(); true`);
    await waitFor(
      window,
      `document.querySelector('#timing').disabled === false`,
      120_000,
      'sound font reload',
    );
    console.log('Sound font reloaded.');
  }

  await window.webContents.executeJavaScript(`document.querySelector('#offline').click(); true`);
  await waitFor(
    window,
    `document.querySelector('#results').textContent.includes('"offline"')`,
    300_000,
    'offline comparison',
  ).catch(async (error) => {
    const status = await window.webContents.executeJavaScript(
      `document.querySelector('#status').textContent`,
    );
    const logText = await window.webContents.executeJavaScript(
      `document.querySelector('#log').textContent`,
    );
    console.log(`[status] ${status}`);
    console.log(`[log]\n${logText}`);
    throw error;
  });
  console.log('Offline comparison complete.');

  const report = await window.webContents.executeJavaScript(
    `JSON.parse(document.querySelector('#results').textContent)`,
  );
  const resultsRoot = join(SPIKE_ROOT, 'results');
  await mkdir(resultsRoot, { recursive: true });
  const target = join(resultsRoot, `browser-${Date.now()}.json`);
  await writeFile(target, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nReport written to ${target}`);
  console.log(JSON.stringify(report, null, 2));
}

void app.whenReady().then(() => {
  run()
    .then(() => app.quit())
    .catch((error) => {
      console.error('DRIVE FAILED', error);
      app.exit(1);
    });
});
