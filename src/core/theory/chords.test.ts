import { describe, expect, it } from 'vitest';

import {
  buildChord,
  CHORD_FORMULAS,
  CHORD_QUALITIES,
  chordPitchClasses,
  formatChordName,
  parseChordName,
  parseQuality,
} from '@core/theory/chords';
import type { ChordQuality } from '@core/theory/types';

describe('chord formulas', () => {
  it('builds the four triad qualities', () => {
    expect(chordPitchClasses(buildChord({ letter: 'C', alteration: 0 }, ''))).toEqual([0, 4, 7]);
    expect(chordPitchClasses(buildChord({ letter: 'C', alteration: 0 }, 'm'))).toEqual([0, 3, 7]);
    expect(chordPitchClasses(buildChord({ letter: 'C', alteration: 0 }, 'dim'))).toEqual([0, 3, 6]);
    expect(chordPitchClasses(buildChord({ letter: 'C', alteration: 0 }, 'aug'))).toEqual([0, 4, 8]);
  });

  it('builds the seventh qualities', () => {
    expect(chordPitchClasses(buildChord({ letter: 'C', alteration: 0 }, 'maj7'))).toEqual([
      0, 4, 7, 11,
    ]);
    expect(chordPitchClasses(buildChord({ letter: 'C', alteration: 0 }, 'm7'))).toEqual([
      0, 3, 7, 10,
    ]);
    expect(chordPitchClasses(buildChord({ letter: 'C', alteration: 0 }, '7'))).toEqual([
      0, 4, 7, 10,
    ]);
    expect(chordPitchClasses(buildChord({ letter: 'C', alteration: 0 }, 'm7♭5'))).toEqual([
      0, 3, 6, 10,
    ]);
    expect(chordPitchClasses(buildChord({ letter: 'C', alteration: 0 }, 'dim7'))).toEqual([
      0, 3, 6, 9,
    ]);
    expect(chordPitchClasses(buildChord({ letter: 'C', alteration: 0 }, 'mMaj7'))).toEqual([
      0, 3, 7, 11,
    ]);
  });

  it('spells chord tones with the expected letters', () => {
    const chord = buildChord({ letter: 'C', alteration: 0 }, '9');
    expect(chord.notes.map((note) => note.letter)).toEqual(['C', 'E', 'G', 'B', 'D']);
    const flat = buildChord({ letter: 'F', alteration: 0 }, '13');
    expect(flat.notes.map((note) => `${note.letter}${note.alteration}`)).toEqual([
      'F0',
      'A0',
      'C0',
      'E-1',
      'G0',
      'D0',
    ]);
    const flatSeventh = buildChord({ letter: 'B', alteration: -1 }, 'maj7');
    expect(flatSeventh.notes.map((note) => `${note.letter}${note.alteration}`)).toEqual([
      'B-1',
      'D0',
      'F0',
      'A0',
    ]);
  });

  it('supports all qualities in FR-CHD-1', () => {
    for (const quality of CHORD_QUALITIES) {
      const chord = buildChord({ letter: 'C', alteration: 0 }, quality);
      expect(chord.notes.length, quality).toBeGreaterThanOrEqual(3);
      expect(chordPitchClasses(chord)[0], quality).toBe(0);
      expect(new Set(chordPitchClasses(chord)).size, quality).toBe(chord.notes.length);
    }
  });

  it('defines a formula for every supported quality', () => {
    expect(Object.keys(CHORD_FORMULAS).sort()).toEqual([...CHORD_QUALITIES].sort());
  });
});

describe('chord names', () => {
  it('formats roots with the standard accidental symbols', () => {
    expect(formatChordName(buildChord({ letter: 'F', alteration: 1 }, 'maj7'))).toBe('F♯maj7');
    expect(formatChordName(buildChord({ letter: 'B', alteration: -1 }, 'm7'))).toBe('B♭m7');
    expect(formatChordName(buildChord({ letter: 'C', alteration: 0 }, ''))).toBe('C');
  });

  it('round-trips every quality on every root spelling', () => {
    const roots = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C♯', 'D♭', 'F♯', 'G♭', 'A♯', 'B♭'];
    for (const root of roots) {
      for (const quality of CHORD_QUALITIES) {
        const parsed = parseChordName(`${root}${quality}`);
        expect(parsed, `${root}${quality}`).not.toBeNull();
        const chord = buildChord(
          parsed?.root ?? { letter: 'C', alteration: 0 },
          parsed?.quality ?? '',
        );
        expect(formatChordName(chord), `${root}${quality}`).toBe(`${root}${quality}`);
      }
    }
  });

  it('parses common ASCII aliases', () => {
    expect(parseChordName('C-7')?.quality).toBe('m7');
    expect(parseChordName('Cdim')?.quality).toBe('dim');
    expect(parseChordName('C°')?.quality).toBe('dim');
    expect(parseChordName('Cø7')?.quality).toBe('m7♭5');
    expect(parseChordName('Cmaj7')?.quality).toBe('maj7');
    expect(parseChordName('Cm(Maj7)')?.quality).toBe('mMaj7');
    expect(parseChordName('C7sus4')?.quality).toBe('7sus4');
  });

  it('prefers the longest known quality suffix', () => {
    expect(parseQuality('7sus4')).toBe('7sus4');
    expect(parseQuality('7b9')).toBe('7♭9');
    expect(parseQuality('7#9#5')).toBe('7♯9♯5');
    expect(parseQuality('maj13')).toBe('maj13');
  });

  it('rejects invalid chord names', () => {
    expect(parseChordName('H')).toBeNull();
    expect(parseChordName('Cfoo')).toBeNull();
    expect(parseChordName('C###7')).toBeNull();
    expect(parseQuality('foo')).toBeNull();
  });

  it('parses roots with double accidentals', () => {
    expect(parseChordName('C𝄪7')).toBeNull();
    expect(parseChordName('Fx7')).toBeNull();
    expect(parseChordName('F♯♯')).toEqual({
      root: { letter: 'F', alteration: 2 },
      quality: '',
    } satisfies { root: { letter: 'F'; alteration: number }; quality: ChordQuality });
  });
});
