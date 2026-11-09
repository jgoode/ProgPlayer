/**
 * Golden timeline tests (P3.3, testing.md §4.2).
 *
 * A golden timeline is the whole event list of a known arrangement, compared
 * exactly. It pins the compiler's behaviour where a regression would be
 * silent: a bar that shifts by one tick, a click that loses its accent, a
 * marker that moves to the wrong bar.
 *
 * The three arrangements are the ones the phase exit check names: a
 * single-section loop, a three-section arrangement, and a 7/8 arrangement.
 */

import { describe, expect, it } from 'vitest';

import { compileTimeline } from './compile';
import type { CompiledTimeline } from './compile';
import type { ClickEvent, MarkerEvent, NoteEvent, TimelineEvent } from './types';
import { TICKS_PER_QUARTER } from '../arrangement/meter';
import type { ChordSlot } from '../arrangement/types';
import { barChord, section, session } from '../../../tests/fixtures/sessions';

/** A compact, comparable summary of the timeline. */
interface GoldenEvent {
  readonly kind: string;
  readonly tick: number;
  readonly detail: string;
}

function summarize(timeline: CompiledTimeline): readonly GoldenEvent[] {
  return timeline.events.map((event: TimelineEvent): GoldenEvent => {
    if (event.kind === 'note') {
      return {
        kind: 'note',
        tick: event.startTick,
        detail: `${event.part}:${event.pitch}`,
      };
    }
    if (event.kind === 'click') {
      return {
        kind: 'click',
        tick: event.startTick,
        detail: `${event.accent}`,
      };
    }
    return {
      kind: 'marker',
      tick: event.tick,
      detail: `${event.marker}${event.bar === undefined ? '' : `:${event.bar}`}`,
    };
  });
}

function notes(timeline: CompiledTimeline): readonly NoteEvent[] {
  return timeline.events.filter((event): event is NoteEvent => event.kind === 'note');
}

function clicks(timeline: CompiledTimeline): readonly ClickEvent[] {
  return timeline.events.filter((event): event is ClickEvent => event.kind === 'click');
}

function markers(
  timeline: CompiledTimeline,
  marker: MarkerEvent['marker'],
): readonly MarkerEvent[] {
  return timeline.events.filter(
    (event): event is MarkerEvent => event.kind === 'marker' && event.marker === marker,
  );
}

/** A chord slot of the given duration in quarter-note beats. */
function chord(
  degree: number,
  durationBeats: number,
  quality: ChordSlot['quality'] = '',
): ChordSlot {
  return { degree, quality, durationBeats };
}

describe('golden timeline: single-section loop', () => {
  // One section, two one-bar chords (I and V), played twice, in 4/4.
  const timeline = compileTimeline(session([section('Loop', [barChord(1), barChord(5)], 2)]));

  it('lays the section out over two bars per repeat, four bars in total', () => {
    expect(timeline.totalBars).toBe(4);
    expect(timeline.totalTicks).toBe(4 * 4 * TICKS_PER_QUARTER);
  });

  it('numbers the bars globally across the repeats', () => {
    expect(markers(timeline, 'bar').map((marker) => marker.bar)).toEqual([1, 2, 3, 4]);
  });

  it('marks the start of each section pass', () => {
    expect(markers(timeline, 'sectionStart').map((marker) => marker.tick)).toEqual([
      0,
      2 * 4 * TICKS_PER_QUARTER,
    ]);
  });

  it('emits a chord change at every chord boundary', () => {
    expect(markers(timeline, 'chordChange').map((marker) => marker.tick)).toEqual([
      0,
      4 * TICKS_PER_QUARTER,
      8 * TICKS_PER_QUARTER,
      12 * TICKS_PER_QUARTER,
    ]);
  });

  it('emits one chord note group and one bass note per chord', () => {
    const chordNotes = notes(timeline).filter((note) => note.part === 'chords');
    const bassNotes = notes(timeline).filter((note) => note.part === 'bass');
    expect(chordNotes).toHaveLength(12);
    expect(bassNotes).toHaveLength(4);
  });

  it('keeps the chord note groups a bar long', () => {
    const chordNotes = notes(timeline).filter((note) => note.part === 'chords');
    for (const note of chordNotes) {
      expect(note.endTick - note.startTick).toBe(4 * TICKS_PER_QUARTER);
    }
  });

  it('places the count-in before tick 0 and leaves the arrangement at tick 0', () => {
    expect(timeline.countInTicks).toBe(4 * TICKS_PER_QUARTER);
    expect(timeline.startTick).toBe(0);
    const countInClicks = clicks(timeline).filter((click) => click.countIn);
    expect(countInClicks).toHaveLength(4);
    expect(countInClicks[0]?.startTick).toBe(-4 * TICKS_PER_QUARTER);
  });
});

describe('golden timeline: three-section arrangement', () => {
  // A verse, a chorus and a bridge, each two bars long.
  const timeline = compileTimeline(
    session([
      section('Verse', [barChord(1), barChord(4)]),
      section('Chorus', [barChord(5), barChord(1)]),
      section('Bridge', [barChord(2), barChord(5)]),
    ]),
  );

  it('lays six bars out in three two-bar sections', () => {
    expect(timeline.totalBars).toBe(6);
    expect(timeline.totalTicks).toBe(6 * 4 * TICKS_PER_QUARTER);
  });

  it('numbers the bars one to six', () => {
    expect(markers(timeline, 'bar').map((marker) => marker.bar)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('starts each section at its own bar', () => {
    expect(
      markers(timeline, 'sectionStart').map((marker) => ({
        name: marker.sectionName,
        bar: marker.bar,
      })),
    ).toEqual([
      { name: 'Verse', bar: 1 },
      { name: 'Chorus', bar: 3 },
      { name: 'Bridge', bar: 5 },
    ]);
  });

  it('keeps the sections contiguous, with no gap between them', () => {
    const starts = markers(timeline, 'sectionStart').map((marker) => marker.tick);
    expect(starts).toEqual([0, 8 * TICKS_PER_QUARTER, 16 * TICKS_PER_QUARTER]);
  });

  it('emits a chord change at each of the six chord boundaries', () => {
    expect(markers(timeline, 'chordChange')).toHaveLength(6);
  });

  it('accents the first beat of every bar, in every section', () => {
    const barClicks = clicks(timeline).filter((click) => !click.countIn && click.accent === 'bar');
    expect(barClicks).toHaveLength(6);
    expect(barClicks.map((click) => click.startTick)).toEqual([
      0,
      4 * TICKS_PER_QUARTER,
      8 * TICKS_PER_QUARTER,
      12 * TICKS_PER_QUARTER,
      16 * TICKS_PER_QUARTER,
      20 * TICKS_PER_QUARTER,
    ]);
  });
});

describe('golden timeline: 7/8 arrangement', () => {
  // 7/8 is a 2+2+3 grouping: the bar is 3.5 quarter-note beats long.
  const timeline = compileTimeline(
    session([section('Odd', [chord(1, 3.5)])], {
      timeSignature: '7/8',
      playback: { countInBars: 0, loopMode: 'off' },
    }),
  );

  it('makes a 7/8 bar three and a half quarter-note beats long', () => {
    expect(timeline.totalTicks).toBe(3.5 * TICKS_PER_QUARTER);
    expect(timeline.totalBars).toBe(1);
  });

  it('emits the OQ-5 grouping clicks: 2, 2 and 3 eighths', () => {
    const barClicks = clicks(timeline).filter((click) => !click.countIn);
    // Seven eighth-note clicks. The first is the bar's downbeat, which is
    // also the start of the first group, so it carries the stronger `bar`
    // accent; the next two group starts carry `group`, and the remaining
    // four eighths are ordinary `beat` clicks.
    expect(barClicks.map((click) => click.accent)).toEqual([
      'bar',
      'beat',
      'group',
      'beat',
      'group',
      'beat',
      'beat',
    ]);
  });

  it('places the group starts at two eighths and four eighths into the bar', () => {
    const groupStarts = clicks(timeline)
      .filter((click) => click.accent === 'group')
      .map((click) => click.startTick);
    expect(groupStarts).toEqual([TICKS_PER_QUARTER, 2 * TICKS_PER_QUARTER]);
  });

  it('marks one bar and one chord change', () => {
    expect(markers(timeline, 'bar')).toHaveLength(1);
    expect(markers(timeline, 'chordChange')).toHaveLength(1);
  });

  it('has no count-in when the session asks for none', () => {
    expect(timeline.countInTicks).toBe(0);
    expect(clicks(timeline).filter((click) => click.countIn)).toHaveLength(0);
  });
});

describe('golden timeline: event summary', () => {
  it('summarizes a simple four-bar arrangement in a stable order', () => {
    const timeline = compileTimeline(
      session([section('A', [barChord(1), barChord(5)])], {
        playback: { countInBars: 0, loopMode: 'off' },
      }),
    );

    // The exact order is the contract the scheduler relies on: events are
    // ordered by tick, and within a tick the markers come first (bar,
    // section start, chord change, beat), then the notes, then the click.
    const summary = summarize(timeline);
    expect(summary.slice(0, 9)).toEqual([
      { kind: 'marker', tick: 0, detail: 'bar:1' },
      { kind: 'marker', tick: 0, detail: 'sectionStart:1' },
      { kind: 'marker', tick: 0, detail: 'chordChange' },
      { kind: 'marker', tick: 0, detail: 'beat:1' },
      { kind: 'note', tick: 0, detail: 'chords:48' },
      { kind: 'note', tick: 0, detail: 'chords:52' },
      { kind: 'note', tick: 0, detail: 'chords:55' },
      { kind: 'note', tick: 0, detail: 'bass:36' },
      { kind: 'click', tick: 0, detail: 'bar' },
    ]);
  });
});
