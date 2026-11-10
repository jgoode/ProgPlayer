/**
 * Tests for the render-quantum helpers (P4.6, ADR-0002 §2, gap G-15).
 *
 * The critical property is that the snapped target is **bit-identical** to
 * the clock the engine will actually reach. The obvious arithmetic
 * (`currentTime + quanta * (quantumFrames / sampleRate)`) computes a
 * different double, and the engine then dispatches the event a whole
 * quantum late.
 */

import { describe, expect, it } from 'vitest';

import {
  engineClockAfterQuanta,
  quantaForLead,
  quantumAlignedOffset,
  quantumAlignedTarget,
  RENDER_QUANTUM_FRAMES,
  snapFramesToQuantum,
} from './quantum';

/**
 * The engine's own accumulation, copied from the engine's source so the
 * test compares the helper against the real behaviour rather than against
 * itself.
 */
function engineClockReference(currentTime: number, quanta: number, sampleRate: number): number {
  const step = 128 * (1 / sampleRate);
  let time = currentTime;
  for (let index = 0; index < quanta; index += 1) {
    time += step;
  }
  return time;
}

describe('quantum: quantaForLead', () => {
  it('rounds a lead time up to the next quantum', () => {
    expect(quantaForLead(1)).toBe(1);
    expect(quantaForLead(128)).toBe(1);
    expect(quantaForLead(129)).toBe(2);
    expect(quantaForLead(256)).toBe(2);
    expect(quantaForLead(4800)).toBe(38);
  });

  it('always asks for at least one quantum', () => {
    expect(quantaForLead(0)).toBe(1);
    expect(quantaForLead(-100)).toBe(1);
  });

  it('rejects a non-positive quantum size', () => {
    expect(() => quantaForLead(128, 0)).toThrow(RangeError);
  });

  it('rejects a non-finite lead', () => {
    expect(() => quantaForLead(Number.NaN)).toThrow(RangeError);
    expect(() => quantaForLead(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('quantum: engineClockAfterQuanta', () => {
  it('matches the engine clock bit for bit', () => {
    const sampleRate = 48_000;
    for (const quanta of [1, 2, 3, 7, 16, 100, 375, 1000]) {
      const expected = engineClockReference(0, quanta, sampleRate);
      expect(engineClockAfterQuanta(0, quanta, sampleRate)).toBe(expected);
    }
  });

  it('matches the engine clock from a non-zero origin', () => {
    const sampleRate = 48_000;
    for (const origin of [0.1, 0.21066666666666667, 1.5, 12.25]) {
      for (const quanta of [1, 5, 50, 500]) {
        const expected = engineClockReference(origin, quanta, sampleRate);
        expect(engineClockAfterQuanta(origin, quanta, sampleRate)).toBe(expected);
      }
    }
  });

  it('advances by exactly one render quantum per step', () => {
    const sampleRate = 48_000;
    const first = engineClockAfterQuanta(0, 1, sampleRate);
    const second = engineClockAfterQuanta(0, 2, sampleRate);
    expect(second - first).toBeCloseTo(RENDER_QUANTUM_FRAMES / sampleRate, 15);
  });

  it('is not the same as the naive arithmetic', () => {
    // This is the regression the ADR warns about: the naive expression
    // computes a different double, and the engine then dispatches the
    // event one whole quantum late.
    const sampleRate = 48_000;
    const origin = 0.21066666666666667;
    const quanta = 375;
    const naive = origin + quanta * (RENDER_QUANTUM_FRAMES / sampleRate);
    const accumulated = engineClockAfterQuanta(origin, quanta, sampleRate);
    expect(naive).not.toBe(accumulated);
  });

  it('rejects invalid arguments', () => {
    expect(() => engineClockAfterQuanta(0, 1, 0)).toThrow(RangeError);
    expect(() => engineClockAfterQuanta(0, -1, 48_000)).toThrow(RangeError);
    expect(() => engineClockAfterQuanta(0, 1.5, 48_000)).toThrow(RangeError);
  });
});

describe('quantum: quantumAlignedTarget', () => {
  it('is the engine clock at the start of the target quantum', () => {
    const sampleRate = 48_000;
    const target = quantumAlignedTarget(0.5, 10, sampleRate);
    expect(target).toBe(engineClockAfterQuanta(0.5, 10, sampleRate));
  });
});

describe('quantum: snapFramesToQuantum', () => {
  it('snaps forward to the next boundary', () => {
    expect(snapFramesToQuantum(1)).toBe(128);
    expect(snapFramesToQuantum(128)).toBe(128);
    expect(snapFramesToQuantum(129)).toBe(256);
  });

  it('is idempotent', () => {
    const once = snapFramesToQuantum(300);
    expect(snapFramesToQuantum(once)).toBe(once);
  });
});

describe('quantum: quantumAlignedOffset', () => {
  it('lands exactly on a quantum boundary', () => {
    const sampleRate = 48_000;
    for (const seconds of [0, 0.0001, 0.001, 0.002, 0.0027, 0.01]) {
      const offset = quantumAlignedOffset(seconds, sampleRate);
      const frames = offset * sampleRate;
      // The result is an exact multiple of the render quantum.
      expect(
        Math.abs(frames / RENDER_QUANTUM_FRAMES - Math.round(frames / RENDER_QUANTUM_FRAMES)),
      ).toBeLessThan(1e-9);
    }
  });

  it('never moves the target earlier than requested', () => {
    const sampleRate = 48_000;
    for (const seconds of [0, 0.0001, 0.001, 0.002, 0.0027, 0.01, 0.5]) {
      expect(quantumAlignedOffset(seconds, sampleRate)).toBeGreaterThanOrEqual(seconds - 1e-12);
    }
  });

  it('moves a target that is just past a boundary by one whole quantum', () => {
    // The snap is a round-up to the grid, so a target a fraction past a
    // boundary waits for the next one. The *dispatch* error against the
    // snapped target is still 0 frames, which is what ADR-0002 requires.
    const sampleRate = 48_000;
    const quantum = RENDER_QUANTUM_FRAMES / sampleRate;
    expect(quantumAlignedOffset(quantum * 1.01, sampleRate)).toBeCloseTo(quantum * 2, 12);
  });

  it('does not push a boundary target a whole quantum further', () => {
    const sampleRate = 48_000;
    const quantum = RENDER_QUANTUM_FRAMES / sampleRate;
    expect(quantumAlignedOffset(quantum, sampleRate)).toBeCloseTo(quantum, 12);
  });
});
