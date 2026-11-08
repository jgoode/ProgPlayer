import { describe, expect, it } from 'vitest';

import { buildChord } from '@core/theory/chords';
import { pitchClassNumber } from '@core/theory/pitch';
import {
  closePositionCandidates,
  DEFAULT_VOICING_RULES,
  retainedFormulaDegrees,
  selectBassNote,
  voiceChord,
  voiceProgression,
} from '@core/theory/voicing';

const C = { letter: 'C', alteration: 0 } as const;

describe('voicing rules', () => {
  it('keeps the fifth for triads and sevenths', () => {
    expect(retainedFormulaDegrees('')).toEqual([1, 3, 5]);
    expect(retainedFormulaDegrees('7')).toEqual([1, 3, 5, 7]);
    expect(retainedFormulaDegrees('m7')).toEqual([1, 3, 5, 7]);
  });

  it('drops the fifth for chords with a ninth or higher', () => {
    expect(retainedFormulaDegrees('9')).toEqual([1, 3, 7, 9]);
    expect(retainedFormulaDegrees('13')).toEqual([1, 3, 7, 9, 13]);
    expect(retainedFormulaDegrees('m9')).toEqual([1, 3, 7, 9]);
  });

  it('drops the unaltered eleventh over a major third', () => {
    expect(retainedFormulaDegrees('maj11')).toEqual([1, 3, 7, 9]);
    expect(retainedFormulaDegrees('13♯11')).toEqual([1, 3, 7, 9, 11, 13]);
  });

  it('keeps the eleventh when the third is minor', () => {
    expect(retainedFormulaDegrees('m11')).toEqual([1, 3, 7, 9, 11]);
  });

  it('keeps an altered eleventh', () => {
    expect(retainedFormulaDegrees('maj7♯11')).toEqual([1, 3, 7, 11]);
    expect(retainedFormulaDegrees('7♯11')).toEqual([1, 3, 7, 11]);
  });

  it('produces close-position candidates inside the register', () => {
    const chord = buildChord(C, 'maj7');
    const candidates = closePositionCandidates(chord);
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.notes[0]).toBeGreaterThanOrEqual(DEFAULT_VOICING_RULES.chordLow);
      expect(candidate.notes.at(-1)).toBeLessThanOrEqual(DEFAULT_VOICING_RULES.chordHigh);
      expect(candidate.notes.at(-1)! - candidate.notes[0]!).toBeLessThanOrEqual(
        DEFAULT_VOICING_RULES.closeSpan,
      );
      expect(candidate.notes.every((note) => note % 12 === candidate.notes[0]! % 12)).toBe(false);
    }
  });

  it('selects a voicing inside the register', () => {
    const voicing = voiceChord(buildChord(C, 'maj7'));
    expect(voicing.notes.length).toBe(4);
    expect(voicing.notes[0]).toBeGreaterThanOrEqual(DEFAULT_VOICING_RULES.chordLow);
    expect(voicing.notes.at(-1)).toBeLessThanOrEqual(DEFAULT_VOICING_RULES.chordHigh);
    expect([...voicing.notes].sort((a, b) => a - b)).toEqual(voicing.notes);
  });

  it('uses only chord-tone pitch classes in the voicing', () => {
    const chord = buildChord(C, '9');
    const voicing = voiceChord(chord);
    const chordPitchClasses = new Set(chord.notes.map((note) => pitchClassNumber(note)));
    for (const note of voicing.notes) {
      expect(chordPitchClasses.has(((note % 12) + 12) % 12)).toBe(true);
    }
  });

  it('chooses the inversion with minimal movement', () => {
    const first = voiceChord(buildChord(C, ''));
    const second = voiceChord(buildChord({ letter: 'G', alteration: 0 }, ''), first.notes);
    const movement = second.notes.reduce(
      (total, note, index) => total + Math.abs(note - (first.notes[index] ?? note)),
      0,
    );
    expect(movement).toBeLessThanOrEqual(7);
  });

  it('places the bass root in the bass register', () => {
    for (const root of ['C', 'E', 'F#', 'Bb']) {
      const chord = buildChord(
        { letter: root[0] as 'C', alteration: root.length > 1 ? (root[1] === '#' ? 1 : -1) : 0 },
        '',
      );
      const bass = selectBassNote(chord);
      expect(bass).toBeGreaterThanOrEqual(DEFAULT_VOICING_RULES.bassLow);
      expect(bass).toBeLessThanOrEqual(DEFAULT_VOICING_RULES.bassHigh);
      expect(((bass % 12) + 12) % 12).toBe(pitchClassNumber(chord.root));
    }
  });

  it('voices every progression chord inside the register', () => {
    const chords = [
      buildChord(C, 'maj7'),
      buildChord({ letter: 'D', alteration: 0 }, 'm7'),
      buildChord({ letter: 'G', alteration: 0 }, '7'),
      buildChord({ letter: 'C', alteration: 0 }, '9'),
    ];
    const voicings = voiceProgression(chords);
    expect(voicings).toHaveLength(chords.length);
    for (const voicing of voicings) {
      expect(voicing.notes[0]).toBeGreaterThanOrEqual(DEFAULT_VOICING_RULES.chordLow);
      expect(voicing.notes.at(-1)).toBeLessThanOrEqual(DEFAULT_VOICING_RULES.chordHigh);
      expect(voicing.bass).toBeGreaterThanOrEqual(DEFAULT_VOICING_RULES.bassLow);
      expect(voicing.bass).toBeLessThanOrEqual(DEFAULT_VOICING_RULES.bassHigh);
    }
  });
});
