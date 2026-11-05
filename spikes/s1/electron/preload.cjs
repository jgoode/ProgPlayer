/**
 * Spike S1 preload bridge.
 *
 * Minimal, typed-by-convention surface: process metrics for the CPU/memory
 * measurement and a way to persist the JSON report. No generic IPC escape
 * hatch, matching the production preload policy (NFR-SEC-1).
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spike', {
  getMetrics: () => ipcRenderer.invoke('spike:get-metrics'),
  getTreeMetrics: () => ipcRenderer.invoke('spike:get-tree-metrics'),
  saveReport: (report) => ipcRenderer.invoke('spike:save-report', report),
});
