/**
 * Unit tests for the Spike S2 measurement helpers.
 *
 * These pin the maths the MIDI go/no-go decision relies on: the
 * audio-clock-to-performance.now() mapping, the percentile calculation and
 * the event-id encoding used to match loopback messages to intended sends.
 */

import { describe, expect, it } from 'vitest';

import {
  buildMeasurementTimeline,
  decodeEventId,
  encodeEventId,
  MIDI_CLOCK_PPQN,
  percentile,
  performanceTimeForAudioTime,
  summarizeSamples,
  TICKS_PER_QUARTER,
  TimelineClock,
} from '../../spikes/s2/renderer/analysis';

describe('audio-clock to performance.now() mapping', () => {
  it('maps a future audio time onto the performance.now() timeline', () => {
    const mapped = performanceTimeForAudioTime(
      { contextTime: 10, performanceTime: 5000 },
      10.25,
      0.02,
      0.005,
    );
    // 250 ms of audio time plus 25 ms of output and base latency.
    expect(mapped).toBeCloseTo(5275, 6);
  });

  it('is monotone in the target audio time', () => {
    const earlier = performanceTimeForAudioTime(
      { contextTime: 10, performanceTime: 5000 },
      10.1,
      0,
      0,
    );
    const later = performanceTimeForAudioTime(
      { contextTime: 10, performanceTime: 5000 },
      10.2,
      0,
      0,
    );
    expect(later).toBeGreaterThan(earlier);
  });
});

describe('percentiles', () => {
  it('interpolates between samples', () => {
    expect(percentile([0, 10], 0.5)).toBeCloseTo(5, 6);
    expect(percentile([0, 10, 20, 30], 0.95)).toBeCloseTo(28.5, 6);
  });

  it('returns NaN for an empty sample set', () => {
    expect(Number.isNaN(percentile([], 0.5))).toBe(true);
  });

  it('summarizes a distribution', () => {
    const stats = summarizeSamples([4, 1, 3, 2]);
    expect(stats.count).toBe(4);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(4);
    expect(stats.mean).toBeCloseTo(2.5, 6);
    expect(stats.p50).toBeCloseTo(2.5, 6);
  });
});

describe('event id encoding', () => {
  it('round-trips ids through the note and velocity bytes', () => {
    for (const id of [0, 1, 99, 100, 4242, 12699]) {
      const { note, velocity } = encodeEventId(id);
      expect(decodeEventId(note, velocity)).toBe(id);
    }
  });

  it('rejects ids that cannot be encoded', () => {
    expect(() => encodeEventId(-1)).toThrow(RangeError);
    expect(() => encodeEventId(12700)).toThrow(RangeError);
  });

  it('ignores bytes that are not encoded ids', () => {
    expect(decodeEventId(10, 0)).toBeNull();
    expect(decodeEventId(5, 1)).toBeNull();
  });
});

describe('timeline clock', () => {
  const clock = new TimelineClock(0, 1000, 120);

  it('converts ticks to performance time at the given tempo', () => {
    expect(clock.performanceTimeForTick(TICKS_PER_QUARTER)).toBeCloseTo(1500, 6);
    expect(clock.performanceTimeForTick(0)).toBe(1000);
  });

  it('spaces 24 ppqn clock pulses evenly', () => {
    expect(clock.clockPulseIntervalMs).toBeCloseTo(60000 / 120 / MIDI_CLOCK_PPQN, 6);
    expect(clock.clockPulseIntervalMs).toBeCloseTo(20.833333, 5);
  });

  it('maps performance time back to ticks', () => {
    expect(clock.tickForPerformanceTime(1500)).toBeCloseTo(TICKS_PER_QUARTER, 6);
  });

  it('rejects a non-positive tempo', () => {
    expect(() => new TimelineClock(0, 0, 0)).toThrow(RangeError);
  });
});

describe('measurement timeline', () => {
  const timeline = buildMeasurementTimeline({ bpm: 120, bars: 2, beatsPerBar: 4, notesPerBeat: 1 });

  it('emits 24 clock pulses per quarter note', () => {
    const clocks = timeline.filter((event) => event.kind === 'clock');
    expect(clocks.length).toBe(2 * 4 * MIDI_CLOCK_PPQN);
  });

  it('places the clock pulses on the 24th-of-a-beat grid', () => {
    const clocks = timeline.filter((event) => event.kind === 'clock');
    expect(clocks[0]?.tick).toBe(0);
    expect(clocks[1]?.tick).toBe(TICKS_PER_QUARTER / MIDI_CLOCK_PPQN);
  });

  it('uses the default FR-SND-5 channels for click, bass and chords', () => {
    const noteOns = timeline.filter((event) => event.kind === 'note-on');
    expect(noteOns.some((event) => event.channel === 10)).toBe(true);
    expect(noteOns.some((event) => event.channel === 2)).toBe(true);
    expect(noteOns.some((event) => event.channel === 1)).toBe(true);
  });

  it('sorts events by tick', () => {
    const ticks = timeline.map((event) => event.tick);
    expect([...ticks].sort((left, right) => left - right)).toEqual(ticks);
  });

  it('gives every event a unique id', () => {
    const ids = new Set(timeline.map((event) => event.id));
    expect(ids.size).toBe(timeline.length);
  });
});
