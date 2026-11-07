/**
 * Look-ahead MIDI scheduler for Spike S2.
 *
 * The timer lives in a Worker (`timer-worker.ts`); this class only reacts to
 * the "tick" messages the Worker posts. It never uses `setTimeout`,
 * `requestAnimationFrame` or any other UI timer to time a note.
 *
 * The class is deliberately free of DOM and Web MIDI types so it can be
 * unit-tested with a simulated clock.
 */

import type { TimelineClock, TimelineEvent } from './analysis';

/** Latency record for one dispatched event. */
export interface DispatchRecord {
  id: number;
  kind: TimelineEvent['kind'];
  /** `performance.now()` time the event was intended for. */
  intendedTimeMs: number;
  /** `performance.now()` time the sender called `send()`. */
  dispatchedAtMs: number;
  /** Positive means the message was handed to the driver late. */
  latenessMs: number;
}

/** Dependencies of {@link LookAheadScheduler}. */
export interface SchedulerOptions {
  /** Current time in the `performance.now()` domain, in milliseconds. */
  now: () => number;
  /** How far ahead of "now" events are dispatched. */
  lookAheadMs: number;
  /** Tick-to-time mapping. */
  clock: TimelineClock;
  /** Events to schedule, sorted by tick. */
  events: readonly TimelineEvent[];
  /** Called for every event that enters the look-ahead window. */
  onDispatch: (event: TimelineEvent, record: DispatchRecord) => void;
  /** Called once, when the last event has been dispatched. */
  onComplete?: () => void;
}

/**
 * Dispatches timeline events once they fall inside the look-ahead window.
 *
 * The worker posts a tick every few milliseconds; on each tick every event
 * whose intended time is within `lookAheadMs` is dispatched exactly once.
 */
export class LookAheadScheduler {
  private readonly options: SchedulerOptions;
  private nextIndex = 0;
  private dispatchRecords: DispatchRecord[] = [];
  private running = false;

  constructor(options: SchedulerOptions) {
    if (options.lookAheadMs <= 0) {
      throw new RangeError('Look-ahead must be positive');
    }
    this.options = options;
  }

  /** True while the scheduler is accepting ticks. */
  get isRunning(): boolean {
    return this.running;
  }

  /** Number of events dispatched so far. */
  get dispatchedCount(): number {
    return this.dispatchRecords.length;
  }

  /** Dispatch lateness records, in dispatch order. */
  get records(): readonly DispatchRecord[] {
    return this.dispatchRecords;
  }

  /** Starts accepting ticks. */
  start(): void {
    this.running = true;
    this.nextIndex = 0;
    this.dispatchRecords = [];
  }

  /** Stops the scheduler. Events already dispatched are not withdrawn. */
  stop(): void {
    this.running = false;
  }

  /**
   * Dispatches every event whose intended time falls inside the look-ahead
   * window. Returns the number of events dispatched by this tick.
   */
  tick(): number {
    if (!this.running) {
      return 0;
    }
    const horizon = this.options.now() + this.options.lookAheadMs;
    let dispatched = 0;
    while (this.nextIndex < this.options.events.length) {
      const event = this.options.events[this.nextIndex] as TimelineEvent;
      const intendedTimeMs = this.options.clock.performanceTimeForTick(event.tick);
      if (intendedTimeMs > horizon) {
        break;
      }
      this.nextIndex += 1;
      const dispatchedAtMs = this.options.now();
      const record: DispatchRecord = {
        id: event.id,
        kind: event.kind,
        intendedTimeMs,
        dispatchedAtMs,
        latenessMs: dispatchedAtMs - intendedTimeMs,
      };
      this.dispatchRecords.push(record);
      this.options.onDispatch(event, record);
      dispatched += 1;
    }
    if (dispatched > 0 && this.nextIndex >= this.options.events.length) {
      this.options.onComplete?.();
    }
    return dispatched;
  }
}
