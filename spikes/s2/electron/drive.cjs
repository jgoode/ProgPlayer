/**
 * Spike S2 headless driver — Web MIDI path.
 *
 * Usage:
 *   node spikes/s2/electron/drive.cjs \
 *     --output "loopMIDI Port 1" --input "loopMIDI Port 2" \
 *     --bars 4 --bpm 120 [--minimize-after 2000] [--out results/web-midi-....json]
 *
 * The driver launches the spike's own Electron shell, requests MIDI access
 * through the page (so the session permission handler is exercised), picks
 * the requested loopback ports, runs the measurement, minimises the window
 * half-way through, and writes the JSON report.
 */

const { app, BrowserWindow, ipcMain, powerSaveBlocker, protocol } = require('electron');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const { extname, join, normalize, resolve } = require('node:path');

const SPIKE_ROOT = resolve(__dirname, '..');
const DIST_ROOT = join(SPIKE_ROOT, 'dist');
const SCHEME = 'spike';

const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index >= 0 && index + 1 < args.length) {
    return args[index + 1];
  }
  return fallback;
}

const OUTPUT_NAME = argValue('output', '');
const INPUT_NAME = argValue('input', '');
const BARS = Number(argValue('bars', '4'));
const BPM = Number(argValue('bpm', '120'));
const BEATS_PER_BAR = Number(argValue('beats-per-bar', '4'));
const NOTES_PER_BEAT = Number(argValue('notes-per-beat', '1'));
const LOOK_AHEAD_MS = Number(argValue('look-ahead', '100'));
const WORKER_INTERVAL_MS = Number(argValue('worker-interval', '10'));
const MINIMIZE_AFTER_MS = Number(argValue('minimize-after', '0'));
const OUT_NAME = argValue('out', `web-midi-${Date.now()}.json`);

// Chromium's Windows MIDI backend is WinMM by default; the WinRT backend is
// behind the `MidiManagerWinrt` feature. `--winrt-midi` switches it on so
// the spike can compare the two backends on Windows.
if (args.includes('--winrt-midi')) {
  app.commandLine.appendSwitch('enable-features', 'MidiManagerWinrt');
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
]);

function resolveRequestPath(url) {
  const parsed = new URL(url);
  const pathname = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
  const relative = normalize(pathname);
  if (relative.startsWith('..')) {
    return null;
  }
  return join(DIST_ROOT, relative);
}

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
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

let driverWindow = null;

async function waitFor(window, expression, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await window.webContents.executeJavaScript(expression);
    if (value) {
      return value;
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function pickPort(ports, wanted) {
  if (!wanted) {
    return ports[0];
  }
  const exact = ports.find((port) => port.name === wanted);
  if (exact) {
    return exact;
  }
  const partial = ports.find((port) => (port.name ?? '').includes(wanted));
  return partial;
}

let blockerId = null;

async function run() {
  registerProtocol();
  ipcMain.handle('spike:save-report', async (_event, name, report) => {
    const resultsRoot = join(SPIKE_ROOT, 'results');
    await mkdir(resultsRoot, { recursive: true });
    const target = join(resultsRoot, name);
    await writeFile(target, JSON.stringify(report, null, 2), 'utf8');
    return target;
  });
  ipcMain.handle('spike:start-power-save-blocker', () => {
    if (blockerId === null) {
      blockerId = powerSaveBlocker.start('prevent-app-suspension');
    }
    return true;
  });
  ipcMain.handle('spike:stop-power-save-blocker', () => {
    if (blockerId !== null) {
      if (powerSaveBlocker.isStarted(blockerId)) {
        powerSaveBlocker.stop(blockerId);
      }
      blockerId = null;
    }
    return true;
  });
  ipcMain.handle('spike:window-state', () => ({
    minimized: driverWindow?.isMinimized() ?? false,
    visible: driverWindow?.isVisible() ?? false,
  }));
  ipcMain.handle('spike:minimize', () => {
    driverWindow?.minimize();
    return true;
  });
  ipcMain.handle('spike:restore', () => {
    driverWindow?.restore();
    driverWindow?.focus();
    return true;
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
  driverWindow = window;
  window.webContents.on('console-message', (_event, level, message) => {
    console.log(`[renderer:${level}] ${message}`);
  });
  await window.loadURL(`${SCHEME}://app/index.html`);
  await waitFor(window, 'typeof window.spike === "object"', 30_000, 'the renderer API');

  const access = await window.webContents.executeJavaScript('window.spike.requestAccess(false)');
  console.log(`MIDI access granted: ${access.granted}${access.error ? ` (${access.error})` : ''}`);
  if (!access.granted) {
    throw new Error(`MIDI access denied: ${access.error}`);
  }

  const ports = await window.webContents.executeJavaScript('window.spike.enumerate()');
  console.log(`Outputs: ${JSON.stringify(ports.outputs)}`);
  console.log(`Inputs: ${JSON.stringify(ports.inputs)}`);

  const output = pickPort(ports.outputs, OUTPUT_NAME);
  const input = pickPort(ports.inputs, INPUT_NAME);
  const useNullSink = args.includes('--null-sink');
  // A missing loopback is a *result*, not a crash: the report records why the
  // capture was impossible and the dispatch path is still measured. The
  // workflow relies on this so that one platform without a loopback does not
  // hide the results of the others.
  let loopbackUnavailableReason = null;
  if (!output) {
    loopbackUnavailableReason = `No MIDI output port matched "${OUTPUT_NAME}".`;
    console.warn(`${loopbackUnavailableReason} Running without a MIDI output.`);
  }
  if (!input) {
    const reason = `No MIDI input port matched "${INPUT_NAME}".`;
    loopbackUnavailableReason = loopbackUnavailableReason
      ? `${loopbackUnavailableReason} ${reason}`
      : reason;
    console.warn(`${reason} Running without capture.`);
  }
  console.log(
    `Using output "${output ? output.name : 'none'}" and input "${input ? input.name : 'none'}"`,
  );

  await window.webContents.executeJavaScript('window.spikeHost.startPowerSaveBlocker()');

  const runPromise = window.webContents.executeJavaScript(
    `window.spike.run(${JSON.stringify({
      outputPortId: output ? output.id : '',
      inputPortId: input ? input.id : '',
      bpm: BPM,
      bars: BARS,
      beatsPerBar: BEATS_PER_BAR,
      notesPerBeat: NOTES_PER_BEAT,
      lookAheadMs: LOOK_AHEAD_MS,
      workerIntervalMs: WORKER_INTERVAL_MS,
      minimizeAfterMs: MINIMIZE_AFTER_MS,
      simulateUiLoad: args.includes('--ui-load'),
      useNullSink,
    })})`,
  );

  if (MINIMIZE_AFTER_MS > 0) {
    await new Promise((done) => setTimeout(done, MINIMIZE_AFTER_MS));
    console.log('Minimising the window.');
    await window.webContents.executeJavaScript('window.spikeHost.minimize()');
  }

  const report = await runPromise;
  await window.webContents.executeJavaScript('window.spikeHost.restore()');
  const stateChanges = await window.webContents.executeJavaScript('window.spike.stateChanges()');
  const windowState = await window.webContents.executeJavaScript('window.spikeHost.windowState()');
  await window.webContents.executeJavaScript('window.spikeHost.stopPowerSaveBlocker()');

  const result = {
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    osRelease: process.getSystemVersion?.() ?? null,
    ports: { outputs: ports.outputs, inputs: ports.inputs },
    selected: { output: output ?? null, input: input ?? null },
    permission: access,
    loopbackUnavailableReason,
    minimizedDuringRun: MINIMIZE_AFTER_MS > 0,
    windowStateAtEnd: windowState,
    stateChanges,
    report,
  };

  const resultsRoot = join(SPIKE_ROOT, 'results');
  await mkdir(resultsRoot, { recursive: true });
  const target = join(resultsRoot, OUT_NAME);
  await writeFile(target, JSON.stringify(result, null, 2), 'utf8');
  console.log(`Report written to ${target}`);
  console.log(
    `Note error p50=${report.notes.error.p50.toFixed(3)}ms p99=${report.notes.error.p99.toFixed(3)}ms max=${report.notes.error.max.toFixed(3)}ms`,
  );
}

void app.whenReady().then(
  () => {
    void run()
      .then(() => app.quit())
      .catch((error) => {
        console.error(error);
        app.exit(1);
      });
  },
  (error) => {
    console.error(error);
    app.exit(1);
  },
);

app.on('window-all-closed', () => {
  app.quit();
});
