import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { formatChordName } from '@core/theory/chords';
import { resolveProgression } from '@core/theory/degree';
import { pitchClassNumber } from '@core/theory/pitch';
import { generateScale } from '@core/theory/scales';
import type { DegreeChord, Letter, PitchClass, ScaleType } from '@core/theory/types';
import { DEFAULT_VOICING_RULES, voiceProgression } from '@core/theory/voicing';

const goldenDirectory = fileURLToPath(new URL('../fixtures/golden/', import.meta.url));

interface ScaleGolden {
  readonly pitchClasses: readonly number[];
}

interface PresetGoldenChord {
  readonly name: string;
  readonly pitchClasses: readonly number[];
}

interface PresetDefinition {
  readonly name: string;
  readonly home: readonly ScaleType[];
  readonly chords: readonly DegreeChord[];
}

const scales = JSON.parse(readFileSync(`${goldenDirectory}scales.json`, 'utf8')) as Record<
  string,
  Record<string, ScaleGolden>
>;

const presets = JSON.parse(readFileSync(`${goldenDirectory}presets.json`, 'utf8')) as Record<
  string,
  Record<string, readonly PresetGoldenChord[]>
>;

const presetDefinitions = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../fixtures/theory/appendix-a-presets.json', import.meta.url)),
    'utf8',
  ),
) as Record<string, PresetDefinition>;

const TONIC_SPELLINGS = Object.keys(scales);
const CANONICAL_TONICS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function parseTonic(name: string): PitchClass {
  const letter = name[0] as Letter;
  const accidental = name.slice(1);
  const alteration = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
  return { letter, alteration };
}

describe('golden scales', () => {
  it('covers every tonic spelling and scale type', () => {
    expect(TONIC_SPELLINGS.length).toBeGreaterThanOrEqual(12);
    for (const tonic of TONIC_SPELLINGS) {
      for (const type of Object.keys(scales[tonic] ?? {})) {
        expect(scales[tonic]?.[type], `${tonic} ${type}`).toBeDefined();
      }
    }
  });

  it('matches the oracle pitch classes for every tonic spelling and scale type', () => {
    for (const tonicName of TONIC_SPELLINGS) {
      const tonic = parseTonic(tonicName);
      for (const [type, expected] of Object.entries(scales[tonicName] ?? {})) {
        const scale = generateScale(tonic, type as ScaleType);
        expect(
          scale.notes.map((note) => pitchClassNumber(note)),
          `${tonicName} ${type}`,
        ).toEqual(expected.pitchClasses);
      }
    }
  });
});

describe('golden presets', () => {
  it('covers all 29 Appendix A presets', () => {
    expect(Object.keys(presets)).toHaveLength(29);
    expect(Object.keys(presetDefinitions)).toHaveLength(29);
  });

  it('resolves every preset in all 12 keys', () => {
    for (const [id, definition] of Object.entries(presetDefinitions)) {
      for (const tonicName of CANONICAL_TONICS) {
        const tonic = parseTonic(tonicName);
        const resolved = resolveProgression(tonic, definition.chords);
        const expected = presets[id]?.[tonicName];
        expect(expected, `${id} ${tonicName}`).toBeDefined();
        expect(
          resolved.map((item) => formatChordName(item.chord)),
          `${id} ${tonicName}`,
        ).toEqual(expected?.map((chord) => chord.name));
        expect(
          resolved.map((item) => item.chord.notes.map((note) => pitchClassNumber(note))),
          `${id} ${tonicName}`,
        ).toEqual(expected?.map((chord) => chord.pitchClasses));
      }
    }
  });

  it('keeps preset roots fixed regardless of the home scale type (A5)', () => {
    for (const [id, definition] of Object.entries(presetDefinitions)) {
      expect(definition.home.length, id).toBeGreaterThan(0);
      const tonic = parseTonic('C');
      const resolved = resolveProgression(tonic, definition.chords);
      expect(
        resolved.map((item) => formatChordName(item.chord)),
        id,
      ).toEqual(presets[id]?.['C']?.map((chord) => chord.name));
    }
  });

  it('uses only qualities from the supported preset vocabulary', () => {
    const supported: Record<string, true> = {
      '': true,
      m: true,
      dim: true,
      aug: true,
      maj7: true,
      m7: true,
      '7': true,
      'm7♭5': true,
      dim7: true,
      mMaj7: true,
      '7♭9': true,
    };
    for (const [id, definition] of Object.entries(presetDefinitions)) {
      for (const chord of definition.chords) {
        expect(supported[chord.quality] === true, `${id} ${chord.quality}`).toBe(true);
      }
    }
  });

  it('voices every preset in every key with the bass below the chord part', () => {
    for (const [id, definition] of Object.entries(presetDefinitions)) {
      for (const tonicName of CANONICAL_TONICS) {
        const tonic = parseTonic(tonicName);
        const resolved = resolveProgression(tonic, definition.chords);
        const voicings = voiceProgression(resolved.map((item) => item.chord));
        for (const [index, voicing] of voicings.entries()) {
          const label = `${id} ${tonicName} ${index}`;
          expect(voicing.notes[0], label).toBeGreaterThan(voicing.bass);
          expect(voicing.notes[0], label).toBeGreaterThanOrEqual(DEFAULT_VOICING_RULES.chordLow);
          expect(voicing.notes.at(-1), label).toBeLessThanOrEqual(DEFAULT_VOICING_RULES.chordHigh);
          expect(voicing.bass, label).toBeGreaterThanOrEqual(DEFAULT_VOICING_RULES.bassLow);
          expect(voicing.bass, label).toBeLessThanOrEqual(DEFAULT_VOICING_RULES.bassHigh);
          expect(voicing.notes.at(-1)! - voicing.notes[0]!, label).toBeLessThanOrEqual(
            DEFAULT_VOICING_RULES.closeSpan,
          );
        }
      }
    }
  });
});
