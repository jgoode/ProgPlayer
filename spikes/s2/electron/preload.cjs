/**
 * Spike S2 preload bridge.
 *
 * The renderer has no Node access. The driver invokes these calls through
 * `webContents.executeJavaScript` on `window.spike`, so the preload only has
 * to expose the small, typed surface the measurement needs.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spikeHost', {
  saveReport: (name, report) => ipcRenderer.invoke('spike:save-report', name, report),
  startPowerSaveBlocker: () => ipcRenderer.invoke('spike:start-power-save-blocker'),
  stopPowerSaveBlocker: () => ipcRenderer.invoke('spike:stop-power-save-blocker'),
  windowState: () => ipcRenderer.invoke('spike:window-state'),
  minimize: () => ipcRenderer.invoke('spike:minimize'),
  restore: () => ipcRenderer.invoke('spike:restore'),
});
