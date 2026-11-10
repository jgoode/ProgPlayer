/**
 * The Worker-based timer (P4.8, NFR-TIM-1).
 *
 * The timer is the one piece of the playback path that lives in a Worker,
 * so its message protocol is the boundary between the renderer and the
 * Worker. The tests use a fake Worker, so they are deterministic.
 */

import { describe, expect, it, vi } from 'vitest';

import { WorkerTimer } from './worker-timer';

/** A message the fake Worker received. */
interface PostedMessage {
  readonly type: string;
  readonly delayMs?: number;
}

/** A fake Worker that records what it was told and can fire a tick. */
class FakeWorker {
  static instances: FakeWorker[] = [];

  readonly posted: PostedMessage[] = [];

  onmessage: ((event: MessageEvent<{ type: string }>) => void) | null = null;

  terminated = false;

  constructor(
    readonly url: string | URL,
    readonly options?: WorkerOptions,
  ) {
    FakeWorker.instances.push(this);
  }

  postMessage(message: PostedMessage): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Delivers a tick to the host. */
  fireTick(): void {
    this.onmessage?.({ data: { type: 'tick' } } as MessageEvent<{ type: string }>);
  }
}

/** Installs the fake Worker and returns the restore function. */
function installFakeWorker(): () => void {
  const original = globalThis.Worker;
  FakeWorker.instances = [];
  (globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;
  return () => {
    (globalThis as unknown as { Worker: unknown }).Worker = original;
  };
}

describe('worker timer', () => {
  it('arms the worker with the requested delay', () => {
    const restore = installFakeWorker();
    try {
      const timer = new WorkerTimer('timer.worker.js');
      timer.schedule(() => undefined, 25);

      const worker = FakeWorker.instances[0] as FakeWorker;
      expect(worker.posted).toEqual([{ type: 'start', delayMs: 25 }]);
      expect(worker.options).toEqual({ type: 'module' });
    } finally {
      restore();
    }
  });

  it('runs the callback the scheduler gave it when the worker ticks', () => {
    const restore = installFakeWorker();
    try {
      const timer = new WorkerTimer('timer.worker.js');
      const callback = vi.fn();
      timer.schedule(callback, 25);

      const worker = FakeWorker.instances[0] as FakeWorker;
      worker.fireTick();

      expect(callback).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it('is one-shot, like the simulated clock: a tick with no re-arm does nothing', () => {
    const restore = installFakeWorker();
    try {
      const timer = new WorkerTimer('timer.worker.js');
      const callback = vi.fn();
      timer.schedule(callback, 25);

      const worker = FakeWorker.instances[0] as FakeWorker;
      worker.fireTick();
      worker.fireTick();

      expect(callback).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it('re-arms the worker when the callback schedules the next tick', () => {
    const restore = installFakeWorker();
    try {
      const timer = new WorkerTimer('timer.worker.js');
      const worker = FakeWorker.instances[0] as FakeWorker;

      // This is the scheduler's own pattern: the callback pumps and then
      // arms the next tick.
      const callback = vi.fn(() => {
        timer.schedule(callback, 25);
      });
      timer.schedule(callback, 25);

      worker.fireTick();
      worker.fireTick();

      expect(callback).toHaveBeenCalledTimes(2);
      expect(worker.posted).toEqual([
        { type: 'start', delayMs: 25 },
        { type: 'start', delayMs: 25 },
        { type: 'start', delayMs: 25 },
      ]);
    } finally {
      restore();
    }
  });

  it('cancels the pending wake-up', () => {
    const restore = installFakeWorker();
    try {
      const timer = new WorkerTimer('timer.worker.js');
      timer.schedule(() => undefined, 25);
      timer.cancel();

      const worker = FakeWorker.instances[0] as FakeWorker;
      expect(worker.posted.map((message) => message.type)).toEqual(['start', 'stop']);
    } finally {
      restore();
    }
  });

  it('stops the worker when it is disposed', () => {
    const restore = installFakeWorker();
    try {
      const timer = new WorkerTimer('timer.worker.js');
      timer.dispose();

      const worker = FakeWorker.instances[0] as FakeWorker;
      expect(worker.terminated).toBe(true);
      expect(worker.posted.map((message) => message.type)).toEqual(['stop']);
    } finally {
      restore();
    }
  });

  it('does not arm the worker after it is disposed', () => {
    const restore = installFakeWorker();
    try {
      const timer = new WorkerTimer('timer.worker.js');
      timer.dispose();
      timer.schedule(() => undefined, 25);

      const worker = FakeWorker.instances[0] as FakeWorker;
      expect(worker.posted.map((message) => message.type)).toEqual(['stop']);
    } finally {
      restore();
    }
  });
});
