/**
 * The synth AudioWorklet (P4.6, ADR-0002 §2 and §4).
 *
 * The worklet owns the `SpessaSynthProcessor`. It is the only place the
 * engine is touched, so:
 *
 * - the sound bank is parsed **inside the worklet**, not on the main
 *   thread, so a 30 MB font cannot stall the UI (ADR-0002 §4);
 * - every event is scheduled on the **engine's own clock**, snapped to the
 *   render-quantum grid, so the dispatch error is 0 frames (ADR-0002 §2).
 *
 * ## The clock
 *
 * The engine advances its clock only when it renders, by exactly
 * `sampleCount * (1 / sampleRate)` per call. The worklet's `currentTime`
 * advances in exactly the same way, so the two are interchangeable: the
 * engine clock *is* the worklet clock. (Measured in Electron 45 /
 * Chromium at 48 kHz: the two agree to within 6 ULP over a whole run, and
 * the engine's increment is exactly `128 / 48000` per render quantum.)
 *
 * The main thread's `AudioContext.currentTime` is a *different* clock: it
 * is the playback position, which trails the render position by the output
 * latency. The worklet therefore reports its own clock to the main
 * thread, and the main thread schedules against that.
 *
 * ## The message protocol
 *
 * The main thread posts:
 *
 * - `{ type: 'loadBank', id, buffer }` — parse and add a sound bank;
 * - `{ type: 'programChange', channel, program, time }` — choose a preset;
 * - `{ type: 'message', bytes, time }` — schedule a raw MIDI message;
 * - `{ type: 'allNotesOff', channels }` — silence the used channels;
 * - `{ type: 'clock' }` — ask for a clock sample.
 *
 * The worklet posts:
 *
 * - `{ type: 'ready' }` — the processor exists;
 * - `{ type: 'bankLoaded', id, presets }` — a bank was parsed;
 * - `{ type: 'clock', engineTime, audioTime, frame }` — a clock sample;
 * - `{ type: 'error', message }` — a recoverable failure.
 */

import { BasicSoundBank, SoundBankLoader, SpessaSynthProcessor } from 'spessasynth_core';

import {
  CLICK_DURATION_SECONDS,
  CLICK_PEAK_GAIN,
  clickEnvelope,
  clickFrequency,
} from './click-source';

/**
 * Ambient declarations for the `AudioWorkletGlobalScope`.
 *
 * TypeScript's DOM library does not ship the worklet globals, and the
 * `AudioWorkletProcessor` base class only exists in the worklet realm.
 */
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare const currentFrame: number;
declare const currentTime: number;
declare const sampleRate: number;
declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor,
): void;

/** The name the worklet registers itself under. */
export const SYNTH_WORKLET_NAME = 'practiceplayer-synth';

/** A sound bank request from the main thread. */
interface LoadBankMessage {
  readonly type: 'loadBank';
  readonly id: string;
  readonly buffer: ArrayBuffer;
  /**
   * The MIDI bank number the bank is given.
   *
   * The bundled fonts all use program 0, so each bank needs its own bank
   * number or the bass would play the piano.
   */
  readonly bankOffset?: number | undefined;
}

/** A raw MIDI message to schedule. */
interface ScheduleMessage {
  readonly type: 'message';
  readonly bytes: number[];
  /** The engine-clock time the message should be dispatched at. */
  readonly time: number;
}

/** A program change to schedule. */
interface ProgramChangeMessage {
  readonly type: 'programChange';
  readonly channel: number;
  readonly program: number;
  readonly time: number;
}

/** A request to silence the used channels. */
interface AllNotesOffMessage {
  readonly type: 'allNotesOff';
  readonly channels: readonly number[];
}

/**
 * A click to sound.
 *
 * The click is synthesized rather than played from a SoundFont: the
 * bundled banks contain no percussion, and the app does not bundle a drum
 * kit (P4.6).
 */
interface ClickMessage {
  readonly type: 'click';
  /** The engine-clock time the click should sound at. */
  readonly time: number;
  /** True for the accented downbeat. */
  readonly accented: boolean;
  /** The click's velocity, 1..127. */
  readonly velocity: number;
}

/** A request for a clock sample. */
interface ClockMessage {
  readonly type: 'clock';
}

type WorkletRequest =
  | LoadBankMessage
  | ScheduleMessage
  | ProgramChangeMessage
  | AllNotesOffMessage
  | ClickMessage
  | ClockMessage;

/**
 * A click that is waiting to sound.
 *
 * The click's phase is computed from its start frame, so every click is
 * phase-accurate regardless of when it is triggered.
 */
interface PendingClick {
  /** The engine-clock time the click starts at. */
  readonly time: number;
  /** The click's frequency, in hertz. */
  readonly frequency: number;
  /** The click's peak gain, in linear amplitude. */
  readonly gain: number;
  /** The phase, in radians, at the start of the click. */
  readonly phase: number;
}

/** The synth worklet processor. */
class SynthProcessor extends AudioWorkletProcessor {
  private readonly processor: SpessaSynthProcessor;

  /** The channels that have been used, so all-notes-off covers them. */
  private readonly usedChannels = new Set<number>();

  /**
   * The clicks that are waiting to sound, in the order they will sound.
   *
   * The list is kept sorted by time, so the oldest click is always the
   * first one to be rendered.
   */
  private readonly pendingClicks: PendingClick[] = [];

  constructor() {
    super();
    this.processor = new SpessaSynthProcessor(sampleRate, {
      maxBufferSize: 128,
      // The effects chain is on: S1 measured the reverb and chorus on the
      // bundled banks, and gap G-17 is closed in favour of the dry-plus-
      // effects signal (ADR-0002, "Effects chain").
      effectsEnabled: true,
      eventsEnabled: false,
      initialTime: currentTime,
    });

    this.port.onmessage = (event: MessageEvent<WorkletRequest>) => {
      void this.handleMessage(event.data);
    };

    this.port.postMessage({ type: 'ready', engineTime: this.processor.currentTime });
  }

  /** Handles one request from the main thread. */
  private async handleMessage(request: WorkletRequest): Promise<void> {
    try {
      switch (request.type) {
        case 'loadBank': {
          // The Vorbis decoder must be ready before an SF3 bank can be
          // parsed; it is only awaited once per realm.
          await BasicSoundBank.ready;
          const bank = SoundBankLoader.fromArrayBuffer(request.buffer);
          this.processor.soundBankManager.addSoundBank(bank, request.id, request.bankOffset ?? 0);
          this.port.postMessage({
            type: 'bankLoaded',
            id: request.id,
            presets: this.processor.soundBankManager.presetList.map((preset) => ({
              name: preset.name,
              program: preset.program,
              bankMSB: preset.bankMSB,
              bankLSB: preset.bankLSB,
            })),
          });
          break;
        }
        case 'programChange': {
          this.usedChannels.add(request.channel);
          this.processor.processMessage(
            new Uint8Array([0xc0 | (request.channel - 1), request.program & 0x7f]),
            0,
            { time: request.time },
          );
          break;
        }
        case 'message': {
          const bytes = request.bytes;
          const status = bytes[0] ?? 0;
          const channel = (status & 0x0f) + 1;
          this.usedChannels.add(channel);
          this.processor.processMessage(new Uint8Array(bytes), 0, { time: request.time });
          break;
        }
        case 'allNotesOff': {
          // Both controls are sent, as implementation.md §2.4 requires:
          // CC 123 releases the notes, CC 120 clears the sound entirely.
          for (const channel of request.channels) {
            const zeroBased = channel - 1;
            this.processor.processMessage(new Uint8Array([0xb0 | zeroBased, 123, 0]), 0, {
              time: this.processor.currentTime,
            });
            this.processor.processMessage(new Uint8Array([0xb0 | zeroBased, 120, 0]), 0, {
              time: this.processor.currentTime,
            });
          }
          // The pending queue is dropped as well: a note that was scheduled
          // but not yet dispatched must not sound after a stop (FR-SND-9).
          this.processor.stopAll(true);
          // The pending clicks are dropped for the same reason: a click
          // that was scheduled but not yet sounded must not be heard after
          // a stop.
          this.pendingClicks.length = 0;
          break;
        }
        case 'click': {
          this.pendingClicks.push({
            time: request.time,
            frequency: clickFrequency(request.accented),
            // The velocity scales the click's level, with 127 as full.
            gain: (CLICK_PEAK_GAIN * request.velocity) / 127,
            // The phase is derived from the click's start time, so every
            // click starts at the same point of its cycle.
            phase: (2 * Math.PI * clickFrequency(request.accented) * request.time) % (2 * Math.PI),
          });
          this.pendingClicks.sort((a, b) => a.time - b.time);
          break;
        }
        case 'clock': {
          this.port.postMessage({
            type: 'clock',
            engineTime: this.processor.currentTime,
            audioTime: currentTime,
            frame: currentFrame,
          });
          break;
        }
      }
    } catch (error: unknown) {
      this.port.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Renders one quantum.
   *
   * The engine writes into the buffers it is given, so they must be zeroed
   * before every call. The clicks are mixed in afterwards, so a click is
   * never affected by the engine's gain staging.
   */
  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    const left = output?.[0];
    const right = output?.[1];
    if (!left || !right) {
      return true;
    }

    left.fill(0);
    right.fill(0);
    this.processor.process(left, right);
    this.renderClicks(left, right);
    return true;
  }

  /**
   * Mixes the pending clicks into the output buffers.
   *
   * The clicks are rendered from their start frame, so the phase is exact
   * and the join at a loop boundary is seamless.
   */
  private renderClicks(left: Float32Array, right: Float32Array): void {
    if (this.pendingClicks.length === 0) {
      return;
    }

    const quantumStart = this.processor.currentTime;
    const quantumEnd = quantumStart + left.length / sampleRate;

    // Clicks that ended before this quantum are dropped.
    while (
      this.pendingClicks.length > 0 &&
      (this.pendingClicks[0] as PendingClick).time + CLICK_DURATION_SECONDS < quantumStart
    ) {
      this.pendingClicks.shift();
    }

    for (const click of this.pendingClicks) {
      if (click.time >= quantumEnd) {
        break;
      }

      const startFrame = Math.max(0, Math.round((click.time - quantumStart) * sampleRate));

      for (let frame = startFrame; frame < left.length; frame += 1) {
        const t = click.time - quantumStart + frame / sampleRate;
        if (t >= CLICK_DURATION_SECONDS) {
          break;
        }
        const envelope = clickEnvelope(t, CLICK_DURATION_SECONDS);
        const sample =
          Math.sin(click.phase + 2 * Math.PI * click.frequency * t) * envelope * click.gain;
        left[frame] = (left[frame] as number) + sample;
        right[frame] = (right[frame] as number) + sample;
      }
    }
  }
}

registerProcessor(SYNTH_WORKLET_NAME, SynthProcessor);
