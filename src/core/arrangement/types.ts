/**
 * Arrangement data model (FR-ARR-1..6, FR-TMP-1..4, FR-IO-1).
 *
 * The types here describe the *in-memory* arrangement: a session with its
 * sections, the progressions they use and the chord slots those progressions
 * are made of. The on-disk document shapes are defined by the schemas in
 * `schema.ts`; the types below are the domain vocabulary the compiler and the
 * file formats share.
 *
 * Two units are used and they are deliberately different:
 *
 * - **Beat** (used by `ChordSlot.durationBeats`) is always a quarter note.
 *   The tick grid is 480 ticks per quarter, so one beat is 480 ticks in every
 *   meter. A 4/4 bar is therefore 4 beats, a 6/8 bar is 3 beats and a 7/8
 *   bar is 3.5 beats.
 * - **Tempo beat** (used by `tempoBpm` and by the metronome) follows OQ-5:
 *   quarter-note BPM everywhere except 6/8, which counts dotted quarters.
 */

import type { AccidentalPreference, ChordQuality, ScaleType } from '../theory/types';

/** Time signatures supported by FR-TMP-3. */
export const TIME_SIGNATURES = ['4/4', '3/4', '6/8', '5/4', '7/8'] as const;
export type TimeSignature = (typeof TIME_SIGNATURES)[number];

/** Preset categories from FR-LIB-1. */
export const PRESET_CATEGORIES = ['rock', 'blues', 'jazz', 'modal'] as const;
export type PresetCategory = (typeof PRESET_CATEGORIES)[number];

/** Key spelling preference (OQ-2); the theory core owns the vocabulary. */
export const ACCIDENTAL_PREFERENCES = ['sharps', 'flats'] as const;
export type { AccidentalPreference };

/**
 * Beat grouping for 5/4 (FR-TMP-4): 3+2 by default, 2+3 when the user
 * switches it. The grouping only applies to 5/4; the other meters have a
 * single fixed grouping.
 */
export const BEAT_GROUPINGS = ['3+2', '2+3'] as const;
export type BeatGrouping = (typeof BEAT_GROUPINGS)[number];

/** Loop modes (FR-PLY-6). The loop region itself is a range of expanded bars (G-07). */
export const LOOP_MODES = ['off', 'whole', 'section', 'barRange'] as const;
export type LoopMode = (typeof LOOP_MODES)[number];

/** A pitch class with an explicit spelling (letter plus accidental). */
export interface SessionPitchClass {
  readonly letter: 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
  readonly alteration: number;
}

/** The session key: a tonic and the spelling preference used for display. */
export interface SessionKey {
  readonly tonic: SessionPitchClass;
  readonly spelling: AccidentalPreference;
}

/** One chord in a progression, with its duration in quarter-note beats. */
export interface ChordSlot {
  /** Major-scale degree, 1..7. */
  readonly degree: number;
  /** Semitone alteration of the degree: -1 is flat, +1 is sharp. */
  readonly alteration?: number | undefined;
  /** Explicit chord quality; never inferred from the scale type. */
  readonly quality: ChordQuality;
  /** Duration in quarter-note beats; one 4/4 bar is 4 beats. */
  readonly durationBeats: number;
}

/** A progression: an ordered list of chord slots (FR-LIB-3). */
export interface Progression {
  readonly id: string;
  readonly name: string;
  readonly category: PresetCategory;
  /** Built-in progressions are read-only but can be duplicated (FR-LIB-4). */
  readonly builtIn: boolean;
  readonly chords: readonly ChordSlot[];
}

/** One section of the arrangement (FR-ARR-2). */
export interface Section {
  readonly name: string;
  /** How many times the section is played; repeats are unrolled by the compiler. */
  readonly repeatCount: number;
  readonly progression: Progression;
  /** Library preset this section came from, when it came from one. */
  readonly presetId?: string | undefined;
}

/** Per-part mixer and routing settings (requirements §7). */
export interface PartSettings {
  readonly volume: number;
  readonly muted: boolean;
  /** User-facing MIDI channel, 1..16 (FR-SND-5 defaults: 1, 2, 10). */
  readonly channel: number;
}

export interface MixSettings {
  readonly chords: PartSettings;
  readonly bass: PartSettings;
  readonly click: PartSettings;
}

/** A bar range in the expanded arrangement, used for loop selection (G-07). */
export interface BarRange {
  /** First bar, 1-based, in global expanded-bar numbering. */
  readonly startBar: number;
  /** Last bar, inclusive, in global expanded-bar numbering. */
  readonly endBar: number;
}

export interface PlaybackSettings {
  /** Count-in bars before the arrangement starts, 0..4 (FR-PLY-5). */
  readonly countInBars: number;
  readonly loopMode: LoopMode;
  /** Loop range in global expanded-bar numbering; only used by `barRange`. */
  readonly loopBarRange?: BarRange | undefined;
}

/** A session: one key, one tempo, one meter and an ordered list of sections. */
export interface Session {
  /** Schema version of the document this session was loaded from (FR-IO-1). */
  readonly schemaVersion: number;
  readonly name: string;
  readonly key: SessionKey;
  readonly scaleType: ScaleType;
  readonly tempoBpm: number;
  readonly timeSignature: TimeSignature;
  /** Only meaningful for 5/4 (FR-TMP-4). */
  readonly beatGrouping?: BeatGrouping | undefined;
  readonly sections: readonly Section[];
  readonly mix: MixSettings;
  readonly playback: PlaybackSettings;
}

/** A preset document: a progression plus its library metadata (FR-LIB-1, FR-LIB-5). */
export interface PresetDocument {
  readonly schemaVersion: number;
  readonly id: string;
  readonly name: string;
  readonly category: PresetCategory;
  readonly builtIn: boolean;
  /** Scale types this preset is suggested for; drives preset suggestions only. */
  readonly homeScaleTypes: readonly string[];
  /** The meter the preset's durations were authored in. */
  readonly timeSignature: TimeSignature;
  readonly chords: readonly ChordSlot[];
}
