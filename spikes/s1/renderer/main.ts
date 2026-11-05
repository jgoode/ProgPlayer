/**
 * Spike S1 renderer — drives the SpessaSynth measurements in Electron.
 *
 * Three measurement runs, all reported as JSON:
 *
 * 1. **Timing** — schedules note-on messages with a future engine timestamp
 *    and reads back the frame the worklet dispatched them on. The error is the
 *    difference between the requested time and the dispatch frame.
 * 2. **Soak** — plays the three-part arrangement (7-note chords, bass, click)
 *    at 200 BPM for the selected duration, sampling renderer CPU/memory and
 *    counting silent 10 ms blocks (dropouts).
 * 3. **Offline comparison** — renders the same arrangement with
 *    `OfflineAudioContext` (the library's own offline path) and compares it
 *    with the real-time capture: onset alignment, level, envelope correlation.
 *
 * The engine runs inside the measurement worklet
 * (`spikes/s1/worklet/measure-worklet.ts`) so the dispatch frame is
 * observable; the library's own `WorkletSynthesizer` is used for the offline
 * render, because that is the API the app would use in production.
 */

import { WorkletSynthesizer } from 'spessasynth_lib';

import {
  allEvents,
  arrangementDigest,
  barsForSeconds,
  bestAlignment,
  BASS_CHANNEL,
  BASS_PROGRAM,
  buildArrangement,
  CHORD_CHANNEL,
  CHORD_PROGRAM,
  CLICK_PROGRAM,
  compareCaptures,
  differenceBySecond,
  findOnset,
  findSampleAlignment,
  peakLevel,
  rootMeanSquare,
  summarizeErrors,
  toDecibels,
  type Arrangement,
} from './analysis';

declare global {
  interface Window {
    spike?: {
      getMetrics(): Promise<{
        cpuPercent: number;
        workingSetBytes: number;
        peakWorkingSetBytes: number;
      } | null>;
      getTreeMetrics(): Promise<{
        cpuPercent: number;
        workingSetBytes: number;
        peakWorkingSetBytes: number;
        processes: {
          type: string;
          pid: number;
          cpuPercent: number;
          workingSetMB: number;
        }[];
      } | null>;
      saveReport(report: unknown): Promise<string>;
    };
  }
}

const SAMPLE_RATE = 48_000;
const RENDER_QUANTUM = 128;
const BPM = 200;
const WORKLET_URL = 'spike://app/vendor/spike-measure-worklet.js';
const LIB_WORKLET_URL = 'spike://app/vendor/spessasynth_processor.min.js';

const statusElement = document.querySelector<HTMLElement>('#status');
const resultsElement = document.querySelector<HTMLElement>('#results');
const logElement = document.querySelector<HTMLElement>('#log');
const progressElement = document.querySelector<HTMLProgressElement>('#progress');
const environmentElement = document.querySelector<HTMLElement>('#environment');
const fontSelect = document.querySelector<HTMLSelectElement>('#font');
const durationInput = document.querySelector<HTMLInputElement>('#duration');
const loadButton = document.querySelector<HTMLButtonElement>('#load');
const timingButton = document.querySelector<HTMLButtonElement>('#timing');
const soakButton = document.querySelector<HTMLButtonElement>('#soak');
const offlineButton = document.querySelector<HTMLButtonElement>('#offline');

function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  if (logElement) logElement.textContent += line;
}

function setStatus(message: string): void {
  if (statusElement) statusElement.textContent = message;
}

function setProgress(value: number): void {
  if (progressElement) progressElement.value = value;
}

function showResults(report: unknown): void {
  if (resultsElement) resultsElement.textContent = JSON.stringify(report, null, 2);
}

/* ------------------------------------------------------------------ *
 * Worklet bridge
 * ------------------------------------------------------------------ */

interface WorkletNoteOn {
  type: 'noteOn';
  id: number;
  frame: number;
  engineTime: number;
  intendedTime: number;
}

interface WorkletClock {
  type: 'clock';
  engineTime: number;
  currentFrame: number;
  currentTime: number;
  sampleRate: number;
}

interface WorkletStats {
  type: 'stats';
  totalFrames: number;
  totalQuanta: number;
  peak: number;
  sumSquares: number;
  totalBlocks: number;
  silentBlocks: number;
  dropouts: number;
  /** Block indices of the silent blocks, so a dropout can be located. */
  silentBlockIndices?: number[];
  peakVoices: number;
  meanVoices: number;
  currentFrame: number;
  engineTime: number;
  sampleRate: number;
}

interface WorkletBankLoaded {
  type: 'bankLoaded';
  decoderReadyMs: number;
  parseMs: number;
  addMs: number;
  totalMs: number;
  bytes: number;
  presets: number;
}

type WorkletMessage =
  | WorkletNoteOn
  | WorkletClock
  | WorkletStats
  | WorkletBankLoaded
  | {
      type: 'scheduled';
      target: number;
      leadSeconds: number | undefined;
      alignToQuantum: boolean;
      captureFromFrame: number;
    }
  | { type: 'captureEnded'; samples: Float32Array };

/** A live measurement session: the audio graph plus the measurement worklet. */
interface Session {
  context: AudioContext;
  measure: AudioWorkletNode;
  fontBytes: number;
  fontName: string;
  bankLoaded: WorkletBankLoaded;
  pendingNoteOns: Map<number, (message: WorkletNoteOn) => void>;
  /** Resolvers for one-shot worklet replies, keyed by message type. */
  waiters: Map<string, ((message: WorkletMessage) => void)[]>;
  nextEventId: number;
}

let session: Session | null = null;

function fontPath(): string {
  return fontSelect?.value === 'sf3'
    ? 'spike://app/fixtures/GeneralUser-GS.sf3'
    : 'spike://app/fixtures/GeneralUser-GS.sf2';
}

async function loadFont(): Promise<Session> {
  setStatus('Loading sound font…');
  setProgress(0.05);

  const context = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });
  await context.audioWorklet.addModule(WORKLET_URL);

  const measure = new AudioWorkletNode(context, 'spike-measure', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  measure.connect(context.destination);

  const pendingNoteOns = new Map<number, (message: WorkletNoteOn) => void>();
  const waitersByType = new Map<string, ((message: WorkletMessage) => void)[]>();
  let bankLoadedResolve: ((value: WorkletBankLoaded) => void) | null = null;
  const bankLoadedPromise = new Promise<WorkletBankLoaded>((resolve) => {
    bankLoadedResolve = resolve;
  });

  measure.port.onmessage = (event: MessageEvent) => {
    const message = event.data as WorkletMessage;
    switch (message.type) {
      case 'noteOn': {
        const resolve = pendingNoteOns.get(message.id);
        if (resolve) {
          pendingNoteOns.delete(message.id);
          resolve(message);
        }
        break;
      }
      case 'bankLoaded': {
        bankLoadedResolve?.(message);
        bankLoadedResolve = null;
        break;
      }
      default:
        break;
    }

    const waiters = waitersByType.get(message.type);
    if (waiters) {
      waitersByType.delete(message.type);
      for (const waiter of waiters) waiter(message);
    }
  };

  const fetchStarted = performance.now();
  const response = await fetch(fontPath());
  if (!response.ok) {
    throw new Error(`Failed to fetch ${fontPath()}: HTTP ${response.status}`);
  }
  const bytes = await response.arrayBuffer();
  const fetchMs = performance.now() - fetchStarted;

  measure.port.postMessage({ type: 'loadBank', buffer: bytes }, [bytes]);
  const bankLoaded = await bankLoadedPromise;

  await context.resume();
  setProgress(0.2);

  log(
    `Loaded ${fontPath()} (${bankLoaded.bytes} bytes): fetch ${fetchMs.toFixed(1)} ms, ` +
      `parse ${bankLoaded.parseMs.toFixed(1)} ms, add ${bankLoaded.addMs.toFixed(1)} ms, ` +
      `${bankLoaded.presets} presets`,
  );

  session = {
    context,
    measure,
    fontBytes: bankLoaded.bytes,
    fontName: fontPath(),
    bankLoaded,
    pendingNoteOns,
    waiters: waitersByType,
    nextEventId: 1,
  };
  return session;
}

/**
 * Waits for the next worklet message of a given type.
 *
 * The worklet answers out of band, so the replies are routed through a waiter
 * list instead of by replacing `port.onmessage` each time.
 */
function waitForMessage<T extends WorkletMessage>(active: Session, type: T['type']): Promise<T> {
  return new Promise((resolve) => {
    const waiters = active.waiters.get(type) ?? [];
    waiters.push((message) => resolve(message as T));
    active.waiters.set(type, waiters);
  });
}

/** Requests the worklet's current clocks. */
async function requestClock(active: Session): Promise<WorkletClock> {
  const reply = waitForMessage<Extract<WorkletMessage, { type: 'clock' }>>(active, 'clock');
  active.measure.port.postMessage({ type: 'clock' });
  return reply;
}

/** Requests the worklet's block statistics. */
async function requestStats(active: Session): Promise<WorkletStats> {
  const reply = waitForMessage<WorkletStats>(active, 'stats');
  active.measure.port.postMessage({ type: 'stats' });
  return reply;
}

/* ------------------------------------------------------------------ *
 * 1. Timing
 * ------------------------------------------------------------------ */

interface TimingMeasurement {
  intendedTime: number;
  intendedFrame: number;
  dispatchFrame: number;
  errorFrames: number;
  leadSeconds: number;
}

interface TimingResult {
  sampleRate: number;
  renderQuantum: number;
  clockOffsetSeconds: number;
  measurements: TimingMeasurement[];
  errorStatistics: ReturnType<typeof summarizeErrors>;
  withinOneQuantum: boolean;
  worstCaseFrames: number;
  alignedMeasurements: TimingMeasurement[];
  alignedErrorStatistics: ReturnType<typeof summarizeErrors>;
  alignedWorstCaseFrames: number;
}

/**
 * Schedules one note at a future engine time and waits for the worklet to
 * report the frame it was dispatched on.
 */
async function measureOne(
  active: Session,
  leadSeconds: number,
  alignToQuantum = false,
): Promise<TimingMeasurement> {
  const id = active.nextEventId;
  active.nextEventId += 3;
  const dispatched = new Promise<WorkletNoteOn>((resolve) => {
    active.pendingNoteOns.set(id + 1, resolve);
  });

  // The worklet computes the target time on the audio thread, so the
  // round-trip time of this message does not enter the measurement.
  active.measure.port.postMessage({
    type: 'schedule',
    leadSeconds,
    alignToQuantum,
    events: [
      {
        id,
        message: [0xc0 | CHORD_CHANNEL, CHORD_PROGRAM],
        offsetSeconds: 0,
        channel: CHORD_CHANNEL,
        note: -1,
        isNoteOn: false,
      },
      {
        id: id + 1,
        message: [0x90 | CHORD_CHANNEL, 60, 100],
        offsetSeconds: 0,
        channel: CHORD_CHANNEL,
        note: 60,
        isNoteOn: true,
      },
      {
        id: id + 2,
        message: [0x80 | CHORD_CHANNEL, 60, 0],
        offsetSeconds: 0.3,
        channel: CHORD_CHANNEL,
        note: 60,
        isNoteOn: false,
      },
    ],
  });

  const noteOn = await dispatched;
  active.measure.port.postMessage({ type: 'stopAll' });

  const intendedFrame = noteOn.intendedTime * SAMPLE_RATE;
  return {
    intendedTime: noteOn.intendedTime,
    intendedFrame,
    dispatchFrame: noteOn.frame,
    errorFrames: noteOn.frame - intendedFrame,
    leadSeconds,
  };
}

async function runTimingTest(): Promise<TimingResult> {
  if (!session) throw new Error('No sound font loaded.');
  setStatus('Running timing test…');
  setProgress(0.3);

  const leads = [0.05, 0.1, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0];
  const measurements: TimingMeasurement[] = [];
  const alignedMeasurements: TimingMeasurement[] = [];

  for (const lead of leads) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const measurement = await measureOne(session, lead);
    measurements.push(measurement);
    log(
      `lead ${lead}s: intended frame ${measurement.intendedFrame.toFixed(1)}, ` +
        `dispatched ${measurement.dispatchFrame}, error ${measurement.errorFrames.toFixed(2)} frames`,
    );
  }

  // Second pass: the target is snapped to the next render quantum boundary.
  for (const lead of leads) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const measurement = await measureOne(session, lead, true);
    alignedMeasurements.push(measurement);
    log(
      `aligned lead ${lead}s: intended frame ${measurement.intendedFrame.toFixed(1)}, ` +
        `dispatched ${measurement.dispatchFrame}, error ${measurement.errorFrames.toFixed(2)} frames`,
    );
  }

  const clock = await requestClock(session);
  const errors = measurements.map((measurement) => measurement.errorFrames);
  const statistics = summarizeErrors(errors);
  const alignedErrors = alignedMeasurements.map((measurement) => measurement.errorFrames);
  const alignedStatistics = summarizeErrors(alignedErrors);

  setProgress(0.45);
  return {
    sampleRate: SAMPLE_RATE,
    renderQuantum: RENDER_QUANTUM,
    clockOffsetSeconds: clock.engineTime - clock.currentTime,
    measurements,
    errorStatistics: statistics,
    withinOneQuantum: errors.every((error) => error >= -0.5 && error < RENDER_QUANTUM),
    worstCaseFrames: statistics.absoluteMax,
    alignedMeasurements,
    alignedErrorStatistics: alignedStatistics,
    alignedWorstCaseFrames: alignedStatistics.absoluteMax,
  };
}

/* ------------------------------------------------------------------ *
 * 2. Soak
 * ------------------------------------------------------------------ */

interface SoakResult {
  durationSeconds: number;
  bars: number;
  bpm: number;
  notesScheduled: number;
  peakVoices: number;
  cpuSamples: {
    at: number;
    cpuPercent: number;
    workingSetMB: number;
    treeCpuPercent: number;
    treeWorkingSetMB: number;
  }[];
  cpuAveragePercent: number;
  cpuPeakPercent: number;
  workingSetPeakMB: number;
  treeCpuAveragePercent: number;
  treeCpuPeakPercent: number;
  treeWorkingSetPeakMB: number;
  workletStats: WorkletStats | null;
  dropouts: number;
  silentBlocks: number;
  totalBlocks: number;
  audioClockDriftSeconds: number;
}

/**
 * Converts the arrangement into worklet schedule messages.
 *
 * The times are relative to the start of the arrangement, so the caller can
 * hand them to the worklet as `offsetSeconds`.
 */
function scheduleMessages(
  arrangement: Arrangement,
  firstId: number,
): {
  id: number;
  message: number[];
  time: number;
  channel: number;
  note: number;
  isNoteOn: boolean;
}[] {
  const messages: {
    id: number;
    message: number[];
    time: number;
    channel: number;
    note: number;
    isNoteOn: boolean;
  }[] = [];
  let id = firstId;

  for (const event of allEvents(arrangement)) {
    const program =
      event.channel === CHORD_CHANNEL
        ? CHORD_PROGRAM
        : event.channel === BASS_CHANNEL
          ? BASS_PROGRAM
          : CLICK_PROGRAM;
    messages.push({
      id: id++,
      message: [0xc0 | event.channel, program],
      time: event.startSeconds,
      channel: event.channel,
      note: -1,
      isNoteOn: false,
    });
    messages.push({
      id: id++,
      message: [0x90 | event.channel, event.note, event.velocity],
      time: event.startSeconds,
      channel: event.channel,
      note: event.note,
      isNoteOn: true,
    });
    messages.push({
      id: id++,
      message: [0x80 | event.channel, event.note, 0],
      time: event.endSeconds,
      channel: event.channel,
      note: event.note,
      isNoteOn: false,
    });
  }

  return messages;
}

async function runSoakTest(): Promise<SoakResult> {
  if (!session) throw new Error('No sound font loaded.');
  const active = session;
  const rawDuration = durationInput?.value ?? '600';
  const durationSeconds = Number(rawDuration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`Invalid soak duration: ${rawDuration}`);
  }
  const bars = barsForSeconds(durationSeconds, BPM);
  const arrangement = buildArrangement(bars, BPM);

  setStatus(`Running ${durationSeconds} s soak at ${BPM} BPM…`);
  setProgress(0.5);
  active.measure.port.postMessage({ type: 'resetStats' });

  const clock = await requestClock(active);
  const messages = scheduleMessages(arrangement, active.nextEventId);
  active.nextEventId += messages.length;
  active.measure.port.postMessage({
    type: 'schedule',
    leadSeconds: 0.5,
    alignToQuantum: true,
    events: messages.map((message) => ({ ...message, offsetSeconds: message.time })),
  });

  const cpuSamples: {
    at: number;
    cpuPercent: number;
    workingSetMB: number;
    treeCpuPercent: number;
    treeWorkingSetMB: number;
  }[] = [];
  const startedAt = performance.now();
  let peakVoices = 0;

  while (performance.now() - startedAt < durationSeconds * 1000) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const metrics = await window.spike?.getMetrics();
    const tree = await window.spike?.getTreeMetrics();
    if (metrics || tree) {
      cpuSamples.push({
        at: Number(((performance.now() - startedAt) / 1000).toFixed(1)),
        cpuPercent: Number((metrics?.cpuPercent ?? 0).toFixed(2)),
        workingSetMB: Number(((metrics?.workingSetBytes ?? 0) / 1024 / 1024).toFixed(1)),
        treeCpuPercent: Number((tree?.cpuPercent ?? 0).toFixed(2)),
        treeWorkingSetMB: Number(((tree?.workingSetBytes ?? 0) / 1024 / 1024).toFixed(1)),
      });
    }
    const stats = await requestStats(active);
    peakVoices = Math.max(peakVoices, stats.peakVoices);
    setProgress(0.5 + (0.3 * (performance.now() - startedAt)) / (durationSeconds * 1000));
  }

  const stats = await requestStats(active);
  active.measure.port.postMessage({ type: 'stopAll' });

  const cpuValues = cpuSamples.map((sample) => sample.cpuPercent);
  const workingSetValues = cpuSamples.map((sample) => sample.workingSetMB);
  const treeCpuValues = cpuSamples.map((sample) => sample.treeCpuPercent);
  const treeWorkingSetValues = cpuSamples.map((sample) => sample.treeWorkingSetMB);
  const clockAfter = await requestClock(active);
  const audioClockDriftSeconds = clockAfter.engineTime - clock.engineTime - durationSeconds;

  setProgress(0.85);
  return {
    durationSeconds,
    bars,
    bpm: BPM,
    notesScheduled: arrangement.chords.length + arrangement.bass.length + arrangement.click.length,
    peakVoices,
    cpuSamples,
    cpuAveragePercent: average(cpuValues),
    cpuPeakPercent: cpuValues.length ? Math.max(...cpuValues) : Number.NaN,
    workingSetPeakMB: workingSetValues.length ? Math.max(...workingSetValues) : Number.NaN,
    treeCpuAveragePercent: average(treeCpuValues),
    treeCpuPeakPercent: treeCpuValues.length ? Math.max(...treeCpuValues) : Number.NaN,
    treeWorkingSetPeakMB: treeWorkingSetValues.length
      ? Math.max(...treeWorkingSetValues)
      : Number.NaN,
    workletStats: stats,
    dropouts: stats.dropouts,
    silentBlocks: stats.silentBlocks,
    totalBlocks: stats.totalBlocks,
    audioClockDriftSeconds: Number(audioClockDriftSeconds.toFixed(4)),
  };
}

/** Mean of a list of samples, rounded to two decimals. */
function average(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  return Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2));
}

/* ------------------------------------------------------------------ *
 * 3. Offline comparison
 * ------------------------------------------------------------------ */

interface OfflineResult {
  offlineRenderSeconds: number;
  offlineContextRenderSeconds: number;
  libraryRealtimeRenderSeconds: number;
  realtimeRenderSeconds: number;
  /** Offline render speed-up against real time (1 = real time). */
  offlineRealtimeRatio: number;
  offlineFrames: number;
  offlineContextFrames: number;
  libraryRealtimeFrames: number;
  realtimeFrames: number;
  /** Difference level per second between the offline and real-time captures. */
  differenceTrace: { at: number; differenceToSignalDb: number }[];
  offlinePeak: number;
  realtimePeak: number;
  offlineRms: number;
  realtimeRms: number;
  offlinePeakDb: number;
  realtimePeakDb: number;
  peakDeltaDb: number;
  rmsDeltaDb: number;
  envelopeLagBlocks: number;
  envelopeCorrelation: number;
  sampleAlignmentFrames: number;
  sampleAlignmentCorrelation: number;
  alignedDifferenceToSignalDb: number;
  alignedMaxAbsoluteDifference: number;
  offlineContextVsRealtimeDifferenceDb: number;
  offlineContextPeakDeltaDb: number;
  offlineContextRmsDeltaDb: number;
  libraryOfflineVsLibraryRealtimeDifferenceDb: number;
  libraryOfflineVsLibraryRealtimePeakDeltaDb: number;
  libraryOfflineVsLibraryRealtimeRmsDeltaDb: number;
  firstOnsetOfflineFrame: number;
  firstOnsetOfflineContextFrame: number;
  firstOnsetLibraryRealtimeFrame: number;
  firstOnsetRealtimeFrame: number;
  onsetDeltaFrames: number;
}

/**
 * Captures the real-time output of the measurement worklet for N seconds.
 *
 * The worklet starts the capture at the exact frame the arrangement's first
 * note is dispatched on, so the returned buffer starts at the same sample as
 * an offline render of the same arrangement.
 */
async function captureRealTime(
  active: Session,
  arrangement: Arrangement,
  seconds: number,
): Promise<Float32Array> {
  const frames = Math.ceil(seconds * SAMPLE_RATE);
  const captured = waitForMessage<Extract<WorkletMessage, { type: 'captureEnded' }>>(
    active,
    'captureEnded',
  );

  // The worklet schedules the arrangement at the next quantum boundary and
  // arms the capture for the same frame.
  const messages = scheduleMessages(arrangement, active.nextEventId);
  active.nextEventId += messages.length;
  active.measure.port.postMessage({
    type: 'schedule',
    leadSeconds: 0.1,
    alignToQuantum: true,
    captureFrames: frames,
    events: messages.map((message) => ({ ...message, offsetSeconds: message.time })),
  });

  await new Promise((resolve) => setTimeout(resolve, seconds * 1000 + 500));
  active.measure.port.postMessage({ type: 'stopCapture' });
  const { samples } = await captured;
  active.measure.port.postMessage({ type: 'stopAll' });
  return samples;
}

/**
 * Renders the arrangement offline with the library's own offline path.
 *
 * `WorkletSynthesizer.startOfflineRender` loads the sound bank and the MIDI
 * sequence into the worklet and the engine's sequencer plays it inside an
 * `OfflineAudioContext`.
 */
async function renderOffline(
  arrangement: Arrangement,
  seconds: number,
  soundBankBuffer: ArrayBuffer,
): Promise<Float32Array> {
  const { BasicMIDI, MIDIBuilder } = await import('spessasynth_core');

  // `MIDIBuilder` keeps a `TextEncoder`, which cannot be structured-cloned to
  // the worklet. Writing a Standard MIDI File and parsing it again produces a
  // plain `BasicMIDI` that can be cloned.
  const builder = new MIDIBuilder({
    timeDivision: 480,
    initialTempo: arrangement.bpm,
    format: 1,
    name: 'PracticePlayer spike S1',
  });
  builder.addTrack('chords');
  builder.addTrack('bass');
  builder.addTrack('click');
  for (const event of allEvents(arrangement)) {
    const track = event.channel === CHORD_CHANNEL ? 1 : event.channel === BASS_CHANNEL ? 2 : 3;
    const program =
      event.channel === CHORD_CHANNEL
        ? CHORD_PROGRAM
        : event.channel === BASS_CHANNEL
          ? BASS_PROGRAM
          : CLICK_PROGRAM;
    builder.programChange(event.startTick, track, event.channel, program);
    builder.noteOn(event.startTick, track, event.channel, event.note, event.velocity);
    builder.noteOff(event.endTick, track, event.channel, event.note);
  }
  builder.flush();
  const midiBytes = builder.writeMIDI();
  const sequence = BasicMIDI.fromArrayBuffer(midiBytes);

  const offlineContext = new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.ceil(SAMPLE_RATE * seconds),
    sampleRate: SAMPLE_RATE,
  });
  await offlineContext.audioWorklet.addModule(LIB_WORKLET_URL);

  const offlineSynth = new WorkletSynthesizer(offlineContext, { eventsEnabled: false });
  offlineSynth.connect(offlineContext.destination);

  await offlineSynth.startOfflineRender({
    soundBankList: [{ bankOffset: 0, soundBankBuffer }],
    midiSequence: sequence,
    loopCount: 0,
  });
  await offlineSynth.isReady;

  const buffer = await offlineContext.startRendering();
  return buffer.getChannelData(0);
}

/**
 * Renders the arrangement inside an `OfflineAudioContext` using the *same*
 * measurement worklet as the real-time path.
 *
 * This isolates the question "is `OfflineAudioContext` equivalent to real-time
 * playback?" from "is the library's own offline path equivalent?", because the
 * only difference between the two renders is the audio context.
 *
 * The events are scheduled with absolute engine times. In an
 * `OfflineAudioContext` the worklet's engine clock starts at 0, so the
 * engine time and the context time are the same.
 */
async function renderOfflineContext(
  arrangement: Arrangement,
  seconds: number,
  soundBankBuffer: ArrayBuffer,
): Promise<Float32Array> {
  const offlineContext = new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.ceil(SAMPLE_RATE * seconds),
    sampleRate: SAMPLE_RATE,
  });
  await offlineContext.audioWorklet.addModule(WORKLET_URL);

  const node = new AudioWorkletNode(offlineContext, 'spike-measure', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  node.connect(offlineContext.destination);

  // The bank has to be loaded into the offline worklet before the render
  // starts, so the load is awaited through the port.
  const bankLoaded = new Promise<void>((resolve) => {
    node.port.onmessage = (event: MessageEvent) => {
      const message = event.data as WorkletMessage;
      if (message.type === 'bankLoaded') resolve();
    };
  });
  node.port.postMessage({ type: 'loadBank', buffer: soundBankBuffer }, [soundBankBuffer]);
  await bankLoaded;

  const messages = scheduleMessages(arrangement, 1);
  node.port.postMessage({ type: 'schedule', events: messages });

  // The rendered buffer is the worklet's own output, so it is the same signal
  // the real-time capture records.
  const buffer = await offlineContext.startRendering();
  return buffer.getChannelData(0);
}

/**
 * Renders the arrangement in real time through the library's own path
 * (`WorkletSynthesizer` with the engine's sequencer), and records the result.
 *
 * Comparing this with the library's offline render answers "does the library's
 * offline path produce the same audio as its real-time path?", which is a
 * different question from "does `OfflineAudioContext` match real time?".
 */
async function renderLibraryRealTime(
  arrangement: Arrangement,
  seconds: number,
  soundBankBuffer: ArrayBuffer,
): Promise<Float32Array> {
  const { BasicMIDI, MIDIBuilder } = await import('spessasynth_core');

  const builder = new MIDIBuilder({
    timeDivision: 480,
    initialTempo: arrangement.bpm,
    format: 1,
    name: 'PracticePlayer spike S1',
  });
  builder.addTrack('chords');
  builder.addTrack('bass');
  builder.addTrack('click');
  for (const event of allEvents(arrangement)) {
    const track = event.channel === CHORD_CHANNEL ? 1 : event.channel === BASS_CHANNEL ? 2 : 3;
    const program =
      event.channel === CHORD_CHANNEL
        ? CHORD_PROGRAM
        : event.channel === BASS_CHANNEL
          ? BASS_PROGRAM
          : CLICK_PROGRAM;
    builder.programChange(event.startTick, track, event.channel, program);
    builder.noteOn(event.startTick, track, event.channel, event.note, event.velocity);
    builder.noteOff(event.endTick, track, event.channel, event.note);
  }
  builder.flush();
  const sequence = BasicMIDI.fromArrayBuffer(builder.writeMIDI());

  const context = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });
  await context.audioWorklet.addModule(LIB_WORKLET_URL);
  await context.audioWorklet.addModule(WORKLET_URL);

  const synth = new WorkletSynthesizer(context, { eventsEnabled: false });
  const recorder = new AudioWorkletNode(context, 'spike-recorder', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  synth.connect(recorder);
  recorder.connect(context.destination);

  const frames = Math.ceil(seconds * SAMPLE_RATE);
  const recorded = new Promise<Float32Array>((resolve) => {
    recorder.port.onmessage = (event: MessageEvent) => {
      const message = event.data as { type: string; samples?: Float32Array };
      if (message.type === 'recorded' && message.samples) resolve(message.samples);
    };
  });
  recorder.port.postMessage({ type: 'record', frames });

  await synth.startOfflineRender({
    soundBankList: [{ bankOffset: 0, soundBankBuffer }],
    midiSequence: sequence,
    loopCount: 0,
  });
  await synth.isReady;

  await new Promise((resolve) => setTimeout(resolve, seconds * 1000 + 700));
  recorder.port.postMessage({ type: 'stopRecording' });
  const samples = await recorded;

  await context.close();
  return samples;
}

async function runOfflineComparison(): Promise<OfflineResult> {
  if (!session) throw new Error('No sound font loaded.');
  const active = session;
  const seconds = 20;
  const bars = barsForSeconds(seconds, BPM);
  const arrangement = buildArrangement(bars, BPM);

  setStatus('Rendering offline…');
  setProgress(0.85);

  const response = await fetch(active.fontName);
  const soundBankBuffer = await response.arrayBuffer();

  const offlineStarted = performance.now();
  const offline = await renderOffline(arrangement, seconds, soundBankBuffer);
  const offlineRenderSeconds = (performance.now() - offlineStarted) / 1000;

  setStatus('Rendering in an OfflineAudioContext…');
  setProgress(0.88);

  // The buffer was transferred to the first worklet and is detached now, so a
  // fresh copy is fetched for the second render.
  const secondResponse = await fetch(active.fontName);
  const secondBuffer = await secondResponse.arrayBuffer();

  const contextStarted = performance.now();
  const offlineContext = await renderOfflineContext(arrangement, seconds, secondBuffer);
  const offlineContextRenderSeconds = (performance.now() - contextStarted) / 1000;

  setStatus('Rendering the library path in real time…');
  setProgress(0.89);

  // The buffer was transferred again, so a third copy is fetched.
  const thirdResponse = await fetch(active.fontName);
  const thirdBuffer = await thirdResponse.arrayBuffer();

  const libraryRealtimeStarted = performance.now();
  const libraryRealtime = await renderLibraryRealTime(arrangement, seconds, thirdBuffer);
  const libraryRealtimeRenderSeconds = (performance.now() - libraryRealtimeStarted) / 1000;

  setStatus('Capturing real-time…');
  setProgress(0.9);

  const realtimeStarted = performance.now();
  const realtime = await captureRealTime(active, arrangement, seconds);
  const realtimeRenderSeconds = (performance.now() - realtimeStarted) / 1000;

  const offlineEnvelope = blockEnvelopeOf(offline);
  const realtimeEnvelope = blockEnvelopeOf(realtime);
  const alignment = bestAlignment(offlineEnvelope, realtimeEnvelope, 40);

  const offlineOnset = findOnset(offline);
  const realtimeOnset = findOnset(realtime);

  // The offline render starts with a short lead-in before the first note, and
  // the real-time capture starts exactly on the first note. Both captures are
  // trimmed to their first onset so the two are compared over the same
  // musical content.
  const trimmedOffline = offlineOnset > 0 ? offline.subarray(offlineOnset) : offline;
  const trimmedRealtime = realtimeOnset > 0 ? realtime.subarray(realtimeOnset) : realtime;

  // Any residual offset is removed by the content alignment.
  const sampleAlignment = findSampleAlignment(trimmedOffline, trimmedRealtime, 2400);
  const offset = sampleAlignment.offset;
  const alignedOffline = offset >= 0 ? trimmedOffline : trimmedOffline.subarray(-offset);
  const alignedRealtime = offset >= 0 ? trimmedRealtime.subarray(offset) : trimmedRealtime;
  const comparison = compareCaptures(alignedOffline, alignedRealtime);

  // The same comparison, but with the `OfflineAudioContext` render as the
  // reference instead of the library's offline path.
  const contextOnset = findOnset(offlineContext);
  const trimmedContext = contextOnset > 0 ? offlineContext.subarray(contextOnset) : offlineContext;
  const contextComparison = compareCaptures(trimmedContext, trimmedRealtime);

  // The library's own path, rendered in real time, against its offline render.
  const libraryRealtimeOnset = findOnset(libraryRealtime);
  const trimmedLibraryRealtime =
    libraryRealtimeOnset > 0 ? libraryRealtime.subarray(libraryRealtimeOnset) : libraryRealtime;
  const libraryComparison = compareCaptures(trimmedOffline, trimmedLibraryRealtime);

  // The difference level per second shows whether the two signals stay in
  // sync or drift apart.
  const differenceTrace = differenceBySecond(trimmedOffline, trimmedRealtime, SAMPLE_RATE);

  setProgress(1);
  return {
    offlineRenderSeconds: Number(offlineRenderSeconds.toFixed(3)),
    offlineContextRenderSeconds: Number(offlineContextRenderSeconds.toFixed(3)),
    libraryRealtimeRenderSeconds: Number(libraryRealtimeRenderSeconds.toFixed(3)),
    realtimeRenderSeconds: Number(realtimeRenderSeconds.toFixed(3)),
    offlineRealtimeRatio: Number((seconds / offlineRenderSeconds).toFixed(1)),
    offlineFrames: offline.length,
    offlineContextFrames: offlineContext.length,
    libraryRealtimeFrames: libraryRealtime.length,
    realtimeFrames: realtime.length,
    differenceTrace,
    offlinePeak: Number(peakLevel(offline).toFixed(6)),
    realtimePeak: Number(peakLevel(realtime).toFixed(6)),
    offlineRms: Number(rootMeanSquare(offline).toFixed(6)),
    realtimeRms: Number(rootMeanSquare(realtime).toFixed(6)),
    offlinePeakDb: Number(toDecibels(peakLevel(offline)).toFixed(2)),
    realtimePeakDb: Number(toDecibels(peakLevel(realtime)).toFixed(2)),
    peakDeltaDb: Number(comparison.peakDeltaDb.toFixed(3)),
    rmsDeltaDb: Number(comparison.rmsDeltaDb.toFixed(3)),
    envelopeLagBlocks: alignment.lag,
    envelopeCorrelation: Number(alignment.correlation.toFixed(6)),
    sampleAlignmentFrames: offset,
    sampleAlignmentCorrelation: Number(sampleAlignment.correlation.toFixed(6)),
    alignedDifferenceToSignalDb: Number(comparison.differenceToSignalDb.toFixed(2)),
    alignedMaxAbsoluteDifference: Number(comparison.maxAbsoluteDifference.toFixed(6)),
    offlineContextVsRealtimeDifferenceDb: Number(contextComparison.differenceToSignalDb.toFixed(2)),
    offlineContextPeakDeltaDb: Number(contextComparison.peakDeltaDb.toFixed(3)),
    offlineContextRmsDeltaDb: Number(contextComparison.rmsDeltaDb.toFixed(3)),
    libraryOfflineVsLibraryRealtimeDifferenceDb: Number(
      libraryComparison.differenceToSignalDb.toFixed(2),
    ),
    libraryOfflineVsLibraryRealtimePeakDeltaDb: Number(libraryComparison.peakDeltaDb.toFixed(3)),
    libraryOfflineVsLibraryRealtimeRmsDeltaDb: Number(libraryComparison.rmsDeltaDb.toFixed(3)),
    firstOnsetOfflineFrame: offlineOnset,
    firstOnsetOfflineContextFrame: contextOnset,
    firstOnsetLibraryRealtimeFrame: libraryRealtimeOnset,
    firstOnsetRealtimeFrame: realtimeOnset,
    onsetDeltaFrames: offlineOnset - realtimeOnset,
  };
}

/** RMS envelope with one value per 10 ms block. */
function blockEnvelopeOf(samples: Float32Array): Float32Array {
  const blockSize = 480;
  const blocks = Math.floor(samples.length / blockSize);
  const envelope = new Float32Array(blocks);
  for (let block = 0; block < blocks; block++) {
    let sumSquares = 0;
    for (let i = 0; i < blockSize; i++) {
      const value = samples[block * blockSize + i] ?? 0;
      sumSquares += value * value;
    }
    envelope[block] = Math.sqrt(sumSquares / blockSize);
  }
  return envelope;
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

function main(): void {
  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    machine: {
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    },
  };

  const environmentRows: Record<string, string> = {
    'User agent': navigator.userAgent,
    'Sample rate': `${SAMPLE_RATE} Hz`,
    'Render quantum': `${RENDER_QUANTUM} frames`,
    'Hardware concurrency': String(navigator.hardwareConcurrency ?? 'unknown'),
  };

  environmentElement?.replaceChildren(
    ...Object.entries(environmentRows).flatMap(([key, value]) => {
      const term = document.createElement('dt');
      term.textContent = key;
      const description = document.createElement('dd');
      description.textContent = value;
      return [term, description];
    }),
  );

  loadButton?.addEventListener('click', () => {
    void (async () => {
      try {
        const loaded = await loadFont();
        report.font = loaded.bankLoaded;
        report.fontBytes = loaded.fontBytes;
        report.fontName = loaded.fontName;
        setStatus(`Loaded ${loaded.fontName} (${loaded.fontBytes} bytes).`);
        showResults(report);
        if (timingButton) timingButton.disabled = false;
        if (soakButton) soakButton.disabled = false;
        if (offlineButton) offlineButton.disabled = false;
      } catch (error) {
        setStatus(`Failed: ${String(error)}`);
        log(`Load failed: ${String(error)}`);
      }
    })();
  });

  timingButton?.addEventListener('click', () => {
    void (async () => {
      try {
        report.timing = await runTimingTest();
        showResults(report);
        setStatus('Timing test complete.');
      } catch (error) {
        setStatus(`Timing test failed: ${String(error)}`);
        log(`Timing test failed: ${String(error)}`);
      }
    })();
  });

  soakButton?.addEventListener('click', () => {
    void (async () => {
      try {
        report.soak = await runSoakTest();
        report.arrangement = {
          bars: report.soak ? (report.soak as SoakResult).bars : 0,
          bpm: BPM,
          digest: arrangementDigest(buildArrangement((report.soak as SoakResult).bars, BPM)),
        };
        showResults(report);
        setStatus('Soak test complete.');
      } catch (error) {
        setStatus(`Soak test failed: ${String(error)}`);
        log(`Soak test failed: ${String(error)}`);
      }
    })();
  });

  offlineButton?.addEventListener('click', () => {
    void (async () => {
      try {
        report.offline = await runOfflineComparison();
        showResults(report);
        const path = await window.spike?.saveReport(report);
        log(`Report written to ${path ?? 'unknown path'}`);
        setStatus('Offline comparison complete.');
      } catch (error) {
        setStatus(`Offline comparison failed: ${String(error)}`);
        log(`Offline comparison failed: ${String(error)}`);
      }
    })();
  });
}

void main();
