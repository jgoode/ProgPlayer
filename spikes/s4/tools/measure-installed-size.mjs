#!/usr/bin/env node
/**
 * Measures the *installed* size of the packaged application.
 *
 * The installer size is what a user downloads; the installed size is what
 * occupies the disk after installation. Both matter for the size budget
 * (OQ-11), and they differ a lot: the macOS bundle contains the Electron
 * framework plus the bundled asset, and the Windows NSIS installer
 * compresses both.
 *
 * The measurement is per platform because the unpacked directory names
 * differ:
 *
 *  - Windows: `win-unpacked`
 *  - macOS:   `mac` (x64) or `mac-arm64` (arm64), each containing
 *             `PracticePlayer S4 Spike.app`
 *
 * On macOS the `.app` is a bundle with symlinked framework versions; the
 * walk below counts each real file once, so the framework is not counted
 * three times.
 */

import { readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const spikeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagesRoot = resolve(spikeRoot, 'app', 'dist', 'packages');

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sums the real size of the files under `root`.
 *
 * macOS framework bundles hard-link the same binary into several
 * `Versions/` directories, so a naive walk counts the Electron framework
 * three times. Every file is therefore counted once, keyed by its device
 * and inode number.
 */
async function walk(root, seen = new Set()) {
  let bytes = 0;
  let files = 0;
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await walk(full, seen);
      bytes += nested.bytes;
      files += nested.files;
      continue;
    }
    const info = await stat(full);
    const key = `${info.dev}:${info.ino}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    bytes += info.size;
    files += 1;
  }
  return { bytes, files };
}

async function findInstalledRoot() {
  const candidates = [
    ['win-unpacked', join(packagesRoot, 'win-unpacked')],
    ['mac-arm64', join(packagesRoot, 'mac-arm64')],
    ['mac', join(packagesRoot, 'mac')],
  ];
  for (const [name, path] of candidates) {
    if (await exists(path)) {
      return { name, path };
    }
  }
  return null;
}

async function main() {
  const found = await findInstalledRoot();
  if (!found) {
    console.log(JSON.stringify({ note: 'no unpacked directory found' }, null, 2));
    return;
  }

  // On macOS the app bundle is one level down; measure the bundle itself.
  let measuredRoot = found.path;
  const appBundle = join(found.path, 'PracticePlayer S4 Spike.app');
  if (await exists(appBundle)) {
    measuredRoot = appBundle;
  }

  const { bytes, files } = await walk(measuredRoot);
  const assetRoot = join(measuredRoot, 'Contents', 'Resources', 'assets');
  const assetRootExists = await exists(assetRoot);

  const report = {
    platform: process.platform,
    arch: process.arch,
    unpackedDirectory: found.name,
    installedBytes: bytes,
    installedMB: Number((bytes / 1048576).toFixed(2)),
    fileCount: files,
    assetDirectory: assetRootExists ? 'Contents/Resources/assets' : 'resources/assets',
  };

  console.log(JSON.stringify(report, null, 2));
}

await main();
