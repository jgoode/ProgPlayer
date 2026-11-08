import { buildChord } from './chords';
import { closestSupportedSpelling, pitchClassNumber, spellDiatonicTone, stepLetter } from './pitch';
import { generateScale } from './scales';
import type { Chord, DegreeChord, PitchClass, ResolvedChord, Scale, ScaleType } from './types';

/** Semitones of the major scale above the tonic, indexed by degree - 1. */
export const MAJOR_SCALE_INTERVALS: readonly number[] = [0, 2, 4, 5, 7, 9, 11];

/**
 * Resolves a scale degree to a root using major-scale letter numbering.
 *
 * The root's letter follows the degree (I = tonic letter, II = next letter,
 * and so on). Accidentals are applied to that letter, so ♭VII in C is B♭ and
 * ♭III in C is E♭. This rule is independent of the selected scale type, as
 * confirmed by Assumption A5 / G-01.
 */
export function resolveDegreeRoot(tonic: PitchClass, degree: DegreeChord): PitchClass {
  if (!Number.isInteger(degree.degree) || degree.degree < 1 || degree.degree > 7) {
    throw new RangeError(`Degree must be an integer from 1 to 7: ${degree.degree}`);
  }
  const alteration = degree.alteration ?? 0;
  if (alteration < -2 || alteration > 2) {
    throw new RangeError(`Degree alteration must be within -2..2: ${alteration}`);
  }
  const naturalInterval = MAJOR_SCALE_INTERVALS[degree.degree - 1] as number;
  return spellDiatonicTone(tonic, degree.degree - 1, naturalInterval + alteration);
}

/**
 * Resolves a degree chord to a concrete chord.
 *
 * If the requested spelling would need an accidental outside the supported
 * double-accidental range, the closest supported enharmonic spelling is used
 * and reported by the `enharmonic` flag (G-09).
 */
export function resolveDegreeChord(tonic: PitchClass, degree: DegreeChord): ResolvedChord {
  let root: PitchClass;
  let enharmonic = false;
  try {
    root = resolveDegreeRoot(tonic, degree);
  } catch {
    const naturalInterval = MAJOR_SCALE_INTERVALS[degree.degree - 1] as number;
    const alteration = degree.alteration ?? 0;
    const target = pitchClassNumber(tonic) + naturalInterval + alteration;
    const preferredLetter = stepLetter(tonic.letter, degree.degree - 1);
    const closest = closestSupportedSpelling(target, preferredLetter);
    root = closest.pitch;
    enharmonic = !closest.exact;
  }
  return { degree, chord: buildChord(root, degree.quality), enharmonic };
}

/** Resolves a whole progression of degree chords. */
export function resolveProgression(
  tonic: PitchClass,
  degrees: readonly DegreeChord[],
): readonly ResolvedChord[] {
  return degrees.map((degree) => resolveDegreeChord(tonic, degree));
}

/**
 * Returns the scale that contains a chord's pitch classes, when the given
 * scale does.
 */
export function scaleContainingChord(
  tonic: PitchClass,
  scaleType: ScaleType,
  chord: Chord,
): Scale | null {
  const scale = generateScale(tonic, scaleType);
  const scalePitchClasses = new Set(scale.notes.map((note) => pitchClassNumber(note)));
  const chordPitchClasses = new Set(chord.notes.map((note) => pitchClassNumber(note)));
  for (const pitchClass of chordPitchClasses) {
    if (!scalePitchClasses.has(pitchClass)) {
      return null;
    }
  }
  return scale;
}
