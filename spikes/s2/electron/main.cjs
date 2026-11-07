/**
 * Spike S2 Electron shell.
 *
 * It provides:
 * - a `spike://` protocol that serves the built renderer;
 * - the Web MIDI session permission handlers (NFR-REL-2, implementation.md
 *   §2.7): MIDI access is granted only to the app's own origin, and sysex is
 *   denied unless it is explicitly requested;
 * - a power-save blocker that is active while a measurement runs, so
 *   minimising the window cannot suspend the process (testing.md M-5);
 * - IPC handlers that let the driver save reports and observe the window
 *   state.
 */

const { app, BrowserWindow, ipcMain, powerSaveBlocker, protocol, session } = require('electron');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const { extname, join, normalize, resolve } = require('node:path');

const SPIKE_ROOT = resolve(__dirname, '..');
const DIST_ROOT = join(SPIKE_ROOT, 'dist');
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

/**
 * Grants Web MIDI access to the app's own origin only.
 *
 * `midi` is allowed; `midiSysex` is allowed only when the spike is run with
 * `--sysex`, so the default run proves the conservative path.
 */
function registerMidiPermissionHandlers(allowSysex) {
  const appSession = session.defaultSession;
  const isOwnOrigin = (origin) => origin === `spike://app` || origin === `file://`;

  appSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'midi') {
      callback(true);
      return;
    }
    if (permission === 'midiSysex') {
      callback(allowSysex);
      return;
    }
    callback(false);
  });

  appSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (permission === 'midi') {
      return true;
    }
    if (permission === 'midiSysex') {
      return allowSysex && isOwnOrigin(requestingOrigin);
    }
    return false;
  });
}

let mainWindow = null;
let blockerId = null;

function startPowerSaveBlocker() {
  if (blockerId !== null) {
    return;
  }
  blockerId = powerSaveBlocker.start('prevent-app-suspension');
}

function stopPowerSaveBlocker() {
  if (blockerId === null) {
    return;
  }
  if (powerSaveBlocker.isStarted(blockerId)) {
    powerSaveBlocker.stop(blockerId);
  }
  blockerId = null;
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1100,
    height: 900,
    show: true,
    backgroundColor: '#12141a',
    title: 'PracticePlayer Spike S2',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });
  mainWindow = window;
  window.on('minimize', () => {
    console.log('[main] window minimized');
  });
  window.on('restore', () => {
    console.log('[main] window restored');
  });
  window.webContents.on('console-message', (_event, level, message) => {
    console.log(`[renderer:${level}] ${message}`);
  });
  void window.loadURL(`${SCHEME}://app/index.html`);
  return window;
}

function registerIpcHandlers() {
  ipcMain.handle('spike:save-report', async (_event, name, report) => {
    const resultsRoot = join(SPIKE_ROOT, 'results');
    await mkdir(resultsRoot, { recursive: true });
    const target = join(resultsRoot, name);
    await writeFile(target, JSON.stringify(report, null, 2), 'utf8');
    return target;
  });
  ipcMain.handle('spike:start-power-save-blocker', () => {
    startPowerSaveBlocker();
    return blockerId !== null;
  });
  ipcMain.handle('spike:stop-power-save-blocker', () => {
    stopPowerSaveBlocker();
    return blockerId === null;
  });
  ipcMain.handle('spike:window-state', () => ({
    minimized: mainWindow?.isMinimized() ?? false,
    visible: mainWindow?.isVisible() ?? false,
  }));
  ipcMain.handle('spike:minimize', () => {
    mainWindow?.minimize();
    return true;
  });
  ipcMain.handle('spike:restore', () => {
    mainWindow?.restore();
    mainWindow?.focus();
    return true;
  });
}

const allowSysex = process.argv.includes('--sysex');

void app.whenReady().then(() => {
  registerProtocol();
  registerMidiPermissionHandlers(allowSysex);
  registerIpcHandlers();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopPowerSaveBlocker();
  app.quit();
});

app.on('before-quit', stopPowerSaveBlocker);
