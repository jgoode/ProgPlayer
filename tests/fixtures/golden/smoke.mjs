/**
 * Smoke run for the theory core.
 *
 * Exercises the public API end to end in one pass: scale generation, degree
 * resolution, voicing, hints and fretboard positions. Run with:
 *
 *   pnpm exec vite-node tests/fixtures/golden/smoke.mjs
 */

import {
  chordFretboardPositions,
  formatChordName,
  formatPitchClass,
  generateScale,
  getChordScaleHints,
  resolveProgression,
  voiceProgression,
} from '../../../src/core/theory/index.ts';

const tonic = { letter: 'C', alteration: 0 };

const scale = generateScale(tonic, 'major');
console.log('C major:', scale.notes.map(formatPitchClass).join(' '));

const resolved = resolveProgression(tonic, [
  { degree: 2, quality: 'm7' },
  { degree: 5, quality: '7' },
  { degree: 1, quality: 'maj7' },
]);
console.log('ii-V-I:', resolved.map((item) => formatChordName(item.chord)).join(' '));

const voicings = voiceProgression(resolved.map((item) => item.chord));
console.log(
  'voicings:',
  JSON.stringify(voicings.map((voicing) => ({ notes: voicing.notes, bass: voicing.bass }))),
);

const hints = getChordScaleHints(resolved[0].chord, tonic, 'major');
console.log('hint:', hints.inKeyScale.type, '->', hints.suggestedScale.type);

console.log('fretboard Cmaj7:', chordFretboardPositions(resolved[2].chord).length, 'positions');
