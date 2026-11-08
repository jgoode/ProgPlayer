import { describe, expect, it } from 'vitest';

import {
  enharmonicPitchClasses,
  formatPitchClass,
  parsePitchClass,
  pitchClass,
  pitchClassNumber,
  signedModulo12,
  spellingsForPitchClass,
} from '@core/theory/pitch';

describe('pitch classes', () => {
  it('maps letters and accidentals to pitch-class numbers', () => {
    expect(pitchClassNumber(pitchClass('C'))).toBe(0);
    expect(pitchClassNumber(pitchClass('B'))).toBe(11);
    expect(pitchClassNumber(pitchClass('F', 1))).toBe(6);
    expect(pitchClassNumber(pitchClass('B', -1))).toBe(10);
    expect(pitchClassNumber(pitchClass('G', -1))).toBe(6);
    expect(pitchClassNumber(pitchClass('C', 2))).toBe(2);
    expect(pitchClassNumber(pitchClass('C', -2))).toBe(10);
  });

  it('formats letters with Unicode accidentals', () => {
    expect(formatPitchClass(pitchClass('C'))).toBe('C');
    expect(formatPitchClass(pitchClass('F', 1))).toBe('F♯');
    expect(formatPitchClass(pitchClass('B', -1))).toBe('B♭');
    expect(formatPitchClass(pitchClass('F', 2))).toBe('F♯♯');
    expect(formatPitchClass(pitchClass('B', -2))).toBe('B♭♭');
  });

  it('parses ASCII and Unicode accidentals', () => {
    expect(parsePitchClass('C')).toEqual({ letter: 'C', alteration: 0 });
    expect(parsePitchClass('f#')).toEqual({ letter: 'F', alteration: 1 });
    expect(parsePitchClass('G♭')).toEqual({ letter: 'G', alteration: -1 });
    expect(parsePitchClass('Bb')).toEqual({ letter: 'B', alteration: -1 });
    expect(parsePitchClass('H')).toBeNull();
    expect(parsePitchClass('C###')).toBeNull();
  });

  it('rejects unsupported accidentals', () => {
    expect(() => pitchClass('C', 3)).toThrow(RangeError);
    expect(() => pitchClass('C', -3)).toThrow(RangeError);
  });

  it('signs modulo-12 values into the nearest representation', () => {
    expect(signedModulo12(0)).toBe(0);
    expect(signedModulo12(11)).toBe(-1);
    expect(signedModulo12(13)).toBe(1);
    expect(signedModulo12(24)).toBe(0);
  });

  it('lists supported spellings for a pitch class', () => {
    expect(spellingsForPitchClass(6)).toEqual([
      { letter: 'E', alteration: 2 },
      { letter: 'F', alteration: 1 },
      { letter: 'G', alteration: -1 },
    ]);
  });

  it('lists enharmonic spellings for a spelled pitch class', () => {
    expect(enharmonicPitchClasses(pitchClass('F', 1))).toEqual([
      { letter: 'E', alteration: 2 },
      { letter: 'F', alteration: 1 },
      { letter: 'G', alteration: -1 },
    ]);
  });
});
