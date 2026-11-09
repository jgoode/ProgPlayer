/**
 * Timeline types (implementation.md §2.3, D2).
 *
 * The timeline is the single artefact every output reads: the synth, MIDI
 * out, MIDI export and audio export all consume the events compiled here.
 * It is a tick-based event list at 480 ticks per quarter note.
 */

/** The parts of the arrangement that sound independently. */
export const TIMELINE_PARTS = ['chords', 'bass', 'click'] as const;
export type TimelinePart = (typeof TIMELINE_PARTS)[number];

/** Marker kinds emitted by the compiler. */
export const MARKER_KINDS = ['bar', 'beat', 'chordChange', 'sectionStart'] as const;
export type MarkerKind = (typeof MARKER_KINDS)[number];

/** A note event on the chords or bass part. */
export interface NoteEvent {
  readonly kind: 'note';
  readonly part: 'chords' | 'bass';
  /** MIDI channel, 1..16 (FR-SND-5). */
  readonly channel: number;
  /** MIDI note number, 0..127. */
  readonly pitch: number;
  /** MIDI velocity, 1..127. */
  readonly velocity: number;
  readonly startTick: number;
  readonly endTick: number;
}

/** A metronome click. */
export interface ClickEvent {
  readonly kind: 'click';
  readonly channel: number;
  readonly pitch: number;
  readonly velocity: number;
  /** Accent strength: the downbeat is stronger than a group start (G-05). */
  readonly accent: 'bar' | 'group' | 'beat';
  readonly startTick: number;
  readonly endTick: number;
  /** True when the click belongs to the count-in rather than the arrangement. */
  readonly countIn: boolean;
}

/** A positional marker. */
export interface MarkerEvent {
  readonly kind: 'marker';
  readonly marker: MarkerKind;
  readonly tick: number;
  /** Global bar number, 1-based over the expanded arrangement (G-07). */
  readonly bar?: number | undefined;
  /** Beat number inside the bar, 1-based. */
  readonly beat?: number | undefined;
  /** Index of the section the marker belongs to. */
  readonly sectionIndex?: number | undefined;
  /** Name of the section, for `sectionStart` markers. */
  readonly sectionName?: string | undefined;
  /** The chord at the marker, for `chordChange` markers. */
  readonly chordLabel?: string | undefined;
}

/** Any timeline event. */
export type TimelineEvent = NoteEvent | ClickEvent | MarkerEvent;

/** The compiled arrangement. */
export interface Timeline {
  readonly events: readonly TimelineEvent[];
  /** Ticks per quarter note. */
  readonly ticksPerQuarter: number;
  /** Length of the arrangement in ticks, excluding the count-in. */
  readonly totalTicks: number;
  /** Length of the count-in in ticks; the count-in sits before tick 0. */
  readonly countInTicks: number;
  /** The first tick of the arrangement (0 when there is a count-in). */
  readonly startTick: number;
  /** Total number of bars in the expanded arrangement (G-07). */
  readonly totalBars: number;
  /** Tempo in beats per minute, as written for the session. */
  readonly tempoBpm: number;
  /** The session's time signature. */
  readonly timeSignature: string;
}

/** True when the event is a note or click (that is, it has a duration). */
export function isTimedEvent(event: TimelineEvent): event is NoteEvent | ClickEvent {
  return event.kind === 'note' || event.kind === 'click';
}
