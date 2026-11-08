import type { Letter, PitchClass } from './types';

/** Natural semitone value of each letter, C = 0. */
export const LETTER_SEMITONES: Readonly<Record<Letter, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

/** Letters in ascending diatonic order, used for scale-step arithmetic. */
export const LETTERS: readonly Letter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

const LETTER_INDEX: Readonly<Record<Letter, number>> = {
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
};

/** Normalises a semitone count into the 0..11 pitch-class range. */
export function modulo12(value: number): number {
  return ((value % 12) + 12) % 12;
}

/**
 * Chooses the signed alteration in -6..6 that represents `value` modulo 12.
 */
export function signedModulo12(value: number): number {
  const normalised = modulo12(value);
  return normalised > 6 ? normalised - 12 : normalised;
}

/** Pitch class number (0..11) of a spelled pitch class. */
export function pitchClassNumber(pitch: PitchClass): number {
  return modulo12(LETTER_SEMITONES[pitch.letter] + pitch.alteration);
}

/** Steps a letter by `count` diatonic positions, wrapping after B. */
export function stepLetter(letter: Letter, count: number): Letter {
  const index = (LETTER_INDEX[letter] + count + 7 * 7) % 7;
  return LETTERS[index] as Letter;
}

/** Diatonic distance in letter steps from one letter to another. */
export function letterDistance(from: Letter, to: Letter): number {
  return (LETTER_INDEX[to] - LETTER_INDEX[from] + 7) % 7;
}

/**
 * Finds the alteration that turns `letter` into `targetPitchClass`, keeping the
 * result inside the supported double-accidental range when possible.
 */
export function alterationForLetter(letter: Letter, targetPitchClass: number): number {
  return signedModulo12(targetPitchClass - LETTER_SEMITONES[letter]);
}

/** Returns true when the alteration fits the supported accidental range. */
export function isSupportedAlteration(alteration: number): boolean {
  return alteration >= -2 && alteration <= 2;
}

/** Unicode accidental spelling, e.g. -1 -> "♭", 2 -> "♯♯". */
export function formatAlteration(alteration: number): string {
  if (alteration === 0) {
    return '';
  }
  const symbol = alteration > 0 ? '♯' : '♭';
  return symbol.repeat(Math.abs(alteration));
}

/** Formats a pitch class as a letter plus accidental, e.g. "F♯". */
export function formatPitchClass(pitch: PitchClass): string {
  return `${pitch.letter}${formatAlteration(pitch.alteration)}`;
}

/**
 * Parses a letter and accidental sequence into a pitch class.
 *
 * Returns `null` when the text is not a valid pitch-class spelling.
 */
export function parsePitchClass(text: string): PitchClass | null {
  const match = /^([A-Ga-g])([#♯b♭]{0,2})$/.exec(text);
  if (match === null) {
    return null;
  }
  const letter = (match[1] as Letter).toUpperCase() as Letter;
  const accidentalText = match[2] ?? '';
  let alteration = 0;
  for (const symbol of accidentalText) {
    if (symbol === '#' || symbol === '♯') {
      alteration += 1;
    } else {
      alteration -= 1;
    }
  }
  if (!isSupportedAlteration(alteration)) {
    return null;
  }
  return { letter, alteration };
}

/** Creates a pitch class from a letter and alteration. */
export function pitchClass(letter: Letter, alteration = 0): PitchClass {
  if (!isSupportedAlteration(alteration)) {
    throw new RangeError(`Unsupported accidental: ${alteration}`);
  }
  return { letter, alteration };
}

/**
 * Spells a diatonic tone above a root.
 *
 * `letterSteps` is the number of letter positions above the root, so a ninth
 * is one letter step and an eleventh is three. The tone's pitch class is the
 * root's pitch class plus `semitonesAboveRoot`; its letter is fixed by the
 * degree, and the accidental is the difference between the target pitch
 * class and that letter's natural pitch class.
 *
 * This keeps spellings correct in sharp and flat keys: B♭maj7 spells A
 * natural, F♯maj7 spells E♯, and C7 spells B♭.
 */
export function spellDiatonicTone(
  root: PitchClass,
  letterSteps: number,
  semitonesAboveRoot: number,
): PitchClass {
  const letter = stepLetter(root.letter, letterSteps);
  const target = modulo12(pitchClassNumber(root) + semitonesAboveRoot);
  const alteration = signedModulo12(target - LETTER_SEMITONES[letter]);
  if (!isSupportedAlteration(alteration)) {
    throw new RangeError(
      `Tone ${letterSteps + 1} of ${root.letter}${root.alteration} needs an unsupported accidental`,
    );
  }
  return { letter, alteration };
}

/**
 * Chooses the closest supported spelling of a pitch class.
 *
 * The preferred letter is used when it can express the pitch class within the
 * supported accidental range. Otherwise the spelling with the smallest
 * absolute alteration is chosen, which keeps a double-accidental limit
 * (G-09) while still producing a usable name.
 */
export function closestSupportedSpelling(
  target: number,
  preferredLetter?: Letter,
): { readonly pitch: PitchClass; readonly exact: boolean } {
  const candidates = spellingsForPitchClass(target);
  if (preferredLetter !== undefined) {
    const preferred = candidates.find((candidate) => candidate.letter === preferredLetter);
    if (preferred !== undefined) {
      return { pitch: preferred, exact: true };
    }
  }
  let best: PitchClass | null = null;
  for (const candidate of candidates) {
    if (best === null) {
      best = candidate;
      continue;
    }
    const candidateDistance = Math.abs(candidate.alteration);
    const bestDistance = Math.abs(best.alteration);
    if (candidateDistance < bestDistance) {
      best = candidate;
    }
  }
  if (best === null) {
    throw new RangeError(`No supported spelling for pitch class ${target}`);
  }
  return { pitch: best, exact: false };
}

/**
 * All spellings of a pitch-class number that fit the supported accidental
 * range, ordered by letter.
 */
export function spellingsForPitchClass(target: number): PitchClass[] {
  const result: PitchClass[] = [];
  for (const letter of LETTERS) {
    const alteration = signedModulo12(target - LETTER_SEMITONES[letter]);
    if (isSupportedAlteration(alteration)) {
      result.push({ letter, alteration });
    }
  }
  return result;
}

/** Enharmonic spellings for a spelled pitch class. */
export function enharmonicPitchClasses(pitch: PitchClass): PitchClass[] {
  return spellingsForPitchClass(pitchClassNumber(pitch));
}
