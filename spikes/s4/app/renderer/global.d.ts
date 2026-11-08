/**
 * Ambient declarations for the Spike S4 renderer.
 *
 * The declarations live in a separate file so that `renderer.ts` stays a
 * *script* rather than a module. A module compiles to a script that opens
 * with `Object.defineProperty(exports, ...)`, and `exports` does not exist
 * in a browser page — the page would fail to load with a ReferenceError.
 */

interface AssetMeasurement {
  coldFetchMs: number;
  warmFetchMs: number;
  bytes: number;
  contentType: string;
  error?: string;
}

interface SpikeApi {
  reportAssetMeasurement(measurement: AssetMeasurement): void;
}

interface Window {
  spikeS4?: SpikeApi;
}
