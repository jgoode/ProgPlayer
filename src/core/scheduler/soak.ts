/**
 * The scheduler soak harness (P4.10, testing.md §4.4 and §8).
 *
 * The harness runs the scheduler against a **simulated clock**, so a ten
 * minute run takes milliseconds and is deterministic. It exercises the
 * whole path: the tempo map, the look-ahead scheduler, the transport, the
 * loop wrap and the sinks.
 *
 * The metrics it reports are the ones the exit check names:
 *
 * - the number of events scheduled;
 * - the number of **late** events — an event whose target time was already
 *   in the past when it was dispatched;
 * - the **maximum lateness**, in seconds;
 * - the **drift**: how far the playback is from where the tempo map says
 *   it should be.
 *
 * The drift is measured differently for the two shapes of run, because
 * "where the playback should be" means something different in each:
 *
 * - **Without a loop**, the drift is the difference between the time the
 *   last event was scheduled at and the time the tempo map gives for that
 *   event's end tick. A drift of zero means the arrangement ended exactly
 *   when it should have.
 * - **With a loop**, the arrangement never ends, so the drift is the
 *   worst deviation of any **loop wrap** from the exact length of the
 *   loop region. A drift of zero means the join at the wrap has no gap and
 *   no doubled beat — which is what AT-4 asks for.
 *
 * A dropout would show up as a late event whose lateness exceeds the
 * look-ahead window, because the scheduler could not hand the event to the
 * sink before its target time had passed.
 */

import { compileTimeline } from '../compiler/compile';
import type { CompiledTimeline } from '../compiler/compile';

import { Scheduler } from './scheduler';
import type { SchedulerMetrics, SchedulerPosition } from './scheduler';
import { Transport } from './transport';
import type { TransportOptions } from './transport';

import { FakeClock } from '../../../tests/fixtures/fake-clock';
import { RecordingSink } from '../../../tests/fixtures/recording-sink';

/** The metrics a soak run reports. */
export interface SoakResult {
  /** The simulated duration of the run, in seconds. */
  readonly simulatedSeconds: number;
  /** How many events the scheduler handed to the sink. */
  readonly eventsScheduled: number;
  /** How many events were dispatched after their target time. */
  readonly lateEvents: number;
  /** The worst lateness, in seconds. Zero when nothing was late. */
  readonly maxLatenessSeconds: number;
  /**
   * The drift, in seconds.
   *
   * Without a loop: how far the arrangement's end was from where the tempo
   * map put it. With a loop: the worst deviation of a loop wrap from the
   * exact length of the loop region.
   */
  readonly driftSeconds: number;
  /** How many loop wraps the run made. */
  readonly loopWraps: number;
  /** How many notes were still sounding when the run ended. */
  readonly soundingNotes: number;
  /** The scheduler's own metrics. */
  readonly metrics: SchedulerMetrics;
  /** The positions the scheduler reported. */
  readonly positions: readonly SchedulerPosition[];
}

/** The options for a soak run. */
export interface SoakOptions {
  /** The timeline to play. */
  readonly timeline: CompiledTimeline;
  /** How long the run lasts, in simulated seconds. */
  readonly seconds: number;
  /** The look-ahead window, in seconds. */
  readonly lookAheadSeconds?: number | undefined;
  /** The transport's options. */
  readonly transport?: Omit<TransportOptions, 'timeline'> | undefined;
  /**
   * The timer interval, in milliseconds. The default matches the
   * scheduler's own default.
   */
  readonly timerIntervalMs?: number | undefined;
}

/**
 * Runs the scheduler against a simulated clock and reports the metrics.
 *
 * The clock advances in fixed steps that match the timer interval, so the
 * scheduler is woken exactly as it would be in the real app.
 */
export async function runSoak(options: SoakOptions): Promise<SoakResult> {
  const clock = new FakeClock();
  const sink = new RecordingSink();
  const transport = new Transport({ timeline: options.timeline, ...options.transport });
  const positions: SchedulerPosition[] = [];

  const schedulerOptions: ConstructorParameters<typeof Scheduler>[0] = {
    timeline: options.timeline,
    sinks: [sink],
    clock: () => clock.now(),
    timer: clock.timer,
    transport,
    onPosition: (position) => positions.push(position),
  };
  if (options.lookAheadSeconds !== undefined) {
    schedulerOptions.lookAheadSeconds = options.lookAheadSeconds;
  }
  if (options.timerIntervalMs !== undefined) {
    schedulerOptions.timerIntervalMs = options.timerIntervalMs;
  }

  const scheduler = new Scheduler(schedulerOptions);
  await scheduler.start();

  const timerIntervalMs = options.timerIntervalMs ?? 25;
  const stepSeconds = timerIntervalMs / 1000;
  const steps = Math.ceil(options.seconds / stepSeconds);

  for (let step = 0; step < steps; step += 1) {
    clock.advance(stepSeconds);
  }

  const metrics = scheduler.metrics;
  const tempoMap = scheduler.currentTempoMap;
  const region = transport.currentLoop;

  let driftSeconds = 0;
  let loopWraps = 0;

  if (region === null) {
    // Without a loop the arrangement ends. The drift is the worst
    // deviation of any event's scheduled time from the time the tempo map
    // gives for that event's tick: a drift of zero means every event
    // landed exactly where the tempo map said it would.
    for (const event of sink.events) {
      driftSeconds = Math.max(driftSeconds, Math.abs(event.time - tempoMap.timeAtTick(event.tick)));
    }
  } else {
    // With a loop the arrangement never ends, so the drift is measured at
    // the wrap: the first event of each pass must land exactly one region
    // length after the first event of the previous pass. A deviation would
    // be a gap or a doubled beat at the join (AT-4).
    const regionLength = tempoMap.secondsBetween(region.startTick, region.endTick);
    let passStartTime: number | null = null;
    let previousTick = Number.NEGATIVE_INFINITY;

    for (const event of sink.events) {
      if (event.tick < previousTick) {
        // The tick went backwards: this is a wrap.
        loopWraps += 1;
        if (passStartTime !== null) {
          driftSeconds = Math.max(
            driftSeconds,
            Math.abs(event.time - passStartTime - regionLength),
          );
        }
        passStartTime = event.time;
      } else if (passStartTime === null) {
        passStartTime = event.time;
      }
      previousTick = event.tick;
    }
  }

  // A note that is still sounding at the end of the run has not had its
  // note-off emitted yet — its note-off falls after the run's end.
  const soundingNotes = sink.ofKind('noteOn').length - sink.ofKind('noteOff').length;

  return {
    simulatedSeconds: steps * stepSeconds,
    eventsScheduled: metrics.eventsScheduled,
    lateEvents: metrics.lateEvents,
    maxLatenessSeconds: metrics.maxLatenessSeconds,
    driftSeconds,
    loopWraps,
    soundingNotes,
    metrics,
    positions,
  };
}

/**
 * Compiles a timeline for a soak run.
 *
 * The helper exists so a test does not have to import the compiler and the
 * fixtures separately.
 */
export function compileSoakTimeline(
  session: Parameters<typeof compileTimeline>[0],
): CompiledTimeline {
  return compileTimeline(session);
}
