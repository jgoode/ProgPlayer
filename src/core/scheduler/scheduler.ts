/**
 * Look-ahead scheduler (P4.2, implementation.md §2.3-2.4, NFR-TIM-1).
 *
 * The scheduler walks the compiled timeline and hands events to the sinks
 * with a target time, using a look-ahead window: every timer tick it emits
 * the events that fall inside the next `lookAheadSeconds`, so the sinks
 * always have the events queued before they are due (testing.md §8).
 *
 * The clock is injected, so the whole scheduler is testable with a
 * simulated clock. The timer is injected too: in the app it is a Worker
 * timer, in the tests it is the fake clock's timer.
 *
 * ## Segments
 *
 * The scheduler plays the arrangement as a sequence of *segments*. A
 * segment is a range of ticks that is played once:
 *
 * - the **count-in** segment, which covers the ticks before zero and is
 *   played only on a fresh Play (FR-PLY-5, G-02);
 * - the **region** segment, which covers the loop region — or the whole
 *   arrangement when the loop is off. A region segment is replayed for as
 *   long as the loop is on.
 *
 * Each segment has its own start time, its own tempo map and its own plan
 * of events. When a segment ends, the next one starts at exactly the
 * moment the previous one ended, so a loop join has no gap and no doubled
 * beat (implementation.md §2.4).
 *
 * ## The time model
 *
 * The clock is the audio clock, so the target times are absolute: the
 * count-in clicks happen at the moment Play is pressed, and the
 * arrangement starts one count-in later. Within a segment, the target time
 * of an event is
 *
 * ```text
 * segmentStartTime + tempoMap.secondsBetween(segmentStartTick, eventTick)
 * ```
 *
 * The tempo map is anchored at the segment's first tick and its anchors
 * are integrated one by one, so a live tempo change (FR-TMP-2) never moves
 * the times of the events that were already scheduled: the anchor's own
 * time is the continuity point.
 */

import { TICKS_PER_QUARTER } from '../arrangement/meter';
import type { CompiledTimeline } from '../compiler/compile';

import { buildPlaybackPlan, collectMarkers, positionAtTick } from './plan';
import type { PlannedEvent } from './plan';
import type { PlaybackSink, ScheduledEvent, SinkErrorHandler } from './sinks';
import { withTiming } from './sinks';
import { TempoMapBuilder, assertTempoInRange } from './tempo-map';
import type { TempoMap } from './tempo-map';
import { Transport } from './transport';
import type { LoopRegion } from './transport';

/** The clock the scheduler reads the current time from, in seconds. */
export type SchedulerClock = () => number;

/** The timer the scheduler uses to wake up. */
export interface SchedulerTimer {
  /** Schedules a callback after `delayMs`. */
  schedule(callback: () => void, delayMs: number): void;
  /** Cancels a pending callback. */
  cancel(): void;
}

/** The look-ahead window, in seconds (implementation.md §2.3). */
export const DEFAULT_LOOK_AHEAD_SECONDS = 0.1;

/** How often the timer wakes the scheduler up, in milliseconds. */
export const DEFAULT_TIMER_INTERVAL_MS = 25;

/** The metrics the scheduler collects (testing.md §8). */
export interface SchedulerMetrics {
  /** How many events were handed to the sinks. */
  readonly eventsScheduled: number;
  /**
   * How many events were dispatched later than their target time.
   *
   * The budget is 0 late events during a 10-minute soak (testing.md §8).
   */
  readonly lateEvents: number;
  /** The largest lateness observed, in seconds. */
  readonly maxLatenessSeconds: number;
  /** The sum of the lateness observed, in seconds. */
  readonly totalLatenessSeconds: number;
  /** How many times the timer fired later than it was asked to. */
  readonly lateTimerFires: number;
  /** The largest timer overrun observed, in seconds. */
  readonly maxTimerOverrunSeconds: number;
}

/** The position the scheduler reports to the UI. */
export interface SchedulerPosition {
  /** The tick the scheduler is at. */
  readonly tick: number;
  /** The global bar number, 1-based; `null` during the count-in. */
  readonly bar: number | null;
  /** The beat inside the bar, 1-based; `null` during the count-in. */
  readonly beat: number | null;
  /** True while the count-in is running. */
  readonly countIn: boolean;
  /** The metrics collected so far. */
  readonly metrics: SchedulerMetrics;
}

/** Options for constructing a scheduler. */
export interface SchedulerOptions {
  /** The compiled timeline to play. */
  readonly timeline: CompiledTimeline;
  /** The sinks the events are handed to. */
  readonly sinks: readonly PlaybackSink[];
  /** The clock that reports the current time, in seconds. */
  readonly clock: SchedulerClock;
  /** The timer that wakes the scheduler up. */
  readonly timer: SchedulerTimer;
  /** The transport that owns the playback state. */
  readonly transport: Transport;
  /** The look-ahead window, in seconds. Defaults to 100 ms. */
  lookAheadSeconds?: number;
  /** How often the timer fires, in milliseconds. Defaults to 25 ms. */
  timerIntervalMs?: number;
  /** Reports a sink failure without stopping the other sinks. */
  onSinkError?: SinkErrorHandler;
  /** Called after each scheduling pass, with the scheduler's position. */
  onPosition?: (position: SchedulerPosition) => void;
}

/** A pending change of the loop region. */
interface PendingSwitch {
  /** The region to play, or `null` to play the rest of the arrangement. */
  readonly region: LoopRegion | null;
  /** The bar boundary the change takes effect at. */
  readonly boundaryTick: number;
}

/** What the current segment covers. */
type SegmentKind = 'preRoll' | 'region' | 'arrangement';

/** A tempo change inside a segment. */
interface TempoChange {
  /** The tick the change takes effect at. */
  readonly tick: number;
  /** The tempo from that tick onwards. */
  readonly bpm: number;
}

/**
 * The look-ahead scheduler.
 */
export class Scheduler {
  private readonly timeline: CompiledTimeline;
  private readonly sinks: readonly PlaybackSink[];
  private readonly clock: SchedulerClock;
  private readonly timer: SchedulerTimer;
  private readonly transport: Transport;
  private readonly lookAheadSeconds: number;
  private readonly timerIntervalMs: number;
  private readonly onSinkError: SinkErrorHandler | undefined;
  private readonly onPosition: ((position: SchedulerPosition) => void) | undefined;
  private readonly markers: ReturnType<typeof collectMarkers>;
  private readonly barTicks: readonly number[];

  /** The tempo the user asked for. */
  private requestedBpm: number;

  /** The tempo in force at the start of the next segment. */
  private carryBpm: number;

  /** The tempo map of the current segment. */
  private tempoMap: TempoMap;

  /** The tempo in force at the start of the current segment. */
  private segmentInitialBpm: number;

  /** The tempo changes inside the current segment. */
  private segmentChanges: readonly TempoChange[] = [];

  /** The tick range of the current segment. */
  private segmentStartTick = 0;
  private segmentEndTick = 0;

  /** The wall-clock times of the segment's start and end. */
  private segmentStartTime = 0;
  private segmentEndTime = 0;

  /** What the current segment covers. */
  private segmentKind: SegmentKind = 'arrangement';

  /** The plan of the events that have not been emitted yet. */
  private plan: readonly PlannedEvent[] = [];

  /** The index of the next planned event. */
  private planIndex = 0;

  /** The tick of the last event that was emitted. */
  private lastEmittedTick = 0;

  /** A loop-region change waiting for the next bar boundary. */
  private pendingSwitch: PendingSwitch | null = null;

  /** True while the scheduler is running. */
  private running = false;

  /** The time the timer was asked to fire, used to detect late fires. */
  private expectedTimerTime = 0;

  private eventsScheduled = 0;
  private lateEvents = 0;
  private maxLatenessSeconds = 0;
  private totalLatenessSeconds = 0;
  private lateTimerFires = 0;
  private maxTimerOverrunSeconds = 0;

  constructor(options: SchedulerOptions) {
    this.timeline = options.timeline;
    this.sinks = options.sinks;
    this.clock = options.clock;
    this.timer = options.timer;
    this.transport = options.transport;
    this.lookAheadSeconds = options.lookAheadSeconds ?? DEFAULT_LOOK_AHEAD_SECONDS;
    this.timerIntervalMs = options.timerIntervalMs ?? DEFAULT_TIMER_INTERVAL_MS;
    this.onSinkError = options.onSinkError;
    this.onPosition = options.onPosition;
    this.requestedBpm = options.timeline.tempoBpm;
    this.carryBpm = this.requestedBpm;
    this.segmentInitialBpm = this.requestedBpm;
    this.markers = collectMarkers(options.timeline);

    const barTicks: number[] = [];
    for (const marker of this.markers) {
      if (marker.marker === 'bar') {
        barTicks.push(marker.tick);
      }
    }
    barTicks.sort((left, right) => left - right);
    this.barTicks = barTicks;

    this.tempoMap = this.buildSegmentMap();
    this.openInitialSegment(0);
  }

  /** The tempo map of the current segment. */
  get currentTempoMap(): TempoMap {
    return this.tempoMap;
  }

  /** The metrics collected so far. */
  get metrics(): SchedulerMetrics {
    return {
      eventsScheduled: this.eventsScheduled,
      lateEvents: this.lateEvents,
      maxLatenessSeconds: this.maxLatenessSeconds,
      totalLatenessSeconds: this.totalLatenessSeconds,
      lateTimerFires: this.lateTimerFires,
      maxTimerOverrunSeconds: this.maxTimerOverrunSeconds,
    };
  }

  /** The tick the scheduler is at. */
  get currentTick(): number {
    return this.lastEmittedTick;
  }

  /** True while the scheduler is running. */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Starts the scheduler.
   *
   * The sinks are prepared first; a sink that fails to start reports the
   * failure and the other sinks carry on (testing.md §4.4).
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.transport.play();
    this.carryBpm = this.requestedBpm;
    this.openInitialSegment(this.clock());

    for (const sink of this.sinks) {
      try {
        await sink.start?.();
      } catch (error: unknown) {
        this.reportSinkError(sink, error);
      }
    }

    this.running = true;
    this.expectedTimerTime = this.clock();
    this.scheduleNextTick();
    this.pump();
  }

  /**
   * Stops the scheduler and releases every sounding note.
   *
   * The pending events are dropped, so nothing that was scheduled but not
   * yet dispatched reaches the sinks (FR-SND-9).
   */
  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.timer.cancel();
    this.transport.stop();
    this.pendingSwitch = null;
    this.releaseAllNotes();
    this.carryBpm = this.requestedBpm;
    this.openInitialSegment(this.clock());
    this.reportPosition();
  }

  /**
   * Pauses the scheduler and releases every sounding note.
   *
   * The pending events are dropped, so a resume restarts the interrupted
   * beat cleanly (G-02).
   */
  pause(): void {
    if (!this.running) {
      return;
    }
    this.transport.pause();
    this.timer.cancel();
    this.releaseAllNotes();
    this.reportPosition();
  }

  /**
   * Resumes a paused scheduler.
   *
   * The cursor is rewound to the start of the beat that was interrupted and
   * the segment's start time is moved so that beat starts *now*, so the
   * events of that beat are replayed cleanly (G-02).
   */
  resume(): void {
    if (!this.running || this.transport.currentState !== 'paused') {
      return;
    }
    this.transport.resume();

    const resumeTick = Transport.resumeTickFor(this.lastEmittedTick);
    this.segmentStartTime =
      this.clock() - this.tempoMap.secondsBetween(this.segmentStartTick, resumeTick);
    this.segmentEndTime =
      this.segmentStartTime +
      this.tempoMap.secondsBetween(this.segmentStartTick, this.segmentEndTick);
    this.plan = buildPlaybackPlan(this.timeline, resumeTick, this.segmentEndTick);
    this.planIndex = 0;
    this.lastEmittedTick = resumeTick;

    this.expectedTimerTime = this.clock();
    this.scheduleNextTick();
    this.pump();
  }

  /**
   * Changes the tempo.
   *
   * The new tempo takes effect at the next beat boundary, and the times of
   * the events that were already emitted are unaffected (FR-TMP-2). The
   * new tempo stays in force for the rest of the playback, including across
   * a loop wrap.
   */
  setTempo(bpm: number): void {
    assertTempoInRange(bpm);
    if (bpm === this.requestedBpm) {
      return;
    }
    this.requestedBpm = bpm;

    if (!this.running) {
      this.carryBpm = bpm;
      this.segmentInitialBpm = bpm;
      this.segmentChanges = [];
      this.tempoMap = this.buildSegmentMap();
      return;
    }

    // The change takes effect at the first beat boundary that has not been
    // emitted yet.
    const anchorTick = this.nextBeatAfter(this.lastEmittedTick);
    if (anchorTick >= this.segmentEndTick) {
      // The beat is beyond the end of this segment, so the change starts
      // with the next one.
      this.carryBpm = bpm;
      return;
    }

    const changes = this.segmentChanges.filter((change) => change.tick !== anchorTick);
    changes.push({ tick: anchorTick, bpm });
    changes.sort((left, right) => left.tick - right.tick);
    this.segmentChanges = changes;

    this.tempoMap = this.buildSegmentMap();
    this.segmentEndTime =
      this.segmentStartTime +
      this.tempoMap.secondsBetween(this.segmentStartTick, this.segmentEndTick);
  }

  /**
   * Changes the loop region.
   *
   * The change takes effect at the next bar boundary (testing.md §4.4):
   * the region that is playing is finished, and the new region starts from
   * its beginning.
   */
  setLoopRegion(region: LoopRegion | null): void {
    if (!this.running) {
      this.transport.setRegion(region);
      this.openInitialSegment(this.clock());
      return;
    }
    this.pendingSwitch = {
      region,
      boundaryTick: this.nextBarBoundaryAfter(this.lastEmittedTick),
    };
  }

  /**
   * Runs one scheduling pass.
   *
   * The scheduler is driven by the injected timer; the method is public so
   * the tests can drive it directly when they want determinism.
   */
  pump(): void {
    if (!this.running) {
      return;
    }

    const now = this.clock();

    // A late timer fires after its window has already passed. The scheduler
    // catches up, but it does not emit a burst of simultaneous notes: the
    // lateness is recorded and the events keep their own target times
    // (testing.md §4.4).
    if (now > this.expectedTimerTime + 0.000_001) {
      this.lateTimerFires += 1;
      this.maxTimerOverrunSeconds = Math.max(
        this.maxTimerOverrunSeconds,
        now - this.expectedTimerTime,
      );
    }

    this.emitWindow(now + this.lookAheadSeconds);
    this.reportPosition();
  }

  /** The position the scheduler reports to the UI. */
  private reportPosition(): void {
    if (this.onPosition === undefined) {
      return;
    }
    const tick = this.currentPositionTick();
    const position = positionAtTick(this.markers, Math.max(tick, 0));
    this.onPosition({
      tick,
      bar: this.segmentKind === 'preRoll' ? null : position.bar,
      beat: this.segmentKind === 'preRoll' ? null : position.beat,
      countIn: this.segmentKind === 'preRoll',
      metrics: this.metrics,
    });
  }

  /**
   * Emits every event that falls inside the window.
   *
   * The window is split at the segment boundary, so a window that crosses
   * the end of a loop region emits the events before the boundary at their
   * own times and the events of the next pass at the loop start.
   */
  private emitWindow(windowEnd: number): void {
    for (;;) {
      const planned = this.plan[this.planIndex];

      // A pending loop-region change takes effect at the next bar boundary:
      // the events before the boundary are played, and the new region
      // starts at the boundary.
      if (this.pendingSwitch !== null) {
        const boundary = Math.min(this.pendingSwitch.boundaryTick, this.segmentEndTick);
        if (planned === undefined || planned.tick >= boundary) {
          this.applySwitch(boundary);
          continue;
        }
      }

      if (planned === undefined) {
        if (!this.advanceSegment()) {
          this.stop();
          return;
        }
        continue;
      }

      const time = this.timeOf(planned.tick);
      if (time > windowEnd) {
        return;
      }

      this.planIndex += 1;
      this.lastEmittedTick = planned.tick;
      this.emit(planned, time);
    }
  }

  /**
   * Moves to the next segment.
   *
   * Returns false when the arrangement has finished and the loop is off.
   */
  private advanceSegment(): boolean {
    if (this.segmentKind === 'preRoll') {
      this.transport.finishCountIn();
      this.openRegionSegment(this.segmentEndTime);
      return true;
    }

    if (this.segmentKind === 'arrangement') {
      return false;
    }

    // The loop wraps: the next pass starts exactly where this one ended.
    // The tempo in force at the end of this pass carries into the next
    // one, so a live tempo change is not undone by the wrap (FR-TMP-2).
    this.carryBpm = this.segmentFinalBpm;
    this.openRegionSegment(this.segmentEndTime);
    return true;
  }

  /** Applies a pending loop-region change at a bar boundary. */
  private applySwitch(boundaryTick: number): void {
    const pending = this.pendingSwitch;
    this.pendingSwitch = null;
    if (pending === null) {
      return;
    }

    const boundaryTime = this.timeOf(boundaryTick);
    if (pending.region === null) {
      this.transport.setRegion(null);
      this.openArrangementSegment(boundaryTick, boundaryTime);
      return;
    }

    this.transport.setRegion(pending.region);
    this.openSegment(
      pending.region.startTick,
      pending.region.endTick,
      boundaryTime,
      this.carryBpm,
      [],
      'region',
    );
  }

  /** Opens the segment the playback starts with: the count-in, then the region. */
  private openInitialSegment(startTime: number): void {
    if (this.timeline.countInTicks > 0) {
      this.openSegment(-this.timeline.countInTicks, 0, startTime, this.carryBpm, [], 'preRoll');
      return;
    }
    this.openRegionSegment(startTime);
  }

  /** Opens the segment that covers the loop region, or the whole arrangement. */
  private openRegionSegment(startTime: number): void {
    const loop = this.transport.currentLoop;
    if (loop === null) {
      this.openArrangementSegment(0, startTime);
      return;
    }
    this.openSegment(loop.startTick, loop.endTick, startTime, this.carryBpm, [], 'region');
  }

  /** Opens the segment that covers the rest of the arrangement. */
  private openArrangementSegment(startTick: number, startTime: number): void {
    this.openSegment(
      startTick,
      this.timeline.totalTicks,
      startTime,
      this.carryBpm,
      [],
      'arrangement',
    );
  }

  /** Opens a segment and builds its plan and tempo map. */
  private openSegment(
    startTick: number,
    endTick: number,
    startTime: number,
    initialBpm: number,
    changes: readonly TempoChange[],
    kind: SegmentKind,
  ): void {
    this.segmentStartTick = startTick;
    this.segmentEndTick = endTick;
    this.segmentStartTime = startTime;
    this.segmentKind = kind;
    this.segmentInitialBpm = initialBpm;
    this.segmentChanges = changes;
    this.tempoMap = this.buildSegmentMap();
    this.segmentEndTime =
      this.segmentStartTime +
      this.tempoMap.secondsBetween(this.segmentStartTick, this.segmentEndTick);
    this.plan = buildPlaybackPlan(this.timeline, startTick, endTick);
    this.planIndex = 0;
    this.lastEmittedTick = startTick;
  }

  /** Builds the tempo map of the current segment. */
  private buildSegmentMap(): TempoMap {
    const builder = new TempoMapBuilder({
      tick: this.segmentStartTick,
      time: 0,
    }).withInitialTempo(this.segmentInitialBpm);
    for (const change of this.segmentChanges) {
      if (change.tick > this.segmentStartTick && change.tick <= this.segmentEndTick) {
        builder.withChange(change.tick, change.bpm);
      }
    }
    return builder.build();
  }

  /** The tempo in force at the end of the current segment. */
  private get segmentFinalBpm(): number {
    const last = this.segmentChanges[this.segmentChanges.length - 1];
    return last === undefined ? this.segmentInitialBpm : last.bpm;
  }

  /** Emits one event to every sink. */
  private emit(planned: PlannedEvent, time: number): void {
    const now = this.clock();
    const lateness = now - time;
    if (lateness > 0) {
      this.lateEvents += 1;
      this.maxLatenessSeconds = Math.max(this.maxLatenessSeconds, lateness);
      this.totalLatenessSeconds += lateness;
    }

    const scheduled: ScheduledEvent = withTiming(planned.payload, time, planned.tick);

    for (const sink of this.sinks) {
      try {
        sink.schedule(scheduled);
      } catch (error: unknown) {
        this.reportSinkError(sink, error);
      }
    }
    this.eventsScheduled += 1;
  }

  /** Releases every sounding note, on every sink (FR-SND-9). */
  private releaseAllNotes(): void {
    for (const sink of this.sinks) {
      try {
        sink.allNotesOff?.();
      } catch (error: unknown) {
        this.reportSinkError(sink, error);
      }
    }
  }

  /** The time of a tick, relative to the current segment. */
  private timeOf(tick: number): number {
    return this.segmentStartTime + this.tempoMap.secondsBetween(this.segmentStartTick, tick);
  }

  /** The tick the playback is at, derived from the clock. */
  private currentPositionTick(): number {
    const now = Math.min(Math.max(this.clock(), this.segmentStartTime), this.segmentEndTime);
    const relative = now - this.segmentStartTime;
    return this.tempoMap.tickAtTime(relative);
  }

  /** The first beat boundary strictly after a tick. */
  private nextBeatAfter(tick: number): number {
    return (Math.floor(tick / TICKS_PER_QUARTER) + 1) * TICKS_PER_QUARTER;
  }

  /** The first bar boundary strictly after a tick. */
  private nextBarBoundaryAfter(tick: number): number {
    for (const barTick of this.barTicks) {
      if (barTick > tick) {
        return barTick;
      }
    }
    return this.segmentEndTick;
  }

  /** Schedules the next timer tick. */
  private scheduleNextTick(): void {
    if (!this.running) {
      return;
    }
    this.expectedTimerTime = this.clock() + this.timerIntervalMs / 1000;
    this.timer.schedule(() => {
      this.pump();
      this.scheduleNextTick();
    }, this.timerIntervalMs);
  }

  /** Reports a sink failure without interrupting the other sinks. */
  private reportSinkError(sink: PlaybackSink, error: unknown): void {
    const wrapped =
      error instanceof Error ? error : new Error(`Sink ${sink.name} failed: ${String(error)}`);
    if (this.onSinkError === undefined) {
      return;
    }
    this.onSinkError(sink.name, wrapped);
  }
}
