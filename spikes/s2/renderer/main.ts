/**
 * Spike S2 renderer — measures Web MIDI output accuracy and reliability in
 * Electron.
 *
 * The page:
 * 1. asks for MIDI access through `navigator.requestMIDIAccess()` so the
 *    Electron session permission handler is exercised;
 * 2. enumerates input and output ports and records `statechange` events
 *    (hot-plug);
 * 3. schedules notes and 24 ppqn MIDI clock from a Worker-driven look-ahead
 *    loop, stamping every message with a `performance.now()`-domain
 *    timestamp derived from the audio clock via `getOutputTimestamp()`;
 * 4. captures the loopback on an input port and compares the received
 *    `MIDIMessageEvent.timeStamp` against the intended timestamp.
 *
 * It also exposes `window.spike` so the Electron driver can orchestrate the
 * run (including minimising the window in the middle of a measurement).
 */

import {
  buildMeasurementTimeline,
  decodeEventId,
  performanceTimeForAudioTime,
  summarizeSamples,
  TimelineClock,
  type SampleStats,
  type TimelineEvent,
} from './analysis';
import { LookAheadScheduler, type DispatchRecord } from './scheduler';

interface PortSummary {
  id: string;
  name: string | null;
  manufacturer: string | null;
  state: MIDIPortDeviceState;
  type: MIDIPortType;
}

interface StateChangeRecord {
  atMs: number;
  portId: string;
  portName: string | null;
  state: MIDIPortDeviceState;
  type: MIDIPortType;
}

interface NoteSample {
  id: number;
  intendedTimeMs: number;
  receivedTimeMs: number;
  errorMs: number;
}

interface RunOptions {
  outputPortId: string;
  /** Capture port; empty when no loopback port is available. */
  inputPortId: string;
  bpm: number;
  bars: number;
  beatsPerBar: number;
  notesPerBeat: number;
  lookAheadMs: number;
  workerIntervalMs: number;
  /** Milliseconds after the start of the run before the window is minimised. */
  minimizeAfterMs: number;
  /** Simulate heavy main-thread UI work during the run (NFR-TIM-2). */
  simulateUiLoad: boolean;
  /**
   * Use an in-page sink instead of a real MIDI output port.
   *
   * This exercises the permission flow, the Worker timer, the scheduler and
   * the timestamp mapping on machines without a MIDI device. It does **not**
   * measure driver or loopback timing, and the report says so.
   */
  useNullSink: boolean;
}

interface RunReport {
  startedAtMs: number;
  finishedAtMs: number;
  intendedDurationMs: number;
  /** False when no loopback capture port was available. */
  captureAvailable: boolean;
  /** `null` means no real MIDI port was used. */
  sinkMode: 'null' | 'midi-output';
  /** The audio-clock mapping used to derive the MIDI timestamps. */
  clockMapping: {
    contextTime: number;
    outputTimestampPerformanceTime: number;
    outputLatency: number;
    baseLatency: number;
    /** performance.now() at the moment of the mapping. */
    performanceNow: number;
    /**
     * How far behind `performance.now()` the audio output timestamp was.
     * A large positive value means the audio device was not advancing in
     * step with the monotonic clock.
     */
    outputTimestampLagMs: number;
    anchorPerformanceTimeMs: number;
    anchorLeadMs: number;
    /** Anchor after the minimum lead was enforced. */
    effectiveAnchorPerformanceTimeMs: number;
  };
  dispatch: {
    count: number;
    lateness: SampleStats;
    /**
     * Events handed to the driver *after* their intended time. A late
     * dispatch is a timing failure: the driver cannot schedule a message
     * whose timestamp has already passed.
     */
    lateCount: number;
    /** The same count as a fraction of all dispatched events. */
    lateFraction: number;
    records: readonly DispatchRecord[];
  };
  notes: {
    count: number;
    error: SampleStats;
    /** Error with the constant loopback delay removed. */
    jitter: SampleStats;
    samples: NoteSample[];
  };
  clock: {
    count: number;
    /** Inter-arrival interval statistics, in milliseconds. */
    interval: SampleStats;
    /** Deviation of each interval from the nominal 24 ppqn interval. */
    intervalDeviation: SampleStats;
    nominalIntervalMs: number;
  };
  unmatchedReceived: number;
  errors: string[];
}

interface SpikeApi {
  enumerate(): Promise<{ outputs: PortSummary[]; inputs: PortSummary[] }>;
  requestAccess(sysex: boolean): Promise<{ granted: boolean; error: string | null }>;
  stateChanges(): StateChangeRecord[];
  run(options: RunOptions): Promise<RunReport>;
  isRunning(): boolean;
}

declare global {
  interface Window {
    spike?: SpikeApi;
  }
}

const statusElement = document.querySelector<HTMLElement>('#status');
const resultsElement = document.querySelector<HTMLElement>('#results');
const logElement = document.querySelector<HTMLElement>('#log');

function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  if (logElement) {
    logElement.textContent += line;
  }
}

function setStatus(message: string): void {
  if (statusElement) {
    statusElement.textContent = message;
  }
}

function showResults(value: unknown): void {
  if (resultsElement) {
    resultsElement.textContent = JSON.stringify(value, null, 2);
  }
}

const stateChanges: StateChangeRecord[] = [];
let midiAccess: MIDIAccess | null = null;
let activeRun: { scheduler: LookAheadScheduler; worker: Worker } | null = null;

function summarisePort(port: MIDIPort): PortSummary {
  return {
    id: port.id,
    name: port.name,
    manufacturer: port.manufacturer,
    state: port.state,
    type: port.type,
  };
}

function recordStateChange(port: MIDIPort): void {
  stateChanges.push({
    atMs: performance.now(),
    portId: port.id,
    portName: port.name,
    state: port.state,
    type: port.type,
  });
}

async function requestAccess(sysex: boolean): Promise<{ granted: boolean; error: string | null }> {
  try {
    const access = await navigator.requestMIDIAccess({ sysex });
    midiAccess = access;
    access.onstatechange = (event: MIDIConnectionEvent) => {
      const port = event.port;
      if (port) {
        recordStateChange(port);
      }
    };
    return { granted: true, error: null };
  } catch (error) {
    return { granted: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function listPorts(): { outputs: PortSummary[]; inputs: PortSummary[] } {
  const outputs: PortSummary[] = [];
  const inputs: PortSummary[] = [];
  if (!midiAccess) {
    return { outputs, inputs };
  }
  midiAccess.outputs.forEach((port) => outputs.push(summarisePort(port)));
  midiAccess.inputs.forEach((port) => inputs.push(summarisePort(port)));
  return { outputs, inputs };
}

/**
 * Runs one measurement: schedule the timeline, capture the loopback and
 * report the error distribution.
 */
async function run(options: RunOptions): Promise<RunReport> {
  if (!midiAccess) {
    throw new Error('MIDI access has not been granted');
  }
  const output = options.useNullSink ? undefined : midiAccess.outputs.get(options.outputPortId);
  if (!options.useNullSink && !output) {
    throw new Error(`Output port ${options.outputPortId} is not available`);
  }
  const input = options.inputPortId ? midiAccess.inputs.get(options.inputPortId) : undefined;
  if (options.inputPortId && !input) {
    throw new Error(`Input port ${options.inputPortId} is not available`);
  }

  const errors: string[] = [];
  const noteSamples: NoteSample[] = [];
  const clockArrivals: number[] = [];
  const intendedByEventId = new Map<number, number>();
  let unmatchedReceived = 0;

  const audioContext = new AudioContext();
  await audioContext.resume();
  const rawTimestamp = audioContext.getOutputTimestamp();
  // `getOutputTimestamp()` returns optional fields in the DOM typings; a
  // browser that does not implement them cannot be used for a timing
  // measurement, so the run fails loudly instead of silently measuring the
  // wrong thing.
  const contextTime = rawTimestamp.contextTime ?? 0;
  const outputTimestampPerformanceTime = rawTimestamp.performanceTime ?? 0;
  const outputLatency = audioContext.outputLatency ?? 0;
  const baseLatency = audioContext.baseLatency ?? 0;

  // The first event is intended 250 ms after "now" on the audio clock. The
  // mapping through getOutputTimestamp() puts that instant on the
  // performance.now() timeline that Web MIDI timestamps use.
  const startDelaySeconds = 0.25;
  const anchorPerformanceTimeMs = performanceTimeForAudioTime(
    {
      contextTime,
      performanceTime: outputTimestampPerformanceTime,
    },
    contextTime + startDelaySeconds,
    outputLatency,
    baseLatency,
  );

  const anchorLeadMs = anchorPerformanceTimeMs - performance.now();
  const performanceNowAtMapping = performance.now();
  const outputTimestampLagMs = performanceNowAtMapping - outputTimestampPerformanceTime;

  // The audio output timestamp can lag the monotonic clock when the audio
  // device is not producing frames in step with it (headless CI, a suspended
  // device). Sending a MIDI message whose timestamp is already in the past
  // makes the driver send it immediately, so the run would measure the
  // scheduler, not the timestamp path. The anchor is therefore pushed to at
  // least `minimumLeadMs` into the future; the deviation is recorded.
  const minimumLeadMs = options.lookAheadMs + 50;
  const effectiveAnchorPerformanceTimeMs = Math.max(
    anchorPerformanceTimeMs,
    performanceNowAtMapping + minimumLeadMs,
  );
  const effectiveClock = new TimelineClock(0, effectiveAnchorPerformanceTimeMs, options.bpm);
  const events = buildMeasurementTimeline({
    bpm: options.bpm,
    bars: options.bars,
    beatsPerBar: options.beatsPerBar,
    notesPerBeat: options.notesPerBeat,
  });
  const totalTicks = options.bars * options.beatsPerBar * 480;
  const intendedDurationMs =
    effectiveClock.performanceTimeForTick(totalTicks) - effectiveAnchorPerformanceTimeMs;

  if (input) {
    input.onmidimessage = (event: MIDIMessageEvent): void => {
      const data = Array.from(event.data ?? []);
      if (data.length === 0) {
        return;
      }
      const status = data[0] as number;
      if (status === 0xf8) {
        clockArrivals.push(event.timeStamp);
        return;
      }
      if ((status & 0xf0) !== 0x90) {
        return;
      }
      const note = (data[1] ?? 0) & 0x7f;
      const velocity = (data[2] ?? 0) & 0x7f;
      if (velocity === 0) {
        return;
      }
      const id = decodeEventId(note, velocity);
      if (id === null) {
        unmatchedReceived += 1;
        return;
      }
      const intendedTimeMs = intendedByEventId.get(id);
      if (intendedTimeMs === undefined) {
        unmatchedReceived += 1;
        return;
      }
      noteSamples.push({
        id,
        intendedTimeMs,
        receivedTimeMs: event.timeStamp,
        errorMs: event.timeStamp - intendedTimeMs,
      });
    };
  }

  let finishRun: (() => void) | undefined;
  const finished = new Promise<void>((resolve) => {
    finishRun = resolve;
  });
  const scheduler = new LookAheadScheduler({
    now: () => performance.now(),
    lookAheadMs: options.lookAheadMs,
    clock: effectiveClock,
    events,
    onComplete: () => finishRun?.(),
    onDispatch: (event: TimelineEvent, record: DispatchRecord) => {
      if (event.kind === 'clock') {
        output?.send([0xf8], record.intendedTimeMs);
        return;
      }
      const status =
        event.kind === 'note-on' ? 0x90 | (event.channel - 1) : 0x80 | (event.channel - 1);
      intendedByEventId.set(event.id, record.intendedTimeMs);
      output?.send([status, event.note, event.velocity], record.intendedTimeMs);
    },
  });

  const worker = new Worker(new URL('./timer-worker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('message', () => {
    scheduler.tick();
  });
  worker.postMessage({ type: 'start', intervalMs: options.workerIntervalMs });

  scheduler.start();
  const startedAtMs = performance.now();
  setStatus('measuring');

  // NFR-TIM-2 requires that heavy UI activity does not affect the timing.
  // The simulated load blocks the renderer's main thread in short bursts; the
  // Worker timer and the timestamped sends must be unaffected by it.
  let uiLoadHandle: number | undefined;
  if (options.simulateUiLoad) {
    uiLoadHandle = window.setInterval(() => {
      const until = performance.now() + 120;
      // Busy-wait on the main thread to emulate a heavy render.
      while (performance.now() < until) {
        /* intentional main-thread block */
      }
    }, 500);
  }

  // The run finishes when the scheduler has dispatched the last event. The
  // completion signal comes from the Worker-driven scheduler, not from a UI
  // timer, so a minimised window cannot stall it.
  await finished;
  // Give the loopback time to deliver the last messages before the capture
  // is torn down.
  await new Promise<void>((resolve) => setTimeout(resolve, 750));

  scheduler.stop();
  if (uiLoadHandle !== undefined) {
    window.clearInterval(uiLoadHandle);
  }
  worker.postMessage({ type: 'stop' });
  worker.terminate();
  activeRun = null;
  if (input) {
    input.onmidimessage = null;
  }
  await audioContext.close();

  const noteErrors = noteSamples.map((sample) => sample.errorMs);
  const errorStats = summarizeSamples(noteErrors);
  const median = errorStats.p50;
  const jitterStats = summarizeSamples(noteErrors.map((error) => Math.abs(error - median)));

  const intervals: number[] = [];
  for (let index = 1; index < clockArrivals.length; index += 1) {
    intervals.push((clockArrivals[index] as number) - (clockArrivals[index - 1] as number));
  }
  const nominalIntervalMs = effectiveClock.clockPulseIntervalMs;

  const report: RunReport = {
    startedAtMs,
    finishedAtMs: performance.now(),
    intendedDurationMs,
    captureAvailable: input !== undefined,
    sinkMode: options.useNullSink ? 'null' : 'midi-output',
    clockMapping: {
      contextTime,
      outputTimestampPerformanceTime,
      outputLatency,
      baseLatency,
      performanceNow: performanceNowAtMapping,
      outputTimestampLagMs,
      anchorPerformanceTimeMs,
      anchorLeadMs,
      effectiveAnchorPerformanceTimeMs,
    },
    dispatch: {
      count: scheduler.dispatchedCount,
      lateness: summarizeSamples(scheduler.records.map((record) => record.latenessMs)),
      lateCount: scheduler.records.filter((record) => record.latenessMs > 0).length,
      lateFraction:
        scheduler.dispatchedCount === 0
          ? 0
          : scheduler.records.filter((record) => record.latenessMs > 0).length /
            scheduler.dispatchedCount,
      records: scheduler.records,
    },
    notes: {
      count: noteSamples.length,
      error: errorStats,
      jitter: jitterStats,
      samples: noteSamples,
    },
    clock: {
      count: clockArrivals.length,
      interval: summarizeSamples(intervals),
      intervalDeviation: summarizeSamples(intervals.map((value) => value - nominalIntervalMs)),
      nominalIntervalMs,
    },
    unmatchedReceived,
    errors,
  };
  showResults(report);
  return report;
}

window.spike = {
  async enumerate() {
    if (!midiAccess) {
      const result = await requestAccess(false);
      if (!result.granted) {
        return { outputs: [], inputs: [] };
      }
    }
    return listPorts();
  },
  requestAccess,
  stateChanges: () => stateChanges,
  async run(options) {
    const report = await run(options);
    setStatus('idle');
    return report;
  },
  isRunning: () => activeRun !== null,
};

setStatus('ready');
log('Spike S2 renderer ready.');
