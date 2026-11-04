import { join } from 'node:path';

import { app, BrowserWindow, ipcMain, session, shell } from 'electron';

import { IPC_CHANNELS } from '@core/contracts/api';

import { getAppInfo } from './app-info';
import {
  contentSecurityPolicy,
  developmentContentSecurityPolicy,
  rendererWebPreferences,
} from './security';

const isDevelopment = !app.isPackaged;

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

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getAppInfo, () => getAppInfo());
}

void app.whenReady().then(
  () => {
    registerIpcHandlers();
    applyContentSecurityPolicy();
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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
