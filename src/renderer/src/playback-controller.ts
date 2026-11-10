/**
 * The playback controller (P4.3-P4.9).
 *
 * It wires the pieces together: the compiled timeline, the transport, the
 * scheduler, the synth sink and the Worker timer. The React component owns
 * the controller's lifetime; the controller itself knows nothing about
 * React.
 *
 * The clock the scheduler reads is the **audio clock**
 * (`AudioContext.currentTime`), as implementation.md §2.4 requires, and the
 * timer is the **Worker timer**, so the scheduling never depends on the
 * UI thread.
 */

import type { CompiledTimeline } from '@core/compiler';
import { Scheduler } from '@core/scheduler';
import type { SchedulerOptions, SchedulerPosition } from '@core/scheduler';
import { Transport } from '@core/scheduler';

import { SynthSink } from '@audio/synth-sink';
import { WorkerTimer } from '@audio/worker-timer';

/** How the controller is wired up. */
export interface PlaybackControllerOptions {
  /** The compiled arrangement to play. */
  readonly timeline: CompiledTimeline;
  /** The URL of the Worker module that drives the timer. */
  readonly timerWorkerUrl: URL | string;
  /** The URL of the AudioWorklet module that hosts the engine. */
  readonly workletUrl: URL | string;
  /** The bundled sound banks, keyed by the part they play. */
  readonly banks: readonly {
    readonly part: 'chords' | 'bass' | 'click';
    readonly url: URL | string;
  }[];
  /** Reports a recoverable failure. */
  readonly onError?: ((message: string) => void) | undefined;
  /** Reports a sink failure without stopping the playback. */
  readonly onSinkError?: ((name: string, error: Error) => void) | undefined;
  /** Reports the playback position. */
  readonly onPosition?: ((position: SchedulerPosition) => void) | undefined;
  /** The look-ahead window, in seconds. */
  readonly lookAheadSeconds?: number | undefined;
}

/**
 * Drives the playback of one arrangement.
 */
export class PlaybackController {
  private readonly options: PlaybackControllerOptions;

  private readonly transport: Transport;

  private readonly sink: SynthSink;

  private timer: WorkerTimer | null = null;

  private scheduler: Scheduler | null = null;

  private starting: Promise<void> | null = null;

  private stopped = false;

  constructor(options: PlaybackControllerOptions) {
    this.options = options;
    this.transport = new Transport({ timeline: options.timeline });
    this.sink = new SynthSink({
      workletUrl: String(options.workletUrl),
      onError: options.onError,
    });
  }

  /** The transport, so the UI can read the playback state. */
  get currentTransport(): Transport {
    return this.transport;
  }

  /** The scheduler's metrics. */
  get metrics(): Scheduler['metrics'] {
    return (
      this.scheduler?.metrics ?? {
        eventsScheduled: 0,
        lateEvents: 0,
        maxLatenessSeconds: 0,
        totalLatenessSeconds: 0,
        lateTimerFires: 0,
        maxTimerOverrunSeconds: 0,
      }
    );
  }

  /**
   * Starts the playback.
   *
   * The audio context is created and the sound banks are loaded on the
   * first call; later calls reuse them.
   */
  async play(): Promise<void> {
    if (this.starting !== null) {
      await this.starting;
      return;
    }
    this.starting = this.startPlayback();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  /** Pauses the playback and releases every sounding note. */
  pause(): void {
    this.scheduler?.pause();
  }

  /** Resumes the playback from the interrupted beat. */
  resume(): void {
    this.scheduler?.resume();
  }

  /** Stops the playback and releases every sounding note. */
  stop(): void {
    this.scheduler?.stop();
  }

  /** Changes the tempo; it takes effect at the next beat. */
  setTempo(bpm: number): void {
    this.scheduler?.setTempo(bpm);
  }

  /** Releases every resource the controller holds. */
  dispose(): void {
    this.stopped = true;
    this.scheduler?.stop();
    this.timer?.dispose();
    this.timer = null;
    this.scheduler = null;
    this.sink.dispose();
  }

  /** Starts the playback, loading the banks on the first run. */
  private async startPlayback(): Promise<void> {
    await this.sink.start();

    for (const [index, bank] of this.options.banks.entries()) {
      const response = await fetch(bank.url);
      if (!response.ok) {
        throw new Error(`The sound bank "${bank.url}" could not be loaded (${response.status})`);
      }
      const bytes = await response.arrayBuffer();
      // Each bank gets its own MIDI bank number, because the bundled fonts
      // all use program 0.
      await this.sink.loadBank(bank.part, bytes, index);
      this.sink.assignPreset(bank.part, index, 0);
    }

    if (this.stopped) {
      return;
    }

    this.timer = new WorkerTimer(this.options.timerWorkerUrl);

    const schedulerOptions: SchedulerOptions = {
      timeline: this.options.timeline,
      sinks: [this.sink],
      // The audio clock is the master clock (implementation.md §2.4).
      clock: () => this.sink.audioContext.currentTime,
      timer: this.timer,
      transport: this.transport,
    };
    if (this.options.onSinkError !== undefined) {
      schedulerOptions.onSinkError = this.options.onSinkError;
    }
    if (this.options.onPosition !== undefined) {
      schedulerOptions.onPosition = this.options.onPosition;
    }
    if (this.options.lookAheadSeconds !== undefined) {
      schedulerOptions.lookAheadSeconds = this.options.lookAheadSeconds;
    }

    this.scheduler = new Scheduler(schedulerOptions);

    await this.scheduler.start();
  }
}
