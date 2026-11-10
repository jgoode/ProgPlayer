/**
 * A simulated clock and timer for the scheduler tests (testing.md §4.4).
 *
 * The clock is driven by the test: `advance` moves time forward and fires
 * the timers that are due, in order. Nothing in the harness uses a real
 * timer, so the tests are deterministic and run instantly.
 */

import type { SchedulerTimer } from '../../src/core/scheduler/scheduler';

interface ScheduledCallback {
  readonly dueAt: number;
  readonly callback: () => void;
  readonly sequence: number;
}

/** A clock whose time only moves when the test says so. */
export class FakeClock {
  private current: number;

  private sequence = 0;

  private pending: ScheduledCallback[] = [];

  constructor(startAt = 0) {
    this.current = startAt;
  }

  /** The current time, in seconds. */
  now(): number {
    return this.current;
  }

  /** The timer the scheduler uses. */
  get timer(): SchedulerTimer {
    return {
      schedule: (callback: () => void, delayMs: number): void => {
        this.sequence += 1;
        this.pending.push({
          dueAt: this.current + delayMs / 1000,
          callback,
          sequence: this.sequence,
        });
      },
      cancel: (): void => {
        this.pending = [];
      },
    };
  }

  /** How many callbacks are waiting to fire. */
  get pendingCount(): number {
    return this.pending.length;
  }

  /**
   * Moves time forward by `seconds`, firing every timer that comes due.
   *
   * The callbacks fire in due-time order, and the time is set to each
   * callback's due time before it runs — so a callback sees the time it was
   * scheduled for, not the end of the advance.
   */
  advance(seconds: number): void {
    const target = this.current + seconds;

    for (;;) {
      const next = this.nextDue(target);
      if (next === null) {
        break;
      }
      this.current = next.dueAt;
      this.pending = this.pending.filter((entry) => entry !== next);
      next.callback();
    }

    this.current = target;
  }

  /**
   * Moves time forward by `seconds` and fires only the timers due at the
   * *end* of the window.
   *
   * This is how a test simulates a late timer: the callbacks that should
   * have fired in between all fire at once, at the late time.
   */
  advanceLate(seconds: number): void {
    const target = this.current + seconds;
    const due = this.pending.filter((entry) => entry.dueAt <= target);
    this.pending = this.pending.filter((entry) => entry.dueAt > target);
    this.current = target;
    for (const entry of due.sort((left, right) => left.sequence - right.sequence)) {
      entry.callback();
    }
  }

  /** The next callback due at or before `target`. */
  private nextDue(target: number): ScheduledCallback | null {
    let best: ScheduledCallback | null = null;
    for (const entry of this.pending) {
      if (entry.dueAt > target) {
        continue;
      }
      if (
        best === null ||
        entry.dueAt < best.dueAt ||
        (entry.dueAt === best.dueAt && entry.sequence < best.sequence)
      ) {
        best = entry;
      }
    }
    return best;
  }
}
