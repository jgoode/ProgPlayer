/**
 * Regenerates the committed theory golden tables from the `tonal` oracle.
 *
 * The oracle is a development dependency only; application code never
 * imports it. Run with:
 *
 *   node tests/fixtures/golden/generate.mjs
 *
 * The script writes:
 *   - scales.json: pitch classes for every tonic spelling x scale type
 *   - presets.json: expected chord names and pitch classes for Appendix A
 *
 * Spellings for remote keys are constrained by the engine's letter rules and
 * checked against the oracle's pitch classes rather than the oracle's
 * spelling, because the oracle's harmonic-minor spelling is unreliable for
 * remote flat keys.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Chord, Note, Scale } from 'tonal';

/** Returns the chromatic pitch-class number (0..11) for a note name. */
function chroma(noteName) {
  const note = Note.get(noteName);
  if (note.empty) {
    throw new Error(`Oracle does not know the note ${noteName}`);
  }
  return note.chroma;
}

const here = dirname(fileURLToPath(import.meta.url));

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11];

const SCALE_TYPES = [
  'major',
  'naturalMinor',
  'harmonicMinor',
  'melodicMinor',
  'ionian',
  'dorian',
  'phrygian',
  'lydian',
  'mixolydian',
  'aeolian',
  'locrian',
];

const TONIC_SPELLINGS = [
  'C',
  'Db',
  'D',
  'Eb',
  'E',
  'F',
  'Gb',
  'G',
  'Ab',
  'A',
  'Bb',
  'B',
  'C#',
  'D#',
  'F#',
  'G#',
  'A#',
];

const CANONICAL_TONICS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const ORACLE_SCALE_NAMES = {
  major: 'major',
  naturalMinor: 'minor',
  harmonicMinor: 'harmonic minor',
  melodicMinor: 'melodic minor',
  ionian: 'ionian',
  dorian: 'dorian',
  phrygian: 'phrygian',
  lydian: 'lydian',
  mixolydian: 'mixolydian',
  aeolian: 'aeolian',
  locrian: 'locrian',
};

const QUALITY_SUFFIX = {
  '': '',
  m: 'm',
  dim: 'dim',
  aug: 'aug',
  maj7: 'maj7',
  m7: 'm7',
  7: '7',
  'm7♭5': 'm7b5',
  dim7: 'dim7',
  mMaj7: 'mM7',
  6: '6',
  m6: 'm6',
  add9: 'add9',
  madd9: 'madd9',
  9: '9',
  maj9: 'maj9',
  m9: 'm9',
  '7♭9': '7b9',
  '7♯9': '7#9',
  '7♭5': '7b5',
  '7♯5': '7#5',
  '7♯11': '7#11',
  '7♭13': '7b13',
  11: '11',
  m11: 'm11',
  maj11: 'maj11',
  13: '13',
  maj13: 'maj13',
  m13: 'm13',
  sus2: 'sus2',
  sus4: 'sus4',
  '7sus4': '7sus4',
  '7sus2': '7sus2',
  mMaj9: 'mM9',
  mMaj13: 'mM13',
  'maj7♯11': 'maj7#11',
  '9♯11': '9#11',
  '13♯11': '13#11',
  '7♭9♯5': '7b9#5',
  '7♯9♯5': '7#9#5',
  '7♭9♭13': '7b9b13',
  '7♯9♭13': '7#9b13',
};

function accidentalName(alteration) {
  if (alteration === 0) {
    return '';
  }
  return alteration > 0 ? '♯'.repeat(alteration) : '♭'.repeat(-alteration);
}

function stepLetter(letter, count) {
  const index = LETTERS.indexOf(letter);
  return LETTERS[(index + count + 7 * 7) % 7];
}

function signed(value) {
  const normalised = ((value % 12) + 12) % 12;
  return normalised > 6 ? normalised - 12 : normalised;
}

/** Resolves a major-scale degree to a root spelling. */
function degreeRoot(tonicName, degree, alteration = 0) {
  const tonicPc = chroma(tonicName);
  const letter = stepLetter(tonicName[0], degree - 1);
  const target = tonicPc + MAJOR_INTERVALS[degree - 1] + alteration;
  const rootAlteration = signed(target - LETTER_PC[letter]);
  return `${letter}${accidentalName(rootAlteration)}`;
}

/** Converts a Unicode accidental spelling into the oracle's ASCII spelling. */
function oracleName(name) {
  return name.replaceAll('♯', '#').replaceAll('♭', 'b');
}

function scaleGolden() {
  const golden = {};
  for (const tonic of TONIC_SPELLINGS) {
    golden[tonic] = {};
    for (const type of SCALE_TYPES) {
      const scale = Scale.get(`${tonic} ${ORACLE_SCALE_NAMES[type]}`);
      if (scale.empty) {
        throw new Error(`Oracle returned an empty scale for ${tonic} ${type}`);
      }
      golden[tonic][type] = {
        pitchClasses: scale.notes.map((note) => chroma(note)),
        oracleNotes: scale.notes,
      };
    }
  }
  return golden;
}

function presetGolden(presets) {
  const golden = {};
  for (const [id, preset] of Object.entries(presets)) {
    golden[id] = {};
    for (const tonic of CANONICAL_TONICS) {
      golden[id][tonic] = preset.chords.map((chord) => {
        const root = degreeRoot(tonic, chord.degree, chord.alteration ?? 0);
        const suffix = QUALITY_SUFFIX[chord.quality];
        const oracleChord = Chord.get(`${oracleName(root)}${suffix}`);
        if (oracleChord.empty) {
          throw new Error(`Oracle returned an empty chord for ${root}${suffix}`);
        }
        return {
          name: `${root}${chord.quality}`,
          pitchClasses: oracleChord.notes.map((note) => chroma(note)),
        };
      });
    }
  }
  return golden;
}

const presets = JSON.parse(
  await import('node:fs/promises').then(({ readFile }) =>
    readFile(join(here, '..', 'theory', 'appendix-a-presets.json'), 'utf8'),
  ),
);

writeFileSync(join(here, 'scales.json'), `${JSON.stringify(scaleGolden(), null, 2)}\n`, 'utf8');
writeFileSync(
  join(here, 'presets.json'),
  `${JSON.stringify(presetGolden(presets), null, 2)}\n`,
  'utf8',
);

process.stdout.write('Wrote scales.json and presets.json\n');
