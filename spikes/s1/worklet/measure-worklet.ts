/**
 * Spike S1 measurement worklet.
 *
 * Runs `spessasynth_core`'s `SpessaSynthProcessor` directly inside an
 * AudioWorklet so the spike can observe the *dispatch* frame of scheduled
 * events, not just the audible onset.
 *
 * How it works:
 *
 * - `SpessaSynthProcessor.processMessage(message, offset, { time })` queues a
 *   future-timed MIDI message. The queue is drained at the start of
 *   `process()`, so the message is dispatched on the first render quantum whose
 *   engine clock has reached the requested time.
 * - The core's `noteOn` event callback fires inside that dispatch, so the
 *   AudioWorklet global `currentFrame` read there is the exact frame the event
 *   was dispatched on.
 *
 * The worklet also keeps 10 ms block statistics so the soak run can count
 * silent blocks (dropouts), and it can capture the rendered PCM.
 *
 * The engine writes into the output buffers it is given, so the buffers must
 * be zeroed before every `process()` call.
 */

import {
  BasicSoundBank,
  SoundBankLoader,
  SpessaSynthProcessor,
  type SynthesizerEventCallback,
} from 'spessasynth_core';

import { engineClockAfterQuanta, quantaForLead, RENDER_QUANTUM_FRAMES } from '../renderer/analysis';

/**
 * Ambient declarations for the `AudioWorkletGlobalScope`.
 *
 * TypeScript's DOM library does not ship the worklet globals, and the
 * `AudioWorkletProcessor` base class is only available in the worklet realm.
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

const BLOCK_FRAMES = 480; // 10 ms at 48 kHz

interface ScheduledEvent {
  id: number;
  message: number[];
  time?: number;
  offsetSeconds?: number;
  channel: number;
  note: number;
  isNoteOn: boolean;
}

class SpikeMeasureProcessor extends AudioWorkletProcessor {
  private readonly processor: SpessaSynthProcessor;
  private readonly pendingNoteOns: Map<number, { channel: number; note: number; time: number }>;

  private captureBuffer: Float32Array | null = null;
  private capturedFrames = 0;
  /** Frame at which the capture starts; `Infinity` means "from now". */
  private captureFromFrame = Number.POSITIVE_INFINITY;

  private totalFrames = 0;
  private totalQuanta = 0;
  private peak = 0;
  private sumSquares = 0;
  private totalBlocks = 0;
  private silentBlocks = 0;
  private dropouts = 0;
  private lastAudibleBlock = -1;
  /**
   * The engine time at which the first note of the current run was
   * dispatched. Silent blocks *before* that are the intentional lead-in, not
   * dropouts, so they must not be counted.
   */
  private soundStartEngineTime: number | null = null;
  /** Block indices of the silent blocks, so a dropout can be located. */
  private readonly silentBlockIndices: number[] = [];
  private blockPeak = 0;
  private blockFrames = 0;
  private peakVoices = 0;
  private voiceTotal = 0;

  constructor() {
    super();
    this.pendingNoteOns = new Map();
    this.processor = new SpessaSynthProcessor(sampleRate, {
      maxBufferSize: 128,
      effectsEnabled: true,
      eventsEnabled: true,
      initialTime: currentTime,
    });
    this.processor.onEventCall = (event: SynthesizerEventCallback) => {
      this.handleSynthEvent(event);
    };
    this.port.onmessage = (event: MessageEvent) => {
      void this.handleMessage(event.data as Record<string, unknown>);
    };
  }

  private handleSynthEvent(event: SynthesizerEventCallback): void {
    if (event.type !== 'noteOn') return;
    const channel = event.data.channel;
    const note = event.data.midiNote;
    if (this.soundStartEngineTime === null) {
      this.soundStartEngineTime = this.processor.currentTime;
    }
    for (const [id, pending] of this.pendingNoteOns) {
      if (pending.channel === channel && pending.note === note) {
        this.pendingNoteOns.delete(id);
        this.port.postMessage({
          type: 'noteOn',
          id,
          frame: currentFrame,
          engineTime: this.processor.currentTime,
          intendedTime: pending.time,
        });
        return;
      }
    }
  }

  private async handleMessage(message: Record<string, unknown>): Promise<void> {
    switch (message['type']) {
      case 'clock': {
        this.port.postMessage({
          type: 'clock',
          engineTime: this.processor.currentTime,
          currentFrame,
          currentTime,
          sampleRate,
        });
        break;
      }
      case 'loadBank': {
        const started = Date.now();
        // `BasicSoundBank.ready` resolves once the SF3/SF2Pack Vorbis decoder
        // is available; it only has to be awaited once per realm.
        await BasicSoundBank.ready;
        const decoderReadyMs = Date.now() - started;
        const parseStarted = Date.now();
        const buffer = message['buffer'] as ArrayBuffer;
        const bank = SoundBankLoader.fromArrayBuffer(buffer);
        const parseMs = Date.now() - parseStarted;
        const addStarted = Date.now();
        this.processor.soundBankManager.addSoundBank(bank, 'main');
        const addMs = Date.now() - addStarted;
        this.port.postMessage({
          type: 'bankLoaded',
          decoderReadyMs,
          parseMs,
          addMs,
          totalMs: Date.now() - started,
          bytes: buffer.byteLength,
          presets: this.processor.soundBankManager.presetList.length,
        });
        break;
      }
      case 'schedule': {
        const events = message['events'] as ScheduledEvent[];
        const leadSeconds = message['leadSeconds'] as number | undefined;
        const alignToQuantum = message['alignToQuantum'] === true;
        const captureFrames = message['captureFrames'] as number | undefined;

        // Two ways to name the target time:
        //
        // - `leadSeconds`: the target is computed here, on the audio thread,
        //   so the round-trip time of the message does not enter the
        //   measurement. The engine drains its queue at the start of a render
        //   quantum, so a target that is not on a quantum boundary is
        //   dispatched late by up to one quantum; `alignToQuantum` snaps the
        //   target to the next boundary, as ADR-0002 requires.
        // - absolute `time` on each event: used by the soak run, where the
        //   whole arrangement is queued at once.
        //
        // The aligned target is computed with the engine's *own* clock
        // arithmetic — `currentTime` advanced by `quantumFrames *
        // (1 / sampleRate)` once per quantum, accumulated. Computing it any
        // other way leaves the target a few ULP above the clock the engine
        // will actually reach, and the engine's `event.time <= currentTime`
        // test then fails, dispatching the event a whole quantum late.
        const target =
          leadSeconds !== undefined
            ? alignToQuantum
              ? engineClockAfterQuanta(
                  this.processor.currentTime,
                  quantaForLead(leadSeconds * sampleRate, RENDER_QUANTUM_FRAMES),
                  sampleRate,
                  RENDER_QUANTUM_FRAMES,
                )
              : this.processor.currentTime + leadSeconds
            : this.processor.currentTime;

        for (const entry of events) {
          const time =
            leadSeconds !== undefined ? target + (entry.offsetSeconds ?? 0) : (entry.time ?? 0);
          this.processor.processMessage(new Uint8Array(entry.message), 0, { time });
          if (entry.isNoteOn) {
            this.pendingNoteOns.set(entry.id, {
              channel: entry.channel,
              note: entry.note,
              time,
            });
          }
        }

        if (captureFrames !== undefined) {
          // The capture starts at the exact frame the first scheduled event is
          // dispatched on, so the capture and an offline render of the same
          // arrangement start at the same sample.
          //
          // The engine clock and the worklet's frame counter have different
          // origins, so the target is converted into a frame offset from the
          // current render position.
          const framesUntilTarget = Math.round((target - this.processor.currentTime) * sampleRate);
          this.captureFromFrame = currentFrame + framesUntilTarget;
          this.captureBuffer = new Float32Array(captureFrames);
          this.capturedFrames = 0;
        }

        this.port.postMessage({
          type: 'scheduled',
          target,
          leadSeconds,
          alignToQuantum,
          captureFromFrame: this.captureFromFrame,
        });
        break;
      }
      case 'stopAll': {
        this.processor.stopAll(true);
        break;
      }
      case 'stopCapture': {
        const samples = this.captureBuffer
          ? this.captureBuffer.slice(0, this.capturedFrames)
          : new Float32Array(0);
        this.captureBuffer = null;
        this.captureFromFrame = Number.POSITIVE_INFINITY;
        this.port.postMessage({ type: 'captureEnded', samples });
        break;
      }
      case 'stats': {
        this.port.postMessage({
          type: 'stats',
          totalFrames: this.totalFrames,
          totalQuanta: this.totalQuanta,
          peak: this.peak,
          sumSquares: this.sumSquares,
          totalBlocks: this.totalBlocks,
          silentBlocks: this.silentBlocks,
          dropouts: this.dropouts,
          silentBlockIndices: this.silentBlockIndices.slice(0, 64),
          peakVoices: this.peakVoices,
          meanVoices: this.totalQuanta > 0 ? this.voiceTotal / this.totalQuanta : 0,
          currentFrame,
          engineTime: this.processor.currentTime,
          sampleRate,
        });
        break;
      }
      case 'resetStats': {
        this.totalFrames = 0;
        this.totalQuanta = 0;
        this.peak = 0;
        this.sumSquares = 0;
        this.totalBlocks = 0;
        this.silentBlocks = 0;
        this.dropouts = 0;
        this.lastAudibleBlock = -1;
        this.soundStartEngineTime = null;
        this.silentBlockIndices.length = 0;
        this.blockPeak = 0;
        this.blockFrames = 0;
        this.peakVoices = 0;
        this.voiceTotal = 0;
        break;
      }
      default:
        break;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    const left = output?.[0];
    const right = output?.[1];
    if (!left || !right) return true;

    // The engine accumulates into the buffers it is given.
    left.fill(0);
    right.fill(0);
    this.processor.process(left, right);

    const frames = left.length;
    let peak = 0;
    let sumSquares = 0;
    for (let i = 0; i < frames; i++) {
      const value = left[i] ?? 0;
      const absolute = Math.abs(value);
      if (absolute > peak) peak = absolute;
      sumSquares += value * value;
    }

    this.totalFrames += frames;
    this.totalQuanta += 1;
    if (peak > this.peak) this.peak = peak;
    this.sumSquares += sumSquares;
    if (this.processor.voiceCount > this.peakVoices) {
      this.peakVoices = this.processor.voiceCount;
    }
    this.voiceTotal += this.processor.voiceCount;

    let remaining = frames;
    let offset = 0;
    while (remaining > 0) {
      const take = Math.min(remaining, BLOCK_FRAMES - this.blockFrames);
      let blockPeak = this.blockPeak;
      for (let i = offset; i < offset + take; i++) {
        const absolute = Math.abs(left[i] ?? 0);
        if (absolute > blockPeak) blockPeak = absolute;
      }
      this.blockFrames += take;
      this.blockPeak = blockPeak;
      offset += take;
      remaining -= take;
      if (this.blockFrames === BLOCK_FRAMES) {
        this.totalBlocks += 1;
        if (this.blockPeak < 1e-4) {
          this.silentBlocks += 1;
          // A silent block only counts as a dropout once the run has
          // produced sound. The silent blocks before the first note are the
          // intentional lead-in, not a failure of the audio thread.
          if (this.lastAudibleBlock >= 0 && this.soundStartEngineTime !== null) {
            this.dropouts += 1;
            this.silentBlockIndices.push(this.totalBlocks);
          }
        } else {
          this.lastAudibleBlock = this.totalBlocks;
        }
        this.blockFrames = 0;
        this.blockPeak = 0;
      }
    }

    if (this.captureBuffer) {
      // `currentFrame` is the first frame of the current render quantum, so
      // the quantum covers `[currentFrame, currentFrame + frames)`.
      if (currentFrame + frames > this.captureFromFrame) {
        const skip = Math.max(0, Math.ceil(this.captureFromFrame - currentFrame));
        const end = Math.min(this.capturedFrames + (frames - skip), this.captureBuffer.length);
        const copyLength = Math.max(0, end - this.capturedFrames);
        if (copyLength > 0) {
          this.captureBuffer.set(left.subarray(skip, skip + copyLength), this.capturedFrames);
          this.capturedFrames += copyLength;
        }
      }
    }

    return true;
  }
}

registerProcessor('spike-measure', SpikeMeasureProcessor);

/**
 * A pass-through recorder.
 *
 * Captures the audio that another node produces, so a real-time render of the
 * library's own path can be compared with its offline render.
 */
class SpikeRecorderProcessor extends AudioWorkletProcessor {
  private buffer: Float32Array | null = null;
  private capturedFrames = 0;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent) => {
      const message = event.data as Record<string, unknown>;
      if (message['type'] === 'record') {
        this.buffer = new Float32Array(message['frames'] as number);
        this.capturedFrames = 0;
      } else if (message['type'] === 'stopRecording') {
        const samples = this.buffer
          ? this.buffer.slice(0, this.capturedFrames)
          : new Float32Array(0);
        this.buffer = null;
        this.port.postMessage({ type: 'recorded', samples });
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const output = outputs[0];
    const left = output?.[0];
    const right = output?.[1];
    if (!left || !right) return true;

    const source = input?.[0];
    if (source) {
      left.set(source);
      const sourceRight = input?.[1];
      if (sourceRight) right.set(sourceRight);
    } else {
      left.fill(0);
      right.fill(0);
    }

    if (this.buffer) {
      const end = Math.min(this.capturedFrames + left.length, this.buffer.length);
      this.buffer.set(left.subarray(0, end - this.capturedFrames), this.capturedFrames);
      this.capturedFrames = end;
    }

    return true;
  }
}

registerProcessor('spike-recorder', SpikeRecorderProcessor);
