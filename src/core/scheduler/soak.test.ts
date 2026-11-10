/**
 * The scheduler soak test (P4.10, testing.md §4.4 and §8).
 *
 * The run is ten simulated minutes. The clock is simulated, so the test
 * runs in milliseconds and is deterministic, but the scheduler does exactly
 * the same work it would do in the app: the same look-ahead window, the
 * same timer interval and the same loop wrap.
 *
 * The assertions are the exit-check criteria: no late events, no drift and
 * no dropouts.
 */

import { describe, expect, it } from 'vitest';

import { compileTimeline } from '../compiler/compile';

import { FakeClock } from '../../../tests/fixtures/fake-clock';
import { RecordingSink } from '../../../tests/fixtures/recording-sink';
import { barChord, section, session } from '../../../tests/fixtures/sessions';

import { Scheduler } from './scheduler';
import { runSoak } from './soak';
import { Transport } from './transport';

const TEN_MINUTES = 600;

/** A four-bar arrangement that loops for the whole run. */
function loopedTimeline(): ReturnType<typeof compileTimeline> {
  return compileTimeline(
    session([section('A', [barChord(1), barChord(4), barChord(5), barChord(4)])], {
      playback: { countInBars: 0, loopMode: 'whole' },
    }),
  );
}

/** The transport options that make the arrangement loop. */
const LOOPING = { loopMode: 'whole' } as const;

describe('scheduler soak', () => {
  it('runs ten simulated minutes with no late events and no drift', async () => {
    const result = await runSoak({
      timeline: loopedTimeline(),
      seconds: TEN_MINUTES,
      transport: LOOPING,
    });

    expect(result.simulatedSeconds).toBe(TEN_MINUTES);
    expect(result.eventsScheduled).toBeGreaterThan(0);
    expect(result.lateEvents).toBe(0);
    expect(result.maxLatenessSeconds).toBe(0);
    expect(result.metrics.lateTimerFires).toBe(0);
    expect(Math.abs(result.driftSeconds)).toBeLessThan(1e-9);
  });

  it('wraps the loop many times over the ten minutes', async () => {
    const result = await runSoak({
      timeline: loopedTimeline(),
      seconds: TEN_MINUTES,
      transport: LOOPING,
    });

    // A four-bar loop at 120 BPM lasts eight seconds, so a ten minute run
    // wraps about 75 times.
    expect(result.loopWraps).toBeGreaterThan(70);
  });

  it('runs a non-looping arrangement to its end with no drift', async () => {
    const timeline = compileTimeline(
      session([section('A', [barChord(1), barChord(4), barChord(5), barChord(4)])], {
        playback: { countInBars: 0, loopMode: 'off' },
      }),
    );

    const result = await runSoak({ timeline, seconds: 30 });

    expect(result.lateEvents).toBe(0);
    expect(result.loopWraps).toBe(0);
    expect(Math.abs(result.driftSeconds)).toBeLessThan(1e-9);
  });

  it('keeps the late-event metric at zero across the whole run', async () => {
    const result = await runSoak({
      timeline: loopedTimeline(),
      seconds: TEN_MINUTES,
      transport: LOOPING,
    });

    expect(result.metrics.lateEvents).toBe(0);
    expect(result.metrics.totalLatenessSeconds).toBe(0);
  });

  it('reports the metrics the exit check asks for', async () => {
    const result = await runSoak({
      timeline: loopedTimeline(),
      seconds: 60,
      transport: LOOPING,
    });

    expect(result.metrics.eventsScheduled).toBe(result.eventsScheduled);
    expect(result.metrics.lateEvents).toBe(result.lateEvents);
    expect(result.metrics.maxLatenessSeconds).toBe(result.maxLatenessSeconds);
  });

  it('does not drop an event across a loop wrap', async () => {
    const timeline = loopedTimeline();
    const clock = new FakeClock();
    const sink = new RecordingSink();
    const transport = new Transport({ timeline, ...LOOPING });
    const scheduler = new Scheduler({
      timeline,
      sinks: [sink],
      clock: () => clock.now(),
      timer: clock.timer,
      transport,
    });

    await scheduler.start();

    // Five minutes is enough for several wraps of a four-bar loop.
    for (let step = 0; step < 300 * 40; step += 1) {
      clock.advance(0.025);
    }

    const noteOns = sink.ofKind('noteOn');
    expect(noteOns.length).toBeGreaterThan(100);

    // Every note-on has a matching note-off, except for the notes that are
    // still sounding when the run ends — their note-off falls after the
    // run's end, so there is at most one chord's worth of them.
    const noteOffs = sink.ofKind('noteOff');
    expect(noteOffs.length).toBeLessThanOrEqual(noteOns.length);
    expect(noteOns.length - noteOffs.length).toBeLessThanOrEqual(4);
  });

  it('keeps every scheduled event inside the look-ahead window', async () => {
    const timeline = loopedTimeline();
    const clock = new FakeClock();
    const sink = new RecordingSink();
    const transport = new Transport({ timeline, ...LOOPING });
    const scheduler = new Scheduler({
      timeline,
      sinks: [sink],
      clock: () => clock.now(),
      timer: clock.timer,
      transport,
      lookAheadSeconds: 0.1,
    });

    await scheduler.start();

    let clockAtDispatch = 0;
    const originalSchedule = sink.schedule.bind(sink);
    sink.schedule = (event) => {
      // The event must never be scheduled further ahead than the window.
      expect(event.time - clockAtDispatch).toBeLessThanOrEqual(0.1 + 1e-9);
      originalSchedule(event);
    };

    for (let step = 0; step < 600 * 40; step += 1) {
      clockAtDispatch = clock.now();
      clock.advance(0.025);
    }

    expect(sink.events.length).toBeGreaterThan(0);
  });
});
