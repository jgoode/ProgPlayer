import { describe, expect, it } from 'vitest';

import { buildChord, parseQuality } from '@core/theory/chords';
import { resolveDegreeChord, scaleContainingChord } from '@core/theory/degree';
import { closestSupportedSpelling, pitchClassNumber } from '@core/theory/pitch';
import { buildSpelledScale, generateHintScale, scalePitchClasses } from '@core/theory/scales';
import { voiceLeadingCost } from '@core/theory/voicing';

const C = { letter: 'C', alteration: 0 } as const;

describe('theory edge cases', () => {
  it('finds the scale that contains a diatonic chord', () => {
    const scale = scaleContainingChord(C, 'major', buildChord(C, ''));
    expect(scale?.type).toBe('major');
  });

  it('reports that a borrowed chord is outside the in-key scale', () => {
    expect(scaleContainingChord(C, 'major', buildChord(C, 'm7♭5'))).toBeNull();
  });

  it('falls back to an enharmonic spelling for an unsupportable chord tone', () => {
    // E𝄪 major's fifth would need G###.
    const chord = buildChord({ letter: 'E', alteration: 2 }, '');
    expect(chord.notes).toHaveLength(3);
    for (const note of chord.notes) {
      expect(Math.abs(note.alteration)).toBeLessThanOrEqual(2);
    }
  });

  it('marks a degree as enharmonic when the spelling is not exact', () => {
    const resolved = resolveDegreeChord({ letter: 'E', alteration: 2 }, { degree: 3, quality: '' });
    expect(resolved.enharmonic).toBe(true);
  });

  it('rejects a scale with a missing degree position', () => {
    expect(() => buildSpelledScale(C, [0, 2], [{ letterSteps: 0 }])).toThrow(RangeError);
  });

  it('builds the chromatic hint scales', () => {
    expect(generateHintScale(C, 'wholeTone').notes).toHaveLength(6);
    expect(generateHintScale(C, 'wholeHalfDiminished').notes).toHaveLength(8);
    expect(generateHintScale(C, 'halfWholeDiminished').notes).toHaveLength(8);
    expect(generateHintScale(C, 'lydianDominant').notes).toHaveLength(7);
    expect(generateHintScale(C, 'dominantFlatSix').notes).toHaveLength(7);
  });

  it('lists the pitch classes of a collection', () => {
    expect(scalePitchClasses(generateHintScale(C, 'major').notes)).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });

  it('prefers the requested letter when spelling a pitch class', () => {
    expect(closestSupportedSpelling(6, 'G')).toEqual({
      pitch: { letter: 'G', alteration: -1 },
      exact: true,
    });
    expect(closestSupportedSpelling(6, 'D')).toEqual({
      pitch: { letter: 'F', alteration: 1 },
      exact: false,
    });
  });

  it('scores voice leading between two voicings', () => {
    expect(voiceLeadingCost([60, 64, 67], [60, 64, 67])).toBe(0);
    expect(voiceLeadingCost([60, 64, 67], [62, 65, 69])).toBe(10);
    expect(voiceLeadingCost([], [60])).toBe(Number.POSITIVE_INFINITY);
  });

  it('rejects unknown quality suffixes', () => {
    expect(parseQuality('nonsense')).toBeNull();
  });

  it('resolves a chord root pitch class', () => {
    expect(pitchClassNumber(buildChord(C, '').root)).toBe(0);
  });
});
