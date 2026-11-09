/**
 * Timeline compiler (P3.3, implementation.md §2.3, D2).
 *
 * Compiles a session into one tick-based event timeline at 480 ticks per
 * quarter note. The same timeline drives the synth, MIDI out, MIDI export and
 * audio export, so all outputs agree by construction.
 *
 * The compiler resolves each chord slot to a concrete chord (FR-KEY-3), voices
 * it (FR-PLY-2, FR-PLY-3), unrolls the section repeats and numbers the bars
 * globally over the expanded arrangement (G-07).
 */

import { resolveDegreeChord } from '../theory/degree';
import type { DegreeChord } from '../theory/types';
import { selectBassNote, voiceChord } from '../theory/voicing';
import type { ChordSlot, Section, Session } from '../arrangement/types';
import {
  barClicks,
  beatsToTicks,
  chordChangePositions,
  getMeter,
  groupingFor,
  TICKS_PER_QUARTER,
} from '../arrangement/meter';
import type { Meter, MeterGrouping } from '../arrangement/meter';
import { sectionBars } from '../arrangement/validation';
import type { ClickEvent, MarkerEvent, MarkerKind, Timeline, TimelineEvent } from './types';

/** Options for compiling a session into a timeline. */
export interface CompileOptions {
  /** Emit click events (FR-PLY-4). Defaults to true. */
  readonly includeClick?: boolean | undefined;
  /** Emit the count-in region (FR-PLY-5). Defaults to true. */
  readonly includeCountIn?: boolean | undefined;
  /** How many times the whole arrangement is repeated. Defaults to 1. */
  readonly arrangementRepeats?: number | undefined;
  /** Velocity of the chord part. Defaults to 80. */
  readonly chordVelocity?: number | undefined;
  /** Velocity of the bass part. Defaults to 90. */
  readonly bassVelocity?: number | undefined;
  /** Velocity of an ordinary click. Defaults to 100. */
  readonly clickVelocity?: number | undefined;
  /** Velocity of an accented click. Defaults to 115. */
  readonly accentVelocity?: number | undefined;
}

/** One expanded pass of a section: a section played once. */
export interface ExpandedSection {
  /** Index of the section in the session. */
  readonly sectionIndex: number;
  /** Which repetition of the section this is, 1-based. */
  readonly repeatIndex: number;
  readonly name: string;
  /** First global bar of the pass, 1-based. */
  readonly startBar: number;
  /** Last global bar of the pass, inclusive. */
  readonly endBar: number;
  /** Tick the pass starts at, relative to the arrangement start. */
  readonly startTick: number;
  /** Tick the pass ends at, exclusive. */
  readonly endTick: number;
}

/** The compiled arrangement, with the metadata the scheduler and the UI need. */
export interface CompiledTimeline extends Timeline {
  /** The expanded passes, in playback order (repeats unrolled). */
  readonly sections: readonly ExpandedSection[];
}

/** A compilation error with a precise message. */
export class TimelineCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimelineCompileError';
  }
}

const DEFAULT_CHORD_VELOCITY = 80;
const DEFAULT_BASS_VELOCITY = 90;
const DEFAULT_CLICK_VELOCITY = 100;
const DEFAULT_ACCENT_VELOCITY = 115;

/** The GM percussion note used for the click (requirements §10, assumption 3). */
export const CLICK_PITCH = 37;

/** The duration of a click, in ticks. Short, but long enough to be seen. */
const CLICK_DURATION_TICKS = 60;

/**
 * Compiles a session into a timeline.
 *
 * Throws a `TimelineCompileError` when the arrangement cannot be compiled,
 * for example when a chord change falls outside the legal splits of the
 * meter (G-06) or a section does not fill whole bars.
 */
export function compileTimeline(session: Session, options: CompileOptions = {}): CompiledTimeline {
  const includeClick = options.includeClick ?? true;
  const includeCountIn = options.includeCountIn ?? true;
  const arrangementRepeats = options.arrangementRepeats ?? 1;
  const chordVelocity = options.chordVelocity ?? DEFAULT_CHORD_VELOCITY;
  const bassVelocity = options.bassVelocity ?? DEFAULT_BASS_VELOCITY;
  const clickVelocity = options.clickVelocity ?? DEFAULT_CLICK_VELOCITY;
  const accentVelocity = options.accentVelocity ?? DEFAULT_ACCENT_VELOCITY;

  if (!Number.isInteger(arrangementRepeats) || arrangementRepeats < 1) {
    throw new TimelineCompileError(
      `arrangementRepeats must be a positive integer, got ${String(arrangementRepeats)}`,
    );
  }

  const meter = getMeter(session.timeSignature);
  const grouping = groupingFor(meter, session.beatGrouping);
  const legalPositions = chordChangePositions(meter, grouping);

  const events: TimelineEvent[] = [];
  const expanded: ExpandedSection[] = [];
  let arrangementTick = 0;
  let globalBar = 1;
  let previousVoicing: readonly number[] = [];

  for (let arrangementRepeat = 0; arrangementRepeat < arrangementRepeats; arrangementRepeat += 1) {
    for (let sectionIndex = 0; sectionIndex < session.sections.length; sectionIndex += 1) {
      const section = session.sections[sectionIndex] as Section;
      const bars = sectionBars(section, session.timeSignature);
      if (!Number.isInteger(bars) || bars < 1) {
        throw new TimelineCompileError(
          `Section "${section.name}" lasts ${bars} bars of ${session.timeSignature}; ` +
            'a section must fill a whole number of bars',
        );
      }

      // A section's own repeats are unrolled here: each pass is a separate
      // entry in the expanded section list and gets its own global bar
      // numbers (G-07).
      for (let sectionRepeat = 0; sectionRepeat < section.repeatCount; sectionRepeat += 1) {
        const startTick = arrangementTick;
        const startBar = globalBar;

        for (const slot of section.progression.chords) {
          const durationTicks = beatsToTicks(slot.durationBeats);
          const tickInBar = arrangementTick % meter.ticksPerBar;
          if (!legalPositions.includes(tickInBar)) {
            throw new TimelineCompileError(
              `Section "${section.name}" changes chord at tick ${tickInBar} of the bar, ` +
                `which is not a legal split in ${session.timeSignature} ` +
                `(legal splits: ${legalPositions.join(', ')})`,
            );
          }

          const degreeChord: DegreeChord =
            slot.alteration === undefined
              ? { degree: slot.degree, quality: slot.quality }
              : { degree: slot.degree, alteration: slot.alteration, quality: slot.quality };
          const resolved = resolveDegreeChord(session.key.tonic, degreeChord);
          const voicing = voiceChord(resolved.chord, previousVoicing);
          previousVoicing = voicing.notes;

          const chordChannel = session.mix.chords.channel;
          const bassChannel = session.mix.bass.channel;
          for (const pitch of voicing.notes) {
            events.push({
              kind: 'note',
              part: 'chords',
              channel: chordChannel,
              pitch,
              velocity: chordVelocity,
              startTick: arrangementTick,
              endTick: arrangementTick + durationTicks,
            });
          }
          events.push({
            kind: 'note',
            part: 'bass',
            channel: bassChannel,
            pitch: selectBassNote(resolved.chord),
            velocity: bassVelocity,
            startTick: arrangementTick,
            endTick: arrangementTick + durationTicks,
          });

          events.push({
            kind: 'marker',
            marker: 'chordChange',
            tick: arrangementTick,
            sectionIndex,
            chordLabel: formatChordLabel(slot),
          });

          arrangementTick += durationTicks;
        }

        const endTick = arrangementTick;
        const endBar = globalBar + bars - 1;
        expanded.push({
          sectionIndex,
          repeatIndex: sectionRepeat + 1,
          name: section.name,
          startBar,
          endBar,
          startTick,
          endTick,
        });

        events.push({
          kind: 'marker',
          marker: 'sectionStart',
          tick: startTick,
          bar: startBar,
          sectionIndex,
          sectionName: section.name,
        });

        globalBar = endBar + 1;
      }
    }
  }

  const totalTicks = arrangementTick;
  const totalBars = globalBar - 1;

  events.push(...barAndBeatMarkers(totalTicks, meter, grouping));

  if (includeClick) {
    events.push(
      ...clickEvents(
        session,
        meter,
        grouping,
        totalTicks,
        includeCountIn,
        clickVelocity,
        accentVelocity,
      ),
    );
  }

  events.sort(compareEvents);

  const countInTicks = includeCountIn ? session.playback.countInBars * meter.ticksPerBar : 0;

  return {
    events,
    ticksPerQuarter: TICKS_PER_QUARTER,
    totalTicks,
    countInTicks,
    startTick: 0,
    totalBars,
    tempoBpm: session.tempoBpm,
    timeSignature: session.timeSignature,
    sections: expanded,
  };
}

/** Formats a chord slot as a readable label, e.g. `♭VII7`. */
function formatChordLabel(slot: ChordSlot): string {
  const alteration = slot.alteration ?? 0;
  const prefix =
    alteration === 0 ? '' : alteration > 0 ? '♯'.repeat(alteration) : '♭'.repeat(-alteration);
  const numerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  const numeral = numerals[slot.degree - 1] ?? '?';
  return `${prefix}${numeral}${slot.quality}`;
}

/** The bar and beat markers for the arrangement. */
function barAndBeatMarkers(
  totalTicks: number,
  meter: Meter,
  grouping: MeterGrouping,
): readonly MarkerEvent[] {
  const markers: MarkerEvent[] = [];
  const bars = totalTicks / meter.ticksPerBar;
  const clicks = barClicks(meter, grouping);
  for (let bar = 0; bar < bars; bar += 1) {
    const barTick = bar * meter.ticksPerBar;
    markers.push({ kind: 'marker', marker: 'bar', tick: barTick, bar: bar + 1 });
    for (let beat = 0; beat < clicks.length; beat += 1) {
      markers.push({
        kind: 'marker',
        marker: 'beat',
        tick: barTick + (clicks[beat] as { tickInBar: number }).tickInBar,
        bar: bar + 1,
        beat: beat + 1,
      });
    }
  }
  return markers;
}

/** The click events for the arrangement and the count-in. */
function clickEvents(
  session: Session,
  meter: Meter,
  grouping: MeterGrouping,
  totalTicks: number,
  includeCountIn: boolean,
  clickVelocity: number,
  accentVelocity: number,
): readonly ClickEvent[] {
  const clicks: ClickEvent[] = [];
  const channel = session.mix.click.channel;
  const pattern = barClicks(meter, grouping);
  const bars = totalTicks / meter.ticksPerBar;

  for (let bar = 0; bar < bars; bar += 1) {
    const barTick = bar * meter.ticksPerBar;
    for (const click of pattern) {
      clicks.push({
        kind: 'click',
        channel,
        pitch: CLICK_PITCH,
        velocity: click.accent === 'beat' ? clickVelocity : accentVelocity,
        accent: click.accent,
        startTick: barTick + click.tickInBar,
        endTick: barTick + click.tickInBar + CLICK_DURATION_TICKS,
        countIn: false,
      });
    }
  }

  if (includeCountIn && session.playback.countInBars > 0) {
    const countInBars = session.playback.countInBars;
    for (let bar = 0; bar < countInBars; bar += 1) {
      // The count-in sits before tick 0 and is not part of the arrangement.
      const barTick = -(countInBars - bar) * meter.ticksPerBar;
      for (const click of pattern) {
        clicks.push({
          kind: 'click',
          channel,
          pitch: CLICK_PITCH,
          velocity: click.accent === 'beat' ? clickVelocity : accentVelocity,
          accent: click.accent,
          startTick: barTick + click.tickInBar,
          endTick: barTick + click.tickInBar + CLICK_DURATION_TICKS,
          countIn: true,
        });
      }
    }
  }

  return clicks;
}

/**
 * Orders events by tick.
 *
 * Within a tick the order is fixed so the timeline is deterministic: markers
 * first, then notes, then clicks. The marker order is the order in which the
 * events describe the moment: the bar starts, then the section starts, then
 * the chord changes, then the beat within the bar.
 */
function compareEvents(left: TimelineEvent, right: TimelineEvent): number {
  const leftTick = eventTick(left);
  const rightTick = eventTick(right);
  if (leftTick !== rightTick) {
    return leftTick - rightTick;
  }
  return eventRank(left) - eventRank(right);
}

/** The tick an event happens at, whichever kind it is. */
export function eventTick(event: TimelineEvent): number {
  return event.kind === 'marker' ? event.tick : event.startTick;
}

/**
 * The rank of a marker within one tick.
 *
 * The order is explicit rather than inherited from the order the markers
 * happen to be built in, so that reordering the compiler's internals cannot
 * silently change the timeline's shape.
 */
const MARKER_RANK: ReadonlyMap<MarkerKind, number> = new Map<MarkerKind, number>([
  ['bar', 0],
  ['sectionStart', 1],
  ['chordChange', 2],
  ['beat', 3],
]);

/** The sort rank of an event kind within one tick. */
function eventRank(event: TimelineEvent): number {
  switch (event.kind) {
    case 'marker':
      return MARKER_RANK.get(event.marker) ?? 0;
    case 'note':
      return 10;
    case 'click':
      return 20;
  }
}
