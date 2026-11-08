import { CHORD_FORMULAS, hasMajorThird } from './chords';
import { pitchClassNumber } from './pitch';
import type { Chord, ChordQuality, Voicing, VoicingRules } from './types';

/**
 * Default voicing rules.
 *
 * The chord register spans G3..C6 and is centred on middle C (C4). The bass
 * register spans E1..E3 and places the root near C3, an octave below the
 * chord centre. These are the OQ-6 defaults and are recorded in
 * `docs/voicing-rules.md` for musician review.
 */
export const DEFAULT_VOICING_RULES: VoicingRules = {
  chordLow: 55,
  chordHigh: 84,
  bassLow: 28,
  bassHigh: 52,
  closeSpan: 24,
};

/** One table-driven voicing rule. */
export interface VoicingRule {
  readonly id: string;
  /** Minimum extension degree that activates the rule. */
  readonly minimumExtensionDegree?: number;
  /** Formula degree removed by the rule. */
  readonly removesDegree?: number;
  /** Require a major third in the chord formula. */
  readonly requiresMajorThird?: boolean;
  /** Require the affected extension to be unaltered. */
  readonly requiresUnaltered?: boolean;
}

/**
 * Voicing rule table.
 *
 * Order matters: rules are evaluated in sequence and each removal is applied
 * at most once. Rules are data so that they can be tuned after the M-7
 * listening review without changing the voicing algorithm.
 */
export const VOICING_RULES: readonly VoicingRule[] = [
  {
    id: 'drop-fifth-for-ninth-or-higher',
    minimumExtensionDegree: 9,
    removesDegree: 5,
  },
  {
    id: 'drop-eleventh-over-major-third',
    minimumExtensionDegree: 11,
    removesDegree: 11,
    requiresMajorThird: true,
    requiresUnaltered: true,
  },
];

function formulaEntry(quality: ChordQuality, degree: number) {
  return CHORD_FORMULAS[quality].find((entry) => entry.degree === degree);
}

/**
 * Returns the formula degrees kept by the voicing rules.
 */
export function retainedFormulaDegrees(quality: ChordQuality): readonly number[] {
  const formula = CHORD_FORMULAS[quality];
  const removed = new Set<number>();
  for (const rule of VOICING_RULES) {
    if (rule.removesDegree === undefined) {
      continue;
    }
    const removedEntry = formulaEntry(quality, rule.removesDegree);
    if (removedEntry === undefined) {
      continue;
    }
    const hasTrigger = formula.some((entry) => entry.degree >= (rule.minimumExtensionDegree ?? 0));
    if (!hasTrigger) {
      continue;
    }
    if (rule.requiresMajorThird === true && !hasMajorThird(quality)) {
      continue;
    }
    if (rule.requiresUnaltered === true) {
      const naturalSemitones = rule.removesDegree === 11 ? 17 : undefined;
      if (naturalSemitones !== undefined && removedEntry.semitones !== naturalSemitones) {
        continue;
      }
    }
    removed.add(rule.removesDegree);
  }
  return formula.filter((entry) => !removed.has(entry.degree)).map((entry) => entry.degree);
}

interface RotationCandidate {
  readonly notes: readonly number[];
  readonly cost: number;
  readonly lowest: number;
}

/**
 * Symmetric voice-leading cost.
 *
 * Each note in both sets is charged its distance to the nearest note in the
 * other set. A common tone therefore costs nothing and an added or removed
 * voice is charged once for each side that has no counterpart.
 */
export function voiceLeadingCost(
  previous: readonly number[],
  candidate: readonly number[],
): number {
  if (previous.length === 0 || candidate.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  let cost = 0;
  for (const note of previous) {
    let nearest = Number.POSITIVE_INFINITY;
    for (const other of candidate) {
      nearest = Math.min(nearest, Math.abs(note - other));
    }
    cost += nearest;
  }
  for (const note of candidate) {
    let nearest = Number.POSITIVE_INFINITY;
    for (const other of previous) {
      nearest = Math.min(nearest, Math.abs(note - other));
    }
    cost += nearest;
  }
  return cost;
}

/**
 * Builds close-position candidates for a chord.
 *
 * Every rotation of the retained chord tones is a candidate inversion. The
 * tones of a rotation are placed in ascending order with the smallest
 * possible spacing, then shifted by octaves so the whole voicing stays in
 * the chord register and within the close-position span.
 */
export function closePositionCandidates(
  chord: Chord,
  rules: VoicingRules = DEFAULT_VOICING_RULES,
): readonly RotationCandidate[] {
  const degrees = retainedFormulaDegrees(chord.quality);
  const formula = CHORD_FORMULAS[chord.quality];
  const pitchClasses = degrees.map((degree) => {
    const index = formula.findIndex((entry) => entry.degree === degree);
    const note = chord.notes[index];
    if (note === undefined) {
      throw new RangeError(`Missing chord tone for degree ${degree}`);
    }
    return pitchClassNumber(note);
  });

  const candidates: RotationCandidate[] = [];
  for (let rotation = 0; rotation < pitchClasses.length; rotation += 1) {
    const rotated = [...pitchClasses.slice(rotation), ...pitchClasses.slice(0, rotation)];
    const offsets: number[] = [0];
    for (let index = 1; index < rotated.length; index += 1) {
      const previous = rotated[index - 1] as number;
      const current = rotated[index] as number;
      let offset = current - previous;
      while (offset <= 0) {
        offset += 12;
      }
      offsets.push((offsets[index - 1] as number) + offset);
    }
    const span = (offsets[offsets.length - 1] as number) - (offsets[0] as number);
    if (span > rules.closeSpan) {
      continue;
    }
    const firstPitchClass = rotated[0] as number;
    for (let first = rules.chordLow; first + span <= rules.chordHigh; first += 1) {
      if (((first % 12) + 12) % 12 !== firstPitchClass) {
        continue;
      }
      candidates.push({
        notes: offsets.map((offset) => first + offset),
        cost: 0,
        lowest: first,
      });
    }
  }
  return candidates;
}

/**
 * Selects the inversion with the least movement from `previous`.
 *
 * Ties are broken deterministically: lower movement first, then the lower
 * bass note, then the lower first chord note.
 */
export function selectVoicing(
  chord: Chord,
  previous: readonly number[] = [],
  rules: VoicingRules = DEFAULT_VOICING_RULES,
): readonly number[] {
  const candidates = closePositionCandidates(chord, rules);
  if (candidates.length === 0) {
    throw new RangeError(`No close-position voicing fits the register for ${chord.quality}`);
  }
  let best: RotationCandidate | null = null;
  let bestSecondary = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    // The first chord of a progression has no predecessor, so it is centred
    // on middle C: the candidate whose root is closest to C4 wins. On a tie
    // the root-position voicing is preferred, then the candidate whose lowest
    // note is closest to C4.
    const rootIndex = candidate.notes.findIndex(
      (note) => ((note % 12) + 12) % 12 === pitchClassNumber(chord.root),
    );
    const rootNote = candidate.notes[rootIndex < 0 ? 0 : rootIndex] as number;
    const isFirst = previous.length === 0;
    const cost = isFirst ? Math.abs(rootNote - 60) : voiceLeadingCost(previous, candidate.notes);
    const secondary = isFirst ? (rootIndex === 0 ? 0 : 1) : candidate.lowest;
    const scored: RotationCandidate = { ...candidate, cost };
    if (
      best === null ||
      scored.cost < best.cost ||
      (scored.cost === best.cost && secondary < bestSecondary)
    ) {
      best = scored;
      bestSecondary = secondary;
    }
  }
  return (best as RotationCandidate).notes;
}

/** Selects the bass note for a chord root in the bass register. */
export function selectBassNote(chord: Chord, rules: VoicingRules = DEFAULT_VOICING_RULES): number {
  const rootPitchClass = pitchClassNumber(chord.root);
  let best = Number.NaN;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let note = rules.bassLow; note <= rules.bassHigh; note += 1) {
    if (((note % 12) + 12) % 12 !== rootPitchClass) {
      continue;
    }
    const distance = Math.abs(note - 48);
    if (distance < bestDistance) {
      best = note;
      bestDistance = distance;
    }
  }
  if (Number.isNaN(best)) {
    throw new RangeError(`No bass note fits the register for root ${chord.root.letter}`);
  }
  return best;
}

/** Voices a chord, optionally using the previous voicing to minimise movement. */
export function voiceChord(
  chord: Chord,
  previous: readonly number[] = [],
  rules: VoicingRules = DEFAULT_VOICING_RULES,
): Voicing {
  const notes = selectVoicing(chord, previous, rules);
  return { notes, bass: selectBassNote(chord, rules) };
}

/** Voices a progression, carrying each voicing into the next chord. */
export function voiceProgression(
  chords: readonly Chord[],
  rules: VoicingRules = DEFAULT_VOICING_RULES,
): readonly Voicing[] {
  const voicings: Voicing[] = [];
  let previous: readonly number[] = [];
  for (const chord of chords) {
    const voicing = voiceChord(chord, previous, rules);
    voicings.push(voicing);
    previous = voicing.notes;
  }
  return voicings;
}
