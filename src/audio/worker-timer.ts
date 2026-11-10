/**
 * Worker-based timer (P4.8, implementation.md §2.4, NFR-TIM-1).
 *
 * The scheduler's timer lives in a Worker, never in the UI thread: a
 * backgrounded or busy renderer must not be able to delay the scheduler's
 * wake-up (testing.md §4.4, "Window hidden/minimized").
 *
 * The Worker is created from a module URL that the build turns into a real
 * file, so it works both from the Vite dev server and from the packaged
 * `file://` renderer.
 */

import type { SchedulerTimer } from '@core/scheduler/scheduler';

/** The messages the worker and its host exchange. */
type WorkerRequest =
  | { readonly type: 'start'; readonly delayMs: number }
  | { readonly type: 'stop' }
  | { readonly type: 'tick' };

/**
 * A timer whose wake-ups come from a Worker.
 *
 * The host posts a `start` message when it wants a wake-up; the Worker
 * replies with a `tick` message when the delay has elapsed. The host then
 * calls the callback it was given by `schedule`, and the scheduler arms
 * the next wake-up, so only one timer is ever outstanding.
 */
export class WorkerTimer implements SchedulerTimer {
  private readonly worker: Worker;

  /** The callback the scheduler handed to the last `schedule` call. */
  private callback: (() => void) | null = null;

  private disposed = false;

  /**
   * Creates a Worker timer.
   *
   * @param workerUrl the URL of the Worker module.
   */
  constructor(workerUrl: URL | string) {
    this.worker = new Worker(workerUrl, { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerRequest>) => {
      if (event.data.type !== 'tick') {
        return;
      }
      // The callback is taken before it is run, so a callback that arms
      // the next tick is not lost.
      const callback = this.callback;
      this.callback = null;
      callback?.();
    };
  }

  /** Schedules a callback after `delayMs`. */
  schedule(callback: () => void, delayMs: number): void {
    if (this.disposed) {
      return;
    }
    this.callback = callback;
    this.worker.postMessage({ type: 'start', delayMs });
  }

  /** Cancels the pending wake-up. */
  cancel(): void {
    if (this.disposed) {
      return;
    }
    this.worker.postMessage({ type: 'stop' });
  }

  /** Stops the Worker and releases it. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.worker.postMessage({ type: 'stop' });
    this.worker.terminate();
  }
}

/**
 * A timer that fires on the UI thread.
 *
 * It is only used by the tests and by the fallback when a Worker cannot be
 * created; the scheduler itself never asks for one.
 */
export class UiTimer implements SchedulerTimer {
  private handle: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly intervalMs: number) {}

  schedule(callback: () => void, delayMs: number): void {
    this.cancel();
    // The scheduler asks for its own interval; the timer uses the shorter
    // of the two, so a caller that asks for a shorter delay is honoured.
    const delay = Math.min(this.intervalMs, delayMs);
    this.handle = setTimeout(() => {
      this.handle = null;
      callback();
    }, delay);
  }

  cancel(): void {
    if (this.handle !== null) {
      clearTimeout(this.handle);
      this.handle = null;
    }
  }
}
