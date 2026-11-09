import { describe, expect, it } from 'vitest';

import { compileTimeline } from './compile';
import type { ClickEvent, MarkerEvent, NoteEvent, TimelineEvent } from './types';
import { barChord, halfBarChord, section, session } from '../../../tests/fixtures/sessions';

function notes(events: readonly TimelineEvent[]): readonly NoteEvent[] {
  return events.filter((event): event is NoteEvent => event.kind === 'note');
}

function clicks(events: readonly TimelineEvent[]): readonly ClickEvent[] {
  return events.filter((event): event is ClickEvent => event.kind === 'click');
}

function markers(
  events: readonly TimelineEvent[],
  kind: MarkerEvent['marker'],
): readonly MarkerEvent[] {
  return events.filter(
    (event): event is MarkerEvent => event.kind === 'marker' && event.marker === kind,
  );
}

describe('timeline compiler', () => {
  it('compiles a one-bar section into the expected length', () => {
    const timeline = compileTimeline(session([section('A', [barChord(1)])]));
    expect(timeline.totalTicks).toBe(1920);
    expect(timeline.totalBars).toBe(1);
    expect(timeline.ticksPerQuarter).toBe(480);
  });

  it('emits a chord note and a bass note for every chord slot', () => {
    const timeline = compileTimeline(
      session([section('A', [barChord(1), barChord(4), barChord(5)])]),
    );
    const chordNotes = notes(timeline.events).filter((note) => note.part === 'chords');
    const bassNotes = notes(timeline.events).filter((note) => note.part === 'bass');
    // A major triad is three notes; three chords give nine chord notes.
    expect(chordNotes).toHaveLength(9);
    expect(bassNotes).toHaveLength(3);
  });

  it('gives the bass the root of the chord, below the chord part', () => {
    const timeline = compileTimeline(session([section('A', [barChord(1)])]));
    const bass = notes(timeline.events).find((note) => note.part === 'bass');
    const chordNotes = notes(timeline.events).filter((note) => note.part === 'chords');
    if (bass === undefined) {
      throw new Error('the compiler emitted no bass note');
    }
    expect(bass.pitch % 12).toBe(0); // C
    for (const note of chordNotes) {
      expect(note.pitch).toBeGreaterThan(bass.pitch);
    }
  });

  it('gives each part its own MIDI channel', () => {
    const timeline = compileTimeline(session([section('A', [barChord(1)])]));
    expect(notes(timeline.events).find((note) => note.part === 'chords')?.channel).toBe(1);
    expect(notes(timeline.events).find((note) => note.part === 'bass')?.channel).toBe(2);
    expect(clicks(timeline.events)[0]?.channel).toBe(10);
  });

  it('ends every note exactly where the next one starts', () => {
    const timeline = compileTimeline(
      session([section('A', [barChord(1), barChord(4)])], { timeSignature: '4/4' }),
    );
    const chordNotes = notes(timeline.events).filter((note) => note.part === 'chords');
    const first = chordNotes[0];
    const last = chordNotes[chordNotes.length - 1];
    expect(first?.startTick).toBe(0);
    // Two one-bar chords: the last note ends at the end of bar two.
    expect(last?.endTick).toBe(3840);
    for (const note of chordNotes) {
      expect(note.endTick).toBeGreaterThan(note.startTick);
    }
  });

  it('compiles a sub-bar chord change on a legal split (G-06)', () => {
    const timeline = compileTimeline(session([section('A', [halfBarChord(1), halfBarChord(4)])]));
    const changes = markers(timeline.events, 'chordChange');
    expect(changes.map((marker) => marker.tick)).toEqual([0, 960]);
  });

  it('rejects a chord change that is not a legal split', () => {
    // The section fills exactly one bar, but the change lands on the third
    // eighth of the bar, which is not a legal split in 4/4.
    expect(() =>
      compileTimeline(
        session([
          section('A', [
            { degree: 1, quality: '', durationBeats: 1.5 },
            { degree: 4, quality: '', durationBeats: 2.5 },
          ]),
        ]),
      ),
    ).toThrow(/not a legal split/);
  });

  it('rejects a section that does not fill whole bars', () => {
    expect(() =>
      compileTimeline(session([section('A', [{ degree: 1, quality: '', durationBeats: 3 }])])),
    ).toThrow(/whole number of bars/);
  });

  describe('markers', () => {
    it('emits a bar marker for every bar, numbered globally from one', () => {
      const timeline = compileTimeline(
        session([section('A', [barChord(1), barChord(4)]), section('B', [barChord(5)])]),
      );
      const bars = markers(timeline.events, 'bar');
      expect(bars.map((marker) => marker.bar)).toEqual([1, 2, 3]);
      expect(bars.map((marker) => marker.tick)).toEqual([0, 1920, 3840]);
    });

    it('emits a beat marker for every click of every bar', () => {
      const timeline = compileTimeline(session([section('A', [barChord(1)])]));
      expect(markers(timeline.events, 'beat')).toHaveLength(4);
    });

    it('emits a section start marker for each section', () => {
      const timeline = compileTimeline(
        session([section('A', [barChord(1)]), section('B', [barChord(4)])]),
      );
      const starts = markers(timeline.events, 'sectionStart');
      expect(starts.map((marker) => marker.sectionName)).toEqual(['A', 'B']);
      expect(starts.map((marker) => marker.tick)).toEqual([0, 1920]);
      expect(starts.map((marker) => marker.bar)).toEqual([1, 2]);
    });

    it('emits a chord change marker for every chord slot', () => {
      const timeline = compileTimeline(session([section('A', [barChord(1), barChord(4)])]));
      const changes = markers(timeline.events, 'chordChange');
      expect(changes).toHaveLength(2);
      expect(changes[0]?.chordLabel).toBe('I');
      expect(changes[1]?.chordLabel).toBe('IV');
    });
  });

  describe('repeats and global bar numbering (G-07)', () => {
    it('unrolls a section repeat and numbers the bars continuously', () => {
      const timeline = compileTimeline(session([section('A', [barChord(1), barChord(4)], 3)]));
      expect(timeline.totalBars).toBe(6);
      expect(timeline.totalTicks).toBe(6 * 1920);
      expect(markers(timeline.events, 'bar').map((marker) => marker.bar)).toEqual([
        1, 2, 3, 4, 5, 6,
      ]);
    });

    it('numbers bars globally across sections', () => {
      const timeline = compileTimeline(
        session([section('A', [barChord(1)], 2), section('B', [barChord(4)], 2)]),
      );
      expect(timeline.totalBars).toBe(4);
      expect(timeline.sections.map((entry) => [entry.startBar, entry.endBar])).toEqual([
        [1, 1],
        [2, 2],
        [3, 3],
        [4, 4],
      ]);
    });

    it('repeats the whole arrangement on request', () => {
      const timeline = compileTimeline(session([section('A', [barChord(1)])]), {
        arrangementRepeats: 3,
      });
      expect(timeline.totalBars).toBe(3);
      expect(timeline.totalTicks).toBe(3 * 1920);
    });

    it('rejects a non-positive arrangement repeat count', () => {
      expect(() =>
        compileTimeline(session([section('A', [barChord(1)])]), { arrangementRepeats: 0 }),
      ).toThrow(/positive integer/);
    });
  });

  describe('count-in', () => {
    it('places the count-in before tick zero and excludes it from bar numbering', () => {
      const timeline = compileTimeline(session([section('A', [barChord(1)])]), {
        includeCountIn: true,
      });
      expect(timeline.countInTicks).toBe(1920);
      const countInClicks = clicks(timeline.events).filter((click) => click.countIn);
      expect(countInClicks).toHaveLength(4);
      expect(Math.min(...countInClicks.map((click) => click.startTick))).toBe(-1920);
      expect(Math.max(...countInClicks.map((click) => click.startTick))).toBe(-480);
      // The arrangement's own bars still start at bar 1, tick 0.
      expect(markers(timeline.events, 'bar')[0]?.bar).toBe(1);
      expect(markers(timeline.events, 'bar')[0]?.tick).toBe(0);
    });

    it('omits the count-in when it is switched off', () => {
      const timeline = compileTimeline(session([section('A', [barChord(1)])]), {
        includeCountIn: false,
      });
      expect(timeline.countInTicks).toBe(0);
      expect(clicks(timeline.events).filter((click) => click.countIn)).toHaveLength(0);
    });

    it('emits no count-in when the session asks for zero count-in bars', () => {
      const timeline = compileTimeline(
        session([section('A', [barChord(1)])], {
          playback: { countInBars: 0, loopMode: 'off' },
        }),
      );
      expect(clicks(timeline.events).filter((click) => click.countIn)).toHaveLength(0);
    });
  });

  describe('clicks (G-05)', () => {
    it('clicks on every quarter in 4/4 with the downbeat accented', () => {
      const timeline = compileTimeline(session([section('A', [barChord(1)])]));
      const arrangementClicks = clicks(timeline.events).filter((click) => !click.countIn);
      expect(arrangementClicks).toHaveLength(4);
      expect(arrangementClicks.map((click) => click.accent)).toEqual([
        'bar',
        'beat',
        'beat',
        'beat',
      ]);
    });

    it('clicks on the two dotted quarters in 6/8', () => {
      const timeline = compileTimeline(
        session([section('A', [{ degree: 1, quality: '', durationBeats: 3 }])], {
          timeSignature: '6/8',
        }),
      );
      const arrangementClicks = clicks(timeline.events).filter((click) => !click.countIn);
      expect(arrangementClicks.map((click) => click.startTick)).toEqual([0, 720]);
    });

    it('clicks on every eighth in 7/8', () => {
      const timeline = compileTimeline(
        session([section('A', [{ degree: 1, quality: '', durationBeats: 3.5 }])], {
          timeSignature: '7/8',
        }),
      );
      const arrangementClicks = clicks(timeline.events).filter((click) => !click.countIn);
      expect(arrangementClicks).toHaveLength(7);
      expect(arrangementClicks.map((click) => click.accent)).toEqual([
        'bar',
        'beat',
        'group',
        'beat',
        'group',
        'beat',
        'beat',
      ]);
    });

    it('omits clicks when they are switched off', () => {
      const timeline = compileTimeline(session([section('A', [barChord(1)])]), {
        includeClick: false,
      });
      expect(clicks(timeline.events)).toHaveLength(0);
    });
  });

  it('sorts events by tick', () => {
    const timeline = compileTimeline(session([section('A', [barChord(1), barChord(4)])]));
    let previous = Number.NEGATIVE_INFINITY;
    for (const event of timeline.events) {
      const tick = event.kind === 'marker' ? event.tick : event.startTick;
      expect(tick).toBeGreaterThanOrEqual(previous);
      previous = tick;
    }
  });
});
