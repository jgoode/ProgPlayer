#!/usr/bin/env node
/**
 * Builds the Spike S4 packaging harness.
 *
 * Steps:
 *  1. Compile the Electron main and preload scripts (TypeScript → JavaScript).
 *  2. Compile the renderer script.
 *  3. Copy the renderer HTML into the output directory.
 *  4. Prepare the large sample asset.
 *
 * The packaging step (electron-builder) is separate — see `package.mjs`.
 */

import { spawnSync } from 'node:child_process';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const spikeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = resolve(spikeRoot, 'app');
const repoRoot = resolve(spikeRoot, '..', '..');

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}`);
  }
}

const tsc = resolve(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');

run(process.execPath, [tsc, '--noEmit', '-p', resolve(spikeRoot, 'tsconfig.json')], appRoot);
run(process.execPath, [tsc, '-p', resolve(spikeRoot, 'tsconfig.json')], appRoot);

await mkdir(resolve(appRoot, 'dist', 'renderer'), { recursive: true });
await copyFile(
  resolve(appRoot, 'renderer', 'index.html'),
  resolve(appRoot, 'dist', 'renderer', 'index.html'),
);

run(process.execPath, [resolve(spikeRoot, 'tools', 'prepare-asset.mjs')], spikeRoot);

console.log('S4 spike app built.');
