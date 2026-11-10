/**
 * MIDI message helpers (P4.6, P4.7).
 *
 * The synth sink hands the engine raw MIDI messages, and the click source
 * is a MIDI channel of its own. These helpers build the messages, so the
 * byte-level rules live in one place and can be unit tested without an
 * audio device.
 */

/** MIDI status bytes used by the app. */
export const MIDI_NOTE_OFF = 0x80;
export const MIDI_NOTE_ON = 0x90;
export const MIDI_PROGRAM_CHANGE = 0xc0;
export const MIDI_CONTROL_CHANGE = 0xb0;

/** The MIDI control change that stops every sounding note (CC 123). */
export const MIDI_ALL_NOTES_OFF = 123;

/** The MIDI control change that stops every sound (CC 120). */
export const MIDI_ALL_SOUND_OFF = 120;

/**
 * Builds a note-on message.
 *
 * A velocity of 0 is a note-off in disguise, so it is normalised to a real
 * note-off message.
 */
export function noteOnMessage(channel: number, pitch: number, velocity: number): Uint8Array {
  const zeroBased = assertChannel(channel);
  assertPitch(pitch);
  const clampedVelocity = Math.max(1, Math.min(127, Math.round(velocity)));
  return new Uint8Array([MIDI_NOTE_ON | zeroBased, pitch, clampedVelocity]);
}

/** Builds a note-off message. */
export function noteOffMessage(channel: number, pitch: number): Uint8Array {
  const zeroBased = assertChannel(channel);
  assertPitch(pitch);
  return new Uint8Array([MIDI_NOTE_OFF | zeroBased, pitch, 0]);
}

/** Builds a program-change message. */
export function programChangeMessage(channel: number, program: number): Uint8Array {
  const zeroBased = assertChannel(channel);
  const clamped = Math.max(0, Math.min(127, Math.round(program)));
  return new Uint8Array([MIDI_PROGRAM_CHANGE | zeroBased, clamped]);
}

/** Builds a control-change message. */
export function controlChangeMessage(
  channel: number,
  controller: number,
  value: number,
): Uint8Array {
  const zeroBased = assertChannel(channel);
  const clampedValue = Math.max(0, Math.min(127, Math.round(value)));
  return new Uint8Array([
    MIDI_CONTROL_CHANGE | zeroBased,
    Math.max(0, Math.min(127, Math.round(controller))),
    clampedValue,
  ]);
}

/**
 * Converts a user-facing channel number (1..16) to the engine's
 * zero-based channel index (0..15).
 */
export function assertChannel(channel: number): number {
  if (!Number.isInteger(channel) || channel < 1 || channel > 16) {
    throw new RangeError(`MIDI channel must be an integer in 1..16, got ${String(channel)}`);
  }
  return channel - 1;
}

/** Checks that a pitch is a valid MIDI note number. */
export function assertPitch(pitch: number): void {
  if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) {
    throw new RangeError(`MIDI pitch must be an integer in 0..127, got ${String(pitch)}`);
  }
}
