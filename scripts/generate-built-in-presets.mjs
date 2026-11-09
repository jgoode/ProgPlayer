#!/usr/bin/env node
/**
 * Generate the built-in practice preset library from the Appendix A fixture.
 *
 * `tests/fixtures/theory/appendix-a-presets.json` is the authoritative
 * transcription of Appendix A in `docs/requirements.md`: it supplies every
 * preset's display name, home scale types and chord sequence. This script
 * enriches that source with the presentation metadata (category) and the
 * Appendix A bar structure (chord durations) and writes the runtime resources
 * consumed by the application:
 *
 *   resources/presets/<id>.json   one document per preset (29 files)
 *   resources/presets/index.json  manifest listing the presets in Appendix A order
 *
 * The output is deterministic: the same fixture always produces byte-identical
 * files, and re-running the generator is idempotent.
 *
 * Note on B5 (Jazz blues): Appendix A names this preset "Jazz blues (12-bar)"
 * and lists its bars as `I7 · IV7 · I7 · I7 · IV7 · ♯iv°7 · I7 · VI7 · ii7 ·
 * V7 · I7 / VI7 · ii7 / V7`. The first ten bars hold one chord each and the
 * last two bars hold two chords each, so the form is ten whole-chord bars
 * plus two two-chord bars: twelve bars in total, which is what the preset's
 * name says.
 *
 * Usage (from the repository root):
 *
 *   node scripts/generate-built-in-presets.mjs
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = join(projectRoot, 'tests', 'fixtures', 'theory', 'appendix-a-presets.json');
const outputDirectory = join(projectRoot, 'resources', 'presets');

/**
 * Appendix A is authored in 4/4, so one bar is four beats. The metadata table
 * records, for every appendix code, its library category and the home scale
 * types the fixture carries. The fixture's `home` array is authoritative; the
 * table below is checked against it so a divergence fails loudly instead of
 * silently shipping the wrong home scales.
 */
const PRESET_METADATA = {
  r1: { category: 'rock', home: ['mixolydian', 'major'] },
  r2: { category: 'rock', home: ['mixolydian'] },
  r3: { category: 'rock', home: ['major'] },
  r4: { category: 'rock', home: ['naturalMinor'] },
  r5: { category: 'rock', home: ['naturalMinor'] },
  r6: { category: 'rock', home: ['major'] },
  r7: { category: 'rock', home: ['major'] },
  r8: { category: 'rock', home: ['naturalMinor', 'phrygian'] },
  b1: { category: 'blues', home: ['mixolydian', 'major'] },
  b2: { category: 'blues', home: ['mixolydian', 'major'] },
  b3: { category: 'blues', home: ['naturalMinor'] },
  b4: { category: 'blues', home: ['mixolydian', 'major'] },
  b5: { category: 'blues', home: ['major'] },
  b6: { category: 'blues', home: ['mixolydian', 'major'] },
  j1: { category: 'jazz', home: ['major'] },
  j2: { category: 'jazz', home: ['naturalMinor', 'harmonicMinor'] },
  j3: { category: 'jazz', home: ['major'] },
  j4: { category: 'jazz', home: ['major'] },
  j5: { category: 'jazz', home: ['major'] },
  j6: { category: 'jazz', home: ['major'] },
  j7: { category: 'jazz', home: ['major'] },
  j8: { category: 'jazz', home: ['major'] },
  m1: { category: 'modal', home: ['dorian'] },
  m2: { category: 'modal', home: ['mixolydian'] },
  m3: { category: 'modal', home: ['phrygian'] },
  m4: { category: 'modal', home: ['lydian'] },
  m5: { category: 'modal', home: ['naturalMinor'] },
  m6: { category: 'modal', home: ['dorian'] },
  m7: { category: 'modal', home: ['locrian'] },
};

/**
 * Duration table (in beats) derived from the bar structure of Appendix A.
 *
 * One 4/4 bar equals four beats, so a chord held for one whole bar is four
 * beats and a chord sharing a bar with another chord is two beats. The table
 * lists the duration of every chord in fixture order:
 *
 *   - R1..R8, B1..B4, B6, J1..J4, J6..J8: one chord per bar (4 beats each).
 *   - B5 (Jazz blues, 12-bar): ten single-chord bars, then two bars that each
 *     hold two chords (2 beats each), which is the form the Appendix A row
 *     describes with its two slash-separated bars.
 *   - J5 (I–VI7–ii–V turnaround): two chords per bar (2 beats each).
 *   - M1..M4, M7: two chords, each held for two bars (8 beats each).
 *   - M5: one chord per bar (4 beats each).
 *   - M6 (Modal half-step shift): 8 bars, then 4 bars, then 4 bars
 *     (32, 16, 16 beats).
 */
const DURATION_BEATS = {
  r1: [4, 4, 4, 4],
  r2: [4, 4, 4, 4],
  r3: [4, 4, 4, 4],
  r4: [4, 4, 4, 4],
  r5: [4, 4, 4, 4],
  r6: [4, 4, 4, 4],
  r7: [4, 4, 4, 4],
  r8: [4, 4, 4, 4],
  b1: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  b2: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  b3: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  b4: [4, 4, 4, 4, 4, 4, 4, 4],
  b5: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 2, 2, 2, 2],
  b6: [4, 4, 4, 4],
  j1: [4, 4, 4, 4],
  j2: [4, 4, 4, 4],
  j3: [4, 4, 4, 4],
  j4: [4, 4, 4, 4, 4, 4],
  j5: [2, 2, 2, 2],
  j6: [4, 4, 4, 4],
  j7: [4, 4, 4, 4],
  j8: [4, 4, 4, 4, 4, 4, 4, 4],
  m1: [8, 8],
  m2: [8, 8],
  m3: [8, 8],
  m4: [8, 8],
  m5: [4, 4, 4, 4],
  m6: [32, 16, 16],
  m7: [8, 8],
};

/** Expected total length of each preset, in whole 4/4 bars. */
const EXPECTED_BARS = {
  r1: 4,
  r2: 4,
  r3: 4,
  r4: 4,
  r5: 4,
  r6: 4,
  r7: 4,
  r8: 4,
  b1: 12,
  b2: 12,
  b3: 12,
  b4: 8,
  // B5 is the 12-bar jazz blues form: ten single-chord bars plus two bars
  // that each hold two chords.
  b5: 12,
  b6: 4,
  j1: 4,
  j2: 4,
  j3: 4,
  j4: 6,
  j5: 2,
  j6: 4,
  j7: 4,
  j8: 8,
  m1: 4,
  m2: 4,
  m3: 4,
  m4: 4,
  m5: 4,
  m6: 16,
  m7: 4,
};

/** Appendix A order: rock, blues, jazz, modal. */
const PRESET_IDS = [
  ...['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8'],
  ...['b1', 'b2', 'b3', 'b4', 'b5', 'b6'],
  ...['j1', 'j2', 'j3', 'j4', 'j5', 'j6', 'j7', 'j8'],
  ...['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'],
];

const BEATS_PER_BAR = 4;

function fail(message) {
  console.error(`generate-built-in-presets: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

/**
 * Serialise a document with the repository JSON style: 2-space indentation,
 * LF line endings and a trailing newline.
 *
 * The layout follows the repository's Prettier configuration (`printWidth: 100`):
 * a value stays on one line when it fits the print width, otherwise it is
 * expanded with one entry per line. Arrays holding more than one object are
 * always expanded, one object per line, which is what Prettier does as well.
 * The result is therefore stable under `prettier --check`.
 */
const PRINT_WIDTH = 100;

function inlineValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map(inlineValue).join(', ')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).map(
      ([key, item]) => `${JSON.stringify(key)}: ${inlineValue(item)}`,
    );
    return entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }`;
  }
  return JSON.stringify(value);
}

function holdsMultipleObjects(value) {
  return (
    value.length > 1 &&
    value.every(
      (item) =>
        item !== null &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        Object.keys(item).length > 1,
    )
  );
}

/**
 * @param value the value to render
 * @param depth nesting depth, used for the indentation of the closing bracket
 * @param prefixLength number of characters already written on the current line
 */
function serializeValue(value, depth, prefixLength) {
  const indent = '  '.repeat(depth);

  if (Array.isArray(value)) {
    const inline = inlineValue(value);
    if (!holdsMultipleObjects(value) && prefixLength + inline.length <= PRINT_WIDTH) {
      return inline;
    }
    const items = value.map(
      (item) =>
        `${'  '.repeat(depth + 1)}${serializeValue(item, depth + 1, '  '.repeat(depth + 1).length)}`,
    );
    return `[\n${items.join(',\n')}\n${indent}]`;
  }

  if (value !== null && typeof value === 'object') {
    const inline = inlineValue(value);
    if (prefixLength + inline.length <= PRINT_WIDTH) {
      return inline;
    }
    const entries = Object.entries(value).map(([key, item]) => {
      const keyText = `${JSON.stringify(key)}: `;
      const childPrefix = '  '.repeat(depth + 1).length + keyText.length;
      return `${'  '.repeat(depth + 1)}${keyText}${serializeValue(item, depth + 1, childPrefix)}`;
    });
    return `{\n${entries.join(',\n')}\n${indent}}`;
  }

  return JSON.stringify(value);
}

function toJson(document) {
  return `${serializeValue(document, 0, 0)}\n`;
}

function buildChord(chord, durationBeats) {
  const output = { degree: chord.degree };
  if (Object.hasOwn(chord, 'alteration')) {
    output.alteration = chord.alteration;
  }
  output.quality = chord.quality;
  output.durationBeats = durationBeats;
  return output;
}

const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

mkdirSync(outputDirectory, { recursive: true });

const manifestEntries = [];
const summary = [];

for (const id of PRESET_IDS) {
  const appendixCode = id.toUpperCase();
  const source = fixture[appendixCode];
  if (!source) {
    fail(`fixture is missing appendix code ${appendixCode}`);
  }

  const metadata = PRESET_METADATA[id];
  const durations = DURATION_BEATS[id];
  if (!metadata || !durations) {
    fail(`no generator metadata for ${id}`);
  }

  if (
    !Array.isArray(source.home) ||
    source.home.length !== metadata.home.length ||
    source.home.some((scaleType, index) => scaleType !== metadata.home[index])
  ) {
    fail(`home scale types for ${appendixCode} differ from the generator table`);
  }

  if (source.chords.length !== durations.length) {
    fail(
      `${appendixCode} has ${source.chords.length} chords but ${durations.length} durations are defined`,
    );
  }

  const chords = source.chords.map((chord, index) => buildChord(chord, durations[index]));
  const totalBeats = durations.reduce((sum, beats) => sum + beats, 0);
  if (totalBeats % BEATS_PER_BAR !== 0) {
    fail(`${appendixCode} does not add up to a whole number of 4/4 bars`);
  }

  const bars = totalBeats / BEATS_PER_BAR;
  if (bars !== EXPECTED_BARS[id]) {
    fail(`${appendixCode} spans ${bars} bars, expected ${EXPECTED_BARS[id]}`);
  }

  const document = {
    schemaVersion: 1,
    id,
    name: source.name,
    category: metadata.category,
    builtIn: true,
    homeScaleTypes: [...source.home],
    timeSignature: '4/4',
    chords,
  };

  const fileName = `${id}.json`;
  writeFileSync(join(outputDirectory, fileName), toJson(document), 'utf8');

  manifestEntries.push({
    id,
    file: fileName,
    name: source.name,
    category: metadata.category,
  });
  summary.push({ id, file: fileName, bars, chords: chords.length });
}

const manifest = {
  schemaVersion: 1,
  presets: manifestEntries,
};
writeFileSync(join(outputDirectory, 'index.json'), toJson(manifest), 'utf8');

for (const entry of summary) {
  console.log(`${entry.file}: ${entry.bars} bar(s), ${entry.chords} chord(s)`);
}
console.log(`index.json: ${manifestEntries.length} preset(s)`);
