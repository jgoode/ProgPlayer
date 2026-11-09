/**
 * Bar and beat model (FR-TMP-3, FR-TMP-4, OQ-5).
 *
 * The tick grid is 480 ticks per quarter note. One *beat* is always a quarter
 * note, so a beat is 480 ticks in every meter and `durationBeats` means the
 * same thing everywhere (FR-ARR-4). A meter is described by:
 *
 * - `numerator` / `denominator`: the written time signature.
 * - `beatsPerBar`: the number of quarter-note beats in one bar.
 * - `accentGroups`: the OQ-5 grouping, as beat counts. A group is the unit
 *   the metronome feels.
 * - `clickUnitBeats`: the length of one metronome click.
 *
 * Three distinct concepts are kept apart on purpose, because they are not
 * the same thing in the odd meters:
 *
 * 1. **Accent groups** (OQ-5): where the strong beats fall. 4/4 has one
 *    group of four beats, 6/8 groups 3+3 eighths, 7/8 groups 2+2+3 eighths
 *    and 5/4 groups 3+2 (user-switchable to 2+3).
 * 2. **Clicks** (G-05): one click per beat unit of the meter. 4/4 clicks on
 *    four quarters, 6/8 on two dotted quarters, 7/8 on seven eighths.
 *    Clicks that start an accent group are accented.
 * 3. **Legal chord changes** (G-06): only beat-group boundaries are legal.
 *    In the quarter-note meters (4/4, 3/4, 5/4) the beat is the structural
 *    unit, so every quarter is a legal split; in 6/8 the beat unit is the
 *    dotted quarter, which is also a group start; in 7/8 the eighth is a
 *    subdivision of its 2+2+3 groups, so only the group starts (eighths 1, 3
 *    and 5) are legal splits.
 *
 * That split keeps FR-ARR-4 satisfiable in every supported meter — testing.md
 * §4.2 requires two chords per bar to compile in every time signature — while
 * a 7/8 chord change cannot land on a weak eighth and contradict the agreed
 * 2+2+3 feel.
 */

/** Ticks per quarter note. */
export const TICKS_PER_QUARTER = 480;

/** The accent grouping of one bar, expressed in quarter-note beats. */
export interface MeterGrouping {
  /** Group sizes in quarter-note beats, e.g. `[2, 2, 3]` for 7/8 in eighths. */
  readonly groups: readonly number[];
  /** Tempo beats per bar: how many metronome beats the bar contains. */
  readonly tempoBeatsPerBar: number;
  /** Length of one tempo beat in quarter-note beats (3 for 6/8, 1 otherwise). */
  readonly tempoBeatBeats: number;
}

/** A supported time signature. */
export interface Meter {
  readonly timeSignature: string;
  readonly numerator: number;
  readonly denominator: number;
  /** Quarter-note beats in one bar. */
  readonly beatsPerBar: number;
  /** Length of one bar in ticks. */
  readonly ticksPerBar: number;
  /** The default OQ-5 grouping. */
  readonly defaultGrouping: MeterGrouping;
  /** Length of one metronome click in quarter-note beats (G-05). */
  readonly clickUnitBeats: number;
  /** How the legal chord-change positions are derived (G-06). */
  readonly splitRule: 'beat' | 'group';
}

function quarterMeter(
  timeSignature: string,
  numerator: number,
  denominator: number,
  beatsPerBar: number,
): Meter {
  const grouping: MeterGrouping = {
    groups: [beatsPerBar],
    tempoBeatsPerBar: beatsPerBar,
    tempoBeatBeats: 1,
  };
  return {
    timeSignature,
    numerator,
    denominator,
    beatsPerBar,
    ticksPerBar: beatsPerBar * TICKS_PER_QUARTER,
    defaultGrouping: grouping,
    clickUnitBeats: 1,
    splitRule: 'beat',
  };
}

/**
 * The five supported meters (FR-TMP-3).
 *
 * 5/4 is listed with its default 3+2 grouping; the 2+3 alternative is
 * selected through `Session.beatGrouping` (FR-TMP-4).
 */
export const METERS: Readonly<Record<string, Meter>> = {
  '4/4': quarterMeter('4/4', 4, 4, 4),
  '3/4': quarterMeter('3/4', 3, 4, 3),
  '6/8': {
    timeSignature: '6/8',
    numerator: 6,
    denominator: 8,
    beatsPerBar: 3,
    ticksPerBar: 3 * TICKS_PER_QUARTER,
    defaultGrouping: {
      // 6/8 groups 3+3 eighths = two dotted-quarter beats (OQ-5).
      groups: [1.5, 1.5],
      tempoBeatsPerBar: 2,
      tempoBeatBeats: 3,
    },
    clickUnitBeats: 1.5,
    // The dotted quarter is both the click unit and a group start.
    splitRule: 'group',
  },
  '5/4': {
    timeSignature: '5/4',
    numerator: 5,
    denominator: 4,
    beatsPerBar: 5,
    ticksPerBar: 5 * TICKS_PER_QUARTER,
    defaultGrouping: {
      // 5/4 groups 3+2 by default; 2+3 is the user-switchable alternative.
      groups: [3, 2],
      tempoBeatsPerBar: 5,
      tempoBeatBeats: 1,
    },
    clickUnitBeats: 1,
    // The quarter is the structural unit of a quarter-note meter, so every
    // quarter is a legal split even inside a 3+2 accent group.
    splitRule: 'beat',
  },
  '7/8': {
    timeSignature: '7/8',
    numerator: 7,
    denominator: 8,
    beatsPerBar: 3.5,
    ticksPerBar: 7 * 240,
    defaultGrouping: {
      // 7/8 groups 2+2+3 eighths (OQ-5). Expressed in quarter-note beats:
      // three groups of 1, 1 and 1.5 quarter notes.
      groups: [1, 1, 1.5],
      tempoBeatsPerBar: 7,
      tempoBeatBeats: 0.5,
    },
    clickUnitBeats: 0.5,
    // The eighth is a subdivision of the 2+2+3 groups, so a chord change may
    // only land on a group start.
    splitRule: 'group',
  },
};

/** Every supported meter, in a stable order. */
export const SUPPORTED_METERS: readonly Meter[] = [
  METERS['4/4'] as Meter,
  METERS['3/4'] as Meter,
  METERS['6/8'] as Meter,
  METERS['5/4'] as Meter,
  METERS['7/8'] as Meter,
];

/** Looks up a meter by its time signature. */
export function getMeter(timeSignature: string): Meter {
  const meter = METERS[timeSignature];
  if (meter === undefined) {
    throw new RangeError(`Unsupported time signature: ${timeSignature}`);
  }
  return meter;
}

/**
 * Returns the grouping to use for a meter, honouring the 5/4 user setting.
 *
 * `beatGrouping` only affects 5/4; every other meter has one grouping.
 */
export function groupingFor(meter: Meter, beatGrouping?: string): MeterGrouping {
  if (meter.timeSignature === '5/4' && beatGrouping === '2+3') {
    return { groups: [2, 3], tempoBeatsPerBar: 5, tempoBeatBeats: 1 };
  }
  return meter.defaultGrouping;
}

/** One click or marker position inside a bar. */
export interface MeterPosition {
  /** Tick offset from the start of the bar. */
  readonly tickInBar: number;
  /** Index of the accent group the position falls in (0-based). */
  readonly groupIndex: number;
  /** True when the position starts an accent group. */
  readonly groupStart: boolean;
  /** True when the position is the bar's downbeat. */
  readonly barStart: boolean;
}

/** The click positions inside one bar. */
export function barPositions(meter: Meter, grouping: MeterGrouping): readonly MeterPosition[] {
  const positions: MeterPosition[] = [];
  const clicksPerBar = Math.round(meter.beatsPerBar / meter.clickUnitBeats);
  const groupStarts = accentGroupStartTicks(grouping);
  for (let click = 0; click < clicksPerBar; click += 1) {
    const tickInBar = click * meter.clickUnitBeats * TICKS_PER_QUARTER;
    const groupIndex = groupIndexAtTick(groupStarts, tickInBar);
    const groupStart = groupStarts.includes(tickInBar);
    positions.push({
      tickInBar,
      groupIndex,
      groupStart,
      barStart: tickInBar === 0,
    });
  }
  return positions;
}

/** The tick offsets at which an accent group starts. */
function accentGroupStartTicks(grouping: MeterGrouping): readonly number[] {
  const starts: number[] = [];
  let tick = 0;
  for (const group of grouping.groups) {
    starts.push(tick);
    tick += group * TICKS_PER_QUARTER;
  }
  return starts;
}

/** The index of the accent group a tick offset falls in. */
function groupIndexAtTick(groupStarts: readonly number[], tickInBar: number): number {
  let index = 0;
  for (let candidate = 0; candidate < groupStarts.length; candidate += 1) {
    if ((groupStarts[candidate] as number) <= tickInBar) {
      index = candidate;
    }
  }
  return index;
}

/**
 * The tick positions a chord change may land on (G-06).
 *
 * Only beat-group boundaries are legal chord-change positions: the editor
 * offers only valid splits and the compiler rejects a chord that changes
 * anywhere else.
 */
export function chordChangePositions(meter: Meter, grouping: MeterGrouping): readonly number[] {
  if (meter.splitRule === 'group') {
    return [...accentGroupStartTicks(grouping)].sort((left, right) => left - right);
  }
  const positions: number[] = [];
  const clicksPerBar = Math.round(meter.beatsPerBar / meter.clickUnitBeats);
  for (let click = 0; click < clicksPerBar; click += 1) {
    positions.push(click * meter.clickUnitBeats * TICKS_PER_QUARTER);
  }
  return positions;
}

/**
 * The click positions inside one bar, with their accent strength.
 *
 * Accent strengths are `bar` (the downbeat), `group` (the start of an accent
 * group that is not the downbeat) and `beat` (an ordinary click).
 */
export interface ClickPosition {
  readonly tickInBar: number;
  readonly accent: 'bar' | 'group' | 'beat';
}

/** The click pattern for one bar (G-05). */
export function barClicks(meter: Meter, grouping: MeterGrouping): readonly ClickPosition[] {
  return barPositions(meter, grouping).map((position) => {
    if (position.barStart) {
      return { tickInBar: position.tickInBar, accent: 'bar' };
    }
    if (position.groupStart) {
      return { tickInBar: position.tickInBar, accent: 'group' };
    }
    return { tickInBar: position.tickInBar, accent: 'beat' };
  });
}

/** Converts a duration in quarter-note beats to ticks. */
export function beatsToTicks(beats: number): number {
  return beats * TICKS_PER_QUARTER;
}

/** Converts a duration in ticks to quarter-note beats. */
export function ticksToBeats(ticks: number): number {
  return ticks / TICKS_PER_QUARTER;
}
