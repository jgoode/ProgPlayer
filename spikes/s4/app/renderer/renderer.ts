/**
 * Renderer of the Spike S4 packaging harness.
 *
 * It fetches the large bundled asset twice over the `s4://` protocol: once
 * to measure the cold fetch (the first read after launch, which includes
 * opening the file and decoding the response) and once to measure the warm
 * fetch (the file is in the OS page cache by then).
 *
 * The result is handed to the main process through the preload's single
 * typed channel; the renderer has no Node access.
 *
 * This file is deliberately a *script*, not a module: it is loaded with a
 * classic `<script src>` tag from a `file://` URL (Chromium blocks module
 * scripts over `file://`), and a module would compile to a script that
 * references `exports`.
 */

const ASSET_URL = 's4://assets/sample.bin';

async function measureFetch(): Promise<AssetMeasurement> {
  try {
    const coldStart = performance.now();
    const coldResponse = await fetch(ASSET_URL);
    const coldBody = await coldResponse.arrayBuffer();
    const coldFetchMs = performance.now() - coldStart;

    const warmStart = performance.now();
    const warmResponse = await fetch(ASSET_URL);
    const warmBody = await warmResponse.arrayBuffer();
    const warmFetchMs = performance.now() - warmStart;

    const measurement: AssetMeasurement = {
      coldFetchMs,
      warmFetchMs,
      bytes: coldBody.byteLength,
      contentType: coldResponse.headers.get('content-type') ?? '',
    };

    if (warmBody.byteLength !== coldBody.byteLength) {
      measurement.error = 'byte-length mismatch between cold and warm fetches';
    }

    return measurement;
  } catch (error) {
    return {
      coldFetchMs: 0,
      warmFetchMs: 0,
      bytes: 0,
      contentType: '',
      error: String(error),
    };
  }
}

async function run(): Promise<void> {
  const status = document.querySelector('#status');
  if (status !== null) status.textContent = 'measuring…';

  const measurement = await measureFetch();
  if (status !== null) {
    status.textContent = measurement.error ?? `loaded ${measurement.bytes} bytes`;
  }

  window.spikeS4?.reportAssetMeasurement(measurement);
}

void run();
