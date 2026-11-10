/**
 * A recording sink for the scheduler tests (testing.md §4.4-4.5).
 *
 * The sink records every event it is handed, so a test can assert on the
 * order, the times and the contents of the events without any audio.
 */

import type { PlaybackSink, ScheduledEvent } from '../../src/core/scheduler/sinks';

/** A recording sink. */
export class RecordingSink implements PlaybackSink {
  readonly name: string;

  /** Every event the sink was handed, in order. */
  readonly events: ScheduledEvent[] = [];

  /** How many times `allNotesOff` was called. */
  allNotesOffCount = 0;

  /** How many times `start` was called. */
  startCount = 0;

  /** When set, `start` throws this error. */
  startError: Error | null = null;

  /** When set, `schedule` throws this error. */
  scheduleError: Error | null = null;

  constructor(name = 'recording') {
    this.name = name;
  }

  start(): void {
    this.startCount += 1;
    if (this.startError !== null) {
      throw this.startError;
    }
  }

  schedule(event: ScheduledEvent): void {
    if (this.scheduleError !== null) {
      throw this.scheduleError;
    }
    this.events.push(event);
  }

  allNotesOff(): void {
    this.allNotesOffCount += 1;
  }

  /** The events of one kind. */
  ofKind<K extends ScheduledEvent['kind']>(
    kind: K,
  ): readonly Extract<ScheduledEvent, { kind: K }>[] {
    return this.events.filter(
      (event): event is Extract<ScheduledEvent, { kind: K }> => event.kind === kind,
    );
  }

  /** Forgets the recorded events. */
  clear(): void {
    this.events.length = 0;
  }
}
