/**
 * Unit tests for the Spike S1 measurement helpers.
 *
 * The maths that decides the go/no-go for the SoundFont engine lives in
 * `spikes/s1/renderer/analysis.ts`; these tests pin the behaviour that the
 * measurement report relies on.
 */

import { describe, expect, it } from 'vitest';

import {
  arrangementDigest,
  barsForSeconds,
  bestAlignment,
  BASS_CHANNEL,
  buildArrangement,
  CHORD_CHANNEL,
  CLICK_CHANNEL,
  compareCaptures,
  engineClockAfterQuanta,
  EXTENDED_CHORD_INTERVALS,
  findOnset,
  findSampleAlignment,
  peakLevel,
  quantumAlignedOffset,
  quantumAlignedTarget,
  quantaForLead,
  rootMeanSquare,
  RENDER_QUANTUM_FRAMES,
  snapFramesToQuantum,
  summarizeErrors,
  tickToSeconds,
  toDecibels,
  allEvents,
} from '../../spikes/s1/renderer/analysis';

describe('render-quantum snapping', () => {
  const SAMPLE_RATE = 48_000;

  it('waits at least one quantum, so an event is always queued', () => {
    expect(quantaForLead(0)).toBe(1);
    expect(quantaForLead(1)).toBe(1);
    expect(quantaForLead(127)).toBe(1);
  });

  it('rounds a lead up to the next whole quantum', () => {
    expect(quantaForLead(128)).toBe(1);
    expect(quantaForLead(129)).toBe(2);
    expect(quantaForLead(256)).toBe(2);
    expect(quantaForLead(257)).toBe(3);
  });

  it('snaps a frame offset to the next quantum boundary', () => {
    expect(snapFramesToQuantum(0)).toBe(RENDER_QUANTUM_FRAMES);
    expect(snapFramesToQuantum(1)).toBe(RENDER_QUANTUM_FRAMES);
    expect(snapFramesToQuantum(128)).toBe(128);
    expect(snapFramesToQuantum(129)).toBe(256);
  });

  it('never pushes an offset a whole quantum late when it already sits on a boundary', () => {
    // The epsilon in `quantaForLead` exists for exactly this case: a lead
    // that is an exact multiple of the quantum must not be rounded up again.
    expect(quantaForLead(128)).toBe(1);
    expect(quantaForLead(128 * 38)).toBe(38);
    expect(quantaForLead(128 * 750)).toBe(750);
  });

  it('rejects a non-positive quantum or sample rate', () => {
    expect(() => quantaForLead(128, 0)).toThrow(RangeError);
    expect(() => quantumAlignedOffset(0.1, 0)).toThrow(RangeError);
  });

  it('advances the engine clock the way the engine does', () => {
    const start = 7.519680000000001;
    const step = 128 * (1 / SAMPLE_RATE);

    expect(engineClockAfterQuanta(start, 0, SAMPLE_RATE)).toBe(start);
    expect(engineClockAfterQuanta(start, 1, SAMPLE_RATE)).toBe(start + step);
    expect(engineClockAfterQuanta(start, 2, SAMPLE_RATE)).toBe(start + step + step);
  });

  it('produces a target the engine reaches exactly, not one a quantum late', () => {
    // This is the regression that matters: the engine advances its clock by
    // `quantumFrames * (1 / sampleRate)` once per quantum and accumulates the
    // rounding error. A target computed as `currentTime + quanta *
    // quantumSeconds` lands a few ULP above the clock the engine will
    // actually reach, so the engine's `event.time <= currentTime` test fails
    // and the event is dispatched a whole quantum (128 frames) late.
    const start = 7.519680000000001;
    let engineClock = start;
    const step = 128 * (1 / SAMPLE_RATE);
    let naiveDiffered = false;

    for (let quanta = 1; quanta <= 40; quanta++) {
      const target = quantumAlignedTarget(start, quanta, SAMPLE_RATE);

      // The engine clock advances by one quantum per iteration.
      engineClock += step;

      // The target must be the engine's clock *exactly*, so that the
      // comparison `event.time <= currentTime` succeeds on that quantum.
      expect(target).toBe(engineClock);

      // The naive computation must never land *below* the engine's clock:
      // that would make the event dispatch early, which the engine would
      // refuse and dispatch in the following quantum instead.
      const naive = start + quanta * (128 / SAMPLE_RATE);
      expect(naive).toBeGreaterThanOrEqual(engineClock);
      if (naive !== engineClock) naiveDiffered = true;
    }

    // The two computations do diverge over a realistic lead, which is why
    // the engine's own arithmetic has to be used.
    expect(naiveDiffered).toBe(true);
  });

  it('keeps the aligned offset within one quantum of the requested lead', () => {
    for (const lead of [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2]) {
      const offset = quantumAlignedOffset(lead, SAMPLE_RATE);
      expect(offset).toBeGreaterThan(0);
      expect(offset).toBeLessThanOrEqual(lead + 128 / SAMPLE_RATE);
    }
  });
});

describe('arrangement', () => {
  it('lays out three parts over the requested bars', () => {
    const arrangement = buildArrangement(4, 200);

    expect(arrangement.chords).toHaveLength(4 * EXTENDED_CHORD_INTERVALS.length);
    expect(arrangement.bass).toHaveLength(4);
    expect(arrangement.click).toHaveLength(4 * 4);
  });

  it('uses separate channels for chords, bass and click', () => {
    const arrangement = buildArrangement(1, 200);

    expect(new Set(arrangement.chords.map((event) => event.channel))).toEqual(
      new Set([CHORD_CHANNEL]),
    );
    expect(new Set(arrangement.bass.map((event) => event.channel))).toEqual(
      new Set([BASS_CHANNEL]),
    );
    expect(new Set(arrangement.click.map((event) => event.channel))).toEqual(
      new Set([CLICK_CHANNEL]),
    );
  });

  it('keeps every note inside its bar', () => {
    const arrangement = buildArrangement(8, 200);

    for (const event of [...arrangement.chords, ...arrangement.bass, ...arrangement.click]) {
      expect(event.startTick).toBeGreaterThanOrEqual(0);
      expect(event.endTick).toBeGreaterThan(event.startTick);
      expect(Math.floor(event.startTick / 1920)).toBe(Math.floor((event.endTick - 1) / 1920));
    }
  });

  it('converts ticks to seconds at the tempo', () => {
    expect(tickToSeconds(480, 120)).toBeCloseTo(0.5, 10);
    expect(tickToSeconds(480, 200)).toBeCloseTo(0.3, 10);
    expect(tickToSeconds(1920, 200)).toBeCloseTo(1.2, 10);
  });

  it('orders all events by start time', () => {
    const events = allEvents(buildArrangement(4, 200));
    const starts = events.map((event) => event.startSeconds);

    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it('produces a stable digest and differs when the arrangement differs', () => {
    expect(arrangementDigest(buildArrangement(4, 200))).toBe(
      arrangementDigest(buildArrangement(4, 200)),
    );
    expect(arrangementDigest(buildArrangement(4, 200))).not.toBe(
      arrangementDigest(buildArrangement(5, 200)),
    );
  });

  it('rounds the bar count up to cover the requested duration', () => {
    // At 200 BPM a bar lasts 4 * 60 / 200 = 1.2 s.
    expect(barsForSeconds(1, 200)).toBe(1);
    expect(barsForSeconds(1.2, 200)).toBe(1);
    expect(barsForSeconds(1.3, 200)).toBe(2);
    expect(barsForSeconds(600, 200)).toBe(500);
  });
});

describe('onset detection', () => {
  it('finds the first frame above the threshold', () => {
    const samples = new Float32Array(10);
    samples[4] = 0.5;

    expect(findOnset(samples)).toBe(4);
  });

  it('returns -1 when the capture is silent', () => {
    expect(findOnset(new Float32Array(10))).toBe(-1);
  });

  it('ignores samples below the threshold', () => {
    const samples = new Float32Array(10);
    samples[2] = 1e-5;
    samples[6] = 1e-3;

    expect(findOnset(samples)).toBe(6);
  });
});

describe('level helpers', () => {
  it('computes the RMS of a mono capture', () => {
    const samples = new Float32Array([1, -1, 1, -1]);

    expect(rootMeanSquare(samples)).toBeCloseTo(1, 10);
  });

  it('computes the peak of a mono capture', () => {
    // `Float32Array` stores 0.7 with single precision, so the comparison has
    // to allow for the rounding of the stored value.
    expect(peakLevel(new Float32Array([0.2, -0.7, 0.1]))).toBeCloseTo(0.7, 6);
  });

  it('converts amplitudes to dBFS', () => {
    expect(toDecibels(1)).toBeCloseTo(0, 10);
    expect(toDecibels(0.5)).toBeCloseTo(-6.0206, 3);
    expect(toDecibels(0)).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('error summary', () => {
  it('reports min, median, p95, max and the largest absolute error', () => {
    const summary = summarizeErrors([-5, 0, 5, 100]);

    expect(summary.count).toBe(4);
    expect(summary.min).toBe(-5);
    expect(summary.median).toBeCloseTo(2.5, 10);
    expect(summary.max).toBe(100);
    expect(summary.absoluteMax).toBe(100);
  });

  it('reports NaN statistics for an empty list', () => {
    const summary = summarizeErrors([]);

    expect(summary.count).toBe(0);
    expect(Number.isNaN(summary.median)).toBe(true);
  });
});

describe('envelope alignment', () => {
  it('finds a delayed copy of the reference', () => {
    const reference = new Float32Array([0, 1, 0, 0, 0, 0, 0, 0]);
    const candidate = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0]);

    expect(bestAlignment(reference, candidate, 4).lag).toBe(2);
  });

  it('returns zero lag for identical envelopes', () => {
    const reference = new Float32Array([1, 2, 3, 4]);

    expect(bestAlignment(reference, reference, 4).lag).toBe(0);
  });

  it('normalises the correlation so identical envelopes score 1', () => {
    const reference = new Float32Array([1, 2, 3, 4, 5]);

    expect(bestAlignment(reference, reference, 4).correlation).toBeCloseTo(1, 6);
  });

  it('scores an inverted envelope at -1', () => {
    const reference = new Float32Array([1, 2, 3, 4, 5]);
    const candidate = new Float32Array([-1, -2, -3, -4, -5]);

    expect(bestAlignment(reference, candidate, 4).correlation).toBeCloseTo(-1, 6);
  });
});

describe('sample alignment', () => {
  /** A deterministic, non-periodic test signal. */
  function testSignal(length: number): Float32Array {
    const samples = new Float32Array(length);
    let state = 1;
    for (let i = 0; i < length; i++) {
      // A 32-bit linear congruential generator keeps the signal deterministic
      // and aperiodic, so the correlation peak is unambiguous. `Math.imul`
      // keeps the multiplication in 32-bit integer space.
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      samples[i] = (state / 4294967296) * 2 - 1;
    }
    return samples;
  }

  it('reports zero offset and full correlation for identical captures', () => {
    const capture = testSignal(480);

    const alignment = findSampleAlignment(capture, capture, 2400);

    expect(alignment.offset).toBe(0);
    expect(alignment.correlation).toBeCloseTo(1, 4);
  });

  it('finds a shifted copy of the capture', () => {
    const reference = testSignal(960);
    // `candidate` is the reference delayed by 120 samples, so the alignment
    // offset is +120.
    const candidate = new Float32Array(960);
    candidate.set(reference.subarray(0, 840), 120);

    const alignment = findSampleAlignment(reference, candidate, 2400);

    expect(alignment.offset).toBe(120);
    expect(alignment.correlation).toBeCloseTo(1, 2);
  });

  it('finds a negative shift when the candidate leads the reference', () => {
    const reference = testSignal(960);
    const candidate = new Float32Array(960);
    candidate.set(reference.subarray(120), 0);

    const alignment = findSampleAlignment(reference, candidate, 2400);

    expect(alignment.offset).toBe(-120);
    expect(alignment.correlation).toBeCloseTo(1, 2);
  });

  it('finds the true peak rather than a false one elsewhere in the window', () => {
    // Regression: the search used to run a decimated sweep first and then
    // refine within ±`decimation` samples of that result. A coarse step is
    // `decimation` samples wide, so the refinement could never move to a
    // neighbouring coarse step. When the coarse stage picked the wrong step,
    // the search locked in an offset whose correlation was near zero, even
    // though the true peak was at offset 0.
    //
    // The signal is long enough that the decimation is 468 samples, exactly
    // as in the browser run that exposed the bug.
    const reference = testSignal(960_000);
    const candidate = new Float32Array(960_000);
    candidate.set(reference, 0);
    // A weak but genuine correlation at a far offset, which the decimated
    // sweep could pick up in preference to the true peak.
    for (let i = 0; i < 8_192; i++) {
      candidate[2_194 + i] = (candidate[2_194 + i] ?? 0) + 0.01 * (reference[i] ?? 0);
    }

    const alignment = findSampleAlignment(reference, candidate, 2400);

    expect(alignment.offset).toBe(0);
    expect(alignment.correlation).toBeCloseTo(1, 2);
  });
});

describe('capture comparison', () => {
  it('reports zero difference for identical captures', () => {
    const capture = new Float32Array([0.1, -0.2, 0.3]);
    const comparison = compareCaptures(capture, capture);

    expect(comparison.differenceToSignalDb).toBeLessThan(-100);
    expect(comparison.maxAbsoluteDifference).toBe(0);
    expect(comparison.peakDeltaDb).toBeCloseTo(0, 10);
    expect(comparison.rmsDeltaDb).toBeCloseTo(0, 10);
  });

  it('reports the level of the difference relative to the reference', () => {
    const reference = new Float32Array([1, 1, 1, 1]);
    const candidate = new Float32Array([0.5, 0.5, 0.5, 0.5]);
    const comparison = compareCaptures(reference, candidate);

    expect(comparison.differenceToSignalDb).toBeCloseTo(-6.0206, 3);
    expect(comparison.peakDeltaDb).toBeCloseTo(6.0206, 3);
  });
});
