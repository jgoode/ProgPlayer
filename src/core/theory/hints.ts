import hintTable from './data/chord-scale-hints.json';
import { generateHintScale, generateScale } from './scales';
import type {
  Chord,
  ChordScaleHint,
  ChordQuality,
  HintScaleType,
  PitchClass,
  ScaleType,
} from './types';

const CHORD_SCALE_HINTS = hintTable as Readonly<Record<ChordQuality, HintScaleType>>;

/** Returns the quality-driven scale suggestion for a chord. */
export function suggestScaleForChord(chord: Chord): HintScaleType {
  return CHORD_SCALE_HINTS[chord.quality];
}

/**
 * Returns both scale hints for a chord.
 *
 * `inKeyScale` is the session scale; `suggestedScale` is rooted at the chord
 * root and selected by chord quality, so borrowed and non-diatonic chords
 * still receive a useful suggestion (OQ-8).
 */
export function getChordScaleHints(
  chord: Chord,
  tonic: PitchClass,
  scaleType: ScaleType,
): ChordScaleHint {
  const suggestionType = suggestScaleForChord(chord);
  return {
    inKeyScale: generateScale(tonic, scaleType),
    suggestedScale: generateHintScale(chord.root, suggestionType),
  };
}
