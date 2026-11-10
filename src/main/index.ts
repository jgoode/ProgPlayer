import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  app,
  BrowserWindow,
  ipcMain,
  net,
  powerSaveBlocker,
  protocol,
  session,
  shell,
} from 'electron';

import { IPC_CHANNELS } from '@core/contracts/api';
import type { BuiltInPreset, BundledSoundFont } from '@core/contracts/api';

import { getAppInfo } from './app-info';
import { ASSET_SCHEME, resolveAssetPath } from './asset-path';
import { bundledAssetLayout } from './bundled-assets';
import {
  contentSecurityPolicy,
  developmentContentSecurityPolicy,
  rendererWebPreferences,
} from './security';

const isDevelopment = !app.isPackaged;

/**
 * The bundled-asset scheme must be registered as privileged before the app
 * is ready, so the renderer can fetch the fonts from it (ADR-0005).
 *
 * `corsEnabled` is required because the renderer runs on a `file://`
 * origin, which is a different origin from the custom scheme. The
 * handler therefore answers with `Access-Control-Allow-Origin: *`, which
 * is safe here: the scheme serves one fixed, local directory and accepts
 * no request body.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: ASSET_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

/**
 * The power-save blocker that is active during playback.
 *
 * It is started when the playback starts and stopped when it ends, so the
 * app never keeps the machine awake while it is idle
 * (implementation.md §2.4).
 */
let activePowerSaveBlocker: number | null = null;

/**
 * The bundled SoundFonts, with the URL each one is served from.
 *
 * The fonts are listed explicitly so the renderer never has to guess a
 * file name, and so a missing font is reported at startup rather than in
 * the middle of a playback.
 */
const BUNDLED_SOUND_FONTS: readonly BundledSoundFont[] = [
  {
    part: 'chords',
    file: 'UprightPianoKW.sf3',
    url: `${ASSET_SCHEME}://bundle/soundfonts/UprightPianoKW.sf3`,
    name: 'Upright Piano KW',
  },
  {
    part: 'bass',
    file: 'FingerBassYR.sf3',
    url: `${ASSET_SCHEME}://bundle/soundfonts/FingerBassYR.sf3`,
    name: 'Finger Bass YR',
  },
];

/**
 * Applies the Content Security Policy as a response header for every request
 * the renderer makes, so the policy cannot be bypassed by a document that
 * omits the meta tag.
 */
function applyContentSecurityPolicy(): void {
  const policy = isDevelopment ? developmentContentSecurityPolicy : contentSecurityPolicy;

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });
}

/**
 * Registers the protocol that serves the bundled assets.
 *
 * The handler serves exactly one directory and rejects any path that
 * escapes it, including percent-encoded traversal (ADR-0005).
 */
function registerAssetProtocol(): void {
  const assetRoot = bundledAssetLayout().root;

  protocol.handle(ASSET_SCHEME, async (request) => {
    const filePath = resolveAssetPath(request.url, assetRoot);
    if (filePath === null || !existsSync(filePath)) {
      return new Response('Not found', {
        status: 404,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }

    const response = await net.fetch(`file://${filePath.replace(/\\/g, '/')}`);
    // The renderer is on a `file://` origin, so the response needs an
    // explicit CORS header to be fetchable from it.
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  });
}

/**
 * Reads the built-in preset index.
 *
 * The index is a small JSON file in the bundled resources. A missing or
 * malformed index yields an empty list rather than an exception, so the
 * app still starts.
 */
function readBuiltInPresets(): readonly BuiltInPreset[] {
  const indexPath = join(bundledAssetLayout().presets, 'index.json');
  if (!existsSync(indexPath)) {
    console.error(`The built-in preset index is missing at ${indexPath}`);
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(indexPath, 'utf8')) as {
      presets?: { id?: string; file?: string; name?: string; category?: string }[];
    };
    return (parsed.presets ?? [])
      .filter(
        (preset): preset is { id: string; file: string; name: string; category: string } =>
          typeof preset.id === 'string' &&
          typeof preset.file === 'string' &&
          typeof preset.name === 'string' &&
          typeof preset.category === 'string',
      )
      .map((preset) => ({
        id: preset.id,
        name: preset.name,
        category: preset.category,
        url: `${ASSET_SCHEME}://bundle/presets/${preset.file}`,
      }));
  } catch (error: unknown) {
    console.error('The built-in preset index could not be read', error);
    return [];
  }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1024,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    show: false,
    backgroundColor: '#12141a',
    title: 'PracticePlayer',
    webPreferences: {
      ...rendererWebPreferences,
      preload: join(__dirname, '../preload/index.cjs'),
    },
  });

  window.once('ready-to-show', () => {
    window.show();
  });

  // Never navigate to remote content and never open arbitrary windows.
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return window;
}

/**
 * Starts or stops the power-save blocker.
 *
 * The blocker is active only during playback, so an idle app never keeps
 * the machine awake.
 */
function setPowerSaveBlocker(active: boolean): void {
  if (active) {
    if (activePowerSaveBlocker !== null) {
      return;
    }
    activePowerSaveBlocker = powerSaveBlocker.start('prevent-app-suspension');
    return;
  }
  if (activePowerSaveBlocker !== null) {
    powerSaveBlocker.stop(activePowerSaveBlocker);
    activePowerSaveBlocker = null;
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getAppInfo, () => getAppInfo());
  ipcMain.handle(IPC_CHANNELS.getBundledSoundFonts, () => BUNDLED_SOUND_FONTS);
  ipcMain.handle(IPC_CHANNELS.getBuiltInPresets, () => readBuiltInPresets());
  ipcMain.handle(IPC_CHANNELS.setPowerSaveBlocker, (_event, active: unknown) => {
    setPowerSaveBlocker(active === true);
  });
}

void app.whenReady().then(
  () => {
    registerIpcHandlers();
    applyContentSecurityPolicy();
    registerAssetProtocol();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  },
  (error: unknown) => {
    console.error('Failed to start PracticePlayer', error);
    app.quit();
  },
);

app.on('window-all-closed', () => {
  setPowerSaveBlocker(false);
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
