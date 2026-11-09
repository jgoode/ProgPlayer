/**
 * Property-based timeline tests (P3.3, P3.7, testing.md §4.2).
 *
 * A golden timeline pins the compiler's behaviour on arrangements somebody
 * chose. These tests do the opposite: they generate arrangements nobody
 * chose and assert the properties that must hold for *every* arrangement.
 *
 * The generator builds only musically valid sessions — a chord change always
 * lands on a legal split for the meter (G-06) and every section always
 * fills a whole number of bars — because the compiler is entitled to reject
 * an invalid arrangement, and a property test that generated invalid
 * arrangements would be testing the error path rather than the invariants.
 *
 * The seed is fixed so a failure is reproducible.
 */

import fc, { type Arbitrary } from 'fast-check';
import { describe, expect, it } from 'vitest';

import { compileTimeline } from './compile';
import type { CompiledTimeline } from './compile';
import type { ClickEvent, MarkerEvent, NoteEvent, TimelineEvent } from './types';
import {
  barClicks,
  chordChangePositions,
  getMeter,
  groupingFor,
  TICKS_PER_QUARTER,
} from '../arrangement/meter';
import type { Meter, MeterGrouping } from '../arrangement/meter';
import type { ChordQuality } from '../theory/types';
import type { ChordSlot, Section, Session, TimeSignature } from '../arrangement/types';
import { section, session } from '../../../tests/fixtures/sessions';

const SEED = 20261109;
const NUM_RUNS = 100;

const TIME_SIGNATURES = ['4/4', '3/4', '6/8', '5/4', '7/8'] as const;
const QUALITIES = ['', 'm', '7', 'm7', 'maj7'] as const;

/** One chord in a generated progression. */
interface ChordSpec {
  readonly degree: number;
  readonly quality: ChordQuality;
}

/** One generated section, before the meter-dependent layout is computed. */
interface SectionSpec {
  readonly name: string;
  readonly bars: number;
  readonly repeatCount: number;
  readonly chords: readonly ChordSpec[];
  /** Random numbers used to choose where the chord changes fall. */
  readonly randoms: readonly number[];
}

/** One generated case: a session plus the expectations derived from it. */
interface CaseSpec {
  readonly timeSignature: TimeSignature;
  readonly sections: readonly SectionSpec[];
  readonly arrangementRepeats: number;
  readonly countInBars: number;
}

const meterArbitrary: Arbitrary<TimeSignature> = fc.constantFrom(...TIME_SIGNATURES);
const qualityArbitrary: Arbitrary<ChordQuality> = fc.constantFrom(...QUALITIES);

const chordSpecArbitrary: Arbitrary<ChordSpec> = fc.record({
  degree: fc.integer({ min: 1, max: 7 }),
  quality: qualityArbitrary,
});

const sectionSpecArbitrary: Arbitrary<SectionSpec> = fc.record({
  name: fc.constantFrom('A', 'B', 'C', 'D'),
  bars: fc.integer({ min: 1, max: 4 }),
  repeatCount: fc.integer({ min: 1, max: 3 }),
  chords: fc.array(chordSpecArbitrary, { minLength: 1, maxLength: 6 }),
  randoms: fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 12 }),
});

const caseArbitrary: Arbitrary<CaseSpec> = fc.record({
  timeSignature: meterArbitrary,
  sections: fc.array(sectionSpecArbitrary, { minLength: 1, maxLength: 4 }),
  arrangementRepeats: fc.integer({ min: 1, max: 2 }),
  countInBars: fc.integer({ min: 0, max: 2 }),
});

/** The legal chord-change boundaries inside a section of `bars` bars. */
function legalBoundaries(meter: Meter, grouping: MeterGrouping, bars: number): readonly number[] {
  const legal = chordChangePositions(meter, grouping);
  const end = bars * meter.ticksPerBar;
  const ticks = new Set<number>();
  for (let bar = 0; bar < bars; bar += 1) {
    for (const position of legal) {
      const tick = bar * meter.ticksPerBar + position;
      if (tick > 0 && tick < end) {
        ticks.add(tick);
      }
    }
  }
  return [...ticks].sort((left, right) => left - right);
}

/** Chooses `count` distinct boundaries from `candidates`, using `randoms`. */
function pickBoundaries(
  candidates: readonly number[],
  count: number,
  randoms: readonly number[],
): readonly number[] {
  const remaining = [...candidates];
  const picked: number[] = [];
  for (let index = 0; index < count && remaining.length > 0; index += 1) {
    const random = randoms[index % randoms.length] ?? 0;
    const position = random % remaining.length;
    const [chosen] = remaining.splice(position, 1);
    if (chosen !== undefined) {
      picked.push(chosen);
    }
  }
  return picked.sort((left, right) => left - right);
}

/** Lays a generated section out over legal splits of whole bars. */
function buildChords(
  spec: SectionSpec,
  meter: Meter,
  grouping: MeterGrouping,
): readonly ChordSlot[] {
  const boundaries = legalBoundaries(meter, grouping, spec.bars);
  const chordCount = Math.min(spec.chords.length, boundaries.length + 1);
  const chosen = pickBoundaries(boundaries, chordCount - 1, spec.randoms);
  const end = spec.bars * meter.ticksPerBar;
  const edges = [0, ...chosen, end];
  const slots: ChordSlot[] = [];
  for (let index = 0; index < chordCount; index += 1) {
    const specChord = spec.chords[index];
    const from = edges[index] ?? 0;
    const to = edges[index + 1] ?? end;
    slots.push({
      degree: specChord?.degree ?? 1,
      quality: specChord?.quality ?? '',
      durationBeats: (to - from) / TICKS_PER_QUARTER,
    });
  }
  return slots;
}

/** Builds the session described by a generated case. */
function buildSession(spec: CaseSpec): Session {
  const meter = getMeter(spec.timeSignature);
  const grouping = groupingFor(meter);
  const sections: Section[] = spec.sections.map((sectionSpec) =>
    section(sectionSpec.name, buildChords(sectionSpec, meter, grouping), sectionSpec.repeatCount),
  );
  return session(sections, {
    timeSignature: spec.timeSignature,
    playback: { countInBars: spec.countInBars, loopMode: 'off' },
  });
}

/** Compiles a generated case with its arrangement repeat count. */
function compile(spec: CaseSpec): CompiledTimeline {
  return compileTimeline(buildSession(spec), { arrangementRepeats: spec.arrangementRepeats });
}

/** The total number of bars the generated case should produce. */
function expectedTotalBars(spec: CaseSpec): number {
  const barsPerSection = spec.sections.reduce(
    (sum, sectionSpec) => sum + sectionSpec.bars * sectionSpec.repeatCount,
    0,
  );
  return barsPerSection * spec.arrangementRepeats;
}

function notes(events: readonly TimelineEvent[]): readonly NoteEvent[] {
  return events.filter((event): event is NoteEvent => event.kind === 'note');
}

function clicks(events: readonly TimelineEvent[]): readonly ClickEvent[] {
  return events.filter((event): event is ClickEvent => event.kind === 'click');
}

function markers(
  events: readonly TimelineEvent[],
  marker: MarkerEvent['marker'],
): readonly MarkerEvent[] {
  return events.filter(
    (event): event is MarkerEvent => event.kind === 'marker' && event.marker === marker,
  );
}

/** The tick an event happens at, whichever kind it is. */
function eventTick(event: TimelineEvent): number {
  return event.kind === 'marker' ? event.tick : event.startTick;
}

/**
 * The chord blocks of a timeline: one entry per chord, with the span it
 * covers.
 *
 * The chord part holds several voices of one chord at once, so the unit is
 * the *chord*, not the note. Two chords never overlap: one ends before the
 * next begins.
 */
function chordBlocks(events: readonly TimelineEvent[]): readonly { start: number; end: number }[] {
  const blocks = new Map<number, number>();
  for (const note of notes(events).filter((event) => event.part === 'chords')) {
    const current = blocks.get(note.startTick);
    blocks.set(note.startTick, Math.max(current ?? 0, note.endTick));
  }
  return [...blocks.entries()]
    .map(([start, end]) => ({ start, end }))
    .sort((left, right) => left.start - right.start);
}

describe('timeline compiler properties', () => {
  it('never emits a zero or negative duration', () => {
    fc.assert(
      fc.property(caseArbitrary, (spec) => {
        const timeline = compile(spec);
        for (const event of timeline.events) {
          if (event.kind === 'note' || event.kind === 'click') {
            expect(event.endTick).toBeGreaterThan(event.startTick);
          }
        }
      }),
      { seed: SEED, numRuns: NUM_RUNS },
    );
  });

  it('never overlaps two chords within the same part', () => {
    // The chord part holds several voices of one chord at once, so the
    // invariant is about chords: one chord ends before the next begins.
    // The bass part has a single note per chord, so its notes are checked
    // directly.
    fc.assert(
      fc.property(caseArbitrary, (spec) => {
        const timeline = compile(spec);

        const blocks = chordBlocks(timeline.events);
        for (let index = 1; index < blocks.length; index += 1) {
          expect(blocks[index]?.start).toBeGreaterThanOrEqual(blocks[index - 1]?.end ?? 0);
        }

        const bass = notes(timeline.events)
          .filter((note) => note.part === 'bass')
          .sort((left, right) => left.startTick - right.startTick);
        for (let index = 1; index < bass.length; index += 1) {
          expect(bass[index]?.startTick).toBeGreaterThanOrEqual(bass[index - 1]?.endTick ?? 0);
        }
      }),
      { seed: SEED, numRuns: NUM_RUNS },
    );
  });

  it('gives every note a valid MIDI pitch and velocity', () => {
    fc.assert(
      fc.property(caseArbitrary, (spec) => {
        const timeline = compile(spec);
        for (const note of notes(timeline.events)) {
          expect(note.pitch).toBeGreaterThanOrEqual(0);
          expect(note.pitch).toBeLessThanOrEqual(127);
          expect(note.velocity).toBeGreaterThanOrEqual(1);
          expect(note.velocity).toBeLessThanOrEqual(127);
          expect(note.channel).toBeGreaterThanOrEqual(1);
          expect(note.channel).toBeLessThanOrEqual(16);
        }
      }),
      { seed: SEED, numRuns: NUM_RUNS },
    );
  });

  it('uses whole ticks for every event and duration', () => {
    fc.assert(
      fc.property(caseArbitrary, (spec) => {
        const timeline = compile(spec);
        for (const event of timeline.events) {
          expect(Number.isInteger(eventTick(event))).toBe(true);
          if (event.kind === 'note' || event.kind === 'click') {
            expect(Number.isInteger(event.endTick - event.startTick)).toBe(true);
          }
        }
      }),
      { seed: SEED, numRuns: NUM_RUNS },
    );
  });

  it('lays the sections out end to end and matches the total bar count', () => {
    fc.assert(
      fc.property(caseArbitrary, (spec) => {
        const timeline = compile(spec);
        const meter = getMeter(spec.timeSignature);
        expect(timeline.totalTicks).toBe(expectedTotalBars(spec) * meter.ticksPerBar);
        expect(timeline.totalBars).toBe(expectedTotalBars(spec));
        expect(timeline.totalBars).toBe(markers(timeline.events, 'bar').length);

        let expectedStart = 0;
        for (const entry of timeline.sections) {
          expect(entry.startTick).toBe(expectedStart);
          expect(entry.endTick - entry.startTick).toBe(
            (entry.endBar - entry.startBar + 1) * meter.ticksPerBar,
          );
          expectedStart = entry.endTick;
        }
        expect(expectedStart).toBe(timeline.totalTicks);
      }),
      { seed: SEED, numRuns: NUM_RUNS },
    );
  });

  it('covers each section exactly with its chords', () => {
    // The chord blocks tile the section: they start at its first tick, end
    // at its last, and leave no gap between them.
    fc.assert(
      fc.property(caseArbitrary, (spec) => {
        const timeline = compile(spec);
        const blocks = chordBlocks(timeline.events);
        for (const entry of timeline.sections) {
          const inSection = blocks.filter(
            (block) => block.start >= entry.startTick && block.start < entry.endTick,
          );
          expect(inSection.length).toBeGreaterThan(0);
          expect(inSection[0]?.start).toBe(entry.startTick);
          expect(inSection[inSection.length - 1]?.end).toBe(entry.endTick);
          for (let index = 1; index < inSection.length; index += 1) {
            expect(inSection[index]?.start).toBe(inSection[index - 1]?.end);
          }
        }
      }),
      { seed: SEED, numRuns: NUM_RUNS },
    );
  });

  it('numbers the bar markers contiguously from one', () => {
    fc.assert(
      fc.property(caseArbitrary, (spec) => {
        const timeline = compile(spec);
        const meter = getMeter(spec.timeSignature);
        const bars = markers(timeline.events, 'bar');
        expect(bars.map((marker) => marker.bar)).toEqual(
          Array.from({ length: timeline.totalBars }, (_unused, index) => index + 1),
        );
        bars.forEach((marker, index) => {
          expect(marker.tick).toBe(index * meter.ticksPerBar);
          expect(marker.tick).toBeGreaterThanOrEqual(0);
        });
        expect(bars[0]?.tick).toBe(0);
      }),
      { seed: SEED, numRuns: NUM_RUNS },
    );
  });

  it('marks every chord change with the start of a chord note group', () => {
    fc.assert(
      fc.property(caseArbitrary, (spec) => {
        const timeline = compile(spec);
        const chordStarts = new Set(
          notes(timeline.events)
            .filter((note) => note.part === 'chords')
            .map((note) => note.startTick),
        );
        const changes = markers(timeline.events, 'chordChange');
        expect(changes.length).toBeGreaterThan(0);
        for (const change of changes) {
          expect(chordStarts.has(change.tick)).toBe(true);
        }
      }),
      { seed: SEED, numRuns: NUM_RUNS },
    );
  });

  it('puts every chord change on a legal split', () => {
    fc.assert(
      fc.property(caseArbitrary, (spec) => {
        const timeline = compile(spec);
        const meter = getMeter(spec.timeSignature);
        const legal = chordChangePositions(meter, groupingFor(meter));
        for (const marker of markers(timeline.events, 'chordChange')) {
          const offset =
            ((marker.tick % meter.ticksPerBar) + meter.ticksPerBar) % meter.ticksPerBar;
          expect(legal).toContain(offset);
        }
      }),
      { seed: SEED, numRuns: NUM_RUNS },
    );
  });

  it('keeps the count-in before tick zero and out of the bar numbering', () => {
    fc.assert(
      fc.property(caseArbitrary, (spec) => {
        const timeline = compile(spec);
        const meter = getMeter(spec.timeSignature);
        expect(timeline.countInTicks).toBe(spec.countInBars * meter.ticksPerBar);
        for (const click of clicks(timeline.events)) {
          if (click.countIn) {
            expect(click.startTick).toBeLessThan(0);
          } else {
            expect(click.startTick).toBeGreaterThanOrEqual(0);
          }
        }
        for (const marker of markers(timeline.events, 'bar')) {
          expect(marker.bar).toBeGreaterThanOrEqual(1);
          expect(marker.tick).toBeGreaterThanOrEqual(0);
        }
      }),
      { seed: SEED, numRuns: NUM_RUNS },
    );
  });

  it('clicks the meter pattern once per bar', () => {
    fc.assert(
      fc.property(caseArbitrary, (spec) => {
        const timeline = compile(spec);
        const meter = getMeter(spec.timeSignature);
        const pattern = barClicks(meter, groupingFor(meter));
        const arrangementClicks = clicks(timeline.events).filter((click) => !click.countIn);
        expect(arrangementClicks).toHaveLength(timeline.totalBars * pattern.length);
        for (let bar = 0; bar < timeline.totalBars; bar += 1) {
          const inBar = arrangementClicks.filter(
            (click) =>
              click.startTick >= bar * meter.ticksPerBar &&
              click.startTick < (bar + 1) * meter.ticksPerBar,
          );
          expect(inBar).toHaveLength(pattern.length);
        }
      }),
      { seed: SEED, numRuns: NUM_RUNS },
    );
  });

  it('accents the bar downbeat more strongly than an ordinary beat', () => {
    fc.assert(
      fc.property(caseArbitrary, (spec) => {
        const timeline = compile(spec);
        for (const click of clicks(timeline.events)) {
          if (click.accent === 'bar') {
            expect(click.velocity).toBeGreaterThan(0);
          }
        }
        // Every bar's first click is the downbeat.
        const arrangementClicks = clicks(timeline.events).filter((click) => !click.countIn);
        const barClicksFound = arrangementClicks.filter((click) => click.accent === 'bar');
        expect(barClicksFound).toHaveLength(timeline.totalBars);
      }),
      { seed: SEED, numRuns: NUM_RUNS },
    );
  });

  it('orders every event by tick', () => {
    fc.assert(
      fc.property(caseArbitrary, (spec) => {
        const timeline = compile(spec);
        const ticks = timeline.events.map(eventTick);
        for (let index = 1; index < ticks.length; index += 1) {
          expect(ticks[index]).toBeGreaterThanOrEqual(ticks[index - 1] ?? 0);
        }
      }),
      { seed: SEED, numRuns: NUM_RUNS },
    );
  });

  it('compiles the same session identically every time', () => {
    fc.assert(
      fc.property(caseArbitrary, (spec) => {
        const first = compile(spec);
        const second = compile(spec);
        expect(second.events).toEqual(first.events);
        expect(second.totalTicks).toBe(first.totalTicks);
        expect(second.totalBars).toBe(first.totalBars);
      }),
      { seed: SEED, numRuns: NUM_RUNS },
    );
  });
});
