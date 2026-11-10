/**
 * Sink contracts (P4.2, P4.6, P4.7, implementation.md §2.3).
 *
 * A sink consumes the compiled timeline. It is handed events with a target
 * time on the *sink's own clock* — the audio clock for the synth, the
 * performance clock for MIDI out, a frame position for an offline render.
 *
 * The scheduler never knows what a sink does with an event; it only knows
 * when the event should happen. That keeps the scheduler testable with a
 * recording sink and lets the synth and MIDI sinks share one timeline.
 */

import type { TimelinePart } from '../compiler/types';

/** A note starts. */
export interface NoteOnPayload {
  readonly kind: 'noteOn';
  readonly part: Exclude<TimelinePart, 'click'>;
  /** MIDI channel, 1..16. */
  readonly channel: number;
  /** MIDI note number, 0..127. */
  readonly pitch: number;
  /** MIDI velocity, 1..127. */
  readonly velocity: number;
}

/** A note ends. */
export interface NoteOffPayload {
  readonly kind: 'noteOff';
  readonly part: Exclude<TimelinePart, 'click'>;
  readonly channel: number;
  readonly pitch: number;
}

/** A metronome click. */
export interface ClickPayload {
  readonly kind: 'click';
  readonly channel: number;
  readonly pitch: number;
  readonly velocity: number;
  /** The accent strength of the click (G-05). */
  readonly accent: 'bar' | 'group' | 'beat';
  /** True when the click belongs to the count-in (FR-PLY-5). */
  readonly countIn: boolean;
}

/**
 * Every sounding note must stop.
 *
 * The scheduler calls it directly on stop and pause, so no sink is ever
 * left with a hanging note (FR-SND-9).
 */
export interface AllNotesOffPayload {
  readonly kind: 'allNotesOff';
  /** The channels that were in use. */
  readonly channels: readonly number[];
}

/** What an event *is*, without its timing. */
export type EventPayload = NoteOnPayload | NoteOffPayload | ClickPayload | AllNotesOffPayload;

/**
 * An event with its timing.
 *
 * The time is in the sink's own clock, in seconds.
 */
export type ScheduledEvent = EventPayload & {
  /**
   * The time the event should happen at, in the sink's clock, in seconds.
   *
   * For the synth sink this is the audio-clock time; the engine-clock
   * snapping happens inside the sink, not here.
   */
  readonly time: number;
  /**
   * The tick the event belongs to, relative to the start of the arrangement.
   *
   * The tick is preserved through loop wraps so the UI can report the
   * position even when the time has been offset.
   */
  readonly tick: number;
};

/** A sink that consumes scheduled events. */
export interface PlaybackSink {
  /** A stable name, used in error messages and metrics. */
  readonly name: string;

  /**
   * Prepares the sink for playback.
   *
   * Called before the first event of a run. A sink that cannot start (a
   * missing sound bank, a disconnected device) reports the failure through
   * the `onError` callback and leaves itself inert; the other sinks carry
   * on (testing.md §4.4, "Device removed mid-play").
   */
  start?(): Promise<void> | void;

  /** Schedules one event. */
  schedule(event: ScheduledEvent): void;

  /**
   * Releases every sounding note and cancels pending events.
   *
   * Called on stop and on pause (FR-SND-9). The sink must leave no hanging
   * notes behind.
   */
  allNotesOff?(): void;

  /** Releases the resources the sink holds. */
  dispose?(): void;
}

/** The callback a sink uses to report a recoverable failure. */
export type SinkErrorHandler = (sinkName: string, error: Error) => void;

/** Builds a scheduled event from a payload and its timing. */
export function withTiming(payload: EventPayload, time: number, tick: number): ScheduledEvent {
  switch (payload.kind) {
    case 'noteOn':
      return { ...payload, time, tick };
    case 'noteOff':
      return { ...payload, time, tick };
    case 'click':
      return { ...payload, time, tick };
    case 'allNotesOff':
      return { ...payload, time, tick };
  }
}
