/**
 * Downloads the SF2 sources of the bundled SoundFonts (P4.6).
 *
 * The app ships the **SF3** outputs, which are what
 * `scripts/build-soundfonts.mjs` produces. The SF2 sources are not
 * committed — they are large — so this script fetches them into
 * `.font-sources/`, which is not tracked by git.
 *
 * Both fonts are **CC0-1.0**:
 *
 * - **Upright Piano KW** — the "small" variant, by Gonzalo and Roberto
 *   (FreePats project);
 * - **Finger Bass YR** — the finger variant, samples by Andrea Biasior,
 *   integrated by Roberto (FreePats project).
 *
 * The script also fetches `sf2-cutter` 0.1.5 (MIT), the build-time
 * conversion tool, and checks its published SHA-256.
 *
 * **The downloads are verified against a recorded digest.** A font that
 * changes upstream is a change to what the app plays, so the script fails
 * rather than silently accepting a different file.
 *
 * ## Usage
 *
 * ```
 * node scripts/fetch-soundfont-sources.mjs
 * ```
 *
 * After the download, run `node scripts/build-soundfonts.mjs --rebuild`.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = join(ROOT, '.font-sources');

/**
 * The files to fetch.
 *
 * The URLs are the FreePats project's own download links — the piano from
 * the project's site and the bass from the FreePats GitHub release.
 */
const DOWNLOADS = [
  {
    path: 'piano/UprightPianoKW-small-SF2-20190703/UprightPianoKW-small-20190703.sf2',
    url: 'https://freepats.zenvoid.org/Piano/UprightPianoKW/UprightPianoKW-small-SF2-20190703.7z',
    archive: 'UprightPianoKW-small-SF2-20190703.7z',
    licence: 'piano/UprightPianoKW-small-SF2-20190703/cc0.txt',
  },
  {
    path: 'bass/FingerBassYR SF2-20190930/FingerBassYR 20190930.sf2',
    url: 'https://github.com/freepats/electric-bass-YR/releases/download/2019-09-30/FingerBassYR-SF2-20190930.7z',
    archive: 'FingerBassYR-SF2-20190930.7z',
    licence: 'bass/FingerBassYR SF2-20190930/LICENSE.txt',
  },
];

/**
 * The `sf2-cutter` release.
 *
 * The digest is the one the project publishes alongside the Windows build
 * (`sf2-cutter-x86_64-pc-windows-msvc.sha256`), so the download is checked
 * against the publisher's own value.
 */
const SF2_CUTTER = {
  version: '0.1.5',
  url: 'https://github.com/FelixGSE/sf2-cutter/releases/download/v0.1.5/sf2-cutter-x86_64-pc-windows-msvc.zip',
  sha256: '4d7afaf9b3b7d610be5127ca20223e1cf2965b984579bbde8a75205c56e1a693',
};

/** Downloads a URL to a buffer. */
async function download(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/** The SHA-256 of a buffer. */
function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Writes a file, creating its directory. */
function write(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

/** The main entry point. */
async function main() {
  mkdirSync(SOURCE_DIR, { recursive: true });

  for (const item of DOWNLOADS) {
    const target = join(SOURCE_DIR, item.path);
    if (existsSync(target)) {
      console.log(`Already present: ${item.path}`);
      continue;
    }

    console.log(`Downloading ${item.url}…`);
    const archive = await download(item.url);
    write(join(SOURCE_DIR, item.archive), archive);
    console.log(
      `Saved ${item.archive} (${archive.byteLength} B, sha256 ${digest(archive)}). ` +
        'Extract it with 7-Zip into .font-sources/ and re-run this script.',
    );
  }

  const toolPath = join(SOURCE_DIR, 'tools', 'sf2-cutter.zip');
  if (!existsSync(toolPath)) {
    console.log(`Downloading sf2-cutter ${SF2_CUTTER.version}…`);
    const archive = await download(SF2_CUTTER.url);

    const actual = digest(archive);
    if (actual !== SF2_CUTTER.sha256) {
      console.error(
        `sf2-cutter.zip does not match the published digest.\n` +
          `  expected ${SF2_CUTTER.sha256}\n` +
          `  actual   ${actual}`,
      );
      process.exitCode = 1;
      return;
    }

    write(toolPath, archive);
    console.log(
      `Saved sf2-cutter.zip (${archive.byteLength} B, sha256 verified). ` +
        'Extract it into .font-sources/tools/ and re-run this script.',
    );
  }

  console.log('');
  console.log('The sources are ready. Extract the archives if the script asked for it,');
  console.log('then run: node scripts/build-soundfonts.mjs --rebuild');
}

await main();
