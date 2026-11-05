/**
 * Spike S1 — pure arrangement and analysis helpers.
 *
 * No DOM, no Electron, no audio APIs: the maths is unit tested
 * (`tests/unit/spike-s1-analysis.test.ts`).
 */

/* ------------------------------------------------------------------ *
 * Render-quantum snapping
 *
 * The engine drains its message queue at the start of every render quantum,
 * so an event with an arbitrary target time is dispatched on the first
 * quantum whose clock has reached it — an error of 0…127 frames. ADR-0002
 * therefore requires the *scheduling* time to be snapped up to the next
 * 128-frame boundary, which makes the dispatch error exactly 0 frames.
 *
 * The musical time (the tick position) is untouched: only the time handed to
 * the engine moves, so MIDI export and MIDI-out stay exact.
 * ------------------------------------------------------------------ */

/** The Web Audio render quantum, in frames. */
export const RENDER_QUANTUM_FRAMES = 128;

/**
 * The number of render quanta to wait for a lead time expressed in frames.
 *
 * The result is at least one quantum, because an event scheduled at the
 * current instant would be dispatched immediately rather than queued.
 */
export function quantaForLead(leadFrames: number, quantumFrames = RENDER_QUANTUM_FRAMES): number {
  if (quantumFrames <= 0) throw new RangeError('quantumFrames must be positive');
  if (!Number.isFinite(leadFrames)) {
    throw new RangeError('leadFrames must be finite');
  }

  return Math.max(1, Math.ceil(leadFrames / quantumFrames - 1e-9));
}

/**
 * The engine's clock value after `quanta` render quanta.
 *
 * The engine advances its clock by `quantumFrames * (1 / sampleRate)` once
 * per quantum and *accumulates* the rounding error of every addition. A
 * target computed as `currentTime + quanta * quantumSeconds` therefore ends
 * up a few ULP above the clock the engine will actually reach, and the
 * engine's `event.time <= currentTime` test then fails — the event is
 * dispatched one whole quantum late.
 *
 * Computing the target with the same accumulation makes the two values
 * bit-identical, which is what makes the dispatch exact.
 */
export function engineClockAfterQuanta(
  currentTime: number,
  quanta: number,
  sampleRate: number,
  quantumFrames = RENDER_QUANTUM_FRAMES,
): number {
  if (sampleRate <= 0) throw new RangeError('sampleRate must be positive');
  if (!Number.isInteger(quanta) || quanta < 0) {
    throw new RangeError('quanta must be a non-negative integer');
  }

  const step = quantumFrames * (1 / sampleRate);
  let time = currentTime;
  for (let i = 0; i < quanta; i++) time += step;
  return time;
}

/**
 * The scheduling target for an event that should be dispatched `quanta`
 * render quanta from now.
 *
 * The result is the engine clock at the start of that quantum, so the engine
 * dispatches the event in exactly that quantum — an error of 0 frames.
 */
export function quantumAlignedTarget(
  currentTime: number,
  quanta: number,
  sampleRate: number,
  quantumFrames = RENDER_QUANTUM_FRAMES,
): number {
  return engineClockAfterQuanta(currentTime, quanta, sampleRate, quantumFrames);
}

/**
 * Snaps a frame offset forward to the next render-quantum boundary.
 *
 * An offset that already sits on a boundary is returned unchanged, so the
 * function is idempotent and never pushes an event a whole quantum late.
 */
export function snapFramesToQuantum(
  offsetFrames: number,
  quantumFrames = RENDER_QUANTUM_FRAMES,
): number {
  return quantaForLead(offsetFrames, quantumFrames) * quantumFrames;
}

/**
 * The scheduling offset, in seconds, from an anchor to the next
 * render-quantum boundary. The result is in the range (0, one quantum].
 */
export function quantumAlignedOffset(
  offsetSeconds: number,
  sampleRate: number,
  quantumFrames = RENDER_QUANTUM_FRAMES,
): number {
  if (sampleRate <= 0) throw new RangeError('sampleRate must be positive');

  return snapFramesToQuantum(offsetSeconds * sampleRate, quantumFrames) / sampleRate;
}

/* ------------------------------------------------------------------ *
 * Arrangement
 * ------------------------------------------------------------------ */

export const TICKS_PER_QUARTER = 480;
export const BEATS_PER_BAR = 4;

export const CHORD_CHANNEL = 0;
export const BASS_CHANNEL = 1;
export const CLICK_CHANNEL = 9;

export const CHORD_PROGRAM = 0; // Grand Piano
export const BASS_PROGRAM = 33; // Finger Bass
export const CLICK_PROGRAM = 0; // Room kit
export const CLICK_NOTE = 39; // Side stick

export const CHORD_ROOT_MIDI = 60; // C4
export const BASS_ROOT_MIDI = 36; // C2

/** Extended chord voicing: root, 3rd, 5th, 7th, 9th, 11th, 13th. */
export const EXTENDED_CHORD_INTERVALS = [0, 4, 7, 10, 14, 17, 21];

/** Root semitone offsets of the four-chord loop used by the stress test. */
export const PROGRESSION = [0, 5, 7, 9];

export interface TimedEvent {
  channel: number;
  note: number;
  velocity: number;
  startTick: number;
  endTick: number;
}

export interface TimedEventInSeconds extends TimedEvent {
  startSeconds: number;
  endSeconds: number;
}

export interface Arrangement {
  bpm: number;
  bars: number;
  chords: TimedEvent[];
  bass: TimedEvent[];
  click: TimedEvent[];
}

/** Converts a tick position to seconds at the given tempo. */
export function tickToSeconds(tick: number, bpm: number): number {
  return (tick / TICKS_PER_QUARTER) * (60 / bpm);
}

/** Builds the three-part stress-test arrangement. */
export function buildArrangement(bars: number, bpm: number): Arrangement {
  const chords: TimedEvent[] = [];
  const bass: TimedEvent[] = [];
  const click: TimedEvent[] = [];

  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * BEATS_PER_BAR * TICKS_PER_QUARTER;
    const barEnd = barStart + BEATS_PER_BAR * TICKS_PER_QUARTER;
    const root = PROGRESSION[bar % PROGRESSION.length] ?? 0;

    for (const interval of EXTENDED_CHORD_INTERVALS) {
      chords.push({
        channel: CHORD_CHANNEL,
        note: CHORD_ROOT_MIDI + root + interval,
        velocity: 96,
        startTick: barStart,
        endTick: barEnd,
      });
    }

    bass.push({
      channel: BASS_CHANNEL,
      note: BASS_ROOT_MIDI + root,
      velocity: 104,
      startTick: barStart,
      endTick: barEnd,
    });

    for (let beat = 0; beat < BEATS_PER_BAR; beat++) {
      const start = barStart + beat * TICKS_PER_QUARTER;
      click.push({
        channel: CLICK_CHANNEL,
        note: CLICK_NOTE,
        velocity: beat === 0 ? 120 : 88,
        startTick: start,
        endTick: start + TICKS_PER_QUARTER / 4,
      });
    }
  }

  return { bpm, bars, chords, bass, click };
}

/** Converts tick-based events to absolute seconds. */
export function toSeconds(events: TimedEvent[], bpm: number): TimedEventInSeconds[] {
  return events.map((event) => ({
    ...event,
    startSeconds: tickToSeconds(event.startTick, bpm),
    endSeconds: tickToSeconds(event.endTick, bpm),
  }));
}

/** All events of the arrangement, ordered by start time. */
export function allEvents(arrangement: Arrangement): TimedEventInSeconds[] {
  return [
    ...toSeconds(arrangement.chords, arrangement.bpm),
    ...toSeconds(arrangement.bass, arrangement.bpm),
    ...toSeconds(arrangement.click, arrangement.bpm),
  ].sort((a, b) => a.startSeconds - b.startSeconds || a.channel - b.channel);
}

/**
 * FNV-1a digest of the event list.
 *
 * The Node harness (`spikes/s1/tools/measure-engine.mjs`) computes the same
 * digest, so the two runs can prove they measured the same arrangement.
 */
export function arrangementDigest(arrangement: Arrangement): string {
  const lines = allEvents(arrangement)
    .map(
      (event) =>
        `${event.channel}:${event.note}:${event.velocity}:${event.startTick}:${event.endTick}`,
    )
    .join('\n');
  let hash = 0x811c9dc5;
  for (let i = 0; i < lines.length; i++) {
    hash ^= lines.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Bars needed to cover the given number of seconds at the given tempo. */
export function barsForSeconds(seconds: number, bpm: number): number {
  const secondsPerBar = (BEATS_PER_BAR * 60) / bpm;
  return Math.max(1, Math.ceil(seconds / secondsPerBar));
}

/* ------------------------------------------------------------------ *
 * Analysis
 * ------------------------------------------------------------------ */

/** Absolute sample value above which a frame counts as audible signal. */
export const ONSET_THRESHOLD = 1e-4;

/**
 * Index of the first frame whose absolute value exceeds `threshold`.
 * Returns -1 when the capture contains no signal.
 */
export function findOnset(samples: Float32Array, threshold = ONSET_THRESHOLD): number {
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i];
    if (value !== undefined && Math.abs(value) > threshold) return i;
  }
  return -1;
}

/** Descriptive statistics for a list of signed errors. */
export interface ErrorStatistics {
  count: number;
  min: number;
  median: number;
  p95: number;
  max: number;
  mean: number;
  absoluteMax: number;
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const low = sorted[lower] ?? Number.NaN;
  const high = sorted[upper] ?? Number.NaN;
  if (low === high) return low;
  return low + (high - low) * (index - lower);
}

/** Computes min/median/p95/max/mean and the largest absolute error. */
export function summarizeErrors(errors: number[]): ErrorStatistics {
  if (errors.length === 0) {
    return {
      count: 0,
      min: Number.NaN,
      median: Number.NaN,
      p95: Number.NaN,
      max: Number.NaN,
      mean: Number.NaN,
      absoluteMax: Number.NaN,
    };
  }
  const sorted = [...errors].sort((a, b) => a - b);
  const sum = errors.reduce((total, value) => total + value, 0);
  return {
    count: errors.length,
    min: sorted[0] ?? Number.NaN,
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1] ?? Number.NaN,
    mean: sum / errors.length,
    absoluteMax: Math.max(...errors.map(Math.abs)),
  };
}

/** Root-mean-square level of a mono capture. */
export function rootMeanSquare(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumSquares = 0;
  for (const value of samples) sumSquares += value * value;
  return Math.sqrt(sumSquares / samples.length);
}

/** Peak absolute level of a mono capture. */
export function peakLevel(samples: Float32Array): number {
  let peak = 0;
  for (const value of samples) {
    const absolute = Math.abs(value);
    if (absolute > peak) peak = absolute;
  }
  return peak;
}

/** Converts a linear amplitude to dBFS (0 dBFS = full scale). */
export function toDecibels(amplitude: number): number {
  if (amplitude <= 0) return Number.NEGATIVE_INFINITY;
  return 20 * Math.log10(amplitude);
}

/** RMS envelope with one value per block. */
export function blockEnvelope(samples: Float32Array, blockSize: number): Float32Array {
  if (blockSize <= 0) throw new RangeError('blockSize must be positive');
  const blocks = Math.floor(samples.length / blockSize);
  const envelope = new Float32Array(blocks);
  for (let block = 0; block < blocks; block++) {
    let sumSquares = 0;
    for (let i = 0; i < blockSize; i++) {
      const value = samples[block * blockSize + i] ?? 0;
      sumSquares += value * value;
    }
    envelope[block] = Math.sqrt(sumSquares / blockSize);
  }
  return envelope;
}

/**
 * Lag (in envelope blocks) that best aligns two envelopes.
 *
 * A positive lag means `candidate` sounds later than `reference`.
 *
 * The correlation is the normalised Pearson coefficient, so it is in the
 * range -1..1 and is comparable between runs. Ties are broken towards the
 * smallest absolute lag, so an identical pair reports zero lag.
 */
export function bestAlignment(
  reference: Float32Array,
  candidate: Float32Array,
  maxLagBlocks: number,
): { lag: number; correlation: number } {
  const length = Math.min(reference.length, candidate.length);
  if (length === 0) return { lag: 0, correlation: 0 };

  let bestLag = 0;
  let bestCorrelation = Number.NEGATIVE_INFINITY;
  for (let lag = -maxLagBlocks; lag <= maxLagBlocks; lag++) {
    const correlation = pearsonAtLag(reference, candidate, lag);
    if (isBetterAlignment(correlation, lag, bestCorrelation, bestLag)) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  return { lag: bestLag, correlation: bestCorrelation };
}

/**
 * Compares two alignment candidates.
 *
 * The *magnitude* of the correlation decides the winner, so an inverted signal
 * still aligns on the correct offset; the signed value is what gets reported.
 * Ties are broken towards the smaller absolute offset, so a signal that
 * matches at several offsets reports the one closest to zero.
 */
function isBetterAlignment(
  correlation: number,
  offset: number,
  bestCorrelation: number,
  bestOffset: number,
): boolean {
  if (!Number.isFinite(bestCorrelation)) return true;

  const magnitude = Math.abs(correlation);
  const bestMagnitude = Math.abs(bestCorrelation);
  if (magnitude > bestMagnitude + CORRELATION_EPSILON) return true;
  if (magnitude < bestMagnitude - CORRELATION_EPSILON) return false;
  if (Math.abs(offset) !== Math.abs(bestOffset)) return Math.abs(offset) < Math.abs(bestOffset);
  // Same magnitude and same distance: prefer the positive correlation.
  return correlation > bestCorrelation;
}

/** Correlations closer than this are treated as equal. */
const CORRELATION_EPSILON = 1e-9;

/** Pearson correlation of two envelopes at a given block lag. */
function pearsonAtLag(reference: Float32Array, candidate: Float32Array, lag: number): number {
  const length = Math.min(reference.length, candidate.length);
  let sumA = 0;
  let sumB = 0;
  let sumAB = 0;
  let sumAA = 0;
  let sumBB = 0;
  let count = 0;

  for (let i = 0; i < length; i++) {
    const shifted = i + lag;
    if (shifted < 0 || shifted >= candidate.length) continue;
    const a = reference[i] ?? 0;
    const b = candidate[shifted] ?? 0;
    sumA += a;
    sumB += b;
    sumAB += a * b;
    sumAA += a * a;
    sumBB += b * b;
    count++;
  }

  if (count < 2) return 0;
  const covariance = sumAB - (sumA * sumB) / count;
  const varianceA = sumAA - (sumA * sumA) / count;
  const varianceB = sumBB - (sumB * sumB) / count;
  const denominator = Math.sqrt(varianceA * varianceB);
  if (denominator <= 0) return 0;
  return covariance / denominator;
}

/**
 * Finds the sample offset that best aligns `candidate` with `reference`.
 *
 * An exhaustive sample-accurate sweep over the whole permitted range,
 * correlating a short window at the start of the signal, where the
 * alignment is unambiguous.
 *
 * Returns the offset in samples (positive means `candidate` starts later) and
 * the normalised correlation at that offset.
 */
export function findSampleAlignment(
  reference: Float32Array,
  candidate: Float32Array,
  maxOffsetSamples: number,
): { offset: number; correlation: number } {
  if (reference.length < 2 || candidate.length < 2) return { offset: 0, correlation: 0 };

  // A single sample-accurate sweep over the whole permitted range.
  //
  // The earlier implementation searched a decimated sweep first and then
  // refined within ±`decimation` samples of that result. A coarse step is
  // `decimation` samples wide, so the refinement window could never move to
  // a neighbouring coarse step: once the coarse stage picked the wrong
  // step, the fine stage locked in a wrong offset that the true peak was
  // out of reach of. It reported an alignment whose correlation was near
  // zero while the true peak — at offset 0 — had a correlation of 0.999.
  //
  // The sweep is now exhaustive over the permitted range, so the reported
  // alignment is always the global peak of the correlation. The cost is
  // `2 * maxOffsetSamples` correlations over a short window, which is
  // bounded and small.
  let bestOffset = 0;
  let bestCorrelation = Number.NEGATIVE_INFINITY;
  for (let offset = -maxOffsetSamples; offset <= maxOffsetSamples; offset++) {
    const correlation = windowCorrelationAtOffset(reference, candidate, offset, FINE_WINDOW);
    if (isBetterAlignment(correlation, offset, bestCorrelation, bestOffset)) {
      bestCorrelation = correlation;
      bestOffset = offset;
    }
  }

  return { offset: bestOffset, correlation: bestCorrelation };
}

/** Number of samples the sample-accurate search correlates over. */
const FINE_WINDOW = 8192;

/**
 * Normalised cross-correlation of the first `window` samples of two signals
 * at a sample offset.
 */
function windowCorrelationAtOffset(
  reference: Float32Array,
  candidate: Float32Array,
  offset: number,
  window: number,
): number {
  const start = Math.max(0, -offset);
  const end = Math.min(reference.length, candidate.length - offset, start + window);
  const frames = end - start;
  if (frames < 2) return 0;

  let sumA = 0;
  let sumB = 0;
  let sumAB = 0;
  let sumAA = 0;
  let sumBB = 0;
  for (let i = start; i < end; i++) {
    const a = reference[i] ?? 0;
    const b = candidate[i + offset] ?? 0;
    sumA += a;
    sumB += b;
    sumAB += a * b;
    sumAA += a * a;
    sumBB += b * b;
  }

  const covariance = sumAB - (sumA * sumB) / frames;
  const varianceA = sumAA - (sumA * sumA) / frames;
  const varianceB = sumBB - (sumB * sumB) / frames;
  const denominator = Math.sqrt(varianceA * varianceB);
  if (denominator <= 0) return 0;
  return covariance / denominator;
}

/**
 * Difference level of two captures, per one-second block.
 *
 * A constant level means the two signals differ in shape but stay in sync; a
 * rising level means the captures drift apart over time.
 */
export function differenceBySecond(
  reference: Float32Array,
  candidate: Float32Array,
  sampleRate: number,
): { at: number; differenceToSignalDb: number }[] {
  const frames = Math.min(reference.length, candidate.length);
  const blockSize = sampleRate;
  const blocks = Math.floor(frames / blockSize);
  const result: { at: number; differenceToSignalDb: number }[] = [];

  for (let block = 0; block < blocks; block++) {
    let differenceSquares = 0;
    let signalSquares = 0;
    for (let i = block * blockSize; i < (block + 1) * blockSize; i++) {
      const a = reference[i] ?? 0;
      const b = candidate[i] ?? 0;
      const difference = a - b;
      differenceSquares += difference * difference;
      signalSquares += a * a;
    }
    result.push({
      at: block,
      differenceToSignalDb: Number(
        toDecibels(Math.sqrt(differenceSquares / Math.max(signalSquares, 1e-30))).toFixed(2),
      ),
    });
  }

  return result;
}

/** Compares two captures sample by sample. */
export interface CaptureComparison {
  frames: number;
  peakA: number;
  peakB: number;
  rmsA: number;
  rmsB: number;
  peakDeltaDb: number;
  rmsDeltaDb: number;
  differenceToSignalDb: number;
  maxAbsoluteDifference: number;
}

/**
 * Compares two captures of the same signal.
 *
 * `differenceToSignalDb` is the level of the difference relative to the
 * reference; it is the useful number when deciding whether two render paths
 * are equivalent.
 */
export function compareCaptures(
  reference: Float32Array,
  candidate: Float32Array,
): CaptureComparison {
  const frames = Math.min(reference.length, candidate.length);
  let differenceSquares = 0;
  let signalSquares = 0;
  let maxAbsoluteDifference = 0;
  for (let i = 0; i < frames; i++) {
    const referenceValue = reference[i] ?? 0;
    const candidateValue = candidate[i] ?? 0;
    const difference = referenceValue - candidateValue;
    differenceSquares += difference * difference;
    signalSquares += referenceValue * referenceValue;
    if (Math.abs(difference) > maxAbsoluteDifference) {
      maxAbsoluteDifference = Math.abs(difference);
    }
  }

  const peakA = peakLevel(reference);
  const peakB = peakLevel(candidate);
  const rmsA = rootMeanSquare(reference);
  const rmsB = rootMeanSquare(candidate);

  return {
    frames,
    peakA,
    peakB,
    rmsA,
    rmsB,
    peakDeltaDb: toDecibels(peakA) - toDecibels(peakB),
    rmsDeltaDb: toDecibels(rmsA) - toDecibels(rmsB),
    differenceToSignalDb: toDecibels(Math.sqrt(differenceSquares / Math.max(signalSquares, 1e-30))),
    maxAbsoluteDifference,
  };
}
