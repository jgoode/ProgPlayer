/**
 * Playback plan (P4.2, P4.5, implementation.md §2.3).
 *
 * The compiled timeline holds sustained notes: one event with a start and an
 * end tick. The sinks want discrete events, so the plan splits the notes
 * into a note-on and a note-off and orders everything by tick.
 *
 * A plan covers one *region* of the arrangement. The first region covers the
 * count-in and the arrangement up to the loop boundary; every later region
 * covers the loop region alone. Splitting the plan at the loop boundary is
 * what makes the loop join seamless: the events before the boundary are
 * emitted once, and the region is replayed from its start afterwards.
 */

import type { CompiledTimeline } from '../compiler/compile';
import type { MarkerEvent } from '../compiler/types';

import type { EventPayload } from './sinks';

/** The order events at the same tick are emitted in. */
const ORDER_NOTE_OFF = 0;
const ORDER_NOTE_ON = 1;
const ORDER_CLICK = 2;

/** One planned event, with the tick it belongs to. */
export interface PlannedEvent {
  /** The tick the event happens at. */
  readonly tick: number;
  /** The order within the tick. */
  readonly order: number;
  /** The event to hand to the sinks. */
  readonly payload: EventPayload;
  /** True when the event belongs to the count-in (FR-PLY-5). */
  readonly countIn: boolean;
}

/**
 * Builds the plan for a range of ticks.
 *
 * `startTick` is inclusive and `endTick` is exclusive. A note that starts
 * inside the range but ends after it is cut short at `endTick`, so no note
 * hangs over the loop boundary.
 */
export function buildPlaybackPlan(
  timeline: CompiledTimeline,
  startTick: number,
  endTick: number,
): readonly PlannedEvent[] {
  const planned: PlannedEvent[] = [];

  for (const event of timeline.events) {
    if (event.kind === 'note') {
      const note = event;
      if (note.startTick < startTick || note.startTick >= endTick) {
        continue;
      }
      const noteEnd = Math.min(note.endTick, endTick);
      planned.push({
        tick: note.startTick,
        order: ORDER_NOTE_ON,
        countIn: false,
        payload: {
          kind: 'noteOn',
          part: note.part,
          channel: note.channel,
          pitch: note.pitch,
          velocity: note.velocity,
        },
      });
      planned.push({
        tick: noteEnd,
        order: ORDER_NOTE_OFF,
        countIn: false,
        payload: {
          kind: 'noteOff',
          part: note.part,
          channel: note.channel,
          pitch: note.pitch,
        },
      });
      continue;
    }

    if (event.kind === 'click') {
      const click = event;
      if (click.startTick < startTick || click.startTick >= endTick) {
        continue;
      }
      planned.push({
        tick: click.startTick,
        order: ORDER_CLICK,
        countIn: click.countIn,
        payload: {
          kind: 'click',
          channel: click.channel,
          pitch: click.pitch,
          velocity: click.velocity,
          accent: click.accent,
          countIn: click.countIn,
        },
      });
    }
  }

  planned.sort((left, right) => left.tick - right.tick || left.order - right.order);
  return planned;
}

/** The markers of a timeline, ordered by tick. */
export function collectMarkers(timeline: CompiledTimeline): readonly MarkerEvent[] {
  return timeline.events.filter((event): event is MarkerEvent => event.kind === 'marker');
}

/**
 * The bar and beat at a tick.
 *
 * The bar number is the global expanded-bar number (G-07), so it keeps
 * counting across the loop wrap even though the tick goes back.
 */
export function positionAtTick(
  markers: readonly MarkerEvent[],
  tick: number,
): { readonly bar: number | null; readonly beat: number | null } {
  let bar: number | null = null;
  let beat: number | null = null;

  for (const marker of markers) {
    if (marker.tick > tick) {
      break;
    }
    if (marker.marker === 'bar') {
      bar = marker.bar ?? bar;
      beat = null;
    } else if (marker.marker === 'beat') {
      beat = marker.beat ?? beat;
    }
  }

  return { bar, beat };
}
