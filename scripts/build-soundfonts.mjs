/**
 * Builds the bundled SoundFonts from their SF2 sources (P4.6).
 *
 * The app ships two fonts, both CC0:
 *
 * - **Upright Piano KW** (the chords) — the "small" variant;
 * - **Finger Bass YR** (the bass) — the finger variant.
 *
 * Both are converted to **SF3** (Ogg Vorbis-compressed SoundFont), which is
 * roughly a seventh of the SF2 size. The conversion is done with
 * `sf2-cutter` 0.1.5 (MIT, build-time only — see the licence register in
 * `docs/gap-analysis.md` §4).
 *
 * **The conversion must be pinned.** Both the tool's version and the
 * Vorbis quality change the output size *and* the audio, so neither is a
 * default: the script records the digest of every input and every output,
 * so a changed font or a changed tool is visible in the diff rather than
 * silently changing what the app plays.
 *
 * The script is idempotent: it does nothing when the outputs are already
 * correct, and it fails rather than overwriting an output that does not
 * match the recorded digest.
 *
 * ## Reproducibility
 *
 * `sf2-cutter` writes **random Ogg serial numbers**, so two conversions of
 * the same source produce different bytes even though the audio is
 * identical. The script therefore normalizes the container after the
 * conversion: every page gets the same serial number and a freshly
 * computed CRC. The result is byte-identical across runs, so the recorded
 * digests are meaningful and a font change shows up as a real diff.
 *
 * ## Usage
 *
 * ```
 * node scripts/build-soundfonts.mjs            # verify the outputs
 * node scripts/build-soundfonts.mjs --rebuild  # rebuild them
 * ```
 *
 * The SF2 sources are **not** committed: they are downloaded from the
 * FreePats project by `scripts/fetch-soundfont-sources.mjs`, because the
 * SF2 files are large and the SF3 outputs are what the app actually ships.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = join(ROOT, '.font-sources');
const OUTPUT_DIR = join(ROOT, 'resources', 'soundfonts');
const MANIFEST_PATH = join(OUTPUT_DIR, 'manifest.json');

/** The SF2-Cutter version this script pins. */
const SF2_CUTTER_VERSION = '0.1.5';

/**
 * The Vorbis quality the conversion uses.
 *
 * S4 measured the quality levels; `0.4` is the value the spike used, and
 * changing it changes both the size and the audio.
 */
const VORBIS_QUALITY = '0.4';

/** The fonts the app bundles. */
const FONTS = [
  {
    id: 'UprightPianoKW',
    part: 'chords',
    name: 'Upright Piano KW',
    source: 'piano/UprightPianoKW-small-SF2-20190703/UprightPianoKW-small-20190703.sf2',
    output: 'UprightPianoKW.sf3',
    licence: 'LICENSES/UprightPianoKW-CC0.txt',
  },
  {
    id: 'FingerBassYR',
    part: 'bass',
    name: 'Finger Bass YR',
    source: 'bass/FingerBassYR SF2-20190930/FingerBassYR 20190930.sf2',
    output: 'FingerBassYR.sf3',
    licence: 'LICENSES/FingerBassYR-LICENSE.txt',
  },
];

/** The SHA-256 of a file. */
function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * The Ogg container's CRC-32, with the polynomial `0x04c11db7`, no
 * reflection and no final inversion.
 *
 * This is the checksum Ogg specifies for each page; `sf2-cutter` uses the
 * standard library's CRC, which is the reflected variant, so the value is
 * computed here rather than taken from `node:zlib`.
 */
function oggCrc(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 24;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x80000000 ? ((crc << 1) ^ 0x04c11db7) & 0xffffffff : (crc << 1) & 0xffffffff;
    }
  }
  return crc >>> 0;
}

/** The offsets of every Ogg page in a buffer. */
function oggPages(bytes) {
  const pages = [];
  for (let index = 0; index + 27 <= bytes.length; index += 1) {
    if (
      bytes[index] === 0x4f &&
      bytes[index + 1] === 0x67 &&
      bytes[index + 2] === 0x67 &&
      bytes[index + 3] === 0x53
    ) {
      pages.push(index);
    }
  }
  return pages;
}

/**
 * Normalizes an SF3 file so that the same source always produces the same
 * bytes.
 *
 * Every page's serial number is replaced with a fixed value and its CRC
 * recomputed. The serial number is a container-level identifier that the
 * Ogg specification says has no meaning to a decoder; the CRC then has to
 * match the rewritten page, which the code does.
 */
function normalizeOgg(bytes) {
  const output = Buffer.from(bytes);
  const serial = Buffer.from([0x50, 0x50, 0x00, 0x01]);

  for (const start of oggPages(output)) {
    const segmentCount = output[start + 26];
    const pageLength =
      27 +
      segmentCount +
      output.subarray(start + 27, start + 27 + segmentCount).reduce((a, b) => a + b, 0);

    serial.copy(output, start + 14);
    output.fill(0, start + 22, start + 26);

    const crc = oggCrc(output.subarray(start, start + pageLength));
    output.writeUInt32LE(crc, start + 22);
  }

  return output;
}

/** Finds the `sf2-cutter` executable. */
function findTool() {
  // An explicit override wins, so the tool can be run from anywhere.
  const override = process.env.SF2_CUTTER;
  if (override !== undefined && override !== '') {
    return override;
  }

  const candidates = [
    join(SOURCE_DIR, 'tools', process.platform === 'win32' ? 'sf2-cutter.exe' : 'sf2-cutter'),
    join(ROOT, 'node_modules', '.bin', 'sf2-cutter'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Converts one SF2 file to SF3.
 *
 * The output is written to a temporary name and moved into place, so an
 * interrupted conversion never leaves a half-written font in the app's
 * resources.
 */
function convert(tool, source, output) {
  const temporary = `${output}.building`;
  rmSync(temporary, { force: true });
  execFileSync(
    tool,
    ['convert', source, '--output', temporary, '--to', 'sf3', '--quality', VORBIS_QUALITY],
    { stdio: 'inherit' },
  );

  // Normalize the container so the output is byte-reproducible.
  const converted = normalizeOgg(readFileSync(temporary));
  rmSync(temporary, { force: true });
  writeFileSync(output, converted);
}

/** The main entry point. */
function main() {
  const rebuild = process.argv.includes('--rebuild');
  const tool = findTool();

  if (tool === null) {
    console.error(
      'sf2-cutter was not found. Run `node scripts/fetch-soundfont-sources.mjs` first, ' +
        `or install sf2-cutter ${SF2_CUTTER_VERSION} (MIT).`,
    );
    process.exitCode = 1;
    return;
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });

  const manifest = {
    schemaVersion: 1,
    tool: `sf2-cutter ${SF2_CUTTER_VERSION}`,
    vorbisQuality: VORBIS_QUALITY,
    fonts: [],
  };

  for (const font of FONTS) {
    const source = join(SOURCE_DIR, font.source);
    const output = join(OUTPUT_DIR, font.output);
    const licence = join(OUTPUT_DIR, font.licence);

    if (!existsSync(source)) {
      console.error(`The SF2 source is missing: ${source}`);
      console.error('Run `node scripts/fetch-soundfont-sources.mjs` to download it.');
      process.exitCode = 1;
      return;
    }
    if (!existsSync(licence)) {
      console.error(`The licence text is missing: ${licence}`);
      process.exitCode = 1;
      return;
    }

    if (rebuild || !existsSync(output)) {
      console.log(`Converting ${font.id}…`);
      convert(tool, source, output);
    }

    manifest.fonts.push({
      id: font.id,
      part: font.part,
      name: font.name,
      source: font.source,
      sourceSha256: digest(source),
      output: font.output,
      outputSha256: digest(output),
      outputBytes: readFileSync(output).byteLength,
      licence: font.licence,
    });
  }

  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${MANIFEST_PATH}`);
}

main();
