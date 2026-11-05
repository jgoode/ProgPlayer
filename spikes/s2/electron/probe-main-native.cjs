/**
 * Probes whether the native MIDI candidate can load inside the Electron
 * main process (the only place a native Node module can live: the renderer
 * has no Node integration and the preload is sandboxed).
 */

const { app } = require('electron');

app.whenReady().then(() => {
  try {
    const midi = require('@julusian/midi');
    const outputs = midi.Output.getPortNames();
    console.log(`NATIVE_OK outputs=${JSON.stringify(outputs)}`);
  } catch (error) {
    console.log(`NATIVE_FAIL ${error instanceof Error ? error.message : String(error)}`);
  }
  app.exit(0);
});
