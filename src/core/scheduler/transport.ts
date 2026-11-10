/**
 * Transport (P4.3, P4.4, P4.5, FR-PLY-1, FR-PLY-5, FR-PLY-6, G-02, G-07).
 *
 * The transport owns the playback state and the loop region. It is a pure
 * state machine: it never touches a clock, a sink or the DOM, so its
 * behaviour is fully determined by the calls made on it and can be tested
 * without a renderer.
 *
 * Decisions recorded for Phase 4:
 *
 * - **G-02:** a count-in plays only on a fresh Play from a stopped state.
 *   A resume continues at the start of the beat that was interrupted, with
 *   no count-in, and the held notes are re-established at that point.
 * - **G-07:** a loop region is a range of *expanded* bar numbers. Whole
 *   arrangement, section and bar-range loops all resolve to such a range.
 *   A section loop covers all of that section's repeats. The loop wrap
 *   happens at the end of the region and continues from the start of the
 *   region with no gap.
 */

import type { BarRange, LoopMode } from '../arrangement/types';
import { TICKS_PER_QUARTER } from '../arrangement/meter';
import type { CompiledTimeline } from '../compiler/compile';

/** The states the transport can be in. */
export type TransportState = 'stopped' | 'countingIn' | 'playing' | 'paused';

/** The loop region the transport plays. */
export interface LoopRegion {
  /** The mode the region was derived from. */
  readonly mode: LoopMode;
  /** First bar, 1-based, in expanded-bar numbering. */
  readonly startBar: number;
  /** Last bar, inclusive, in expanded-bar numbering. */
  readonly endBar: number;
  /** The tick the region starts at. */
  readonly startTick: number;
  /** The tick the region ends at, exclusive. */
  readonly endTick: number;
}

/** The position of the transport, as the UI reports it. */
export interface TransportPosition {
  /** The state the transport is in. */
  readonly state: TransportState;
  /** The global bar number, 1-based; `null` during the count-in. */
  readonly bar: number | null;
  /** The beat inside the bar, 1-based; `null` during the count-in. */
  readonly beat: number | null;
  /** True while the count-in is running. */
  readonly countIn: boolean;
  /** The loop region in force, or `null` when the loop is off. */
  readonly loop: LoopRegion | null;
}

/** Options for constructing a transport. */
export interface TransportOptions {
  /** The compiled timeline the transport walks. */
  readonly timeline: CompiledTimeline;
  /** The loop mode to start with. Defaults to `off`. */
  readonly loopMode?: LoopMode;
  /** The loop range to start with, used by the `barRange` mode. */
  readonly loopBarRange?: BarRange | undefined;
  /** The index of the section a `section` loop plays. */
  readonly loopSectionIndex?: number | undefined;
}

/**
 * The playback state machine.
 *
 * The transport decides *what* should play; the scheduler decides *when*.
 * The transport never advances itself: the scheduler tells it when the
 * count-in has finished.
 */
export class Transport {
  private readonly timeline: CompiledTimeline;

  /** The tick each global bar starts at, derived from the bar markers. */
  private readonly barTicks: ReadonlyMap<number, number>;

  private state: TransportState = 'stopped';

  private loopMode: LoopMode;
  private loopBarRange: BarRange | undefined;
  private loopSectionIndex: number | undefined;
  private region: LoopRegion | null;

  constructor(options: TransportOptions) {
    this.timeline = options.timeline;
    this.loopMode = options.loopMode ?? 'off';
    this.loopBarRange = options.loopBarRange;
    this.loopSectionIndex = options.loopSectionIndex;

    const barTicks = new Map<number, number>();
    for (const event of options.timeline.events) {
      if (event.kind === 'marker' && event.marker === 'bar' && event.bar !== undefined) {
        barTicks.set(event.bar, event.tick);
      }
    }
    this.barTicks = barTicks;

    this.region = this.resolveLoop();
  }

  /** The state the transport is in. */
  get currentState(): TransportState {
    return this.state;
  }

  /** True while the transport is playing or counting in. */
  get isRunning(): boolean {
    return this.state === 'playing' || this.state === 'countingIn';
  }

  /** The loop region in force, or `null` when the loop is off. */
  get currentLoop(): LoopRegion | null {
    return this.region;
  }

  /**
   * Starts playback.
   *
   * A fresh Play from a stopped state plays the count-in (G-02). A Play
   * from a paused state is a resume and does not.
   */
  play(): void {
    if (this.state === 'playing' || this.state === 'countingIn') {
      return;
    }
    if (this.state === 'paused') {
      this.resume();
      return;
    }
    this.state = this.timeline.countInTicks > 0 ? 'countingIn' : 'playing';
  }

  /**
   * Pauses playback.
   *
   * The transport resumes at the start of the beat that was interrupted, so
   * a held chord restarts cleanly rather than continuing mid-note (G-02).
   */
  pause(): void {
    if (!this.isRunning) {
      return;
    }
    this.state = 'paused';
  }

  /** Resumes a paused transport, without a count-in (G-02). */
  resume(): void {
    if (this.state !== 'paused') {
      return;
    }
    this.state = 'playing';
  }

  /**
   * Stops playback and returns to the start.
   *
   * The next Play is a fresh Play, so it plays the count-in again.
   */
  stop(): void {
    this.state = 'stopped';
  }

  /**
   * Reports that the count-in has run to its end.
   *
   * The scheduler calls this when it reaches tick 0.
   */
  finishCountIn(): void {
    if (this.state === 'countingIn') {
      this.state = 'playing';
    }
  }

  /**
   * Changes the loop mode and resolves the region it names.
   *
   * A region change during playback takes effect at the next bar boundary
   * (testing.md §4.4), which the scheduler enforces.
   */
  setLoop(
    mode: LoopMode,
    options: {
      readonly barRange?: BarRange | undefined;
      readonly sectionIndex?: number | undefined;
    } = {},
  ): void {
    this.loopMode = mode;
    this.loopBarRange = options.barRange ?? this.loopBarRange;
    this.loopSectionIndex = options.sectionIndex ?? this.loopSectionIndex;
    this.region = this.resolveLoop();
  }

  /**
   * Sets the loop region directly.
   *
   * The scheduler uses this when it applies a region change at a bar
   * boundary, where the region is already resolved.
   */
  setRegion(region: LoopRegion | null): void {
    this.region = region;
    this.loopMode = region?.mode ?? 'off';
    if (region !== null) {
      this.loopBarRange = { startBar: region.startBar, endBar: region.endBar };
    }
  }

  /** The tick the transport resumes at, aligned to the beat (G-02). */
  static resumeTickFor(tick: number): number {
    if (tick < 0) {
      return tick;
    }
    return Math.floor(tick / TICKS_PER_QUARTER) * TICKS_PER_QUARTER;
  }

  /** Resolves the current loop mode into a concrete region. */
  private resolveLoop(): LoopRegion | null {
    if (this.loopMode === 'off') {
      return null;
    }
    if (this.loopMode === 'whole') {
      return {
        mode: 'whole',
        startBar: 1,
        endBar: this.timeline.totalBars,
        startTick: 0,
        endTick: this.timeline.totalTicks,
      };
    }
    if (this.loopMode === 'barRange') {
      const range = this.loopBarRange;
      if (range === undefined) {
        return null;
      }
      return this.regionForBars(range.startBar, range.endBar, 'barRange');
    }

    const index = this.loopSectionIndex ?? 0;
    const passes = this.timeline.sections.filter((entry) => entry.sectionIndex === index);
    const first = passes[0];
    const last = passes[passes.length - 1];
    if (first === undefined || last === undefined) {
      return null;
    }
    // A section loop covers all of that section's repeats (G-07).
    return {
      mode: 'section',
      startBar: first.startBar,
      endBar: last.endBar,
      startTick: first.startTick,
      endTick: last.endTick,
    };
  }

  /** Builds the region covering a range of expanded bars (G-07). */
  private regionForBars(startBar: number, endBar: number, mode: LoopMode): LoopRegion | null {
    const startTick = this.barTicks.get(startBar);
    if (startTick === undefined) {
      return null;
    }
    const endTick = this.barTicks.get(endBar + 1) ?? this.timeline.totalTicks;
    if (endTick <= startTick) {
      return null;
    }
    return {
      mode,
      startBar,
      endBar,
      startTick,
      endTick,
    };
  }
}
