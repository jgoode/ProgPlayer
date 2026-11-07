#!/usr/bin/env node
/**
 * Launches the packaged Spike S4 app and records the first-launch load
 * measurement.
 *
 * The packaged app writes its own report (main-process timings plus the
 * renderer's cold and warm asset fetches) to the path given in
 * `S4_REPORT_PATH`. This script starts the packaged binary with that
 * environment variable set and waits for the report to appear.
 *
 * The measurement is a *cold start* in the sense that matters for NFR-PRF-2:
 * a fresh process starts, the window opens and the renderer fetches the
 * bundled asset for the first time. It is not a cold *disk* cache — the CI
 * runner has just written the installer, so the asset bytes may still be in
 * the page cache. The report states both numbers so the reader can tell.
 *
 * Two launch modes:
 *
 *  - `packaged` (default): the platform's own packaged executable. This is
 *    the mode CI uses, because it is the only one that measures the
 *    installed layout.
 *  - `asar`: the packaged ASAR archive run by the development Electron
 *    binary, with the asset directory pointed at the packaged resource
 *    directory. This is the fallback for developer machines whose
 *    Application Control policy blocks unsigned executables — the
 *    Workstation's Smart App Control does exactly that (see the report).
 *    It measures the same asset layout and the same code, but it is not the
 *    installed executable, so the report records which mode was used.
 *
 * The CI workflow always uses the `packaged` mode: the GitHub-hosted runners
 * do not enforce Smart App Control, so the installed executable runs there.
 */

import { spawn } from 'node:child_process';
import { access, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const spikeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(spikeRoot, '..', '..');
const packagesRoot = resolve(spikeRoot, 'app', 'dist', 'packages');

const platform = process.platform;
const arch = process.arch;

function packagedExecutable() {
  if (platform === 'win32') {
    return resolve(packagesRoot, 'win-unpacked', 'PracticePlayer S4 Spike.exe');
  }
  if (platform === 'darwin') {
    return resolve(
      packagesRoot,
      arch === 'arm64' ? 'mac-arm64' : 'mac',
      'PracticePlayer S4 Spike.app',
      'Contents',
      'MacOS',
      'PracticePlayer S4 Spike',
    );
  }
  return resolve(packagesRoot, 'linux-unpacked', 'practiceplayer-s4-spike');
}

function packagedResourceAssets() {
  if (platform === 'win32') {
    return resolve(packagesRoot, 'win-unpacked', 'resources', 'assets');
  }
  if (platform === 'darwin') {
    return resolve(
      packagesRoot,
      arch === 'arm64' ? 'mac-arm64' : 'mac',
      'PracticePlayer S4 Spike.app',
      'Contents',
      'Resources',
      'assets',
    );
  }
  return resolve(packagesRoot, 'linux-unpacked', 'resources', 'assets');
}

function packagedAsar() {
  if (platform === 'win32') {
    return resolve(packagesRoot, 'win-unpacked', 'resources', 'app.asar');
  }
  if (platform === 'darwin') {
    return resolve(
      packagesRoot,
      arch === 'arm64' ? 'mac-arm64' : 'mac',
      'PracticePlayer S4 Spike.app',
      'Contents',
      'Resources',
      'app.asar',
    );
  }
  return resolve(packagesRoot, 'linux-unpacked', 'resources', 'app.asar');
}

async function exists(path) {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function main() {
  const mode = process.env.S4_MEASURE_MODE ?? 'packaged';
  const reportDirectory = resolve(spikeRoot, 'results');
  await mkdir(reportDirectory, { recursive: true });
  const reportPath = resolve(reportDirectory, `first-launch-${platform}-${arch}-${mode}.json`);
  await rm(reportPath, { force: true });

  let command;
  let args;
  let env = { ...process.env, S4_REPORT_PATH: reportPath };

  if (mode === 'asar') {
    command = resolve(
      repoRoot,
      'node_modules',
      'electron',
      'dist',
      platform === 'win32' ? 'electron.exe' : 'electron',
    );
    args = [packagedAsar()];
    env = { ...env, S4_ASSET_ROOT: packagedResourceAssets() };
  } else {
    command = packagedExecutable();
    args = [];
  }

  if (!(await exists(command))) {
    throw new Error(`Executable not found: ${command}`);
  }

  const child = spawn(command, args, {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stdout.on('data', (chunk) => process.stdout.write(`[app] ${chunk}`));
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
    process.stderr.write(`[app] ${chunk}`);
  });

  const timeoutMs = 120_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await exists(reportPath)) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
      const report = JSON.parse(await readFile(reportPath, 'utf8'));
      console.log(JSON.stringify({ mode, ...report }, null, 2));
      if (!child.killed) child.kill();
      return;
    }
    if (child.exitCode !== null) {
      throw new Error(
        `The app exited with code ${child.exitCode} before writing a report.\n${stderr}`,
      );
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }

  child.kill();
  throw new Error(`The app did not write a report within ${timeoutMs} ms`);
}

await main();
