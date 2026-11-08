/**
 * Spike S2 — native RtMidi measurement harness.
 *
 * The native candidate is `@julusian/midi` (MIT), a Node-API wrapper around
 * RtMidi 6.0.0 with prebuilt binaries for Windows, macOS and Linux.
 *
 * What this harness measures
 * --------------------------
 * RtMidi has **no timestamped send**: `RtMidiOut::sendMessage()` hands the
 * bytes to the OS immediately. The accuracy of the native path is therefore
 * decided entirely by how precisely the scheduler dispatches the event. The
 * harness records:
 *
 * - `dispatch.lateness` — intended time minus the time `send()` was called.
 *   This is the native path's equivalent of Web MIDI's output jitter.
 * - `notes.error` — loopback arrival time minus intended time, when a
 *   capture port is available. It contains the driver's own latency, so it
 *   is *not* comparable with the Web MIDI number without subtracting the
 *   median loopback delay.
 *
 * The timer is a Worker thread (`node:worker_threads`), mirroring the
 * renderer-side Worker timer of the Web MIDI path: a main-thread timer must
 * never decide note timing.
 *
 * Usage:
 *   node spikes/s2/native/measure-native.mjs --output "Port Name" \
 *     [--capture "Port Name"] [--bars 4] [--bpm 120] [--out results/native.json]
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import { Input, Output, verifyLibraryLoaded } from '@julusian/midi';

const SPIKE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index >= 0 && index + 1 < args.length) {
    return args[index + 1];
  }
  return fallback;
}

const OUTPUT_NAME = argValue('output', '');
const CAPTURE_NAME = argValue('capture', '');
const BARS = Number(argValue('bars', '4'));
const BPM = Number(argValue('bpm', '120'));
const BEATS_PER_BAR = 4;
const LOOK_AHEAD_MS = Number(argValue('look-ahead', '100'));
const WORKER_INTERVAL_MS = Number(argValue('worker-interval', '10'));
const OUT_NAME = argValue('out', `native-${Date.now()}.json`);
const CREATE_LOOPBACK = args.includes('--create-loopback');
/**
 * How the native path decides to send.
 *
 * - `timed` (default): arm a timer for the intended time and call
 *   `RtMidiOut::sendMessage()` when it fires. This is the closest the native
 *   path can get to a timestamped send.
 * - `early`: send as soon as the event enters the look-ahead window. This is
 *   what a sink that does not compensate would do; the report shows how far
 *   ahead of the intended time the notes arrive.
 */
const SEND_MODE = args.includes('--early') ? 'early' : 'timed';

const TICKS_PER_QUARTER = 480;
const MIDI_CLOCK_PPQN = 24;

/* ------------------------------------------------------------------ *
 * Pure maths (kept local so the harness has no build step)
 * ------------------------------------------------------------------ */

function percentile(sorted, fraction) {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0];
  const position = fraction * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function summarize(samples) {
  if (samples.length === 0) {
    return {
      count: 0,
      min: Number.NaN,
      max: Number.NaN,
      mean: Number.NaN,
      p50: Number.NaN,
      p95: Number.NaN,
      p99: Number.NaN,
    };
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

function encodeEventId(eventId) {
  const low = eventId % 100;
  const high = Math.floor(eventId / 100);
  return { note: 20 + low, velocity: 1 + high };
}

function decodeEventId(note, velocity) {
  if (velocity < 1) return null;
  const low = note - 20;
  if (low < 0 || low > 99) return null;
  return low + (velocity - 1) * 100;
}

/* ------------------------------------------------------------------ *
 * Timeline
 * ------------------------------------------------------------------ */

function buildTimeline() {
  const totalBeats = BARS * BEATS_PER_BAR;
  const totalTicks = totalBeats * TICKS_PER_QUARTER;
  const events = [];
  let id = 0;

  for (let tick = 0; tick < totalTicks; tick += TICKS_PER_QUARTER / MIDI_CLOCK_PPQN) {
    events.push({ id: id++, tick, kind: 'clock', channel: 0, note: 0, velocity: 0 });
  }

  for (let beat = 0; beat < totalBeats; beat += 1) {
    const parts = [{ channel: 1, note: 60 + (beat % 12) }];
    parts.push({ channel: 10, note: 76 });
    if (beat % 4 === 0) {
      parts.push({ channel: 2, note: 36 });
    }
    for (const part of parts) {
      const encoded = encodeEventId(id);
      events.push({
        id: id++,
        tick: beat * TICKS_PER_QUARTER,
        kind: 'note-on',
        channel: part.channel,
        note: encoded.note,
        velocity: encoded.velocity,
      });
      events.push({
        id: id++,
        tick: beat * TICKS_PER_QUARTER + 240,
        kind: 'note-off',
        channel: part.channel,
        note: encoded.note,
        velocity: encoded.velocity,
      });
    }
  }

  return events.sort((left, right) => left.tick - right.tick || left.id - right.id);
}

/* ------------------------------------------------------------------ *
 * Worker timer
 * ------------------------------------------------------------------ */

const timerSource = `
const { parentPort } = require('node:worker_threads');
let handle;
parentPort.on('message', (message) => {
  if (message.type === 'stop') {
    if (handle !== undefined) clearInterval(handle);
    handle = undefined;
    return;
  }
  if (message.type === 'start') {
    if (handle !== undefined) clearInterval(handle);
    handle = setInterval(() => parentPort.postMessage('tick'), message.intervalMs);
  }
});
`;

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

function listPorts() {
  return {
    outputs: Output.getPortNames(),
    inputs: Input.getPortNames(),
  };
}

function pickPort(names, wanted) {
  if (!wanted) return names[0];
  const exact = names.find((name) => name === wanted);
  if (exact !== undefined) return exact;
  return names.find((name) => name.includes(wanted));
}

async function main() {
  verifyLibraryLoaded();
  const ports = listPorts();
  console.log(`Native output ports: ${JSON.stringify(ports.outputs)}`);
  console.log(`Native input ports: ${JSON.stringify(ports.inputs)}`);

  const notes = [];

  let output = null;
  const outputName = pickPort(ports.outputs, OUTPUT_NAME);
  if (outputName !== undefined) {
    output = new Output();
    output.openPortByName(outputName);
    notes.push(`Opened native output "${outputName}".`);
  } else {
    notes.push('No native output port was opened.');
  }

  // A virtual capture port lets the harness measure its own round trip
  // without an external driver. RtMidi can only create virtual ports on
  // macOS (CoreMIDI) and Linux (ALSA sequencer); the Windows MM API cannot.
  let input = null;
  let loopbackName = '';
  if (CREATE_LOOPBACK) {
    try {
      input = new Input();
      loopbackName = `PracticePlayer S2 Loopback ${Date.now()}`;
      input.openVirtualPort(loopbackName);
      notes.push(`Created native virtual capture port "${loopbackName}".`);
    } catch (error) {
      notes.push(`Virtual capture port not available: ${String(error)}`);
    }
  }

  if (!input) {
    const captureName = pickPort(ports.inputs, CAPTURE_NAME);
    if (captureName !== undefined) {
      input = new Input();
      input.openPortByName(captureName);
      notes.push(`Opened native capture port "${captureName}".`);
    }
  }

  if (input && output && loopbackName) {
    // The virtual port we just created is also visible as an output port.
    const refreshed = listPorts();
    const virtualOutputName = pickPort(refreshed.outputs, loopbackName);
    if (virtualOutputName !== undefined) {
      output.closePort();
      output = new Output();
      output.openPortByName(virtualOutputName);
      notes.push(`Re-opened native output on the virtual port "${virtualOutputName}".`);
    }
  }

  const events = buildTimeline();
  const secondsPerTick = 60 / BPM / TICKS_PER_QUARTER;
  const startDelayMs = 250;
  const anchor = performance.now() + startDelayMs;
  const timeForTick = (tick) => anchor + tick * secondsPerTick * 1000;
  const totalDurationMs = BARS * BEATS_PER_BAR * TICKS_PER_QUARTER * secondsPerTick * 1000;

  const dispatchRecords = [];
  const noteSamples = [];
  const clockArrivals = [];
  const intendedById = new Map();
  let unmatched = 0;

  if (input) {
    input.on('message', (_delta, message) => {
      const status = message[0] & 0xf0;
      if (status === 0x90) {
        const id = decodeEventId(message[1] & 0x7f, message[2] & 0x7f);
        const intended = id === null ? undefined : intendedById.get(id);
        if (intended === undefined) {
          unmatched += 1;
          return;
        }
        const received = performance.now();
        noteSamples.push({
          id,
          intendedTimeMs: intended,
          receivedTimeMs: received,
          errorMs: received - intended,
        });
      } else if ((message[0] & 0xff) === 0xf8) {
        clockArrivals.push(performance.now());
      }
    });
  }

  let nextIndex = 0;
  let finished = false;
  const pendingTimers = new Set();
  const worker = new Worker(timerSource, { eval: true });

  /**
   * Sends one event and records how late it was.
   *
   * RtMidi has no timestamped send, so the native path can only send at the
   * intended instant. The scheduler therefore arms a timer for the intended
   * time; the error is the difference between the moment `send()` was called
   * and the intended time.
   */
  const sendEvent = (event, intendedTimeMs) => {
    const dispatchedAtMs = performance.now();
    dispatchRecords.push({
      id: event.id,
      kind: event.kind,
      intendedTimeMs,
      dispatchedAtMs,
      latenessMs: dispatchedAtMs - intendedTimeMs,
    });
    if (!output) {
      return;
    }
    if (event.kind === 'clock') {
      output.send(Buffer.from([0xf8]));
      return;
    }
    const status =
      event.kind === 'note-on' ? 0x90 | (event.channel - 1) : 0x80 | (event.channel - 1);
    if (event.kind === 'note-on') {
      intendedById.set(event.id, intendedTimeMs);
    }
    output.send(Buffer.from([status, event.note, event.velocity]));
  };

  const dispatch = () => {
    const now = performance.now();
    const horizon = now + LOOK_AHEAD_MS;
    while (nextIndex < events.length) {
      const event = events[nextIndex];
      const intendedTimeMs = timeForTick(event.tick);
      if (intendedTimeMs > horizon) break;
      nextIndex += 1;
      if (SEND_MODE === 'early') {
        sendEvent(event, intendedTimeMs);
        continue;
      }
      const delayMs = Math.max(0, intendedTimeMs - now);
      const timer = setTimeout(() => {
        pendingTimers.delete(timer);
        sendEvent(event, intendedTimeMs);
      }, delayMs);
      pendingTimers.add(timer);
    }
    if (nextIndex >= events.length && pendingTimers.size === 0 && !finished) {
      finished = true;
      worker.postMessage({ type: 'stop' });
    }
  };

  worker.on('message', dispatch);
  worker.postMessage({ type: 'start', intervalMs: WORKER_INTERVAL_MS });

  const startedAt = performance.now();
  while (!finished && performance.now() - startedAt < totalDurationMs + 10_000) {
    await new Promise((done) => setTimeout(done, 50));
  }
  await new Promise((done) => setTimeout(done, 750));
  await worker.terminate();

  if (input) input.closePort();
  if (output) output.closePort();

  const noteErrors = noteSamples.map((sample) => sample.errorMs);
  const errorStats = summarize(noteErrors);
  const jitterStats = summarize(noteErrors.map((error) => Math.abs(error - errorStats.p50)));
  const intervals = [];
  for (let index = 1; index < clockArrivals.length; index += 1) {
    intervals.push(clockArrivals[index] - clockArrivals[index - 1]);
  }
  const nominalIntervalMs = 60000 / BPM / MIDI_CLOCK_PPQN;

  const report = {
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    electron: process.versions.electron ?? null,
    candidate: '@julusian/midi 3.8.1 (RtMidi, MIT)',
    ports,
    notes,
    settings: {
      bpm: BPM,
      bars: BARS,
      lookAheadMs: LOOK_AHEAD_MS,
      workerIntervalMs: WORKER_INTERVAL_MS,
      sendMode: SEND_MODE,
    },
    dispatch: {
      count: dispatchRecords.length,
      lateness: summarize(dispatchRecords.map((record) => record.latenessMs)),
      lateCount: dispatchRecords.filter((record) => record.latenessMs > 0).length,
      lateFraction:
        dispatchRecords.length === 0
          ? 0
          : dispatchRecords.filter((record) => record.latenessMs > 0).length /
            dispatchRecords.length,
      records: dispatchRecords,
    },
    capturedNotes: {
      count: noteSamples.length,
      error: errorStats,
      jitter: jitterStats,
      samples: noteSamples,
    },
    clock: {
      count: clockArrivals.length,
      interval: summarize(intervals),
      intervalDeviation: summarize(intervals.map((value) => value - nominalIntervalMs)),
      nominalIntervalMs,
    },
    unmatchedReceived: unmatched,
  };

  const resultsRoot = join(SPIKE_ROOT, 'results');
  await mkdir(resultsRoot, { recursive: true });
  const target = join(resultsRoot, OUT_NAME);
  await writeFile(target, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Report written to ${target}`);
  console.log(
    `Dispatch lateness p50=${report.dispatch.lateness.p50.toFixed(3)}ms p99=${report.dispatch.lateness.p99.toFixed(3)}ms max=${report.dispatch.lateness.max.toFixed(3)}ms`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
