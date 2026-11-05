/**
 * Simulated-clock tests for the Spike S2 look-ahead scheduler.
 *
 * The scheduler never uses a real timer: the test advances a fake clock and
 * calls `tick()` by hand, so the look-ahead behaviour is deterministic.
 */

import { describe, expect, it } from 'vitest';

import { TimelineClock, type TimelineEvent } from '../../spikes/s2/renderer/analysis';
import { LookAheadScheduler, type DispatchRecord } from '../../spikes/s2/renderer/scheduler';

function eventsAt(ticks: number[]): TimelineEvent[] {
  return ticks.map((tick, index) => ({
    id: index,
    tick,
    kind: 'clock',
    channel: 0,
    note: 0,
    velocity: 0,
  }));
}

describe('look-ahead scheduler', () => {
  it('dispatches an event only once it enters the look-ahead window', () => {
    let now = 1000;
    const dispatched: DispatchRecord[] = [];
    const clock = new TimelineClock(0, 1000, 120);
    const scheduler = new LookAheadScheduler({
      now: () => now,
      lookAheadMs: 100,
      clock,
      events: eventsAt([480]),
      onDispatch: (_event, record) => dispatched.push(record),
    });
    scheduler.start();

    // The event is intended at 1500 ms, 500 ms ahead: outside the window.
    expect(scheduler.tick()).toBe(0);
    expect(dispatched).toHaveLength(0);

    // Move to 1400 ms: the event is now 100 ms ahead and enters the window.
    now = 1400;
    expect(scheduler.tick()).toBe(1);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.intendedTimeMs).toBeCloseTo(1500, 6);
  });

  it('never dispatches an event twice', () => {
    const now = 1000;
    const clock = new TimelineClock(0, 1000, 120);
    const scheduler = new LookAheadScheduler({
      now: () => now,
      lookAheadMs: 100,
      clock,
      events: eventsAt([0, 480]),
      onDispatch: () => undefined,
    });
    scheduler.start();

    expect(scheduler.tick()).toBe(1);
    expect(scheduler.tick()).toBe(0);
    expect(scheduler.dispatchedCount).toBe(1);
  });

  it('records the lateness of a dispatch', () => {
    let now = 1000;
    const records: DispatchRecord[] = [];
    const clock = new TimelineClock(0, 1000, 120);
    const scheduler = new LookAheadScheduler({
      now: () => now,
      lookAheadMs: 100,
      clock,
      events: eventsAt([480]),
      onDispatch: (_event, record) => records.push(record),
    });
    scheduler.start();

    now = 1450;
    scheduler.tick();
    // Intended at 1500 ms, dispatched at 1450 ms: 50 ms early.
    expect(records[0]?.latenessMs).toBeCloseTo(-50, 6);
  });

  it('stops dispatching after stop()', () => {
    const now = 1000;
    const clock = new TimelineClock(0, 1000, 120);
    const scheduler = new LookAheadScheduler({
      now: () => now,
      lookAheadMs: 100,
      clock,
      events: eventsAt([0]),
      onDispatch: () => undefined,
    });
    scheduler.start();
    scheduler.stop();
    expect(scheduler.tick()).toBe(0);
    expect(scheduler.dispatchedCount).toBe(0);
  });

  it('reports completion when the last event is dispatched', () => {
    let now = 0;
    const clock = new TimelineClock(0, 0, 120);
    let completed = 0;
    const scheduler = new LookAheadScheduler({
      now: () => now,
      lookAheadMs: 100,
      clock,
      events: eventsAt([0, 480]),
      onDispatch: () => undefined,
      onComplete: () => {
        completed += 1;
      },
    });
    scheduler.start();
    scheduler.tick();
    expect(completed).toBe(0);
    // The second event is intended at 1500 ms; advance the clock so it
    // enters the look-ahead window.
    now = 1450;
    scheduler.tick();
    expect(completed).toBe(1);
  });

  it('rejects a non-positive look-ahead', () => {
    const clock = new TimelineClock(0, 0, 120);
    expect(
      () =>
        new LookAheadScheduler({
          now: () => 0,
          lookAheadMs: 0,
          clock,
          events: [],
          onDispatch: () => undefined,
        }),
    ).toThrow(RangeError);
  });

  it('surfaces a late Worker tick as positive lateness', () => {
    // Gap G-21: a main-thread stall makes the Worker tick arrive after the
    // event's intended time. Chromium clamps a past timestamp to a zero
    // delay, so the message is sent immediately and is audible early. The
    // scheduler must therefore record the lateness so the harness can count
    // it — and the production scheduler must be configured with a
    // look-ahead larger than the worst expected stall.
    let now = 1000;
    const records: DispatchRecord[] = [];
    const clock = new TimelineClock(0, 1000, 120);
    const scheduler = new LookAheadScheduler({
      now: () => now,
      lookAheadMs: 100,
      clock,
      events: eventsAt([480]),
      onDispatch: (_event, record) => records.push(record),
    });

    scheduler.start();
    // The tick is delayed by 120 ms: the event was intended at 1500 ms and
    // is dispatched at 1520 ms.
    now = 1520;
    scheduler.tick();

    expect(records).toHaveLength(1);
    expect(records[0]?.latenessMs).toBeCloseTo(20, 6);
    expect(records[0]?.latenessMs).toBeGreaterThan(0);
  });
});
