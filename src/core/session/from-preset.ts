/**
 * Building a session from a library preset (P4.9).
 *
 * A preset is a progression plus its metadata; a session is that
 * progression in a key, at a tempo, with the transport settings. The
 * minimal UI needs to turn the user's choices — key, scale, tempo, preset
 * — into a session the compiler can read.
 *
 * The module is pure TypeScript, so the conversion is unit testable
 * without a UI or an audio device.
 */

import type { ChordSlot, Section, Session } from '../arrangement/types';
import type { PresetDocument } from '../arrangement/types';
import type { Letter } from '../theory/types';
import type { ScaleType } from '../theory/types';

/** The tonics the UI offers. */
export const TONIC_LETTERS: readonly Letter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/** The scale types the UI offers, with their display names. */
export const SCALE_TYPE_NAMES: Readonly<Record<ScaleType, string>> = {
  major: 'Major',
  naturalMinor: 'Natural minor',
  harmonicMinor: 'Harmonic minor',
  melodicMinor: 'Melodic minor',
  ionian: 'Ionian',
  dorian: 'Dorian',
  phrygian: 'Phrygian',
  lydian: 'Lydian',
  mixolydian: 'Mixolydian',
  aeolian: 'Aeolian',
  locrian: 'Locrian',
};

/** The scale types the UI offers. */
export const SCALE_TYPES: readonly ScaleType[] = Object.keys(SCALE_TYPE_NAMES) as ScaleType[];

/** The options for building a session from a preset. */
export interface SessionFromPresetOptions {
  /** The preset to play. */
  readonly preset: PresetDocument;
  /** The tonic's letter. */
  readonly tonic: Letter;
  /** The tonic's alteration: -1 is flat, 1 is sharp. */
  readonly alteration?: number | undefined;
  /** The scale the chords are resolved in. */
  readonly scaleType: ScaleType;
  /** The tempo, in beats per minute. */
  readonly tempoBpm: number;
  /** The time signature. Defaults to the preset's own. */
  readonly timeSignature?: Session['timeSignature'] | undefined;
  /** The number of count-in bars. Defaults to 1. */
  readonly countInBars?: number | undefined;
  /** The loop mode. Defaults to `off`. */
  readonly loopMode?: Session['playback']['loopMode'] | undefined;
}

/**
 * Builds a session that plays the preset's progression.
 *
 * The chords keep the preset's degrees and durations; only the key, the
 * tempo and the transport settings come from the caller.
 */
export function sessionFromPreset(options: SessionFromPresetOptions): Session {
  const alteration = options.alteration ?? 0;
  const chords: readonly ChordSlot[] = options.preset.chords;

  const section: Section = {
    name: options.preset.name,
    repeatCount: 1,
    presetId: options.preset.id,
    progression: {
      id: options.preset.id,
      name: options.preset.name,
      category: options.preset.category,
      builtIn: options.preset.builtIn,
      chords,
    },
  };

  return {
    schemaVersion: 1,
    name: options.preset.name,
    key: {
      tonic: { letter: options.tonic, alteration },
      spelling: alteration < 0 ? 'flats' : 'sharps',
    },
    scaleType: options.scaleType,
    tempoBpm: options.tempoBpm,
    timeSignature: options.timeSignature ?? options.preset.timeSignature,
    sections: [section],
    mix: {
      chords: { volume: 0.8, muted: false, channel: 1 },
      bass: { volume: 0.8, muted: false, channel: 2 },
      click: { volume: 0.7, muted: false, channel: 10 },
    },
    playback: {
      countInBars: options.countInBars ?? 1,
      loopMode: options.loopMode ?? 'off',
    },
  };
}
