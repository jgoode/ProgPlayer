// Electron driver for the S3 benchmark.
//
// Runs the encoders inside a real Chromium renderer, which is where the app
// will run them. This matters for `@mediabunny/mp3-encoder`, which needs the
// WebCodecs `AudioEncoder` API that Node does not provide.
//
// It drives the same page as `spikes/s3/renderer/index.html` and prints the
// JSON result to stdout.
//
// Usage: electron spikes/s3/electron/drive.cjs

const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const resultsPath = process.env.S3_ELECTRON_RESULTS;
const benchDir = process.env.S3_BENCH_DIR ?? '';
const rustyWasm = process.env.S3_RUSTY_WASM ?? '';
const seconds = process.env.S3_SECONDS ?? '300';

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: true,
    },
  });

  const indexPath = path.join(__dirname, '..', 'renderer', 'index.html');
  const query = new URLSearchParams({
    seconds,
    benchDir: benchDir.replace(/\\/g, '/'),
    rustyWasm: rustyWasm.replace(/\\/g, '/'),
  });
  await window.loadFile(indexPath, { query: { ...Object.fromEntries(query) } });

  const result = await window.webContents.executeJavaScript('window.__runBenchmark()', true);

  if (resultsPath) {
    fs.writeFileSync(resultsPath, `${JSON.stringify(result, null, 2)}\n`);
  }
  console.log(JSON.stringify(result, null, 2));

  app.quit();
});

app.on('window-all-closed', () => app.quit());
