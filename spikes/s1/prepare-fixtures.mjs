#!/usr/bin/env node
/**
 * Downloads the SoundFont fixtures used by the Spike S1 measurement run.
 *
 * The fonts are not committed to the repository (32 MB + 9 MB of binary
 * assets). Run this script once before `pnpm run spike:s1`.
 *
 * GeneralUser GS is redistributed under the permissive "GeneralUser GS
 * License v2.0" (see docs/gap-analysis.md §4).
 */

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDirectory = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');

const fixtures = [
  {
    file: 'GeneralUser-GS.sf2',
    url: 'https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/GeneralUser-GS.sf2',
    sha256: '9575028c7a1f589f5770fccc8cff2734566af40cd26ed836944e9a5152688cfe',
  },
  {
    file: 'GeneralUser-GS-LICENSE.txt',
    url: 'https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/documentation/LICENSE.txt',
    sha256: null,
  },
];

async function download(fixture) {
  const target = resolve(fixtureDirectory, fixture.file);
  const existing = await stat(target).catch(() => null);
  if (existing) {
    console.log(`${fixture.file}: already present (${existing.size} bytes)`);
    return;
  }

  const response = await fetch(fixture.url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${fixture.url}: HTTP ${response.status}`);
  }

  const temporary = `${target}.download`;
  await mkdir(fixtureDirectory, { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));

  const digest = createHash('sha256');
  digest.update(await import('node:fs/promises').then((fs) => fs.readFile(temporary)));
  const actual = digest.digest('hex');
  if (fixture.sha256 && actual !== fixture.sha256) {
    throw new Error(
      `Checksum mismatch for ${fixture.file}: expected ${fixture.sha256}, got ${actual}`,
    );
  }

  await rename(temporary, target);
  console.log(`${fixture.file}: downloaded (${fixture.sha256 ? actual : actual})`);
}

for (const fixture of fixtures) {
  await download(fixture);
}

console.log('\nOptional SF3 arm:');
console.log(
  '  sf2-cutter v0.1.4 (MIT) converts the SF2 fixture to SF3:\n' +
    '    sf2-cutter convert GeneralUser-GS.sf2 -o GeneralUser-GS.sf3 --quality 0.6\n' +
    '  Expected output: 9,176,020 bytes, sha256 37c3eb58a718a3b6d26b15f27476ba26536caedf85b3d4b7e04f88bd9619a9fd',
);
