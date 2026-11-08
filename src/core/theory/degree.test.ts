import { describe, expect, it } from 'vitest';

import { formatChordName } from '@core/theory/chords';
import { resolveDegreeChord, resolveDegreeRoot, resolveProgression } from '@core/theory/degree';
import { pitchClassNumber } from '@core/theory/pitch';

const C = { letter: 'C', alteration: 0 } as const;

describe('degree resolution', () => {
  it('resolves plain major-scale degrees', () => {
    expect(resolveDegreeRoot(C, { degree: 1, quality: '' })).toEqual({
      letter: 'C',
      alteration: 0,
    });
    expect(resolveDegreeRoot(C, { degree: 4, quality: '' })).toEqual({
      letter: 'F',
      alteration: 0,
    });
    expect(resolveDegreeRoot(C, { degree: 7, quality: '' })).toEqual({
      letter: 'B',
      alteration: 0,
    });
  });

  it('resolves borrowed flat and sharp degrees', () => {
    expect(resolveDegreeRoot(C, { degree: 7, alteration: -1, quality: '' })).toEqual({
      letter: 'B',
      alteration: -1,
    });
    expect(resolveDegreeRoot(C, { degree: 3, alteration: -1, quality: '' })).toEqual({
      letter: 'E',
      alteration: -1,
    });
    expect(resolveDegreeRoot(C, { degree: 4, alteration: 1, quality: '' })).toEqual({
      letter: 'F',
      alteration: 1,
    });
    expect(resolveDegreeRoot(C, { degree: 2, alteration: -1, quality: '' })).toEqual({
      letter: 'D',
      alteration: -1,
    });
  });

  it('keeps roots independent of the selected scale type (A5)', () => {
    const degree = { degree: 5, quality: '7' } as const;
    expect(resolveDegreeChord(C, degree).chord.root).toEqual({
      letter: 'G',
      alteration: 0,
    });
  });

  it('builds chords with explicit qualities', () => {
    const resolved = resolveDegreeChord(C, { degree: 2, quality: 'm7' });
    expect(formatChordName(resolved.chord)).toBe('Dm7');
    expect(resolved.chord.notes.map((note) => pitchClassNumber(note))).toEqual([2, 5, 9, 0]);
  });

  it('resolves borrowed non-diatonic roots', () => {
    const resolved = resolveDegreeChord(C, { degree: 4, alteration: 1, quality: 'dim7' });
    expect(formatChordName(resolved.chord)).toBe('F♯dim7');
    expect(resolved.chord.notes.map((note) => pitchClassNumber(note))).toEqual([6, 9, 0, 3]);
  });

  it('resolves a whole progression', () => {
    const resolved = resolveProgression(C, [
      { degree: 2, quality: 'm7' },
      { degree: 5, quality: '7' },
      { degree: 1, quality: 'maj7' },
    ]);
    expect(resolved.map((item) => formatChordName(item.chord))).toEqual(['Dm7', 'G7', 'Cmaj7']);
  });

  it('rejects invalid degrees', () => {
    expect(() => resolveDegreeRoot(C, { degree: 0, quality: '' })).toThrow(RangeError);
    expect(() => resolveDegreeRoot(C, { degree: 8, quality: '' })).toThrow(RangeError);
    expect(() => resolveDegreeRoot(C, { degree: 1.5, quality: '' })).toThrow(RangeError);
    expect(() => resolveDegreeRoot(C, { degree: 1, alteration: 3, quality: '' })).toThrow(
      RangeError,
    );
  });

  it('falls back to an enharmonic spelling when the degree exceeds double accidentals', () => {
    // E𝄪 major's third degree would need a triple sharp (G###).
    const resolved = resolveDegreeChord({ letter: 'E', alteration: 2 }, { degree: 3, quality: '' });
    expect(resolved.enharmonic).toBe(true);
    expect(pitchClassNumber(resolved.chord.root)).toBe(10);
    expect(Math.abs(resolved.chord.root.alteration)).toBeLessThanOrEqual(2);
  });

  it('keeps double accidentals where they are supported', () => {
    const resolved = resolveDegreeChord({ letter: 'G', alteration: 1 }, { degree: 7, quality: '' });
    expect(resolved.enharmonic).toBe(false);
    expect(resolved.chord.root).toEqual({ letter: 'F', alteration: 2 });
  });
});
