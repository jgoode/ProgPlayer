/**
 * Tempo map tests (P4.1, FR-TMP-1, FR-TMP-2).
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_TEMPO_BPM,
  MIN_TEMPO_BPM,
  TempoMap,
  TempoMapBuilder,
  assertTempoInRange,
  nextBeatTick,
} from './tempo-map';

describe('tempo map', () => {
  it('converts a tick to a time at the initial tempo', () => {
    const map = new TempoMapBuilder().withInitialTempo(120).build();

    // 120 BPM is half a second per quarter note, so 480 ticks is 0.5 s.
    expect(map.timeAtTick(0)).toBe(0);
    expect(map.timeAtTick(480)).toBeCloseTo(0.5, 12);
    expect(map.timeAtTick(1920)).toBeCloseTo(2, 12);
  });

  it('converts a time back to a tick', () => {
    const map = new TempoMapBuilder().withInitialTempo(120).build();

    expect(map.tickAtTime(0.5)).toBeCloseTo(480, 9);
    expect(map.tickAtTime(2)).toBeCloseTo(1920, 9);
  });

  it('extrapolates the count-in backwards from the first anchor', () => {
    const map = new TempoMapBuilder().withInitialTempo(120).build();

    expect(map.timeAtTick(-480)).toBeCloseTo(-0.5, 12);
    expect(map.timeAtTick(-1920)).toBeCloseTo(-2, 12);
  });

  it('applies a tempo change from its anchor onwards', () => {
    const map = new TempoMapBuilder().withInitialTempo(120).withChange(480, 60).build();

    expect(map.bpmAtTick(479)).toBe(120);
    expect(map.bpmAtTick(480)).toBe(60);
    // 0.5 s for the first quarter, then 1 s for the second.
    expect(map.timeAtTick(960)).toBeCloseTo(1.5, 12);
  });

  it('keeps the already-scheduled times unchanged when the tempo changes', () => {
    const map = new TempoMapBuilder().withInitialTempo(120).withChange(480, 240).build();

    // The time of the anchor itself does not move.
    expect(map.timeAtTick(480)).toBeCloseTo(0.5, 12);
    // The tempo only affects what comes after the anchor: 240 BPM is
    // 0.25 s per quarter note.
    expect(map.timeAtTick(960)).toBeCloseTo(0.75, 12);
  });

  it('integrates the segments across a tempo change without a jump', () => {
    const map = new TempoMapBuilder().withInitialTempo(120).withChange(480, 240).build();

    const whole = map.secondsBetween(0, 960);
    const firstHalf = map.secondsBetween(0, 480);
    const secondHalf = map.secondsBetween(480, 960);

    expect(whole).toBeCloseTo(firstHalf + secondHalf, 12);
    expect(firstHalf).toBeCloseTo(0.5, 12);
    expect(secondHalf).toBeCloseTo(0.25, 12);
  });

  it('handles several tempo changes', () => {
    const map = new TempoMapBuilder()
      .withInitialTempo(120)
      .withChange(480, 60)
      .withChange(960, 240)
      .build();

    expect(map.bpmAtTick(480)).toBe(60);
    expect(map.bpmAtTick(960)).toBe(240);
    expect(map.timeAtTick(1440)).toBeCloseTo(0.5 + 1 + 0.25, 12);
  });

  it('replaces an anchor when the tempo changes twice before the next beat', () => {
    const map = new TempoMapBuilder()
      .withInitialTempo(120)
      .withChange(480, 60)
      .withChange(480, 90)
      .build();

    expect(map.anchors).toHaveLength(2);
    expect(map.bpmAtTick(480)).toBe(90);
  });

  it('rejects an anchor that moves backwards', () => {
    expect(() =>
      new TempoMapBuilder().withInitialTempo(120).withChange(480, 60).withChange(240, 90),
    ).toThrow(/at or after/);
  });

  it('rejects a map whose anchors do not increase in time', () => {
    expect(
      () =>
        new TempoMap([
          { tick: 0, time: 0, bpm: 120 },
          { tick: 480, time: -1, bpm: 120 },
        ]),
    ).toThrow(/increase in time order/);
  });

  it('rejects a map with no anchors', () => {
    expect(() => new TempoMap([])).toThrow(/at least one anchor/);
  });

  it('accepts the tempo extremes and rejects anything outside them', () => {
    expect(() => assertTempoInRange(MIN_TEMPO_BPM)).not.toThrow();
    expect(() => assertTempoInRange(MAX_TEMPO_BPM)).not.toThrow();
    expect(() => assertTempoInRange(MIN_TEMPO_BPM - 1)).toThrow(RangeError);
    expect(() => assertTempoInRange(MAX_TEMPO_BPM + 1)).toThrow(RangeError);
    expect(() => assertTempoInRange(Number.NaN)).toThrow(RangeError);
  });

  it('computes the timing at 30 and 300 BPM', () => {
    const slow = new TempoMapBuilder().withInitialTempo(30).build();
    const fast = new TempoMapBuilder().withInitialTempo(300).build();

    expect(slow.timeAtTick(480)).toBeCloseTo(2, 12);
    expect(fast.timeAtTick(480)).toBeCloseTo(0.2, 12);
  });

  it('finds the next beat boundary', () => {
    expect(nextBeatTick(0)).toBe(0);
    expect(nextBeatTick(1)).toBe(480);
    expect(nextBeatTick(480)).toBe(480);
    expect(nextBeatTick(481)).toBe(960);
  });
});
