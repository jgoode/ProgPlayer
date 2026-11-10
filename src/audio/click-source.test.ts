/**
 * The click source (P4.6, FR-PLY-4).
 *
 * The click is synthesized, because the bundled SoundFonts contain no
 * percussion. Its envelope and pitch selection are pure, so they are
 * tested here.
 */

import { describe, expect, it } from 'vitest';

import {
  CLICK_BAR_FREQUENCY,
  CLICK_BEAT_FREQUENCY,
  CLICK_DURATION_SECONDS,
  CLICK_PEAK_GAIN,
  clickEnvelope,
  clickFrequency,
} from './click-source';

describe('click source', () => {
  it('starts silent and ends silent', () => {
    expect(clickEnvelope(0, CLICK_DURATION_SECONDS)).toBe(0);
    expect(clickEnvelope(-0.001, CLICK_DURATION_SECONDS)).toBe(0);
    expect(clickEnvelope(CLICK_DURATION_SECONDS, CLICK_DURATION_SECONDS)).toBe(0);
    expect(clickEnvelope(CLICK_DURATION_SECONDS + 1, CLICK_DURATION_SECONDS)).toBe(0);
  });

  it('rises within the first millisecond', () => {
    expect(clickEnvelope(0.0005, CLICK_DURATION_SECONDS)).toBeLessThan(
      clickEnvelope(0.001, CLICK_DURATION_SECONDS),
    );
  });

  it('decays monotonically after the attack', () => {
    const samples = [0.002, 0.005, 0.01, 0.02, 0.03, 0.04].map((t) =>
      clickEnvelope(t, CLICK_DURATION_SECONDS),
    );
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]).toBeLessThan(samples[index - 1] as number);
    }
  });

  it('never exceeds the peak level', () => {
    for (let t = 0; t < CLICK_DURATION_SECONDS; t += 0.0005) {
      expect(clickEnvelope(t, CLICK_DURATION_SECONDS)).toBeLessThanOrEqual(1);
    }
  });

  it('uses a higher pitch for the accented downbeat', () => {
    expect(clickFrequency(true)).toBe(CLICK_BAR_FREQUENCY);
    expect(clickFrequency(false)).toBe(CLICK_BEAT_FREQUENCY);
    expect(clickFrequency(true)).toBeGreaterThan(clickFrequency(false));
  });

  it('peaks below full scale, so the click cannot clip on its own', () => {
    expect(CLICK_PEAK_GAIN).toBeLessThan(1);
    expect(CLICK_PEAK_GAIN).toBeGreaterThan(0);
  });
});
