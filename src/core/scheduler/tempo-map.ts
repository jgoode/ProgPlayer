/**
 * Tempo map (P4.1, FR-TMP-1, FR-TMP-2, implementation.md §2.4).
 *
 * A tempo map converts between tick positions and times. It is a list of
 * anchors: each anchor names a tick, the time that tick occurs at, and the
 * tempo in force from that tick onwards.
 *
 * The map is immutable once built. A live tempo change creates a new map
 * with an extra anchor at the next beat boundary, so the times of the
 * events that were already scheduled are unaffected (FR-TMP-2).
 */

import { TICKS_PER_QUARTER } from '../arrangement/meter';

/** One anchor of the tempo map. */
export interface TempoAnchor {
  /** The tick this anchor is valid from. */
  readonly tick: number;
  /** The time, in seconds, at which this anchor's tick occurs. */
  readonly time: number;
  /** The tempo from this tick onwards, in beats per minute. */
  readonly bpm: number;
}

/** The tempo limits accepted by the app (FR-TMP-1, OQ-4). */
export const MIN_TEMPO_BPM = 30;
export const MAX_TEMPO_BPM = 300;

/** Throws when the tempo is outside the supported range. */
export function assertTempoInRange(bpm: number): void {
  if (!Number.isFinite(bpm) || bpm < MIN_TEMPO_BPM || bpm > MAX_TEMPO_BPM) {
    throw new RangeError(
      `Tempo must be between ${MIN_TEMPO_BPM} and ${MAX_TEMPO_BPM} BPM, got ${String(bpm)}`,
    );
  }
}

/**
 * A tempo map: an ordered list of anchors.
 *
 * The map is built through `TempoMapBuilder` and is immutable afterwards, so
 * a scheduled event's time can never change under it.
 */
export class TempoMap {
  private readonly anchorList: readonly TempoAnchor[];

  constructor(anchors: readonly TempoAnchor[]) {
    if (anchors.length === 0) {
      throw new RangeError('A tempo map needs at least one anchor');
    }
    for (let index = 1; index < anchors.length; index += 1) {
      const previous = anchors[index - 1] as TempoAnchor;
      const anchor = anchors[index] as TempoAnchor;
      if (anchor.tick <= previous.tick) {
        throw new RangeError(
          `Tempo map anchors must increase in tick order: ${String(previous.tick)} then ${String(anchor.tick)}`,
        );
      }
      if (anchor.time <= previous.time) {
        throw new RangeError(
          `Tempo map anchors must increase in time order: ${String(previous.time)} then ${String(anchor.time)}`,
        );
      }
    }
    this.anchorList = anchors;
  }

  /** The anchors of the map, in order. */
  get anchors(): readonly TempoAnchor[] {
    return this.anchorList;
  }

  /** The tempo in force at the start of the map. */
  get initialBpm(): number {
    return (this.anchorList[0] as TempoAnchor).bpm;
  }

  /**
   * The tempo in force at a tick.
   *
   * Ticks before the first anchor use the first anchor's tempo.
   */
  bpmAtTick(tick: number): number {
    return this.anchorAtOrBefore(tick).bpm;
  }

  /**
   * The time, in seconds, at which a tick occurs.
   *
   * Ticks before the first anchor are extrapolated backwards at the first
   * anchor's tempo, which is what the count-in needs.
   */
  timeAtTick(tick: number): number {
    const anchor = this.anchorAtOrBefore(tick);
    const secondsPerQuarter = 60 / anchor.bpm;
    return anchor.time + ((tick - anchor.tick) / TICKS_PER_QUARTER) * secondsPerQuarter;
  }

  /**
   * The tick that occurs at a time, in seconds.
   *
   * The inverse of `timeAtTick`, used to turn the audio clock back into a
   * musical position.
   */
  tickAtTime(time: number): number {
    const anchor = this.anchorAtOrBeforeTime(time);
    const secondsPerQuarter = 60 / anchor.bpm;
    return anchor.tick + ((time - anchor.time) / secondsPerQuarter) * TICKS_PER_QUARTER;
  }

  /**
   * The number of seconds between two ticks.
   *
   * The anchor times are the continuity points of the map, so the difference
   * of the two tick times is exact: a tempo change never introduces a jump
   * and the count-in (negative ticks) is handled by the same rule.
   */
  secondsBetween(fromTick: number, toTick: number): number {
    return this.timeAtTick(toTick) - this.timeAtTick(fromTick);
  }

  /** The last anchor whose tick is at or before `tick`. */
  private anchorAtOrBefore(tick: number): TempoAnchor {
    let found = this.anchorList[0] as TempoAnchor;
    for (const anchor of this.anchorList) {
      if (anchor.tick > tick) {
        break;
      }
      found = anchor;
    }
    return found;
  }

  /** The last anchor whose time is at or before `time`. */
  private anchorAtOrBeforeTime(time: number): TempoAnchor {
    let found = this.anchorList[0] as TempoAnchor;
    for (const anchor of this.anchorList) {
      if (anchor.time > time) {
        break;
      }
      found = anchor;
    }
    return found;
  }
}

/**
 * Builds a tempo map.
 *
 * The builder keeps the map anchored at tick 0 and time 0 unless another
 * origin is given, and it is the only way to add a live tempo change.
 */
export class TempoMapBuilder {
  private readonly anchors: TempoAnchor[] = [];

  constructor(origin?: { readonly tick: number; readonly time: number }) {
    const tick = origin?.tick ?? 0;
    const time = origin?.time ?? 0;
    this.anchors.push({ tick, time, bpm: 120 });
  }

  /** Sets the tempo in force at the start of the map. */
  withInitialTempo(bpm: number): this {
    assertTempoInRange(bpm);
    const first = this.anchors[0] as TempoAnchor;
    this.anchors[0] = { ...first, bpm };
    return this;
  }

  /**
   * Adds a tempo change.
   *
   * The anchor's tick must be at or after the previous anchor's tick; an
   * anchor at the same tick replaces the previous one, which is what happens
   * when the tempo changes twice before the next beat.
   */
  withChange(tick: number, bpm: number): this {
    assertTempoInRange(bpm);
    const previous = this.anchors[this.anchors.length - 1] as TempoAnchor;
    if (tick < previous.tick) {
      throw new RangeError(
        `A tempo change must be anchored at or after the previous anchor: ${String(tick)} is before ${String(previous.tick)}`,
      );
    }
    const time = this.timeAtTick(tick);
    if (tick === previous.tick) {
      this.anchors[this.anchors.length - 1] = { tick, time, bpm };
      return this;
    }
    this.anchors.push({ tick, time, bpm });
    return this;
  }

  /** The time, in seconds, of a tick under the anchors collected so far. */
  timeAtTick(tick: number): number {
    let anchor = this.anchors[0] as TempoAnchor;
    for (const candidate of this.anchors) {
      if (candidate.tick > tick) {
        break;
      }
      anchor = candidate;
    }
    const secondsPerQuarter = 60 / anchor.bpm;
    return anchor.time + ((tick - anchor.tick) / TICKS_PER_QUARTER) * secondsPerQuarter;
  }

  /** Builds the immutable map. */
  build(): TempoMap {
    return new TempoMap(this.anchors.map((anchor) => ({ ...anchor })));
  }
}

/**
 * The tick of the next beat boundary at or after `tick`.
 *
 * A live tempo change takes effect at the next beat (FR-TMP-2), so this is
 * the anchor tick the transport uses.
 */
export function nextBeatTick(tick: number, ticksPerQuarter = TICKS_PER_QUARTER): number {
  return Math.ceil(tick / ticksPerQuarter) * ticksPerQuarter;
}
