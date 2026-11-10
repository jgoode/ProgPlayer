/**
 * The bridge between the audio clock and the synth engine's clock (P4.6,
 * ADR-0002 §2, gap G-15).
 *
 * The engine advances its clock **only when it renders**, by exactly
 * `sampleCount * (1 / sampleRate)` per call, and it accumulates the
 * rounding error of every addition. The audio context's `currentTime`, in
 * contrast, is the *playback* position: it advances in bursts as the output
 * device consumes the rendered audio, and it includes the output latency.
 *
 * The two clocks are therefore **not** interchangeable. Scheduling an event
 * at the audio clock's `currentTime` would make the engine dispatch it a
 * whole render quantum late, because the engine's clock is behind the
 * playback clock by the buffer that has been rendered but not yet played.
 *
 * The fix is to work in the engine's own clock:
 *
 * - The worklet reports its engine clock and the audio clock together, so
 *   the renderer can convert an audio-clock time into an engine-clock time.
 * - The conversion is exact, because both clocks advance by the same amount
 *   per render quantum; only their origins differ.
 *
 * The measurement that settled this (Electron 45, Chromium, 48 kHz) found
 * the engine clock advancing by exactly `128 / 48000 = 0.002666…` s per
 * render quantum, and the audio clock advancing by the same amount, with
 * the engine clock trailing the playback clock by the output latency.
 */

/** A snapshot of the two clocks, taken inside the worklet. */
export interface ClockSnapshot {
  /** The engine's clock, in seconds. */
  readonly engineTime: number;
  /** The audio context's clock, in seconds. */
  readonly audioTime: number;
  /** The frame counter of the worklet's global scope. */
  readonly frame: number;
}

/**
 * Converts an audio-clock time into an engine-clock time.
 *
 * The offset between the clocks is fixed (both advance by the same amount
 * per render quantum), so the conversion is a single subtraction.
 */
export function audioTimeToEngineTime(snapshot: ClockSnapshot, audioTime: number): number {
  return audioTime - (snapshot.audioTime - snapshot.engineTime);
}

/**
 * Converts an engine-clock time into an audio-clock time.
 */
export function engineTimeToAudioTime(snapshot: ClockSnapshot, engineTime: number): number {
  return engineTime + (snapshot.audioTime - snapshot.engineTime);
}

/**
 * The clock offset between the engine and the audio context, in seconds.
 *
 * It is the amount the engine's clock trails the playback clock by — the
 * audio that has been rendered but not yet heard.
 */
export function clockOffset(snapshot: ClockSnapshot): number {
  return snapshot.audioTime - snapshot.engineTime;
}
