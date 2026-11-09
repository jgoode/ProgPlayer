import { describe, expect, it } from 'vitest';

import { buildChord } from '@core/theory/chords';
import { pitchClassNumber } from '@core/theory/pitch';
import {
  closePositionCandidates,
  countVoiceCrossings,
  DEFAULT_VOICING_RULES,
  retainedFormulaDegrees,
  selectBassNote,
  voiceChord,
  voiceProgression,
} from '@core/theory/voicing';
import type { Letter } from '@core/theory/types';

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

  it('can play a bass note for every one of the twelve roots', () => {
    // Regression: the originally proposed E1-C2 bass register (28-36) holds
    // only nine pitch classes, so C#, D and Eb roots had no bass note at all
    // and threw instead of voicing.
    const roots: readonly { letter: Letter; alteration: number }[] = [
      { letter: 'C', alteration: 0 },
      { letter: 'C', alteration: 1 },
      { letter: 'D', alteration: 0 },
      { letter: 'E', alteration: -1 },
      { letter: 'E', alteration: 0 },
      { letter: 'F', alteration: 0 },
      { letter: 'F', alteration: 1 },
      { letter: 'G', alteration: 0 },
      { letter: 'A', alteration: -1 },
      { letter: 'A', alteration: 0 },
      { letter: 'B', alteration: -1 },
      { letter: 'B', alteration: 0 },
    ];
    for (const root of roots) {
      const bass = selectBassNote(buildChord(root, ''));
      expect(bass).toBeGreaterThanOrEqual(DEFAULT_VOICING_RULES.bassLow);
      expect(bass).toBeLessThanOrEqual(DEFAULT_VOICING_RULES.bassHigh);
      expect(((bass % 12) + 12) % 12).toBe(pitchClassNumber(root));
    }
  });

  it('keeps the bass below the chord part', () => {
    // Regression: with the chord register widened to E2, a chord could be
    // voiced below the bass line, leaving the bass sitting on top of the
    // block. The bass must always be the lowest sounding pitch.
    const chords = [
      buildChord({ letter: 'B', alteration: -1 }, 'maj7'),
      buildChord({ letter: 'D', alteration: 0 }, 'm7'),
      buildChord({ letter: 'G', alteration: 0 }, '7'),
      buildChord({ letter: 'C', alteration: 0 }, 'maj7'),
    ];
    const voicings = voiceProgression(chords);
    for (const voicing of voicings) {
      expect(voicing.notes[0]).toBeGreaterThan(voicing.bass);
    }
  });

  it('counts crossing voices between two voicings', () => {
    // No crossing: both voices keep their order.
    expect(countVoiceCrossings([60, 64], [61, 65])).toBe(0);
    // The voices swap order: the candidate's lower note matches the
    // previous upper voice and vice versa.
    expect(countVoiceCrossings([60, 64], [63, 61])).toBe(1);
    // Different voice counts cannot be compared by rank.
    expect(countVoiceCrossings([60, 64], [61])).toBe(0);
  });

  it('never selects a voicing whose voices cross', () => {
    // The symmetric nearest-note cost cannot choose a crossing candidate:
    // the nearest-note match that crosses is always more expensive than the
    // uncrossed alternative.
    const first = voiceChord(buildChord(C, 'maj7'));
    const second = voiceChord(buildChord({ letter: 'G', alteration: 0 }, '7'), first.notes);
    const third = voiceChord(buildChord(C, 'maj7'), second.notes);
    expect(countVoiceCrossings(first.notes, second.notes)).toBe(0);
    expect(countVoiceCrossings(second.notes, third.notes)).toBe(0);
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
