/**
 * Pure measurement helpers for Spike S2 (MIDI output accuracy).
 *
 * Nothing in this file touches Web MIDI, Electron, the DOM or the file system:
 * it is the maths the measurement report and the unit tests rely on.
 *
 * Time bases
 * ----------
 * - The audio clock (`AudioContext.currentTime`) is the master clock.
 * - `AudioContext.getOutputTimestamp()` maps it to `performance.now()`.
 * - Web MIDI send timestamps and `MIDIMessageEvent.timeStamp` are both in the
 *   `performance.now()` time base, so an intended send time and a received
 *   time can be subtracted directly.
 *
 * Tick bases
 * ----------
 * - The arrangement timeline uses 480 ticks per quarter note.
 * - MIDI clock uses 24 pulses per quarter note (a different grid).
 */

/** Ticks per quarter note in the arrangement timeline. */
export const TICKS_PER_QUARTER = 480;

/** MIDI clock pulses per quarter note. */
export const MIDI_CLOCK_PPQN = 24;

/** Summary of a sample distribution, in milliseconds. */
export interface SampleStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

/**
 * Linear-interpolated percentile of an ascending sample array.
 *
 * `fraction` is in the closed interval [0, 1].
 */
export function percentile(sortedAscending: readonly number[], fraction: number): number {
  if (sortedAscending.length === 0) {
    return Number.NaN;
  }
  if (sortedAscending.length === 1) {
    return sortedAscending[0] as number;
  }
  const position = fraction * (sortedAscending.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sortedAscending[lowerIndex] as number;
  const upper = sortedAscending[upperIndex] as number;
  return lower + (upper - lower) * (position - lowerIndex);
}

/** Distribution summary of a sample set. */
export function summarizeSamples(samples: readonly number[]): SampleStats {
  if (samples.length === 0) {
    return {
      count: 0,
      min: Number.NaN,
      max: Number.NaN,
      mean: Number.NaN,
      p50: Number.NaN,
      p95: Number.NaN,
      p99: Number.NaN,
    };
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    min: sorted[0] as number,
    max: sorted[sorted.length - 1] as number,
    mean: sum / sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

/** Signed error of a received timestamp against the intended one, in milliseconds. */
export function signedErrorMs(receivedTimeMs: number, intendedTimeMs: number): number {
  return receivedTimeMs - intendedTimeMs;
}

/**
 * Encodes an event id into the two MIDI data bytes of a note message.
 *
 * The note number carries the low two digits and the velocity the high ones,
 * so the receiver can recover the id and match it against the intended send
 * time without relying on arrival order.
 */
export function encodeEventId(eventId: number): { note: number; velocity: number } {
  if (!Number.isInteger(eventId) || eventId < 0) {
    throw new RangeError(`Event id must be a non-negative integer: ${eventId}`);
  }
  const low = eventId % 100;
  const high = Math.floor(eventId / 100);
  if (high > 126) {
    throw new RangeError(`Event id too large to encode: ${eventId}`);
  }
  return { note: 20 + low, velocity: 1 + high };
}

/** Recovers an event id encoded by {@link encodeEventId}, or null if the bytes are not one. */
export function decodeEventId(note: number, velocity: number): number | null {
  if (velocity < 1) {
    return null;
  }
  const low = note - 20;
  if (low < 0 || low > 99) {
    return null;
  }
  return low + (velocity - 1) * 100;
}

/** The two timestamps `AudioContext.getOutputTimestamp()` reports. */
export interface OutputTimestampSample {
  /** `AudioContext.currentTime`-domain seconds of the audio frame being played. */
  contextTime: number;
  /** `performance.now()`-domain milliseconds of that same frame. */
  performanceTime: number;
}

/**
 * Maps a target time on the audio clock to the `performance.now()` timestamp
 * that a MIDI message must carry.
 *
 * `outputLatency` and `baseLatency` are added because the audio hardware plays
 * the frame later than `contextTime`, while MIDI timestamps are relative to
 * "now" on the system clock. Adding both latencies lines the MIDI event up
 * with the audio that is actually audible (implementation.md §2.4).
 */
export function performanceTimeForAudioTime(
  timestamp: OutputTimestampSample,
  targetAudioTimeSeconds: number,
  outputLatencySeconds: number,
  baseLatencySeconds: number,
): number {
  const deltaMs = (targetAudioTimeSeconds - timestamp.contextTime) * 1000;
  const latencyMs = (outputLatencySeconds + baseLatencySeconds) * 1000;
  return timestamp.performanceTime + deltaMs + latencyMs;
}

/**
 * The mapping between arrangement ticks and the `performance.now()` clock.
 *
 * The anchor is a (tick, performance-time) pair; tempo is fixed for the
 * duration of a measurement run.
 */
export class TimelineClock {
  readonly anchorTick: number;
  readonly anchorPerformanceTimeMs: number;
  readonly bpm: number;

  constructor(anchorTick: number, anchorPerformanceTimeMs: number, bpm: number) {
    if (bpm <= 0) {
      throw new RangeError(`Tempo must be positive: ${bpm}`);
    }
    this.anchorTick = anchorTick;
    this.anchorPerformanceTimeMs = anchorPerformanceTimeMs;
    this.bpm = bpm;
  }

  /** Seconds per timeline tick. */
  get secondsPerTick(): number {
    return 60 / this.bpm / TICKS_PER_QUARTER;
  }

  /** Milliseconds between two MIDI clock pulses. */
  get clockPulseIntervalMs(): number {
    return 60000 / this.bpm / MIDI_CLOCK_PPQN;
  }

  /** The `performance.now()` time of a timeline tick. */
  performanceTimeForTick(tick: number): number {
    return this.anchorPerformanceTimeMs + (tick - this.anchorTick) * this.secondsPerTick * 1000;
  }

  /** The timeline tick at a `performance.now()` time (may be fractional). */
  tickForPerformanceTime(performanceTimeMs: number): number {
    const elapsedMs = performanceTimeMs - this.anchorPerformanceTimeMs;
    return this.anchorTick + elapsedMs / (this.secondsPerTick * 1000);
  }
}

/** A single scheduled MIDI event. */
export interface TimelineEvent {
  /** Unique id, encoded into the note bytes so the receiver can match it. */
  id: number;
  /** Timeline tick (480 per quarter note). */
  tick: number;
  kind: 'note-on' | 'note-off' | 'clock';
  /** MIDI channel, 1-based (1..16); zero for clock. */
  channel: number;
  /** MIDI note number; zero for clock. */
  note: number;
  /** MIDI velocity; zero for clock. */
  velocity: number;
}

/** Options for {@link buildMeasurementTimeline}. */
export interface TimelineOptions {
  bpm: number;
  bars: number;
  beatsPerBar: number;
  /** Note events per beat (the note-on/note-off pairs are 50 % duty). */
  notesPerBeat: number;
}

/**
 * Builds the measurement timeline: MIDI clock on every 24th of a quarter note,
 * chord notes on channel 1, bass notes on channel 2 and click notes on
 * channel 10 (the FR-SND-5 default channels).
 */
export function buildMeasurementTimeline(options: TimelineOptions): TimelineEvent[] {
  const { bars, beatsPerBar, notesPerBeat } = options;
  if (bars <= 0 || beatsPerBar <= 0 || notesPerBeat <= 0) {
    throw new RangeError('Timeline dimensions must be positive');
  }
  const ticksPerBeat = TICKS_PER_QUARTER;
  const totalBeats = bars * beatsPerBar;
  const totalTicks = totalBeats * ticksPerBeat;
  const events: TimelineEvent[] = [];
  let id = 0;

  for (let tick = 0; tick < totalTicks; tick += TICKS_PER_QUARTER / MIDI_CLOCK_PPQN) {
    events.push({ id: id++, tick, kind: 'clock', channel: 0, note: 0, velocity: 0 });
  }

  const ticksPerNote = ticksPerBeat / notesPerBeat;
  const noteTicks = Math.round(ticksPerNote);
  for (let beat = 0; beat < totalBeats; beat += 1) {
    for (let subdivision = 0; subdivision < notesPerBeat; subdivision += 1) {
      const tick = beat * ticksPerBeat + subdivision * noteTicks;
      const parts: Array<{ channel: number; note: number }> = [
        // Chord voice on every subdivision (FR-SND-5 default channel 1).
        { channel: 1, note: 60 + (beat % 12) },
      ];
      if (subdivision === 0) {
        // Click on the beat (FR-SND-5 default channel 10).
        parts.push({ channel: 10, note: 76 });
        if (beat % 4 === 0) {
          // Bass on the downbeat of each bar (FR-SND-5 default channel 2).
          parts.push({ channel: 2, note: 36 });
        }
      }
      for (const part of parts) {
        const encoded = encodeEventId(id);
        events.push({
          id: id++,
          tick,
          kind: 'note-on',
          channel: part.channel,
          note: encoded.note,
          velocity: encoded.velocity,
        });
        events.push({
          id: id++,
          tick: tick + Math.floor(noteTicks / 2),
          kind: 'note-off',
          channel: part.channel,
          note: encoded.note,
          velocity: encoded.velocity,
        });
      }
    }
  }

  return events.sort((left, right) => left.tick - right.tick || left.id - right.id);
}
