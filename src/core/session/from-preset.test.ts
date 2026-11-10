/**
 * Building a session from a preset (P4.9).
 *
 * The minimal UI turns the user's choices into a session the compiler can
 * read. The conversion is pure, so it is tested here.
 */

import { describe, expect, it } from 'vitest';

import { compileTimeline } from '../compiler/compile';

import { SCALE_TYPE_NAMES, sessionFromPreset } from './from-preset';

const PRESET = {
  schemaVersion: 1,
  id: 'r1',
  name: 'Classic rock I–IV–V–IV',
  category: 'rock',
  builtIn: true,
  homeScaleTypes: ['mixolydian', 'major'],
  timeSignature: '4/4',
  chords: [
    { degree: 1, quality: '', durationBeats: 4 },
    { degree: 4, quality: '', durationBeats: 4 },
    { degree: 5, quality: '', durationBeats: 4 },
    { degree: 4, quality: '', durationBeats: 4 },
  ],
} as const;

describe('session from preset', () => {
  it('keeps the preset chords and duration', () => {
    const session = sessionFromPreset({
      preset: PRESET,
      tonic: 'C',
      scaleType: 'mixolydian',
      tempoBpm: 120,
    });

    expect(session.sections).toHaveLength(1);
    expect(session.sections[0]?.progression.chords).toEqual(PRESET.chords);
    expect(session.sections[0]?.presetId).toBe('r1');
  });

  it('takes the key, the scale and the tempo from the caller', () => {
    const session = sessionFromPreset({
      preset: PRESET,
      tonic: 'D',
      alteration: -1,
      scaleType: 'dorian',
      tempoBpm: 96,
    });

    expect(session.key.tonic).toEqual({ letter: 'D', alteration: -1 });
    expect(session.key.spelling).toBe('flats');
    expect(session.scaleType).toBe('dorian');
    expect(session.tempoBpm).toBe(96);
  });

  it('uses the preset time signature and a one-bar count-in by default', () => {
    const session = sessionFromPreset({
      preset: PRESET,
      tonic: 'C',
      scaleType: 'mixolydian',
      tempoBpm: 120,
    });

    expect(session.timeSignature).toBe('4/4');
    expect(session.playback.countInBars).toBe(1);
    expect(session.playback.loopMode).toBe('off');
  });

  it('compiles into a timeline of the expected length', () => {
    const session = sessionFromPreset({
      preset: PRESET,
      tonic: 'C',
      scaleType: 'mixolydian',
      tempoBpm: 120,
    });
    const timeline = compileTimeline(session);

    expect(timeline.totalBars).toBe(4);
    expect(timeline.countInTicks).toBe(4 * 480);
    expect(timeline.events.some((event) => event.kind === 'note')).toBe(true);
    expect(timeline.events.some((event) => event.kind === 'click')).toBe(true);
  });

  it('names every scale type it offers', () => {
    for (const name of Object.values(SCALE_TYPE_NAMES)) {
      expect(name.length).toBeGreaterThan(0);
    }
  });
});
