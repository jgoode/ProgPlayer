/**
 * The synth sink (P4.6, FR-SND-1, FR-SND-9, ADR-0002).
 *
 * The sink owns the `AudioContext` and the worklet that hosts the engine,
 * and it hands the engine's queue the events the scheduler produces.
 *
 * ## The clock
 *
 * The scheduler's clock is the **audio clock**, but the engine's clock is
 * the **render clock**. They are not the same: the audio clock is the
 * playback position, which trails the render position by the output
 * latency. Scheduling an event at the audio clock's `currentTime` would
 * make the engine dispatch it late by that latency.
 *
 * The sink therefore keeps a **clock offset** between the two, measured
 * from the worklet, and converts every target time into the engine's
 * clock. The offset is stable (both clocks advance by the same amount per
 * render quantum), so one measurement is enough.
 *
 * ## The quantum snap
 *
 * The engine drains its queue at the start of each render quantum, so an
 * event with an arbitrary target is dispatched on the first quantum whose
 * clock has reached it — up to 127 frames late. The target is therefore
 * snapped up to the next quantum boundary, using the engine's own clock
 * arithmetic (ADR-0002 §2, gap G-15).
 */

import type { PlaybackSink, ScheduledEvent } from '@core/scheduler/sinks';
import {
  MIDI_ALL_NOTES_OFF,
  MIDI_ALL_SOUND_OFF,
  MIDI_CONTROL_CHANGE,
  MIDI_NOTE_OFF,
  MIDI_NOTE_ON,
  MIDI_PROGRAM_CHANGE,
  quantumAlignedTarget,
  quantaForLead,
  RENDER_QUANTUM_FRAMES,
} from '@core/scheduler';

import { audioTimeToEngineTime, clockOffset } from './engine-clock';
import type { ClockSnapshot } from './engine-clock';

/** The name the worklet registers itself under. */
export const SYNTH_WORKLET_NAME = 'practiceplayer-synth';

/** How the sink finds the worklet module. */
export type SynthWorkletUrl = string;

/** Options for constructing a synth sink. */
export interface SynthSinkOptions {
  /** The URL of the worklet module. */
  readonly workletUrl: SynthWorkletUrl;
  /** The audio context to use. One is created when this is omitted. */
  readonly context?: AudioContext | undefined;
  /** The channels the parts use, keyed by part. */
  readonly channels?: Partial<Record<'chords' | 'bass' | 'click', number>> | undefined;
  /** The program (preset) each part uses. */
  readonly programs?: Partial<Record<'chords' | 'bass' | 'click', number>> | undefined;
  /** Reports a recoverable failure without stopping the playback. */
  readonly onError?: ((message: string) => void) | undefined;
}

/** The parts that have their own channel and preset. */
const PARTS = ['chords', 'bass', 'click'] as const;

/** The default channels (FR-SND-5: chords 1, bass 2, click 10). */
const DEFAULT_CHANNELS = { chords: 1, bass: 2, click: 10 } as const;

/** The default programs: the first preset of each bundled bank. */
const DEFAULT_PROGRAMS = { chords: 0, bass: 0, click: 0 } as const;

/** A sound bank the sink has loaded. */
export interface LoadedBank {
  /** The bank's identifier. */
  readonly id: string;
  /** The presets the bank contributed. */
  readonly presets: readonly { name: string; program: number; bankMSB: number; bankLSB: number }[];
}

/**
 * The sink that plays the arrangement through the bundled SoundFont engine.
 */
export class SynthSink implements PlaybackSink {
  readonly name = 'synth';

  private readonly context: AudioContext;

  private readonly ownsContext: boolean;

  private readonly channels: Record<'chords' | 'bass' | 'click', number>;

  private readonly programs: Record<'chords' | 'bass' | 'click', number>;

  private readonly onError: ((message: string) => void) | undefined;

  private readonly workletUrl: SynthWorkletUrl;

  private node: AudioWorkletNode | null = null;

  private readonly banks = new Map<string, LoadedBank>();

  /** The latest clock sample from the worklet. */
  private snapshot: ClockSnapshot | null = null;

  /** The channels that have carried a note, so all-notes-off covers them. */
  private readonly usedChannels = new Set<number>();

  /** How many events the sink has handed to the engine. */
  private scheduledCount = 0;

  constructor(options: SynthSinkOptions) {
    this.onError = options.onError;
    this.channels = { ...DEFAULT_CHANNELS, ...options.channels };
    this.programs = { ...DEFAULT_PROGRAMS, ...options.programs };
    this.workletUrl = options.workletUrl;
    if (options.context === undefined) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.ownsContext = true;
    } else {
      this.context = options.context;
      this.ownsContext = false;
    }
  }

  /** The audio context the sink plays through. */
  get audioContext(): AudioContext {
    return this.context;
  }

  /** The clock offset between the engine and the audio clock, in seconds. */
  get clockOffsetSeconds(): number {
    return this.snapshot === null ? 0 : clockOffset(this.snapshot);
  }

  /** The banks the sink has loaded. */
  get loadedBanks(): readonly LoadedBank[] {
    return [...this.banks.values()];
  }

  /**
   * Prepares the sink: loads the worklet, resumes the context and assigns
   * the presets.
   *
   * A failure here is reported to the caller, which leaves this sink inert
   * and lets the other sinks carry on (testing.md §4.4).
   */
  async start(): Promise<void> {
    if (this.node !== null) {
      return;
    }

    await this.context.audioWorklet.addModule(String(this.workletUrl));

    const node = new AudioWorkletNode(this.context, SYNTH_WORKLET_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    node.port.onmessage = (event: MessageEvent) => {
      this.handleWorkletMessage(event.data as Record<string, unknown>);
    };
    node.connect(this.context.destination);
    this.node = node;

    if (this.context.state === 'suspended') {
      await this.context.resume();
    }

    await this.refreshClockSnapshot();
  }

  /**
   * Loads a sound bank into the engine.
   *
   * The bank is parsed inside the worklet, so a large font never stalls the
   * UI (ADR-0002 §4).
   *
   * The bank's *bank offset* is its position in the bank's list, so every
   * bundled bank gets its own MIDI bank number. The bundled fonts all use
   * program 0, so without the offsets the bass would play the piano.
   */
  async loadBank(id: string, bytes: ArrayBuffer, bankOffset?: number): Promise<LoadedBank> {
    if (this.node === null) {
      throw new Error('The synth sink has not been started');
    }
    const buffer = bytes.slice(0);
    this.node.port.postMessage({ type: 'loadBank', id, buffer, bankOffset }, [buffer]);

    const bank = await this.waitForBank(id);
    this.banks.set(id, bank);
    return bank;
  }

  /**
   * Assigns a preset to a channel.
   *
   * The bank-select control chooses the bank and the program change picks
   * the preset inside it. Both are scheduled on the engine's clock, so the
   * assignment happens before the first note on that channel.
   */
  assignPreset(part: 'chords' | 'bass' | 'click', bankMSB: number, program?: number): void {
    const node = this.node;
    if (node === null) {
      return;
    }
    const channel = this.channels[part];
    this.usedChannels.add(channel);
    const time = this.engineTarget(this.context.currentTime);
    // Bank select (MSB), then the program change.
    node.port.postMessage({ type: 'message', bytes: [0xb0 | (channel - 1), 0, bankMSB], time });
    node.port.postMessage({
      type: 'programChange',
      channel,
      program: program ?? this.programs[part],
      time,
    });
  }

  /** Schedules one event on the engine's clock. */
  schedule(event: ScheduledEvent): void {
    if (this.node === null) {
      return;
    }

    switch (event.kind) {
      case 'noteOn': {
        this.usedChannels.add(event.channel);
        this.send(this.noteOnBytes(event.channel, event.pitch, event.velocity), event.time);
        break;
      }
      case 'noteOff': {
        this.send(this.noteOffBytes(event.channel, event.pitch), event.time);
        break;
      }
      case 'click': {
        // The click is synthesized inside the worklet, because the bundled
        // SoundFonts contain no percussion bank (P4.6).
        this.node.port.postMessage({
          type: 'click',
          time: this.engineTarget(event.time),
          accented: event.accent === 'bar',
          velocity: event.velocity,
        });
        this.scheduledCount += 1;
        break;
      }
      case 'allNotesOff': {
        this.allNotesOff();
        break;
      }
    }
  }

  /**
   * Releases every sounding note and drops the pending events.
   *
   * This is called on stop and on pause, so no note is ever left hanging
   * (FR-SND-9).
   */
  allNotesOff(): void {
    if (this.node === null) {
      return;
    }
    const channels = [...this.usedChannels];
    if (channels.length === 0) {
      return;
    }
    this.node.port.postMessage({ type: 'allNotesOff', channels });
  }

  /** Releases the audio context and the worklet. */
  dispose(): void {
    this.node?.disconnect();
    this.node?.port.close();
    this.node = null;
    if (this.ownsContext) {
      void this.context.close();
    }
  }

  /** How many events the sink has handed to the engine. */
  get scheduledEventCount(): number {
    return this.scheduledCount;
  }

  /**
   * Converts an audio-clock time into the engine's clock and snaps it to
   * the next render-quantum boundary.
   */
  private engineTarget(audioTime: number): number {
    const snapshot = this.snapshot;
    if (snapshot === null) {
      // Without a clock sample the best available estimate is the audio
      // clock itself. The worklet publishes a sample as soon as it is
      // ready, so this only applies to events scheduled in the very first
      // milliseconds of a run.
      return audioTime;
    }
    const engineTime = audioTimeToEngineTime(snapshot, audioTime);
    const quanta = quantaForLead((engineTime - snapshot.engineTime) * this.context.sampleRate);
    return quantumAlignedTarget(
      snapshot.engineTime,
      quanta,
      this.context.sampleRate,
      RENDER_QUANTUM_FRAMES,
    );
  }

  /** Hands one raw MIDI message to the engine. */
  private send(bytes: number[], audioTime: number): void {
    const node = this.node;
    if (node === null) {
      return;
    }
    node.port.postMessage({ type: 'message', bytes, time: this.engineTarget(audioTime) });
    this.scheduledCount += 1;
  }

  /** The bytes of a note-on message. */
  private noteOnBytes(channel: number, pitch: number, velocity: number): number[] {
    return [MIDI_NOTE_ON | (channel - 1), pitch, Math.max(1, Math.min(127, velocity))];
  }

  /** The bytes of a note-off message. */
  private noteOffBytes(channel: number, pitch: number): number[] {
    return [MIDI_NOTE_OFF | (channel - 1), pitch, 0];
  }

  /** Handles a message from the worklet. */
  private handleWorkletMessage(message: Record<string, unknown>): void {
    switch (message['type']) {
      case 'clock': {
        this.snapshot = {
          engineTime: Number(message['engineTime']),
          audioTime: Number(message['audioTime']),
          frame: Number(message['frame']),
        };
        break;
      }
      case 'error': {
        this.onError?.(String(message['message']));
        break;
      }
      default:
        break;
    }
  }

  /** Waits for a bank to be parsed by the worklet. */
  private waitForBank(id: string): Promise<LoadedBank> {
    const node = this.node;
    if (node === null) {
      return Promise.reject(new Error('The synth sink has not been started'));
    }
    return new Promise<LoadedBank>((resolve, reject) => {
      const previous = node.port.onmessage;
      const timeout = setTimeout(() => {
        node.port.onmessage = previous;
        reject(new Error(`The sound bank "${id}" did not load within 30 seconds`));
      }, 30_000);

      node.port.onmessage = (event: MessageEvent) => {
        const message = event.data as Record<string, unknown>;
        if (message['type'] === 'bankLoaded' && message['id'] === id) {
          clearTimeout(timeout);
          node.port.onmessage = previous;
          resolve({
            id,
            presets: (message['presets'] as LoadedBank['presets']) ?? [],
          });
          return;
        }
        if (message['type'] === 'error') {
          clearTimeout(timeout);
          node.port.onmessage = previous;
          reject(new Error(String(message['message'])));
          return;
        }
        this.handleWorkletMessage(message);
      };
    });
  }

  /** Asks the worklet for a clock sample and waits for it. */
  private refreshClockSnapshot(): Promise<void> {
    const node = this.node;
    if (node === null) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const previous = node.port.onmessage;
      const timeout = setTimeout(() => {
        node.port.onmessage = previous;
        resolve();
      }, 2000);

      node.port.onmessage = (event: MessageEvent) => {
        const message = event.data as Record<string, unknown>;
        if (message['type'] === 'clock') {
          clearTimeout(timeout);
          node.port.onmessage = previous;
          this.handleWorkletMessage(message);
          resolve();
          return;
        }
        this.handleWorkletMessage(message);
      };
      node.port.postMessage({ type: 'clock' });
    });
  }
}

/** The control-change bytes that release every note on a channel. */
export function allNotesOffBytes(channel: number): number[] {
  return [MIDI_CONTROL_CHANGE | (channel - 1), MIDI_ALL_NOTES_OFF, 0];
}

/** The control-change bytes that silence a channel completely. */
export function allSoundOffBytes(channel: number): number[] {
  return [MIDI_CONTROL_CHANGE | (channel - 1), MIDI_ALL_SOUND_OFF, 0];
}

/** The bytes of a program change. */
export function programChangeBytes(channel: number, program: number): number[] {
  return [MIDI_PROGRAM_CHANGE | (channel - 1), program & 0x7f];
}

/** The parts that have their own channel. */
export { PARTS as SYNTH_PARTS };
