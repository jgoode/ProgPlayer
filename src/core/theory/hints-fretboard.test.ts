import { describe, expect, it } from 'vitest';

import { buildChord, CHORD_QUALITIES } from '@core/theory/chords';
import {
  chordFretboardPositions,
  fretboardPositions,
  STANDARD_TUNING,
} from '@core/theory/fretboard';
import { getChordScaleHints, suggestScaleForChord } from '@core/theory/hints';
import { pitchClassNumber } from '@core/theory/pitch';

const C = { letter: 'C', alteration: 0 } as const;

describe('chord-scale hints', () => {
  it('returns a suggestion for every supported quality', () => {
    for (const quality of CHORD_QUALITIES) {
      expect(suggestScaleForChord(buildChord(C, quality)), quality).toBeDefined();
    }
  });

  it('returns both the in-key scale and the quality suggestion', () => {
    const chord = buildChord({ letter: 'F', alteration: 1 }, '7');
    const hints = getChordScaleHints(chord, C, 'major');
    expect(hints.inKeyScale.type).toBe('major');
    expect(hints.inKeyScale.notes[0]).toEqual(C);
    expect(hints.suggestedScale.type).toBe('mixolydian');
    expect(hints.suggestedScale.notes[0]).toEqual({ letter: 'F', alteration: 1 });
  });

  it('suggests a scale containing the chord tones', () => {
    for (const quality of CHORD_QUALITIES) {
      const chord = buildChord(C, quality);
      const hints = getChordScaleHints(chord, C, 'major');
      const suggested = new Set(hints.suggestedScale.notes.map((note) => pitchClassNumber(note)));
      // The suggestion must contain the chord's root, third and seventh:
      // those are the tones an improviser relies on most.
      for (const tone of chord.notes.slice(0, 4)) {
        const pitchClass = pitchClassNumber(tone);
        const isCore =
          pitchClass === 0 || pitchClass === 3 || pitchClass === 4 || pitchClass === 10;
        if (isCore) {
          expect(suggested.has(pitchClass), `${quality} ${tone.letter}`).toBe(true);
        }
      }
    }
  });
});

describe('fretboard positions', () => {
  it('returns the standard tuning', () => {
    expect(STANDARD_TUNING).toEqual([40, 45, 50, 55, 59, 64]);
  });

  it('finds a C major chord shape in the default range', () => {
    const positions = chordFretboardPositions(buildChord(C, ''));
    // Low E string, fret 3 is G (MIDI 43); A string, fret 3 is C (MIDI 48).
    expect(
      positions.some(
        (position) => position.stringIndex === 0 && position.fret === 3 && position.midiNote === 43,
      ),
    ).toBe(true);
    expect(
      positions.some(
        (position) => position.stringIndex === 1 && position.fret === 3 && position.midiNote === 48,
      ),
    ).toBe(true);
  });

  it('respects the configured fret range', () => {
    const positions = fretboardPositions([0], { frets: { min: 5, max: 7 } });
    expect(positions.length).toBeGreaterThan(0);
    for (const position of positions) {
      expect(position.fret).toBeGreaterThanOrEqual(5);
      expect(position.fret).toBeLessThanOrEqual(7);
    }
  });

  it('returns every chord tone at least once in the default range', () => {
    for (const quality of CHORD_QUALITIES) {
      const chord = buildChord(C, quality);
      const positions = chordFretboardPositions(chord);
      const covered = new Set(positions.map((position) => position.pitchClass));
      for (const tone of chord.notes) {
        expect(covered.has(pitchClassNumber(tone)), `${quality} ${tone.letter}`).toBe(true);
      }
    }
  });

  it('rejects an invalid fret range', () => {
    expect(() => fretboardPositions([0], { frets: { min: -1, max: 5 } })).toThrow(RangeError);
    expect(() => fretboardPositions([0], { frets: { min: 8, max: 5 } })).toThrow(RangeError);
  });
});
