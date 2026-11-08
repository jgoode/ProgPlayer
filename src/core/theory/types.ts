/** Letter names used for explicit pitch-class spelling. */
export type Letter = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';

/**
 * A pitch class with an explicit spelling.
 *
 * `alteration` is in semitones relative to the natural letter: -2 is a double
 * flat, -1 a flat, 0 natural, 1 a sharp and 2 a double sharp.
 */
export interface PitchClass {
  readonly letter: Letter;
  readonly alteration: number;
}

/** Key spelling preference, used when a degree or chord tone needs a choice. */
export type AccidentalPreference = 'sharps' | 'flats';

/** Scale types required by FR-KEY-2. */
export type ScaleType =
  | 'major'
  | 'naturalMinor'
  | 'harmonicMinor'
  | 'melodicMinor'
  | 'ionian'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'aeolian'
  | 'locrian';

/** Scale types that may be suggested for a chord, including chromatic helpers. */
export type HintScaleType =
  | ScaleType
  | 'wholeTone'
  | 'wholeHalfDiminished'
  | 'halfWholeDiminished'
  | 'lydianDominant'
  | 'dominantFlatSix';

export interface Scale {
  readonly type: ScaleType;
  readonly tonic: PitchClass;
  readonly intervals: readonly number[];
  readonly notes: readonly PitchClass[];
}

/**
 * Chord qualities from FR-CHD-1, including the common extension variants.
 *
 * The suffix is the canonical display form; the parser also accepts ASCII
 * `#`/`b` accidentals.
 */
export type ChordQuality =
  | ''
  | 'm'
  | 'dim'
  | 'aug'
  | 'maj7'
  | 'm7'
  | '7'
  | 'm7♭5'
  | 'dim7'
  | 'mMaj7'
  | '6'
  | 'm6'
  | 'add9'
  | 'madd9'
  | '9'
  | 'maj9'
  | 'm9'
  | '7♭9'
  | '7♯9'
  | '7♭5'
  | '7♯5'
  | '7♯11'
  | '7♭13'
  | '11'
  | 'm11'
  | 'maj11'
  | '13'
  | 'maj13'
  | 'm13'
  | 'sus2'
  | 'sus4'
  | '7sus4'
  | '7sus2'
  | 'mMaj9'
  | 'mMaj13'
  | 'maj7♯11'
  | '9♯11'
  | '13♯11'
  | '7♭9♯5'
  | '7♯9♯5'
  | '7♭9♭13'
  | '7♯9♭13';

export interface ChordFormulaEntry {
  /** Diatonic degree above the root: 1, 3, 5, 7, 9, 11 or 13. */
  readonly degree: number;
  /** Semitones above the root. */
  readonly semitones: number;
}

export interface Chord {
  readonly root: PitchClass;
  readonly quality: ChordQuality;
  /** Root plus chord tones, in formula order. */
  readonly notes: readonly PitchClass[];
}

/** A scale-degree chord: major-scale numbering plus an optional accidental. */
export interface DegreeChord {
  /** Major-scale degree, 1..7. */
  readonly degree: number;
  /** Semitone alteration of the degree: -1 is flat, +1 is sharp. */
  readonly alteration?: number;
  readonly quality: ChordQuality;
}

export interface ResolvedChord {
  readonly degree: DegreeChord;
  readonly chord: Chord;
  /** True when the key spelling could not be used and an enharmonic was chosen. */
  readonly enharmonic: boolean;
}

export interface VoicingRules {
  /** Inclusive MIDI bounds for the chord part. */
  readonly chordLow: number;
  readonly chordHigh: number;
  /** Inclusive MIDI bounds for the bass part. */
  readonly bassLow: number;
  readonly bassHigh: number;
  /** Maximum span of a close-position voicing in semitones. */
  readonly closeSpan: number;
}

export interface Voicing {
  /** Ascending MIDI note numbers for the chord part. */
  readonly notes: readonly number[];
  /** MIDI note number of the root in the bass register. */
  readonly bass: number;
}

export interface ChordScaleHint {
  /** The scale selected for the session key. */
  readonly inKeyScale: Scale;
  /** The quality-driven suggestion, rooted at the chord root. */
  readonly suggestedScale: {
    readonly type: HintScaleType;
    readonly notes: readonly PitchClass[];
  };
}

export interface FretboardPosition {
  /** Zero-based string index, low E first. */
  readonly stringIndex: number;
  /** Open-string MIDI note of the string. */
  readonly openNote: number;
  /** Fret number, where 0 is the open string. */
  readonly fret: number;
  readonly midiNote: number;
  /** Pitch class of the played note, 0..11. */
  readonly pitchClass: number;
}

export interface FretboardOptions {
  /** Open-string MIDI notes, low to high. Defaults to standard tuning. */
  readonly tuning?: readonly number[];
  /** Inclusive fret range. Defaults to 0..15. */
  readonly frets?: { readonly min: number; readonly max: number };
}
