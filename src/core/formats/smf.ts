/**
 * Standard MIDI File writer (P3.6, FR-IO-3).
 *
 * Writes a type-1 SMF from a compiled timeline, with:
 *
 * - track 0: the conductor track, carrying the tempo and time-signature meta
 *   events (FR-IO-3);
 * - one track per part: chords, bass and click, each on its own MIDI
 *   channel (FR-SND-5).
 *
 * The writer is pure TypeScript with no Node or DOM dependency, so it can run
 * in the renderer and in tests.
 *
 * The file format is the Standard MIDI File format (type 1), as specified by
 * the MIDI Manufacturers Association: a `MThd` chunk with format 1 and a
 * 480-tick division, followed by `MTrk` chunks, each a stream of
 * variable-length delta times.
 */

import type { TimelineEvent } from '../compiler/types';

/** Ticks per quarter note used in the written file. */
export const SMF_TICKS_PER_QUARTER = 480;

/** The SMF header format: type 1, one track per part plus a conductor track. */
export const SMF_FORMAT = 1;

/** Options for writing a Standard MIDI File. */
export interface WriteSmfOptions {
  /** Include the click track. Defaults to true. */
  readonly includeClick?: boolean | undefined;
  /** Include the count-in region. Defaults to true. */
  readonly includeCountIn?: boolean | undefined;
}

/** The timeline fields the writer needs. */
export interface SmfTimeline {
  readonly events: readonly TimelineEvent[];
  readonly tempoBpm: number;
  readonly timeSignature: string;
}

/** A MIDI event in a track, held with its absolute tick until serialisation. */
interface TrackEvent {
  /** Absolute tick of the event. */
  readonly tick: number;
  /** The raw MIDI bytes of the event. */
  readonly data: Uint8Array;
  /** True for a note-off, used to order events at the same tick. */
  readonly isNoteOff: boolean;
}

/** One track: a name and its events. */
interface Track {
  readonly name: string;
  readonly events: TrackEvent[];
}

/**
 * Writes a Standard MIDI File from a timeline.
 *
 * Returns the file bytes.
 */
export function writeSmf(timeline: SmfTimeline, options: WriteSmfOptions = {}): Uint8Array {
  const includeClick = options.includeClick ?? true;
  const includeCountIn = options.includeCountIn ?? true;

  const tracks = buildTracks(timeline, includeClick, includeCountIn);

  const chunks: Uint8Array[] = [];
  chunks.push(encodeHeader(tracks.length));
  for (const track of tracks) {
    chunks.push(encodeTrack(track));
  }
  return concat(chunks);
}

/** Builds the conductor track and the part tracks. */
function buildTracks(
  timeline: SmfTimeline,
  includeClick: boolean,
  includeCountIn: boolean,
): readonly Track[] {
  const conductor: Track[] = [
    {
      name: 'PracticePlayer',
      events: [
        { tick: 0, data: encodeTempo(timeline.tempoBpm), isNoteOff: false },
        {
          tick: 0,
          data: encodeTimeSignature(timeline.timeSignature),
          isNoteOff: false,
        },
      ],
    },
  ];

  const chords: Track = { name: 'Chords', events: [] };
  const bass: Track = { name: 'Bass', events: [] };
  const click: Track = { name: 'Click', events: [] };

  // A Standard MIDI File cannot express a negative tick: its delta times are
  // unsigned. The count-in region of the timeline lives *before* tick 0, so
  // the whole file is shifted so that the first written event lands on tick
  // 0. The arrangement therefore starts at `countInTicks` in the file, which
  // is exactly the position the count-in occupies in the timeline.
  const earliestTick = findEarliestTick(timeline.events, includeClick, includeCountIn);
  const shift = earliestTick < 0 ? -earliestTick : 0;

  for (const event of timeline.events) {
    if (event.kind === 'note') {
      const target = event.part === 'chords' ? chords : bass;
      target.events.push({
        tick: event.startTick + shift,
        data: encodeNoteOn(event.channel, event.pitch, event.velocity),
        isNoteOff: false,
      });
      target.events.push({
        tick: event.endTick + shift,
        data: encodeNoteOff(event.channel, event.pitch),
        isNoteOff: true,
      });
      continue;
    }
    if (event.kind === 'click') {
      if (!includeClick) {
        continue;
      }
      if (event.countIn && !includeCountIn) {
        continue;
      }
      click.events.push({
        tick: event.startTick + shift,
        data: encodeNoteOn(event.channel, event.pitch, event.velocity),
        isNoteOff: false,
      });
      click.events.push({
        tick: event.endTick + shift,
        data: encodeNoteOff(event.channel, event.pitch),
        isNoteOff: true,
      });
    }
  }

  const tracks: Track[] = [...conductor, chords, bass];
  if (includeClick) {
    tracks.push(click);
  }
  return tracks;
}

/**
 * The earliest tick that will be written to the file.
 *
 * Returns 0 when nothing precedes the arrangement, so the file starts at
 * tick 0. The count-in clicks sit before tick 0 in the timeline, so they
 * determine the shift.
 */
function findEarliestTick(
  events: readonly TimelineEvent[],
  includeClick: boolean,
  includeCountIn: boolean,
): number {
  let earliest = 0;
  for (const event of events) {
    if (event.kind === 'note') {
      earliest = Math.min(earliest, event.startTick);
      continue;
    }
    if (event.kind === 'click') {
      if (!includeClick) {
        continue;
      }
      if (event.countIn && !includeCountIn) {
        continue;
      }
      earliest = Math.min(earliest, event.startTick);
    }
  }
  return earliest;
}

/** Encodes the `MThd` chunk. */
function encodeHeader(trackCount: number): Uint8Array {
  const bytes = new Uint8Array(14);
  bytes.set([0x4d, 0x54, 0x68, 0x64], 0); // "MThd"
  writeUint32(bytes, 4, 6); // header length
  writeUint16(bytes, 8, SMF_FORMAT);
  writeUint16(bytes, 10, trackCount);
  writeUint16(bytes, 12, SMF_TICKS_PER_QUARTER);
  return bytes;
}

/** Encodes one `MTrk` chunk. */
function encodeTrack(track: Track): Uint8Array {
  // Events are written in tick order. At one tick a note-off is written
  // before a note-on, so a retrigger of the same pitch does not overlap.
  const ordered = [...track.events].sort((left, right) => {
    if (left.tick !== right.tick) {
      return left.tick - right.tick;
    }
    if (left.isNoteOff !== right.isNoteOff) {
      return left.isNoteOff ? -1 : 1;
    }
    return 0;
  });

  const body: Uint8Array[] = [];
  let previousTick = 0;
  // Track name meta event (FF 03), so the parts are identifiable in a DAW.
  // Every event in a track — meta events included — is preceded by its
  // variable-length delta time.
  body.push(encodeVariableLength(0));
  body.push(encodeMetaText(0x03, track.name));
  for (const event of ordered) {
    body.push(encodeVariableLength(event.tick - previousTick));
    body.push(event.data);
    previousTick = event.tick;
  }
  // End of track (FF 2F 00), also preceded by its delta time.
  body.push(encodeVariableLength(0));
  body.push(new Uint8Array([0xff, 0x2f, 0x00]));

  const bodyLength = body.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(8 + bodyLength);
  bytes.set([0x4d, 0x54, 0x72, 0x6b], 0); // "MTrk"
  writeUint32(bytes, 4, bodyLength);
  let offset = 8;
  for (const chunk of body) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** Encodes a tempo meta event (FF 51 03 tttttt). */
function encodeTempo(tempoBpm: number): Uint8Array {
  const microsecondsPerQuarter = Math.round(60_000_000 / tempoBpm);
  return new Uint8Array([
    0xff,
    0x51,
    0x03,
    (microsecondsPerQuarter >> 16) & 0xff,
    (microsecondsPerQuarter >> 8) & 0xff,
    microsecondsPerQuarter & 0xff,
  ]);
}

/**
 * Encodes a time-signature meta event (FF 58 04 nn dd cc bb).
 *
 * The denominator is encoded as a negative power of two, so 8 becomes 3.
 */
function encodeTimeSignature(timeSignature: string): Uint8Array {
  const [numeratorText, denominatorText] = timeSignature.split('/');
  const numerator = Number(numeratorText ?? '4');
  const denominator = Number(denominatorText ?? '4');
  const denominatorPower = Math.round(Math.log2(denominator));
  return new Uint8Array([
    0xff,
    0x58,
    0x04,
    numerator & 0xff,
    denominatorPower & 0xff,
    24, // MIDI clocks per metronome click (24 ppqn)
    8, // 32nd notes per quarter note
  ]);
}

/** Encodes a text meta event (FF 04 len text). */
function encodeMetaText(type: number, text: string): Uint8Array {
  const textBytes = encodeUtf8(text);
  const bytes = new Uint8Array(3 + textBytes.length);
  bytes[0] = 0xff;
  bytes[1] = type;
  bytes[2] = textBytes.length;
  bytes.set(textBytes, 3);
  return bytes;
}

/**
 * Encodes a string as UTF-8 bytes.
 *
 * `src/core` is a pure TypeScript layer with no DOM types, so the writer
 * cannot use `TextEncoder`. The track names are ASCII, but the encoder
 * handles the full range so a non-ASCII name cannot corrupt a track.
 */
function encodeUtf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of text) {
    const codePoint = character.codePointAt(0) as number;
    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}

/** Encodes a note-on event (9n pp vv). */
function encodeNoteOn(channel: number, pitch: number, velocity: number): Uint8Array {
  return new Uint8Array([0x90 | ((channel - 1) & 0x0f), pitch & 0x7f, velocity & 0x7f]);
}

/** Encodes a note-off event (8n pp 00). */
function encodeNoteOff(channel: number, pitch: number): Uint8Array {
  return new Uint8Array([0x80 | ((channel - 1) & 0x0f), pitch & 0x7f, 0x00]);
}

/** Encodes a delta time as a MIDI variable-length quantity. */
function encodeVariableLength(value: number): Uint8Array {
  if (value < 0) {
    throw new RangeError(`Delta time must not be negative, got ${value}`);
  }
  let remaining = value;
  const bytes: number[] = [];
  bytes.push(remaining & 0x7f);
  remaining = Math.floor(remaining / 128);
  while (remaining > 0) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining = Math.floor(remaining / 128);
  }
  bytes.reverse();
  return new Uint8Array(bytes);
}

/** Writes a big-endian 16-bit value. */
function writeUint16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
}

/** Writes a big-endian 32-bit value. */
function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

/** Concatenates byte chunks. */
function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
