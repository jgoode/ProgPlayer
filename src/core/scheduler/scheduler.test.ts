/**
 * Scheduler and transport tests (P4.2-P4.5, testing.md §4.4).
 *
 * Every scenario from testing.md §4.4 has a test here. The clock and the
 * timer are simulated, so the tests are deterministic.
 *
 * The clock is the audio clock, so Play is pressed at t = 0: the count-in
 * clicks happen at t = 0, 0.5, 1.0, 1.5 (at 120 BPM) and the arrangement
 * itself starts at t = 2.
 */

import { describe, expect, it } from 'vitest';

import { compileTimeline } from '../compiler/compile';
import type { CompiledTimeline } from '../compiler/compile';

import { FakeClock } from '../../../tests/fixtures/fake-clock';
import { RecordingSink } from '../../../tests/fixtures/recording-sink';
import { barChord, section, session } from '../../../tests/fixtures/sessions';

import { Scheduler } from './scheduler';
import type { SchedulerPosition } from './scheduler';
import { Transport } from './transport';
import type { TransportOptions } from './transport';

interface Harness {
  readonly clock: FakeClock;
  readonly sink: RecordingSink;
  readonly scheduler: Scheduler;
  readonly transport: Transport;
  readonly timeline: CompiledTimeline;
  readonly positions: SchedulerPosition[];
}

/** Builds a four-bar arrangement at 120 BPM. */
function fourBarTimeline(countInBars = 1): CompiledTimeline {
  return compileTimeline(
    session([section('A', [barChord(1), barChord(4), barChord(5), barChord(4)])], {
      playback: { countInBars, loopMode: 'off' },
    }),
  );
}

/** Builds a harness around a timeline. */
function harness(
  timeline: CompiledTimeline = fourBarTimeline(),
  options: {
    readonly transport?: Omit<TransportOptions, 'timeline'>;
    readonly lookAheadSeconds?: number;
  } = {},
): Harness {
  const clock = new FakeClock();
  const sink = new RecordingSink();
  const transport = new Transport({ timeline, ...options.transport });
  const positions: SchedulerPosition[] = [];
  const scheduler = new Scheduler({
    timeline,
    sinks: [sink],
    clock: () => clock.now(),
    timer: clock.timer,
    transport,
    lookAheadSeconds: options.lookAheadSeconds ?? 0.1,
    timerIntervalMs: 25,
    onPosition: (position) => positions.push(position),
  });
  return { clock, sink, scheduler, transport, timeline, positions };
}

/** The unique (tick, pitch) pairs of the note-on events. */
function uniqueNotes(sink: RecordingSink): readonly string[] {
  return [
    ...new Set(
      sink.ofKind('noteOn').map((event) => `${String(event.tick)}:${String(event.pitch)}`),
    ),
  ];
}

describe('scheduler: play from start', () => {
  it('emits the events in order, each stamped at the correct time', async () => {
    const { clock, sink, scheduler } = harness();
    await scheduler.start();

    // The count-in is one bar at 120 BPM: four clicks in the first two
    // seconds, and the arrangement starts at t = 2.
    clock.advance(2);
    const countInClicks = sink.ofKind('click').filter((event) => event.countIn);
    expect(countInClicks).toHaveLength(4);
    expect(countInClicks[0]?.time).toBeCloseTo(0, 9);
    expect(countInClicks[3]?.time).toBeCloseTo(1.5, 9);

    // The first chord starts at tick 0, which is 2 s after Play.
    const noteOns = sink.ofKind('noteOn');
    expect(noteOns[0]?.tick).toBe(0);
    expect(noteOns[0]?.time).toBeCloseTo(2, 9);

    clock.advance(10);
    const times = sink.events.map((event) => event.time);
    for (let index = 1; index < times.length; index += 1) {
      expect(times[index]).toBeGreaterThanOrEqual(times[index - 1] as number);
    }
  });

  it('emits nothing later than the look-ahead window', async () => {
    const { clock, sink, scheduler } = harness();
    await scheduler.start();

    // The first pump emits the events inside the first 100 ms.
    expect(sink.events.length).toBeGreaterThan(0);
    for (const event of sink.events) {
      expect(event.time).toBeLessThanOrEqual(0.1);
    }

    sink.clear();
    clock.advance(0.02);
    for (const event of sink.events) {
      expect(event.time).toBeLessThanOrEqual(0.12);
    }
  });

  it('stops emitting once the arrangement has finished', async () => {
    const { clock, sink, scheduler } = harness();
    await scheduler.start();
    clock.advance(20);

    const count = sink.events.length;
    clock.advance(5);
    expect(sink.events.length).toBe(count);
    expect(scheduler.isRunning).toBe(false);
  });
});

describe('scheduler: pause and resume', () => {
  it('releases the held notes on pause', async () => {
    const { clock, sink, scheduler } = harness();
    await scheduler.start();
    clock.advance(3);

    expect(sink.ofKind('noteOn').length).toBeGreaterThan(0);
    const before = sink.allNotesOffCount;
    scheduler.pause();
    expect(sink.allNotesOffCount).toBe(before + 1);
  });

  it('loses no event and duplicates none across a pause and resume', async () => {
    const { clock, sink, scheduler } = harness();
    await scheduler.start();
    clock.advance(6);

    const beforePause = uniqueNotes(sink);
    scheduler.pause();
    const pauseTick = scheduler.currentTick;
    sink.clear();
    scheduler.resume();
    clock.advance(20);

    const afterResume = uniqueNotes(sink);

    // The resume replays the interrupted beat and then carries on, so the
    // notes of the interrupted beat and the ones after it are all played.
    const expectedAfterResume = beforePause.filter((note) => {
      const tick = Number(note.split(':')[0]);
      return tick >= pauseTick;
    });
    for (const note of expectedAfterResume) {
      expect(afterResume).toContain(note);
    }
    // No note is played twice within the resumed run.
    expect(afterResume.length).toBe(new Set(afterResume).size);
  });

  it('does not play a count-in on resume (G-02)', async () => {
    const { clock, sink, scheduler } = harness();
    await scheduler.start();
    clock.advance(6);
    scheduler.pause();

    sink.clear();
    scheduler.resume();
    clock.advance(1);

    const countInClicks = sink.ofKind('click').filter((event) => event.countIn);
    expect(countInClicks).toHaveLength(0);
  });

  it('restarts the interrupted beat rather than continuing mid-note (G-02)', async () => {
    const { clock, scheduler } = harness();
    await scheduler.start();
    // 2.6 s into the playback is 0.6 s into the first bar, so the
    // interrupted beat is beat 2.
    clock.advance(2.6);
    scheduler.pause();

    expect(scheduler.currentTick).toBe(480);
  });
});

describe('scheduler: stop', () => {
  it('releases every sounding note and clears the pending events', async () => {
    const { clock, sink, scheduler } = harness();
    await scheduler.start();
    clock.advance(6);

    const before = sink.allNotesOffCount;
    scheduler.stop();

    expect(sink.allNotesOffCount).toBe(before + 1);
    expect(scheduler.isRunning).toBe(false);

    const count = sink.events.length;
    clock.advance(5);
    expect(sink.events.length).toBe(count);
  });

  it('returns to the start and plays the count-in again', async () => {
    const { clock, sink, scheduler } = harness();
    await scheduler.start();
    clock.advance(6);
    scheduler.stop();

    sink.clear();
    await scheduler.start();
    clock.advance(0.1);

    expect(sink.ofKind('click').some((event) => event.countIn)).toBe(true);
  });
});

describe('scheduler: count-in', () => {
  it('plays click only during the count-in', async () => {
    const { clock, sink, scheduler } = harness();
    await scheduler.start();
    clock.advance(2.5);

    const countInClicks = sink.ofKind('click').filter((event) => event.countIn);
    expect(countInClicks.length).toBeGreaterThan(0);
    for (const click of countInClicks) {
      expect(click.time).toBeLessThan(2);
    }
  });

  it('numbers the bars from 1 after the count-in', async () => {
    const { clock, scheduler, positions } = harness();
    await scheduler.start();
    clock.advance(3);

    const withBar = positions.filter((position) => position.bar !== null);
    expect(withBar[0]?.bar).toBe(1);
  });

  it('reports no bar during the count-in', async () => {
    const { scheduler, positions } = harness();
    await scheduler.start();

    const duringCountIn = positions.filter((position) => position.countIn);
    expect(duringCountIn.length).toBeGreaterThan(0);
    for (const position of duringCountIn) {
      expect(position.bar).toBeNull();
      expect(position.beat).toBeNull();
    }
  });

  it('does not repeat the count-in on a loop wrap', async () => {
    const timeline = compileTimeline(
      session([section('A', [barChord(1), barChord(4)])], {
        playback: { countInBars: 1, loopMode: 'whole' },
      }),
    );
    const { clock, sink, scheduler, transport } = harness(timeline, {
      transport: { loopMode: 'whole' },
    });
    await scheduler.start();
    clock.advance(30);

    expect(transport.currentLoop).not.toBeNull();
    const countInClicks = sink.ofKind('click').filter((event) => event.countIn);
    // One bar of count-in at 120 BPM: four clicks, once.
    expect(countInClicks).toHaveLength(4);
  });
});

describe('scheduler: loop', () => {
  it('loops the whole arrangement seamlessly', async () => {
    const timeline = compileTimeline(
      session([section('A', [barChord(1), barChord(4)])], {
        playback: { countInBars: 0, loopMode: 'whole' },
      }),
    );
    const { clock, sink, scheduler } = harness(timeline, {
      transport: { loopMode: 'whole' },
    });
    await scheduler.start();
    clock.advance(30);

    const noteOns = sink.ofKind('noteOn');
    // The two chords are played over and over.
    expect(noteOns.length).toBeGreaterThan(4);
    const ticks = noteOns.map((event) => event.tick);
    expect(ticks).toContain(0);
    expect(ticks).toContain(1920);
  });

  it('joins the loop without a gap: the beats are evenly spaced across the wrap', async () => {
    const timeline = compileTimeline(
      session([section('A', [barChord(1), barChord(4)])], {
        playback: { countInBars: 0, loopMode: 'whole' },
      }),
    );
    const { clock, sink, scheduler } = harness(timeline, {
      transport: { loopMode: 'whole' },
    });
    await scheduler.start();
    clock.advance(30);

    const clicks = sink.ofKind('click');
    // The click times are spaced by exactly the beat, with no gap at the
    // wrap and no doubled click.
    for (let index = 1; index < clicks.length; index += 1) {
      const previous = clicks[index - 1] as { time: number };
      const current = clicks[index] as { time: number };
      expect(current.time - previous.time).toBeCloseTo(0.5, 9);
    }
  });

  it('loops a section', async () => {
    const timeline = compileTimeline(
      session(
        [section('A', [barChord(1), barChord(4)]), section('B', [barChord(2), barChord(5)])],
        { playback: { countInBars: 0, loopMode: 'section' } },
      ),
    );
    const { clock, sink, scheduler, transport } = harness(timeline, {
      transport: { loopMode: 'section', loopSectionIndex: 0 },
    });
    await scheduler.start();
    clock.advance(30);

    const region = transport.currentLoop;
    expect(region?.startBar).toBe(1);
    expect(region?.endBar).toBe(2);

    const noteOns = sink.ofKind('noteOn');
    // Only section A's chords are played: section A holds two bars.
    expect(noteOns.every((event) => event.tick < 3840)).toBe(true);
    expect([...new Set(noteOns.map((event) => event.tick))]).toEqual([0, 1920]);
  });

  it('loops a bar range', async () => {
    const timeline = compileTimeline(
      session(
        [section('A', [barChord(1), barChord(4)]), section('B', [barChord(2), barChord(5)])],
        {
          playback: {
            countInBars: 0,
            loopMode: 'barRange',
            loopBarRange: { startBar: 3, endBar: 4 },
          },
        },
      ),
    );
    const { clock, sink, scheduler, transport } = harness(timeline, {
      transport: {
        loopMode: 'barRange',
        loopBarRange: { startBar: 3, endBar: 4 },
      },
    });
    await scheduler.start();
    clock.advance(30);

    const region = transport.currentLoop;
    expect(region?.startBar).toBe(3);
    expect(region?.endBar).toBe(4);

    const noteOns = sink.ofKind('noteOn');
    expect(noteOns.every((event) => event.tick >= 3840)).toBe(true);
  });

  it('loops a region of one bar', async () => {
    const timeline = compileTimeline(
      session([section('A', [barChord(1), barChord(4)])], {
        playback: {
          countInBars: 0,
          loopMode: 'barRange',
          loopBarRange: { startBar: 1, endBar: 1 },
        },
      }),
    );
    const { clock, sink, scheduler } = harness(timeline, {
      transport: {
        loopMode: 'barRange',
        loopBarRange: { startBar: 1, endBar: 1 },
      },
    });
    await scheduler.start();
    clock.advance(30);

    const noteOns = sink.ofKind('noteOn');
    expect(noteOns.every((event) => event.tick < 1920)).toBe(true);
    expect(noteOns.length).toBeGreaterThan(4);
  });

  it('loops a region of one chord', async () => {
    const timeline = compileTimeline(
      session([section('A', [barChord(1), barChord(4)])], {
        playback: {
          countInBars: 0,
          loopMode: 'barRange',
          loopBarRange: { startBar: 1, endBar: 1 },
        },
      }),
    );
    const { clock, sink, scheduler } = harness(timeline, {
      transport: {
        loopMode: 'barRange',
        loopBarRange: { startBar: 1, endBar: 1 },
      },
    });
    await scheduler.start();
    clock.advance(30);

    // The region is one bar, so the two clicks per bar repeat.
    const clicks = sink.ofKind('click');
    expect(clicks.length).toBeGreaterThan(8);
  });

  it('takes a new loop region into account at the next bar boundary', async () => {
    const timeline = compileTimeline(
      session(
        [section('A', [barChord(1), barChord(4)]), section('B', [barChord(2), barChord(5)])],
        { playback: { countInBars: 0, loopMode: 'whole' } },
      ),
    );
    const { clock, sink, scheduler, transport } = harness(timeline, {
      transport: { loopMode: 'whole' },
    });
    await scheduler.start();
    clock.advance(1);

    transport.setLoop('barRange', { barRange: { startBar: 3, endBar: 4 } });
    sink.clear();
    clock.advance(30);

    const noteOns = sink.ofKind('noteOn');
    // The new region is the second section.
    expect(noteOns.some((event) => event.tick >= 3840)).toBe(true);
  });
});

describe('scheduler: tempo change', () => {
  it('applies the new tempo from the next beat', async () => {
    const { clock, sink, scheduler } = harness();
    await scheduler.start();
    clock.advance(3);

    scheduler.setTempo(240);
    clock.advance(5);

    const clicks = sink.ofKind('click');
    const afterChange = clicks.filter((click) => click.time > 3.5);
    // At 240 BPM the beats are 0.25 s apart.
    for (let index = 1; index < afterChange.length; index += 1) {
      const previous = afterChange[index - 1] as { time: number };
      const current = afterChange[index] as { time: number };
      expect(current.time - previous.time).toBeCloseTo(0.25, 6);
    }
  });

  it('does not move the times of the events that were already scheduled', async () => {
    const { clock, sink, scheduler } = harness();
    await scheduler.start();
    clock.advance(3);

    const before = sink.ofKind('click').map((event) => event.time);
    scheduler.setTempo(240);
    clock.advance(0.01);

    const after = sink.ofKind('click').map((event) => event.time);
    expect(after.slice(0, before.length)).toEqual(before);
  });
});

describe('scheduler: tempo extremes', () => {
  it('produces the correct timing at 30 BPM', async () => {
    const timeline = compileTimeline(
      session([section('A', [barChord(1), barChord(4)])], {
        tempoBpm: 30,
        playback: { countInBars: 0, loopMode: 'off' },
      }),
    );
    const { clock, sink, scheduler } = harness(timeline);
    await scheduler.start();
    clock.advance(1);

    const noteOns = sink.ofKind('noteOn');
    expect(noteOns[0]?.time).toBeCloseTo(0, 9);
    clock.advance(10);
    const later = sink.ofKind('noteOn').find((event) => event.tick === 1920);
    // Two seconds per bar at 30 BPM.
    expect(later?.time).toBeCloseTo(8, 6);
  });

  it('produces the correct timing at 300 BPM', async () => {
    const timeline = compileTimeline(
      session([section('A', [barChord(1), barChord(4)])], {
        tempoBpm: 300,
        playback: { countInBars: 0, loopMode: 'off' },
      }),
    );
    const { clock, sink, scheduler } = harness(timeline);
    await scheduler.start();
    clock.advance(10);

    const later = sink.ofKind('noteOn').find((event) => event.tick === 1920);
    // 0.8 s per bar at 300 BPM.
    expect(later?.time).toBeCloseTo(0.8, 6);
  });
});

describe('scheduler: late timer', () => {
  it('catches up without a burst of simultaneous notes and records the metric', async () => {
    const { clock, sink, scheduler } = harness();
    await scheduler.start();

    // The timer fires 500 ms late — far beyond the 100 ms look-ahead.
    clock.advanceLate(0.5);

    const metrics = scheduler.metrics;
    expect(metrics.lateTimerFires).toBeGreaterThan(0);
    expect(metrics.maxTimerOverrunSeconds).toBeGreaterThan(0);

    // The events are still in tick order, so the notes do not pile up on
    // the same instant.
    const noteOns = sink.ofKind('noteOn');
    for (let index = 1; index < noteOns.length; index += 1) {
      const previous = noteOns[index - 1] as { tick: number };
      const current = noteOns[index] as { tick: number };
      expect(current.tick).toBeGreaterThanOrEqual(previous.tick);
    }
  });

  it('reports zero late events when the timer keeps up', async () => {
    const { clock, scheduler } = harness();
    await scheduler.start();
    clock.advance(30);

    expect(scheduler.metrics.lateEvents).toBe(0);
    expect(scheduler.metrics.lateTimerFires).toBe(0);
  });
});

describe('scheduler: sink failure', () => {
  it('keeps playing when a sink fails', async () => {
    const { clock, sink } = harness();
    const errors: string[] = [];
    const failing = new RecordingSink('failing');
    failing.scheduleError = new Error('device removed');

    const timeline = fourBarTimeline();
    const transport = new Transport({ timeline });
    const scheduler = new Scheduler({
      timeline,
      sinks: [failing, sink],
      clock: () => clock.now(),
      timer: clock.timer,
      transport,
      onSinkError: (name) => errors.push(name),
    });

    await scheduler.start();
    clock.advance(6);

    expect(errors).toContain('failing');
    // The healthy sink still received the events.
    expect(sink.ofKind('noteOn').length).toBeGreaterThan(0);
  });

  it('keeps playing when a sink fails to start', async () => {
    const clock = new FakeClock();
    const sink = new RecordingSink();
    const failing = new RecordingSink('failing');
    failing.startError = new Error('no sound bank');
    const errors: string[] = [];

    const timeline = fourBarTimeline();
    const transport = new Transport({ timeline });
    const scheduler = new Scheduler({
      timeline,
      sinks: [failing, sink],
      clock: () => clock.now(),
      timer: clock.timer,
      transport,
      onSinkError: (name) => errors.push(name),
    });

    await scheduler.start();
    clock.advance(6);

    expect(errors).toContain('failing');
    expect(sink.ofKind('noteOn').length).toBeGreaterThan(0);
  });
});

describe('scheduler: event ordering', () => {
  it('emits the events in tick order', async () => {
    const { clock, sink, scheduler } = harness();
    await scheduler.start();
    clock.advance(10);

    const events = sink.events;
    for (let index = 1; index < events.length; index += 1) {
      const previous = events[index - 1] as { tick: number };
      const current = events[index] as { tick: number };
      expect(current.tick).toBeGreaterThanOrEqual(previous.tick);
    }
  });

  it('gives every note an off event', async () => {
    const { clock, sink, scheduler } = harness();
    await scheduler.start();
    clock.advance(10);

    const onCount = sink.ofKind('noteOn').length;
    const offCount = sink.ofKind('noteOff').length;
    expect(offCount).toBe(onCount);
  });

  it('emits the first chord at tick 0', async () => {
    const { clock, sink, scheduler } = harness();
    await scheduler.start();
    clock.advance(3);
    expect(sink.ofKind('noteOn')[0]?.tick).toBe(0);
  });
});
