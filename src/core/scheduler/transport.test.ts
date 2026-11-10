/**
 * Transport tests (P4.3, P4.4, P4.5, G-02, G-07).
 */

import { describe, expect, it } from 'vitest';

import { compileTimeline } from '../compiler/compile';

import { barChord, section, session } from '../../../tests/fixtures/sessions';

import { Transport } from './transport';

describe('transport: states', () => {
  it('starts stopped', () => {
    const timeline = compileTimeline(session([section('A', [barChord(1)])]));
    const transport = new Transport({ timeline });

    expect(transport.currentState).toBe('stopped');
    expect(transport.isRunning).toBe(false);
  });

  it('enters the count-in on a fresh play', () => {
    const timeline = compileTimeline(session([section('A', [barChord(1)])]));
    const transport = new Transport({ timeline });

    transport.play();
    expect(transport.currentState).toBe('countingIn');
    expect(transport.isRunning).toBe(true);
  });

  it('plays straight away when the count-in is zero', () => {
    const timeline = compileTimeline(
      session([section('A', [barChord(1)])], {
        playback: { countInBars: 0, loopMode: 'off' },
      }),
    );
    const transport = new Transport({ timeline });

    transport.play();
    expect(transport.currentState).toBe('playing');
  });

  it('leaves the count-in when the scheduler reports it finished', () => {
    const timeline = compileTimeline(session([section('A', [barChord(1)])]));
    const transport = new Transport({ timeline });

    transport.play();
    transport.finishCountIn();
    expect(transport.currentState).toBe('playing');
  });

  it('pauses and resumes', () => {
    const timeline = compileTimeline(session([section('A', [barChord(1)])]));
    const transport = new Transport({ timeline });

    transport.play();
    transport.pause();
    expect(transport.currentState).toBe('paused');
    expect(transport.isRunning).toBe(false);

    transport.resume();
    expect(transport.currentState).toBe('playing');
  });

  it('resumes without a count-in', () => {
    const timeline = compileTimeline(session([section('A', [barChord(1)])]));
    const transport = new Transport({ timeline });

    transport.play();
    transport.finishCountIn();
    transport.pause();
    transport.resume();

    expect(transport.currentState).toBe('playing');
  });

  it('stops back to the start', () => {
    const timeline = compileTimeline(session([section('A', [barChord(1)])]));
    const transport = new Transport({ timeline });

    transport.play();
    transport.stop();
    expect(transport.currentState).toBe('stopped');
  });

  it('ignores a play while it is already playing', () => {
    const timeline = compileTimeline(session([section('A', [barChord(1)])]));
    const transport = new Transport({ timeline });

    transport.play();
    transport.finishCountIn();
    transport.play();
    expect(transport.currentState).toBe('playing');
  });

  it('ignores a pause while it is stopped', () => {
    const timeline = compileTimeline(session([section('A', [barChord(1)])]));
    const transport = new Transport({ timeline });

    transport.pause();
    expect(transport.currentState).toBe('stopped');
  });

  it('aligns the resume tick to the beat', () => {
    expect(Transport.resumeTickFor(0)).toBe(0);
    expect(Transport.resumeTickFor(479)).toBe(0);
    expect(Transport.resumeTickFor(480)).toBe(480);
    expect(Transport.resumeTickFor(481)).toBe(480);
    expect(Transport.resumeTickFor(959)).toBe(480);
    // The count-in keeps its negative ticks.
    expect(Transport.resumeTickFor(-100)).toBe(-100);
  });
});

describe('transport: loop regions (G-07)', () => {
  const timeline = compileTimeline(
    session([section('A', [barChord(1), barChord(4)]), section('B', [barChord(2), barChord(5)])], {
      playback: { countInBars: 0, loopMode: 'off' },
    }),
  );

  it('has no region when the loop is off', () => {
    const transport = new Transport({ timeline });
    expect(transport.currentLoop).toBeNull();
  });

  it('resolves the whole arrangement', () => {
    const transport = new Transport({ timeline, loopMode: 'whole' });

    expect(transport.currentLoop).toEqual({
      mode: 'whole',
      startBar: 1,
      endBar: 4,
      startTick: 0,
      endTick: 7680,
    });
  });

  it('resolves a section', () => {
    const transport = new Transport({ timeline, loopMode: 'section', loopSectionIndex: 1 });

    expect(transport.currentLoop).toEqual({
      mode: 'section',
      startBar: 3,
      endBar: 4,
      startTick: 3840,
      endTick: 7680,
    });
  });

  it('resolves a bar range', () => {
    const transport = new Transport({
      timeline,
      loopMode: 'barRange',
      loopBarRange: { startBar: 2, endBar: 3 },
    });

    expect(transport.currentLoop).toEqual({
      mode: 'barRange',
      startBar: 2,
      endBar: 3,
      startTick: 1920,
      endTick: 5760,
    });
  });

  it('covers all the repeats of a section', () => {
    const repeated = compileTimeline(
      session([section('A', [barChord(1), barChord(4)], 3)], {
        playback: { countInBars: 0, loopMode: 'off' },
      }),
    );
    const transport = new Transport({
      timeline: repeated,
      loopMode: 'section',
      loopSectionIndex: 0,
    });

    // Three passes of two bars: bars 1..6.
    expect(transport.currentLoop?.startBar).toBe(1);
    expect(transport.currentLoop?.endBar).toBe(6);
  });

  it('has no region for a bar range that was not given', () => {
    const transport = new Transport({ timeline, loopMode: 'barRange' });
    expect(transport.currentLoop).toBeNull();
  });

  it('changes the region at runtime', () => {
    const transport = new Transport({ timeline });

    transport.setLoop('whole');
    expect(transport.currentLoop?.endBar).toBe(4);

    transport.setLoop('barRange', { barRange: { startBar: 1, endBar: 1 } });
    expect(transport.currentLoop).toEqual({
      mode: 'barRange',
      startBar: 1,
      endBar: 1,
      startTick: 0,
      endTick: 1920,
    });
  });

  it('turns the loop off again', () => {
    const transport = new Transport({ timeline, loopMode: 'whole' });

    transport.setLoop('off');
    expect(transport.currentLoop).toBeNull();
  });
});
