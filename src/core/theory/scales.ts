import { isSupportedAlteration, pitchClassNumber, spellDiatonicTone } from './pitch';
import type { HintScaleType, PitchClass, Scale, ScaleType } from './types';

/**
 * Semitone intervals from the tonic for every supported scale type.
 *
 * The three minor scales use the jazz convention: melodic minor is ascending
 * and harmonic minor retains its raised seventh.
 */
export const SCALE_INTERVALS: Readonly<Record<ScaleType, readonly number[]>> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  naturalMinor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
};

/** Position of a scale degree in diatonic letters. */
export interface ScaleDegreePosition {
  /** Letter steps above the tonic. */
  readonly letterSteps: number;
}

/** Seven-note scales use consecutive letters. */
const CONSECUTIVE_DEGREES: readonly ScaleDegreePosition[] = [
  { letterSteps: 0 },
  { letterSteps: 1 },
  { letterSteps: 2 },
  { letterSteps: 3 },
  { letterSteps: 4 },
  { letterSteps: 5 },
  { letterSteps: 6 },
];

/**
 * Extra scales that may be suggested for chromatic chord qualities.
 *
 * The diminished scales repeat a letter, as their traditional spellings
 * require: C whole-half diminished is C D E♭ F G♭ A♭ A B.
 */
export const HINT_SCALE_INTERVALS: Readonly<Record<HintScaleType, readonly number[]>> = {
  ...SCALE_INTERVALS,
  wholeTone: [0, 2, 4, 6, 8, 10],
  wholeHalfDiminished: [0, 2, 3, 5, 6, 8, 9, 11],
  halfWholeDiminished: [0, 1, 3, 4, 6, 7, 9, 10],
  lydianDominant: [0, 2, 4, 6, 7, 9, 10],
  dominantFlatSix: [0, 2, 4, 5, 7, 8, 10],
};

/** Letter positions for the hint scales that are not seven-note scales. */
export const HINT_SCALE_DEGREES: Readonly<
  Partial<Record<HintScaleType, readonly ScaleDegreePosition[]>>
> = {
  wholeTone: [
    { letterSteps: 0 },
    { letterSteps: 1 },
    { letterSteps: 2 },
    { letterSteps: 3 },
    { letterSteps: 4 },
    { letterSteps: 5 },
  ],
  wholeHalfDiminished: [
    { letterSteps: 0 },
    { letterSteps: 1 },
    { letterSteps: 2 },
    { letterSteps: 3 },
    { letterSteps: 4 },
    { letterSteps: 5 },
    { letterSteps: 5 },
    { letterSteps: 6 },
  ],
  halfWholeDiminished: [
    { letterSteps: 0 },
    { letterSteps: 1 },
    { letterSteps: 2 },
    { letterSteps: 2 },
    { letterSteps: 4 },
    { letterSteps: 4 },
    { letterSteps: 5 },
    { letterSteps: 6 },
  ],
  lydianDominant: [
    { letterSteps: 0 },
    { letterSteps: 1 },
    { letterSteps: 2 },
    { letterSteps: 3 },
    { letterSteps: 4 },
    { letterSteps: 5 },
    { letterSteps: 6 },
  ],
  dominantFlatSix: [
    { letterSteps: 0 },
    { letterSteps: 1 },
    { letterSteps: 2 },
    { letterSteps: 3 },
    { letterSteps: 4 },
    { letterSteps: 5 },
    { letterSteps: 6 },
  ],
};

/**
 * Builds a spelled scale from semitone intervals.
 *
 * Scale degrees use the letter positions of `degrees`, and each degree is
 * spelled as a diatonic tone of the tonic. A major scale on E therefore
 * spells E F♯ G♯ A B C♯ D♯, and a flat key keeps its flat spellings.
 */
export function buildSpelledScale(
  tonic: PitchClass,
  intervals: readonly number[],
  degrees: readonly ScaleDegreePosition[] = CONSECUTIVE_DEGREES,
): readonly PitchClass[] {
  return intervals.map((interval, index) => {
    const position = degrees[index];
    if (position === undefined) {
      throw new RangeError(`No degree position for scale degree ${index + 1}`);
    }
    const note = spellDiatonicTone(tonic, position.letterSteps, interval);
    if (!isSupportedAlteration(note.alteration)) {
      throw new RangeError(
        `Scale degree ${index + 1} of ${tonic.letter}${tonic.alteration} needs an unsupported accidental`,
      );
    }
    return note;
  });
}

/** Generates a scale for any supported scale type. */
export function generateScale(tonic: PitchClass, type: ScaleType): Scale {
  const intervals = SCALE_INTERVALS[type];
  return {
    type,
    tonic,
    intervals,
    notes: buildSpelledScale(tonic, intervals),
  };
}

/** Generates a scale for a chord-scale hint, including chromatic helpers. */
export function generateHintScale(
  tonic: PitchClass,
  type: HintScaleType,
): { readonly type: HintScaleType; readonly notes: readonly PitchClass[] } {
  const intervals = HINT_SCALE_INTERVALS[type];
  return {
    type,
    notes: buildSpelledScale(tonic, intervals, HINT_SCALE_DEGREES[type]),
  };
}

/** Pitch-class numbers of a spelled collection. */
export function scalePitchClasses(notes: readonly PitchClass[]): readonly number[] {
  return notes.map((note) => pitchClassNumber(note));
}
