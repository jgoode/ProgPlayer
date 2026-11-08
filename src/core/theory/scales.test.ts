import { describe, expect, it } from 'vitest';

import { pitchClassNumber } from '@core/theory/pitch';
import { generateScale, SCALE_INTERVALS } from '@core/theory/scales';
import type { PitchClass, ScaleType } from '@core/theory/types';

const SCALE_TYPES = Object.keys(SCALE_INTERVALS) as ScaleType[];

describe('scales', () => {
  it('generates the major scale', () => {
    const scale = generateScale({ letter: 'C', alteration: 0 }, 'major');
    expect(scale.notes.map((note) => `${note.letter}${note.alteration}`)).toEqual([
      'C0',
      'D0',
      'E0',
      'F0',
      'G0',
      'A0',
      'B0',
    ]);
    expect(scale.notes.map((note) => pitchClassNumber(note))).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });

  it('generates the three minor scales', () => {
    expect(
      generateScale({ letter: 'A', alteration: 0 }, 'naturalMinor').notes.map((note) =>
        pitchClassNumber(note),
      ),
    ).toEqual([9, 11, 0, 2, 4, 5, 7]);
    expect(
      generateScale({ letter: 'A', alteration: 0 }, 'harmonicMinor').notes.map((note) =>
        pitchClassNumber(note),
      ),
    ).toEqual([9, 11, 0, 2, 4, 5, 8]);
    expect(
      generateScale({ letter: 'A', alteration: 0 }, 'melodicMinor').notes.map((note) =>
        pitchClassNumber(note),
      ),
    ).toEqual([9, 11, 0, 2, 4, 6, 8]);
  });

  it('generates the seven modes of the major scale', () => {
    const expected = {
      ionian: [0, 2, 4, 5, 7, 9, 11],
      dorian: [0, 2, 3, 5, 7, 9, 10],
      phrygian: [0, 1, 3, 5, 7, 8, 10],
      lydian: [0, 2, 4, 6, 7, 9, 11],
      mixolydian: [0, 2, 4, 5, 7, 9, 10],
      aeolian: [0, 2, 3, 5, 7, 8, 10],
      locrian: [0, 1, 3, 5, 6, 8, 10],
    } as const;
    for (const [type, intervals] of Object.entries(expected)) {
      const scale = generateScale({ letter: 'C', alteration: 0 }, type as ScaleType);
      expect(
        scale.notes.map((note) => pitchClassNumber(note)),
        type,
      ).toEqual(intervals);
    }
  });

  it('spells scale degrees with consecutive letters', () => {
    const scale = generateScale({ letter: 'E', alteration: 0 }, 'major');
    expect(scale.notes.map((note) => note.letter)).toEqual(['E', 'F', 'G', 'A', 'B', 'C', 'D']);
    expect(scale.notes.map((note) => note.alteration)).toEqual([0, 1, 1, 0, 0, 1, 1]);
  });

  it('keeps flat keys flat', () => {
    const scale = generateScale({ letter: 'F', alteration: 0 }, 'major');
    expect(scale.notes.map((note) => `${note.letter}${note.alteration}`)).toEqual([
      'F0',
      'G0',
      'A0',
      'B-1',
      'C0',
      'D0',
      'E0',
    ]);
  });

  it('supports double accidentals in remote keys', () => {
    const scale = generateScale({ letter: 'G', alteration: 1 }, 'harmonicMinor');
    expect(scale.notes.map((note) => `${note.letter}${note.alteration}`)).toEqual([
      'G1',
      'A1',
      'B0',
      'C1',
      'D1',
      'E0',
      'F2',
    ]);
  });

  it('covers every scale type for every canonical tonic', () => {
    const tonics: readonly PitchClass[] = [
      { letter: 'C', alteration: 0 },
      { letter: 'C', alteration: 1 },
      { letter: 'D', alteration: 0 },
      { letter: 'D', alteration: 1 },
      { letter: 'E', alteration: 0 },
      { letter: 'F', alteration: 0 },
      { letter: 'F', alteration: 1 },
      { letter: 'G', alteration: 0 },
      { letter: 'G', alteration: 1 },
      { letter: 'A', alteration: 0 },
      { letter: 'A', alteration: 1 },
      { letter: 'B', alteration: 0 },
    ];
    for (const tonic of tonics) {
      for (const type of SCALE_TYPES) {
        const scale = generateScale(tonic, type);
        expect(scale.notes, `${tonic.letter}${tonic.alteration} ${type}`).toHaveLength(7);
        expect(
          scale.notes.map((note) => pitchClassNumber(note)),
          `${tonic.letter}${tonic.alteration} ${type}`,
        ).toEqual(
          SCALE_INTERVALS[type].map((interval) => (pitchClassNumber(tonic) + interval) % 12),
        );
      }
    }
  });
});
