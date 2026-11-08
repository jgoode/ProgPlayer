import { modulo12, pitchClassNumber } from './pitch';
import type { Chord, FretboardOptions, FretboardPosition, PitchClass } from './types';

/** Standard guitar tuning, low E to high E, as MIDI note numbers. */
export const STANDARD_TUNING: readonly number[] = [40, 45, 50, 55, 59, 64];

/**
 * Returns every fret position for the supplied pitch classes.
 *
 * The default range is frets 0..15 inclusive. Only exact pitch classes are
 * returned; the caller decides how to group them into shapes.
 */
export function fretboardPositions(
  pitchClasses: readonly (PitchClass | number)[],
  options: FretboardOptions = {},
): readonly FretboardPosition[] {
  const tuning = options.tuning ?? STANDARD_TUNING;
  const minFret = options.frets?.min ?? 0;
  const maxFret = options.frets?.max ?? 15;
  if (minFret < 0 || maxFret < minFret) {
    throw new RangeError(`Invalid fret range: ${minFret}..${maxFret}`);
  }
  const targets = new Set(
    pitchClasses.map((pitch) =>
      typeof pitch === 'number' ? modulo12(pitch) : pitchClassNumber(pitch),
    ),
  );
  const positions: FretboardPosition[] = [];
  tuning.forEach((openNote, stringIndex) => {
    for (let fret = minFret; fret <= maxFret; fret += 1) {
      const midiNote = openNote + fret;
      const pitchClass = modulo12(midiNote);
      if (targets.has(pitchClass)) {
        positions.push({
          stringIndex,
          openNote,
          fret,
          midiNote,
          pitchClass,
        });
      }
    }
  });
  return positions;
}

/** Returns every fret position for the tones of a chord. */
export function chordFretboardPositions(
  chord: Chord,
  options: FretboardOptions = {},
): readonly FretboardPosition[] {
  return fretboardPositions(chord.notes, options);
}
