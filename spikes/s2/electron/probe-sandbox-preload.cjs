/**
 * Probes whether the native MIDI candidate can load inside a **sandboxed**
 * preload (the configuration `implementation.md` §2.7 requires).
 *
 * A sandboxed preload has no Node module resolution: `require` is limited
 * to a small allow-list of Electron and Node built-ins.
 */

const { app, BrowserWindow } = require('electron');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const PRELOAD_SOURCE = `
const { contextBridge } = require('electron');
let result;
try {
  const midi = require('@julusian/midi');
  result = 'NATIVE_OK ' + JSON.stringify(midi.Output.getPortNames());
} catch (error) {
  result = 'NATIVE_FAIL ' + (error && error.message ? error.message : String(error));
}
contextBridge.exposeInMainWorld('probe', { result });
`;

app.whenReady().then(async () => {
  const directory = mkdtempSync(join(tmpdir(), 's2-probe-'));
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

  await window.loadURL('data:text/html,<html><body>probe</body></html>');
  const result = await window.webContents.executeJavaScript('window.probe.result');
  console.log(result);
  app.exit(0);
});
