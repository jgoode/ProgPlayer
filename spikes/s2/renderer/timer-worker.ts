/**
 * The timer for the Spike S2 look-ahead scheduler.
 *
 * It runs in a dedicated Worker so that the timer is not affected by the
 * renderer's main thread (and not affected at all by window minimisation,
 * because `backgroundThrottling` is disabled for the window). The Worker
 * never sends MIDI itself — Web MIDI is not available in Workers — it only
 * posts "tick" messages that wake the scheduler.
 */

export interface TimerWorkerStartMessage {
  type: 'start';
  intervalMs: number;
}

export interface TimerWorkerStopMessage {
  type: 'stop';
}

export type TimerWorkerMessage = TimerWorkerStartMessage | TimerWorkerStopMessage;

let intervalHandle: ReturnType<typeof setInterval> | undefined;

self.addEventListener('message', (event: MessageEvent<TimerWorkerMessage>) => {
  const message = event.data;
  if (message.type === 'stop') {
    if (intervalHandle !== undefined) {
      clearInterval(intervalHandle);
      intervalHandle = undefined;
    }
    return;
  }
  if (message.type === 'start') {
    if (intervalHandle !== undefined) {
      clearInterval(intervalHandle);
    }
    intervalHandle = setInterval(() => {
      self.postMessage('tick');
    }, message.intervalMs);
  }
});
