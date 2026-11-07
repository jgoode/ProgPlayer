/**
 * Preload for the Spike S4 packaging harness.
 *
 * The renderer has no Node access; it can only send the measurement payload
 * back to the main process over one named channel.
 */

import { contextBridge, ipcRenderer } from 'electron';

export interface AssetMeasurement {
  coldFetchMs: number;
  warmFetchMs: number;
  bytes: number;
  contentType: string;
  error?: string;
}

export interface SpikeApi {
  reportAssetMeasurement(measurement: AssetMeasurement): void;
}

const api: SpikeApi = {
  reportAssetMeasurement(measurement: AssetMeasurement): void {
    ipcRenderer.send('s4:asset-measurement', measurement);
  },
};

contextBridge.exposeInMainWorld('spikeS4', api);
