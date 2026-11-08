#!/usr/bin/env node
/**
 * Runs electron-builder for the Spike S4 packaging harness and records the
 * size of every produced artefact.
 *
 * The size report is the measurement the spike exists to produce: it is
 * written next to the packages as `sizes.json` and uploaded as a CI
 * artefact.
 */

import { spawnSync } from 'node:child_process';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const spikeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = resolve(spikeRoot, 'app');
const repoRoot = resolve(spikeRoot, '..', '..');
const outputRoot = resolve(appRoot, 'dist', 'packages');

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}`);
  }
}

const args = process.argv.slice(2);
const builderArgs = args.length > 0 ? args : ['--publish', 'never'];

run(
  process.execPath,
  [
    resolve(repoRoot, 'node_modules', 'electron-builder', 'cli.js'),
    '--config',
    resolve(appRoot, 'electron-builder.yml'),
    ...builderArgs,
  ],
  appRoot,
);

await mkdir(outputRoot, { recursive: true });

const artefacts = [];
for (const entry of await readdir(outputRoot, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  if (entry.name.endsWith('.yml') || entry.name.endsWith('.json')) continue;
  const info = await stat(join(outputRoot, entry.name));
  artefacts.push({
    name: entry.name,
    bytes: info.size,
    megabytes: Number((info.size / (1024 * 1024)).toFixed(2)),
  });
}

const report = {
  platform: process.platform,
  arch: process.arch,
  electronVersion: '45.2.2',
  electronBuilderVersion: '26.18.0',
  artefacts: artefacts.sort((a, b) => b.bytes - a.bytes),
};

await writeFile(resolve(outputRoot, 'sizes.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report, null, 2));
