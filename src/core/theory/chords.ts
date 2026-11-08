import {
  closestSupportedSpelling,
  isSupportedAlteration,
  pitchClassNumber,
  spellDiatonicTone,
  stepLetter,
} from './pitch';
import type { Chord, ChordFormulaEntry, ChordQuality, PitchClass } from './types';

/**
 * Chord formulas from FR-CHD-1.
 *
 * `degree` is the diatonic extension (1, 3, 5, 7, 9, 11, 13) and `semitones`
 * is the distance above the root. Extension degrees are written in their
 * octave, so a ninth is 14 semitones above the root.
 *
 * Chord tones are spelled from the root's letter, so C9 contains D (not C♯),
 * F13 contains D (not A) and a flat key keeps flat spellings.
 */
export const CHORD_FORMULAS: Readonly<Record<ChordQuality, readonly ChordFormulaEntry[]>> = {
  '': [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
  ],
  m: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 3 },
    { degree: 5, semitones: 7 },
  ],
  dim: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 3 },
    { degree: 5, semitones: 6 },
  ],
  aug: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 8 },
  ],
  maj7: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 11 },
  ],
  m7: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 3 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
  ],
  '7': [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
  ],
  'm7♭5': [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 3 },
    { degree: 5, semitones: 6 },
    { degree: 7, semitones: 10 },
  ],
  dim7: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 3 },
    { degree: 5, semitones: 6 },
    { degree: 7, semitones: 9 },
  ],
  mMaj7: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 3 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 11 },
  ],
  '6': [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 6, semitones: 9 },
  ],
  m6: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 3 },
    { degree: 5, semitones: 7 },
    { degree: 6, semitones: 9 },
  ],
  add9: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 9, semitones: 14 },
  ],
  madd9: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 3 },
    { degree: 5, semitones: 7 },
    { degree: 9, semitones: 14 },
  ],
  '9': [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
    { degree: 9, semitones: 14 },
  ],
  maj9: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 11 },
    { degree: 9, semitones: 14 },
  ],
  m9: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 3 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
    { degree: 9, semitones: 14 },
  ],
  '7♭9': [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
    { degree: 9, semitones: 13 },
  ],
  '7♯9': [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
    { degree: 9, semitones: 15 },
  ],
  '7♭5': [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 6 },
    { degree: 7, semitones: 10 },
  ],
  '7♯5': [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 8 },
    { degree: 7, semitones: 10 },
  ],
  '7♯11': [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
    { degree: 11, semitones: 18 },
  ],
  '7♭13': [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
    { degree: 13, semitones: 20 },
  ],
  '11': [
    { degree: 1, semitones: 0 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
    { degree: 9, semitones: 14 },
    { degree: 11, semitones: 17 },
  ],
  m11: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 3 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
    { degree: 9, semitones: 14 },
    { degree: 11, semitones: 17 },
  ],
  maj11: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 11 },
    { degree: 9, semitones: 14 },
    { degree: 11, semitones: 17 },
  ],
  '13': [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
    { degree: 9, semitones: 14 },
    { degree: 13, semitones: 21 },
  ],
  maj13: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 11 },
    { degree: 9, semitones: 14 },
    { degree: 13, semitones: 21 },
  ],
  m13: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 3 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
    { degree: 9, semitones: 14 },
    { degree: 13, semitones: 21 },
  ],
  sus2: [
    { degree: 1, semitones: 0 },
    { degree: 2, semitones: 2 },
    { degree: 5, semitones: 7 },
  ],
  sus4: [
    { degree: 1, semitones: 0 },
    { degree: 4, semitones: 5 },
    { degree: 5, semitones: 7 },
  ],
  '7sus4': [
    { degree: 1, semitones: 0 },
    { degree: 4, semitones: 5 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
  ],
  '7sus2': [
    { degree: 1, semitones: 0 },
    { degree: 2, semitones: 2 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
  ],
  mMaj9: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 3 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 11 },
    { degree: 9, semitones: 14 },
  ],
  mMaj13: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 3 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 11 },
    { degree: 9, semitones: 14 },
    { degree: 13, semitones: 21 },
  ],
  'maj7♯11': [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 11 },
    { degree: 11, semitones: 18 },
  ],
  '9♯11': [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
    { degree: 9, semitones: 14 },
    { degree: 11, semitones: 18 },
  ],
  '13♯11': [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
    { degree: 9, semitones: 14 },
    { degree: 11, semitones: 18 },
    { degree: 13, semitones: 21 },
  ],
  '7♭9♯5': [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 8 },
    { degree: 7, semitones: 10 },
    { degree: 9, semitones: 13 },
  ],
  '7♯9♯5': [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 8 },
    { degree: 7, semitones: 10 },
    { degree: 9, semitones: 15 },
  ],
  '7♭9♭13': [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
    { degree: 9, semitones: 13 },
    { degree: 13, semitones: 20 },
  ],
  '7♯9♭13': [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
    { degree: 9, semitones: 15 },
    { degree: 13, semitones: 20 },
  ],
};

/** Letter steps for each diatonic extension degree. */
const DEGREE_POSITION: Readonly<Record<number, number>> = {
  1: 0,
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  7: 6,
  9: 1,
  11: 3,
  13: 5,
};

/** Qualities whose formulas include a major third. */
export function hasMajorThird(quality: ChordQuality): boolean {
  const third = CHORD_FORMULAS[quality].find((entry) => entry.degree === 3);
  return third?.semitones === 4;
}

/** Qualities whose formulas include an 11th. */
export function hasEleventh(quality: ChordQuality): boolean {
  return CHORD_FORMULAS[quality].some((entry) => entry.degree === 11);
}

/** Qualities whose formulas include a ninth or a thirteenth. */
export function hasNinthOrHigher(quality: ChordQuality): boolean {
  return CHORD_FORMULAS[quality].some(
    (entry) => entry.degree === 9 || entry.degree === 11 || entry.degree === 13,
  );
}

/**
 * Builds a chord from a root and a quality formula.
 *
 * Chord tones use the letter implied by each formula degree, so C9 contains
 * D (not C♯), F13 contains D (not A) and B♭ major seventh contains A (not
 * A♭).
 */
export function buildChord(root: PitchClass, quality: ChordQuality): Chord {
  const notes = CHORD_FORMULAS[quality].map((entry) => {
    const letterSteps = DEGREE_POSITION[entry.degree];
    if (letterSteps === undefined) {
      throw new RangeError(`Unsupported chord degree: ${entry.degree}`);
    }
    try {
      return spellDiatonicTone(root, letterSteps, entry.semitones);
    } catch {
      // A remote key can need more than a double accidental for one tone
      // (G-09). Fall back to the closest supported enharmonic spelling.
      const target = (pitchClassNumber(root) + entry.semitones) % 12;
      const preferredLetter = stepLetter(root.letter, letterSteps);
      return closestSupportedSpelling(target, preferredLetter).pitch;
    }
  });
  return { root, quality, notes };
}

/** All qualities in FR-CHD-1. */
export const CHORD_QUALITIES = Object.keys(CHORD_FORMULAS) as ChordQuality[];

/** Returns the pitch-class numbers of a chord, root first. */
export function chordPitchClasses(chord: Chord): readonly number[] {
  return chord.notes.map((note) => pitchClassNumber(note));
}

/**
 * Parses a chord name into a root and quality.
 *
 * Supported roots are A-G with up to two sharps or flats. ASCII `#`/`b` and
 * Unicode `♯`/`♭` are accepted in the quality suffix.
 */
export function parseChordName(name: string): { root: PitchClass; quality: ChordQuality } | null {
  const match = /^([A-Ga-g])([#♯b♭]{0,2})(.*)$/.exec(name.trim());
  if (match === null) {
    return null;
  }
  const letter = (match[1] ?? '').toUpperCase() as PitchClass['letter'];
  const accidentalText = match[2] ?? '';
  let rootAlteration = 0;
  for (const symbol of accidentalText) {
    rootAlteration += symbol === '#' || symbol === '♯' ? 1 : -1;
  }
  if (!isSupportedAlteration(rootAlteration)) {
    return null;
  }
  const root: PitchClass = { letter, alteration: rootAlteration };
  const quality = parseQuality(match[3] ?? '');
  if (quality === null) {
    return null;
  }
  return { root, quality };
}

const ASCII_QUALITY_ALIASES: Readonly<Record<string, ChordQuality>> = {
  '': '',
  m: 'm',
  '-': 'm',
  min: 'm',
  dim: 'dim',
  '°': 'dim',
  aug: 'aug',
  '+': 'aug',
  maj7: 'maj7',
  '△7': 'maj7',
  Δ7: 'maj7',
  m7: 'm7',
  '-7': 'm7',
  min7: 'm7',
  '7': '7',
  m7b5: 'm7♭5',
  ø: 'm7♭5',
  ø7: 'm7♭5',
  dim7: 'dim7',
  '°7': 'dim7',
  mMaj7: 'mMaj7',
  'm(maj7)': 'mMaj7',
  'm(Maj7)': 'mMaj7',
  '-maj7': 'mMaj7',
  '6': '6',
  m6: 'm6',
  '-6': 'm6',
  add9: 'add9',
  madd9: 'madd9',
  '9': '9',
  maj9: 'maj9',
  Δ9: 'maj9',
  m9: 'm9',
  '-9': 'm9',
  '7b9': '7♭9',
  '7#9': '7♯9',
  '7b5': '7♭5',
  '7#5': '7♯5',
  '7#11': '7♯11',
  '7b13': '7♭13',
  '11': '11',
  m11: 'm11',
  '-11': 'm11',
  maj11: 'maj11',
  Δ11: 'maj11',
  '13': '13',
  maj13: 'maj13',
  Δ13: 'maj13',
  m13: 'm13',
  '-13': 'm13',
  sus2: 'sus2',
  sus4: 'sus4',
  '7sus4': '7sus4',
  '7sus2': '7sus2',
  mMaj9: 'mMaj9',
  mMaj13: 'mMaj13',
  'maj7#11': 'maj7♯11',
  '9#11': '9♯11',
  '13#11': '13♯11',
  '7b9#5': '7♭9♯5',
  '7#9#5': '7♯9♯5',
  '7b9b13': '7♭9♭13',
  '7#9b13': '7♯9♭13',
};

/**
 * Parses a chord quality suffix.
 *
 * The longest known suffix wins, so `7sus4` is not mistaken for `7`.
 */
export function parseQuality(text: string): ChordQuality | null {
  const unicode = text.replaceAll('#', '♯').replaceAll('b', '♭');
  if (ASCII_QUALITY_ALIASES[text] !== undefined) {
    return ASCII_QUALITY_ALIASES[text];
  }
  for (const quality of CHORD_QUALITIES) {
    if (quality !== '' && unicode === quality) {
      return quality;
    }
  }
  return null;
}

/** Formats a chord name using standard notation. */
export function formatChordName(chord: Chord): string {
  const symbol = chord.root.alteration > 0 ? '♯' : '♭';
  const accidental =
    chord.root.alteration === 0 ? '' : symbol.repeat(Math.abs(chord.root.alteration));
  return `${chord.root.letter}${accidental}${chord.quality}`;
}
