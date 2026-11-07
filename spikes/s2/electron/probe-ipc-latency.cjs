/**
 * Measures the renderer → main process IPC cost that a native MIDI sink
 * would have to pay on every message.
 *
 * Two shapes are compared:
 *   - `ipcRenderer.invoke` — a request/response round trip.
 *   - `ipcRenderer.send` — a one-way message; the main process replies with
 *     a separate `send`, so the measured latency includes the time the
 *     message waits in the main process's event-loop queue before the
 *     renderer sees any sign of it.
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CALLS = Number(process.argv[process.argv.indexOf('--calls') + 1] ?? '300');

const PRELOAD_SOURCE = `
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('probeHost', {
  invokePing: () => ipcRenderer.invoke('probe:ping'),
  sendPing: (id) => ipcRenderer.send('probe:ping', id),
  onPong: (callback) => ipcRenderer.on('probe:pong', (_event, id) => callback(id)),
});
`;

app.whenReady().then(async () => {
  const directory = mkdtempSync(join(tmpdir(), 's2-ipc-'));
  const preloadPath = join(directory, 'preload.cjs');
  writeFileSync(preloadPath, PRELOAD_SOURCE, 'utf8');

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  ipcMain.handle('probe:ping', () => true);
  ipcMain.on('probe:ping', (event, id) => {
    event.sender.send('probe:pong', id);
  });

  await window.loadURL('data:text/html,<html><body>probe</body></html>');

  const result = await window.webContents.executeJavaScript(`(async () => {
    const invoke = [];
    for (let index = 0; index < ${CALLS}; index += 1) {
      const started = performance.now();
      await window.probeHost.invokePing();
      invoke.push(performance.now() - started);
    }

    const send = [];
    await new Promise((done) => {
      const pending = [];
      let received = 0;
      window.probeHost.onPong(() => {
        const started = pending.shift();
        send.push(performance.now() - started);
        received += 1;
        if (received >= ${CALLS}) done();
      });
      for (let index = 0; index < ${CALLS}; index += 1) {
        const started = performance.now();
        pending.push(started);
        window.probeHost.sendPing(index);
      }
    });

    return { invoke, send };
  })()`);

  const summarize = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const at = (fraction) =>
      sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
    return {
      count: sorted.length,
      min: sorted[0],
      p50: at(0.5),
      p95: at(0.95),
      p99: at(0.99),
      max: sorted[sorted.length - 1],
    };
  };

  console.log(
    `IPC invoke=${JSON.stringify(summarize(result.invoke))} send=${JSON.stringify(summarize(result.send))}`,
  );
  app.exit(0);
});
