/**
 * Main process of the Spike S4 packaging harness.
 *
 * The spike answers three questions with measurements:
 *
 * 1. Does electron-builder package a large asset (as `extraResources`) and
 *    produce an installer on each platform?
 * 2. How large is the resulting installer?
 * 3. How long does a cold start take until the renderer has the large asset
 *    in hand over a custom protocol handler?
 *
 * The asset is served over a `s4://` scheme so the renderer never touches
 * the file system (the same rule the production app follows for SoundFonts).
 */

import { createReadStream } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';

import { BrowserWindow, app, ipcMain, protocol } from 'electron';

import { ASSET_SCHEME, resolveAssetPath } from './asset-path.js';

/** Process-relative timestamp taken as early as possible in the main script. */
const processStart = performance.now();

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

const reportPath = process.env.S4_REPORT_PATH ?? '';

/**
 * The bundled asset directory.
 *
 * In the packaged app this is `resources/assets`, which is where
 * electron-builder's `extraResources` puts it. `S4_ASSET_ROOT` overrides it,
 * which is only used by the local measurement harness on machines whose
 * policy blocks the unsigned packaged executable: the harness then runs the
 * packaged ASAR with the development Electron binary and points it at the
 * packaged resource directory.
 */
const assetRoot =
  process.env.S4_ASSET_ROOT ??
  (app.isPackaged
    ? join(process.resourcesPath, 'assets')
    : join(app.getAppPath(), 'assets'));

const measurements = {
  appReadyMs: 0,
  rendererLoadedMs: 0,
  windowShownMs: 0,
  assetRoot,
  assetFiles: [] as { name: string; bytes: number }[],
};

function registerAssetProtocol(): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    const filePath = resolveAssetPath(request.url, assetRoot);

    if (filePath === null) {
      return new Response('Not found', { status: 404 });
    }

    try {
      const info = await stat(filePath);
      if (!info.isFile()) {
        return new Response('Not found', { status: 404 });
      }

      const body = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>;
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': String(info.size),
          'cache-control': 'no-store',
        },
      });
    } catch (error) {
      console.error(`[protocol] ${request.url} failed: ${String(error)}`);
      return new Response('Not found', { status: 404 });
    }
  });
}

async function listAssetFiles(): Promise<void> {
  const entries = await readdir(assetRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const info = await stat(join(assetRoot, entry.name)).catch(() => null);
    if (info === null) continue;
    measurements.assetFiles.push({ name: entry.name, bytes: info.size });
  }
}

async function writeReport(payload: Record<string, unknown>): Promise<void> {
  if (reportPath === '') {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(payload, null, 2), 'utf8');
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 900,
    height: 600,
    show: false,
    backgroundColor: '#12141a',
    title: 'PracticePlayer S4 Spike',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
      preload: join(__dirname, 'preload.js'),
    },
  });

  window.once('ready-to-show', () => {
    window.show();
  });

  // `show` is emitted when the window becomes visible. It can fire before
  // this listener is attached on some platforms, so the constructor-time
  // visibility is recorded separately.
  if (window.isVisible()) {
    measurements.windowShownMs = performance.now() - processStart;
  }
  window.on('show', () => {
    measurements.windowShownMs = performance.now() - processStart;
  });

  window.webContents.once('did-finish-load', () => {
    measurements.rendererLoadedMs = performance.now() - processStart;
  });

  void window.loadFile(join(__dirname, '..', 'renderer', 'index.html'));

  return window;
}

/**
 * Waits until the window has actually been shown, so the report carries the
 * "the user can see the app" figure rather than the "the renderer finished
 * its work" figure.
 */
function waitForWindowShown(window: BrowserWindow, timeoutMs: number): Promise<void> {
  if (window.isVisible() && measurements.windowShownMs > 0) {
    return Promise.resolve();
  }

  const { promise, resolve: resolveWait } = Promise.withResolvers<void>();

  const timer = setTimeout(() => {
    window.removeListener('show', onShow);
    resolveWait();
  }, timeoutMs);

  function onShow(): void {
    clearTimeout(timer);
    resolveWait();
  }

  window.once('show', onShow);

  return promise;
}

ipcMain.on('s4:asset-measurement', (_event, payload: Record<string, unknown>) => {
  void (async () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window !== undefined) {
      await waitForWindowShown(window, 10_000);
    }

    await writeReport({
      ...measurements,
      totalMs: performance.now() - processStart,
      renderer: payload,
    });
    app.quit();
  })();
});

void app.whenReady().then(async () => {
  measurements.appReadyMs = performance.now() - processStart;
  registerAssetProtocol();
  await listAssetFiles();
  createWindow();
});
