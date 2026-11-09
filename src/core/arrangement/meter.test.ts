import { describe, expect, it } from 'vitest';

import {
  METERS,
  SUPPORTED_METERS,
  TICKS_PER_QUARTER,
  barClicks,
  barPositions,
  beatsToTicks,
  chordChangePositions,
  getMeter,
  groupingFor,
  ticksToBeats,
} from './meter';

describe('meter model', () => {
  it('supports exactly the five meters of FR-TMP-3', () => {
    expect(SUPPORTED_METERS.map((meter) => meter.timeSignature)).toEqual([
      '4/4',
      '3/4',
      '6/8',
      '5/4',
      '7/8',
    ]);
  });

  it('rejects an unsupported time signature', () => {
    expect(() => getMeter('2/4')).toThrow(RangeError);
  });

  it('measures bars in quarter-note beats, so 4/4 is four beats', () => {
    expect(getMeter('4/4').beatsPerBar).toBe(4);
    expect(getMeter('4/4').ticksPerBar).toBe(4 * TICKS_PER_QUARTER);
  });

  it('measures a 6/8 bar as three quarter-note beats but two dotted-quarter beats', () => {
    const meter = getMeter('6/8');
    expect(meter.beatsPerBar).toBe(3);
    expect(meter.ticksPerBar).toBe(3 * TICKS_PER_QUARTER);
    expect(meter.defaultGrouping.tempoBeatsPerBar).toBe(2);
    expect(meter.defaultGrouping.tempoBeatBeats).toBe(3);
  });

  it('measures a 7/8 bar as three and a half quarter-note beats', () => {
    const meter = getMeter('7/8');
    expect(meter.beatsPerBar).toBe(3.5);
    expect(meter.ticksPerBar).toBe(7 * 240);
    expect(meter.defaultGrouping.groups).toEqual([1, 1, 1.5]);
  });

  it('switches the 5/4 grouping to 2+3 on request', () => {
    const meter = getMeter('5/4');
    expect(groupingFor(meter).groups).toEqual([3, 2]);
    expect(groupingFor(meter, '2+3').groups).toEqual([2, 3]);
  });

  it('ignores the 5/4 grouping setting in other meters', () => {
    expect(groupingFor(getMeter('4/4'), '2+3').groups).toEqual([4]);
  });

  describe('click patterns (G-05)', () => {
    it('clicks on every quarter in 4/4 with the downbeat accented', () => {
      const meter = getMeter('4/4');
      const clicks = barClicks(meter, groupingFor(meter));
      expect(clicks).toHaveLength(4);
      expect(clicks.map((click) => click.tickInBar)).toEqual([0, 480, 960, 1440]);
      expect(clicks.map((click) => click.accent)).toEqual(['bar', 'beat', 'beat', 'beat']);
    });

    it('clicks on the two dotted quarters in 6/8', () => {
      const meter = getMeter('6/8');
      const clicks = barClicks(meter, groupingFor(meter));
      expect(clicks.map((click) => click.tickInBar)).toEqual([0, 720]);
      expect(clicks.map((click) => click.accent)).toEqual(['bar', 'group']);
    });

    it('clicks on every eighth in 7/8 and accents the 2+2+3 group starts', () => {
      const meter = getMeter('7/8');
      const clicks = barClicks(meter, groupingFor(meter));
      expect(clicks).toHaveLength(7);
      expect(clicks.map((click) => click.tickInBar)).toEqual([0, 240, 480, 720, 960, 1200, 1440]);
      expect(clicks.map((click) => click.accent)).toEqual([
        'bar',
        'beat',
        'group',
        'beat',
        'group',
        'beat',
        'beat',
      ]);
    });

    it('clicks on five quarters in 5/4 and accents the 3+2 boundary', () => {
      const meter = getMeter('5/4');
      const clicks = barClicks(meter, groupingFor(meter));
      expect(clicks).toHaveLength(5);
      expect(clicks.map((click) => click.accent)).toEqual(['bar', 'beat', 'beat', 'group', 'beat']);
    });

    it('moves the 5/4 accent when the grouping is switched to 2+3', () => {
      const meter = getMeter('5/4');
      const clicks = barClicks(meter, groupingFor(meter, '2+3'));
      expect(clicks.map((click) => click.accent)).toEqual(['bar', 'beat', 'group', 'beat', 'beat']);
    });

    it('clicks on three quarters in 3/4', () => {
      const meter = getMeter('3/4');
      expect(barClicks(meter, groupingFor(meter))).toHaveLength(3);
    });
  });

  describe('chord-change positions (G-06)', () => {
    it('allows every quarter in 4/4 and 3/4', () => {
      expect(chordChangePositions(getMeter('4/4'), groupingFor(getMeter('4/4')))).toEqual([
        0, 480, 960, 1440,
      ]);
      expect(chordChangePositions(getMeter('3/4'), groupingFor(getMeter('3/4')))).toEqual([
        0, 480, 960,
      ]);
    });

    it('allows the two dotted-quarter boundaries in 6/8', () => {
      expect(chordChangePositions(getMeter('6/8'), groupingFor(getMeter('6/8')))).toEqual([0, 720]);
    });

    it('allows only the 2+2+3 group starts in 7/8', () => {
      expect(chordChangePositions(getMeter('7/8'), groupingFor(getMeter('7/8')))).toEqual([
        0, 480, 960,
      ]);
    });

    it('allows every quarter in 5/4, since the quarter is the structural unit', () => {
      const meter = getMeter('5/4');
      expect(chordChangePositions(meter, groupingFor(meter))).toEqual([0, 480, 960, 1440, 1920]);
      expect(chordChangePositions(meter, groupingFor(meter, '2+3'))).toEqual([
        0, 480, 960, 1440, 1920,
      ]);
    });
  });

  it('places every click inside the bar', () => {
    for (const meter of SUPPORTED_METERS) {
      const grouping = groupingFor(meter);
      for (const position of barPositions(meter, grouping)) {
        expect(position.tickInBar).toBeGreaterThanOrEqual(0);
        expect(position.tickInBar).toBeLessThan(meter.ticksPerBar);
      }
    }
  });

  it('converts between beats and ticks', () => {
    expect(beatsToTicks(4)).toBe(1920);
    expect(ticksToBeats(1920)).toBe(4);
  });

  it('exposes the meter table by time signature', () => {
    expect(METERS['3/4']?.numerator).toBe(3);
    expect(METERS['3/4']?.denominator).toBe(4);
  });
});
