/**
 * The Worker that drives the scheduler timer (P4.8).
 *
 * The Worker sleeps between wake-ups and posts a `tick` back to the host.
 * The host replies with the next `start`, so there is only ever one
 * outstanding timer and a `stop` cancels it.
 */

type WorkerRequest =
  { readonly type: 'start'; readonly delayMs: number } | { readonly type: 'stop' };

let handle: ReturnType<typeof setTimeout> | null = null;

function stop(): void {
  if (handle !== null) {
    clearTimeout(handle);
    handle = null;
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === 'stop') {
    stop();
    return;
  }
  stop();
  handle = setTimeout(() => {
    handle = null;
    (self as unknown as Worker).postMessage({ type: 'tick' });
  }, request.delayMs);
};
