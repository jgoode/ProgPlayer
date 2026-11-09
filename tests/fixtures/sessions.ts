/**
 * Session fixtures used by the arrangement, compiler and format tests.
 *
 * The fixtures are built by a helper so a test only states what matters
 * about its case.
 */

import type { ChordSlot, Progression, Section, Session } from '../../src/core/arrangement/types';

export const C_MAJOR = { letter: 'C', alteration: 0 } as const;

/** Builds a progression from chord slots. */
export function progression(chords: readonly ChordSlot[]): Progression {
  return {
    id: 'test-progression',
    name: 'Test progression',
    category: 'jazz',
    builtIn: false,
    chords,
  };
}

/** Builds a section from chord slots. */
export function section(name: string, chords: readonly ChordSlot[], repeatCount = 1): Section {
  return { name, repeatCount, progression: progression(chords) };
}

/** Builds a session from sections. */
export function session(sections: readonly Section[], overrides: Partial<Session> = {}): Session {
  return {
    schemaVersion: 1,
    name: 'Test session',
    key: { tonic: C_MAJOR, spelling: 'sharps' },
    scaleType: 'major',
    tempoBpm: 120,
    timeSignature: '4/4',
    sections,
    mix: {
      chords: { volume: 0.8, muted: false, channel: 1 },
      bass: { volume: 0.8, muted: false, channel: 2 },
      click: { volume: 0.7, muted: false, channel: 10 },
    },
    playback: { countInBars: 1, loopMode: 'off' },
    ...overrides,
  };
}

/** One chord per bar in 4/4. */
export function barChord(degree: number, quality: ChordSlot['quality'] = ''): ChordSlot {
  return { degree, quality, durationBeats: 4 };
}

/** Two chords per bar in 4/4. */
export function halfBarChord(degree: number, quality: ChordSlot['quality'] = ''): ChordSlot {
  return { degree, quality, durationBeats: 2 };
}
