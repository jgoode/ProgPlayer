/**
 * Standard MIDI File writer tests (P3.7, FR-IO-3).
 *
 * The writer is hand-written, so the file it produces is checked with an
 * independent reference parser (`midi-file`) rather than with the project's
 * own code: a file that only this project agrees with is not a Standard MIDI
 * File. `midi-file` is a test-only dependency; `src/core` itself stays pure
 * TypeScript.
 *
 * The reference parser reports a MIDI channel zero-based (`channel: 0` is
 * MIDI channel 1) and delta times in ticks, so the absolute tick of every
 * event is reconstructed by accumulating the deltas down the track.
 */

import { parseMidi } from 'midi-file';
import type {
  MidiData,
  MidiEndOfTrackEvent,
  MidiEvent,
  MidiNoteOffEvent,
  MidiNoteOnEvent,
  MidiSetTempoEvent,
  MidiTimeSignatureEvent,
  MidiTrackNameEvent,
} from 'midi-file';
import { describe, expect, it } from 'vitest';

import { compileTimeline } from '../compiler/compile';
import type { NoteEvent, TimelineEvent } from '../compiler/types';
import { barChord, section, session } from '../../../tests/fixtures/sessions';
import { writeSmf } from './smf';

/** One parsed note event with its absolute tick. */
interface ParsedNote {
  readonly kind: 'noteOn' | 'noteOff';
  readonly tick: number;
  /** Zero-based MIDI channel, as the reference parser reports it. */
  readonly channel: number;
  readonly pitch: number;
  readonly velocity: number;
}

/** A note in a comparable shape, with a one-based MIDI channel. */
interface ExpectedNote {
  readonly tick: number;
  readonly channel: number;
  readonly pitch: number;
  readonly velocity: number;
}

/** The parsed note events of one track, with absolute ticks. */
function parsedNotes(track: readonly MidiEvent[]): readonly ParsedNote[] {
  const notes: ParsedNote[] = [];
  let tick = 0;
  for (const event of track) {
    tick += event.deltaTime;
    if (event.type === 'noteOn') {
      const note: MidiNoteOnEvent = event;
      notes.push({
        kind: 'noteOn',
        tick,
        channel: note.channel,
        pitch: note.noteNumber,
        velocity: note.velocity,
      });
    } else if (event.type === 'noteOff') {
      const note: MidiNoteOffEvent = event;
      notes.push({
        kind: 'noteOff',
        tick,
        channel: note.channel,
        pitch: note.noteNumber,
        velocity: note.velocity,
      });
    }
  }
  return notes;
}

/** The name of the track, read from its track-name meta event. */
function trackName(track: readonly MidiEvent[]): string | undefined {
  const event = track.find(
    (candidate): candidate is MidiTrackNameEvent => candidate.type === 'trackName',
  );
  return event?.text;
}

/** Finds a track by its name, failing the test when it is missing. */
function trackByName(data: MidiData, name: string): readonly MidiEvent[] {
  const track = data.tracks.find((candidate) => trackName(candidate) === name);
  if (track === undefined) {
    throw new Error(`the file has no track named "${name}"`);
  }
  return track;
}

/** The timeline's note events for one part. */
function timelineNotes(
  events: readonly TimelineEvent[],
  part: 'chords' | 'bass',
): readonly NoteEvent[] {
  return events.filter((event): event is NoteEvent => event.kind === 'note' && event.part === part);
}

/** Orders notes by tick and pitch so two lists can be compared directly. */
function byTickThenPitch(left: ExpectedNote, right: ExpectedNote): number {
  if (left.tick !== right.tick) {
    return left.tick - right.tick;
  }
  return left.pitch - right.pitch;
}

/** The expected note-on data of one timeline part, in file tick order. */
function expectedNotes(notes: readonly NoteEvent[], shift: number): readonly ExpectedNote[] {
  return notes
    .map((note) => ({
      tick: note.startTick + shift,
      channel: note.channel,
      pitch: note.pitch,
      velocity: note.velocity,
    }))
    .sort(byTickThenPitch);
}

/** The parsed note-on data of one track, in file tick order. */
function actualNoteOns(track: readonly MidiEvent[]): readonly ExpectedNote[] {
  return parsedNotes(track)
    .filter((note) => note.kind === 'noteOn')
    .map((note) => ({
      tick: note.tick,
      // The reference parser reports channels zero-based; the timeline uses
      // the one-based MIDI channel numbers.
      channel: note.channel + 1,
      pitch: note.pitch,
      velocity: note.velocity,
    }))
    .sort(byTickThenPitch);
}

/** Parses the written bytes with the reference parser. */
function parse(bytes: Uint8Array): MidiData {
  // The reference parser takes any `ArrayLike<number>`, so the writer's own
  // `Uint8Array` goes straight in — no Node `Buffer` needed, and the core
  // layer stays free of Node imports.
  return parseMidi(bytes);
}

describe('SMF writer', () => {
  it('writes a file the reference parser accepts', () => {
    const timeline = compileTimeline(session([section('A', [barChord(1), barChord(4)])]));

    const bytes = writeSmf(timeline);

    expect(() => parse(bytes)).not.toThrow();
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('starts with the MThd header chunk', () => {
    const timeline = compileTimeline(session([section('A', [barChord(1)])]));

    const bytes = writeSmf(timeline);

    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('MThd');
    expect(parse(bytes).header.format).toBe(1);
  });

  it('declares format 1, 480 ticks per beat and the track count', () => {
    const timeline = compileTimeline(session([section('A', [barChord(1)])]));

    const parsed = parse(writeSmf(timeline));

    expect(parsed.header.format).toBe(1);
    expect(parsed.header.ticksPerBeat).toBe(480);
    expect(parsed.header.numTracks).toBe(parsed.tracks.length);
  });

  it('writes one track per part plus the conductor track', () => {
    const timeline = compileTimeline(session([section('A', [barChord(1)])]));

    const parsed = parse(writeSmf(timeline));

    expect(parsed.tracks).toHaveLength(4);
    expect(parsed.tracks.map((track) => trackName(track))).toEqual([
      'PracticePlayer',
      'Chords',
      'Bass',
      'Click',
    ]);
  });

  it('omits the click track when includeClick is false', () => {
    const timeline = compileTimeline(session([section('A', [barChord(1)])]));

    const parsed = parse(writeSmf(timeline, { includeClick: false }));

    expect(parsed.tracks).toHaveLength(3);
    expect(parsed.tracks.map((track) => trackName(track))).toEqual([
      'PracticePlayer',
      'Chords',
      'Bass',
    ]);
    // The arrangement itself survives the option.
    expect(parsedNotes(trackByName(parsed, 'Chords')).length).toBeGreaterThan(0);
  });

  it('writes the tempo of the session in the conductor track', () => {
    const timeline = compileTimeline(session([section('A', [barChord(1)])], { tempoBpm: 120 }));

    const parsed = parse(writeSmf(timeline));

    const tempo = trackByName(parsed, 'PracticePlayer').find(
      (event): event is MidiSetTempoEvent => event.type === 'setTempo',
    );
    expect(tempo?.microsecondsPerBeat).toBe(Math.round(60_000_000 / 120));
    expect(tempo?.microsecondsPerBeat).toBe(500_000);
  });

  it('writes the time signature of the session in the conductor track', () => {
    const timeline = compileTimeline(session([section('A', [barChord(1)])]));

    const parsed = parse(writeSmf(timeline));

    const signature = trackByName(parsed, 'PracticePlayer').find(
      (event): event is MidiTimeSignatureEvent => event.type === 'timeSignature',
    );
    expect(signature?.numerator).toBe(4);
    expect(signature?.denominator).toBe(4);
  });

  it.each([
    ['4/4', 4, 4, 4],
    ['7/8', 7, 8, 3.5],
    ['6/8', 6, 8, 3],
  ] as const)('writes the %s time signature', (timeSignature, numerator, denominator, barBeats) => {
    const timeline = compileTimeline(
      session([section('A', [{ degree: 1, quality: '', durationBeats: barBeats }])], {
        timeSignature,
      }),
    );

    const parsed = parse(writeSmf(timeline));

    const signature = trackByName(parsed, 'PracticePlayer').find(
      (event): event is MidiTimeSignatureEvent => event.type === 'timeSignature',
    );
    expect(signature?.numerator).toBe(numerator);
    expect(signature?.denominator).toBe(denominator);
  });

  it('writes the tempo and time signature exactly once per file', () => {
    const timeline = compileTimeline(session([section('A', [barChord(1)])]));

    const parsed = parse(writeSmf(timeline));

    const allEvents = parsed.tracks.flat();
    expect(allEvents.filter((event) => event.type === 'setTempo')).toHaveLength(1);
    expect(allEvents.filter((event) => event.type === 'timeSignature')).toHaveLength(1);
  });

  it('starts every track with a track name and ends it with end of track', () => {
    const timeline = compileTimeline(session([section('A', [barChord(1)])]));

    const parsed = parse(writeSmf(timeline));

    for (const track of parsed.tracks) {
      const first = track[0];
      const last = track[track.length - 1];
      // The track name and the end-of-track marker are meta events; the
      // reference parser marks them with the `meta` flag.
      expect(first?.type).toBe('trackName');
      expect((first as MidiTrackNameEvent).meta).toBe(true);
      expect(last?.type).toBe('endOfTrack');
      expect((last as MidiEndOfTrackEvent).meta).toBe(true);
    }
  });

  it('gives each part its own MIDI channel', () => {
    const timeline = compileTimeline(session([section('A', [barChord(1)])]));

    const parsed = parse(writeSmf(timeline));

    const channelsOf = (name: string): readonly number[] => [
      ...new Set(parsedNotes(trackByName(parsed, name)).map((note) => note.channel + 1)),
    ];
    expect(channelsOf('Chords')).toEqual([1]);
    expect(channelsOf('Bass')).toEqual([2]);
    expect(channelsOf('Click')).toEqual([10]);
  });

  it('reconstructs the note data of the timeline from the parsed deltas', () => {
    const timeline = compileTimeline(
      session([section('A', [barChord(1), barChord(4)])], {
        playback: { countInBars: 0, loopMode: 'off' },
      }),
    );

    const parsed = parse(writeSmf(timeline));

    expect(actualNoteOns(trackByName(parsed, 'Chords'))).toEqual(
      expectedNotes(timelineNotes(timeline.events, 'chords'), 0),
    );
    expect(actualNoteOns(trackByName(parsed, 'Bass'))).toEqual(
      expectedNotes(timelineNotes(timeline.events, 'bass'), 0),
    );
  });

  it('ends every parsed note at the tick of the timeline note', () => {
    const timeline = compileTimeline(
      session([section('A', [barChord(1), barChord(4)])], {
        playback: { countInBars: 0, loopMode: 'off' },
      }),
    );

    const parsed = parse(writeSmf(timeline));

    const expectedEnds = timelineNotes(timeline.events, 'chords')
      .map((note) => ({
        tick: note.endTick,
        channel: note.channel,
        pitch: note.pitch,
        velocity: 0,
      }))
      .sort(byTickThenPitch);
    const actualEnds = parsedNotes(trackByName(parsed, 'Chords'))
      .filter((note) => note.kind === 'noteOff')
      .map((note) => ({
        tick: note.tick,
        channel: note.channel + 1,
        pitch: note.pitch,
        velocity: note.velocity,
      }))
      .sort(byTickThenPitch);
    expect(actualEnds).toEqual(expectedEnds);
  });

  it('shifts the file so the count-in fits before the arrangement', () => {
    const timeline = compileTimeline(
      session([section('A', [barChord(1)])], {
        playback: { countInBars: 1, loopMode: 'off' },
      }),
    );

    const parsed = parse(writeSmf(timeline));

    // One 4/4 count-in bar is 1920 ticks, so the arrangement starts there.
    const chordNotes = parsedNotes(trackByName(parsed, 'Chords')).filter(
      (note) => note.kind === 'noteOn',
    );
    expect(chordNotes[0]?.tick).toBe(1920);
    // The count-in itself starts at tick 0 of the file.
    const clickNotes = parsedNotes(trackByName(parsed, 'Click')).filter(
      (note) => note.kind === 'noteOn',
    );
    expect(clickNotes[0]?.tick).toBe(0);
  });

  it('starts the arrangement at tick 0 without a count-in', () => {
    const timeline = compileTimeline(
      session([section('A', [barChord(1)])], {
        playback: { countInBars: 0, loopMode: 'off' },
      }),
    );

    const parsed = parse(writeSmf(timeline));

    const chordNotes = parsedNotes(trackByName(parsed, 'Chords')).filter(
      (note) => note.kind === 'noteOn',
    );
    expect(chordNotes[0]?.tick).toBe(0);
  });

  it('removes the count-in clicks but keeps the arrangement', () => {
    const timeline = compileTimeline(
      session([section('A', [barChord(1)])], {
        playback: { countInBars: 1, loopMode: 'off' },
      }),
    );

    const withCountIn = parse(writeSmf(timeline));
    const withoutCountIn = parse(writeSmf(timeline, { includeCountIn: false }));

    const countInClicks = (data: MidiData): number =>
      parsedNotes(trackByName(data, 'Click')).filter((note) => note.kind === 'noteOn').length;
    expect(countInClicks(withCountIn)).toBe(8);
    expect(countInClicks(withoutCountIn)).toBe(4);

    // Without the count-in the arrangement starts at the beginning of the
    // file, and the arrangement notes are unchanged.
    const chordNotes = parsedNotes(trackByName(withoutCountIn, 'Chords')).filter(
      (note) => note.kind === 'noteOn',
    );
    expect(chordNotes[0]?.tick).toBe(0);
    expect(chordNotes.map((note) => note.pitch)).toEqual(
      timelineNotes(timeline.events, 'chords').map((note) => note.pitch),
    );
  });
});
