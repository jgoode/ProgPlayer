#!/usr/bin/env node
/**
 * Spike S1 — engine measurement harness.
 *
 * Runs `spessasynth_core` outside the browser so the engine's behaviour can be
 * measured deterministically (same input, same output, no audio device in the
 * loop). The browser app (`spikes/s1/renderer`) measures the same engine
 * through the real Web Audio path with a real output device.
 *
 * Usage:
 *   node spikes/s1/tools/measure-engine.mjs [--seconds 600] [--out spikes/s1/results]
 *
 * Sections:
 *   1. environment          — machine, OS, Node, library versions
 *   2. banks                — SF2 vs SF3 load time, memory, presets/samples
 *   3. timing               — dispatch error of future-timed events
 *   4. equivalence          — scheduler render vs sequencer render
 *   5. throughput           — offline render speed and memory over N minutes
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

import {
  MIDIBuilder,
  SoundBankLoader,
  SpessaSynthProcessor,
  SpessaSynthSequencer,
} from 'spessasynth_core';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPIKE_ROOT = resolve(HERE, '..');
const FIXTURES = resolve(SPIKE_ROOT, 'fixtures');

const SAMPLE_RATE = 48_000;
const RENDER_QUANTUM = 128;
const TICKS_PER_QUARTER = 480;
const BEATS_PER_BAR = 4;
const BPM = 200;

/** Part layout. Mirrors `spikes/s1/renderer/timeline.ts`. */
const CHORD_CHANNEL = 0;
const BASS_CHANNEL = 1;
const CLICK_CHANNEL = 9;
const CHORD_PROGRAM = 0;
const BASS_PROGRAM = 33;
const CLICK_PROGRAM = 0;
const CHORD_ROOT_MIDI = 60;
const BASS_ROOT_MIDI = 36;
const CLICK_NOTE = 39;
const EXTENDED_CHORD_INTERVALS = [0, 4, 7, 10, 14, 17, 21];
const PROGRESSION = [0, 5, 7, 9];

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1 || index + 1 >= args.length) return fallback;
  return args[index + 1];
}
const SOAK_SECONDS = Number(argValue('seconds', '600'));
const OUTPUT_DIR = resolve(SPIKE_ROOT, argValue('out', 'results'));

/* ------------------------------------------------------------------ *
 * Arrangement (shared spec with the renderer; verified by digest)
 * ------------------------------------------------------------------ */

/**
 * Builds the three-part stress arrangement.
 *
 * @param {number} bars number of 4/4 bars
 * @param {number} bpm tempo
 */
function buildArrangement(bars, bpm) {
  const chords = [];
  const bass = [];
  const click = [];

  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * BEATS_PER_BAR * TICKS_PER_QUARTER;
    const barEnd = barStart + BEATS_PER_BAR * TICKS_PER_QUARTER;
    const root = PROGRESSION[bar % PROGRESSION.length];

    for (const interval of EXTENDED_CHORD_INTERVALS) {
      chords.push({
        channel: CHORD_CHANNEL,
        note: CHORD_ROOT_MIDI + root + interval,
        velocity: 96,
        startTick: barStart,
        endTick: barEnd,
      });
    }
    bass.push({
      channel: BASS_CHANNEL,
      note: BASS_ROOT_MIDI + root,
      velocity: 104,
      startTick: barStart,
      endTick: barEnd,
    });
    for (let beat = 0; beat < BEATS_PER_BAR; beat++) {
      const start = barStart + beat * TICKS_PER_QUARTER;
      click.push({
        channel: CLICK_CHANNEL,
        note: CLICK_NOTE,
        velocity: beat === 0 ? 120 : 88,
        startTick: start,
        endTick: start + TICKS_PER_QUARTER / 4,
      });
    }
  }

  return { bpm, bars, chords, bass, click };
}

/** All events in absolute seconds, ordered by start time. */
function allEvents(arrangement) {
  const secondsPerTick = 60 / arrangement.bpm / TICKS_PER_QUARTER;
  return [...arrangement.chords, ...arrangement.bass, ...arrangement.click]
    .map((event) => ({
      ...event,
      startSeconds: event.startTick * secondsPerTick,
      endSeconds: event.endTick * secondsPerTick,
    }))
    .sort((a, b) => a.startSeconds - b.startSeconds || a.channel - b.channel);
}

/** FNV-1a digest of the event list, so the renderer can prove it builds the same arrangement. */
function arrangementDigest(arrangement) {
  const lines = allEvents(arrangement)
    .map(
      (event) =>
        `${event.channel}:${event.note}:${event.velocity}:${event.startTick}:${event.endTick}`,
    )
    .join('\n');
  let hash = 0x811c9dc5;
  for (let i = 0; i < lines.length; i++) {
    hash ^= lines.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Builds the equivalent MIDI sequence for the sequencer path. */
function buildMidiSequence(arrangement) {
  const sequence = new MIDIBuilder({
    timeDivision: TICKS_PER_QUARTER,
    initialTempo: arrangement.bpm,
    format: 1,
    name: 'PracticePlayer spike S1',
  });
  sequence.addTrack('chords');
  sequence.addTrack('bass');
  sequence.addTrack('click');

  for (const event of allEvents(arrangement)) {
    const track = event.channel === CHORD_CHANNEL ? 1 : event.channel === BASS_CHANNEL ? 2 : 3;
    const program =
      event.channel === CHORD_CHANNEL
        ? CHORD_PROGRAM
        : event.channel === BASS_CHANNEL
          ? BASS_PROGRAM
          : CLICK_PROGRAM;
    sequence.programChange(event.startTick, track, event.channel, program);
    sequence.noteOn(event.startTick, track, event.channel, event.note, event.velocity);
    sequence.noteOff(event.endTick, track, event.channel, event.note);
  }
  sequence.flush();
  return sequence;
}

/* ------------------------------------------------------------------ *
 * Small analysis helpers
 * ------------------------------------------------------------------ */

function rms(samples) {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const value of samples) sum += value * value;
  return Math.sqrt(sum / samples.length);
}

function peak(samples) {
  let result = 0;
  for (const value of samples) {
    const absolute = Math.abs(value);
    if (absolute > result) result = absolute;
  }
  return result;
}

function firstOnset(samples, threshold = 1e-4) {
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) > threshold) return i;
  }
  return -1;
}

function toDecibels(amplitude) {
  if (amplitude <= 0) return -Infinity;
  return 20 * Math.log10(amplitude);
}

function summarise(values) {
  if (values.length === 0) return { count: 0, min: null, median: null, max: null, mean: null };
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    count: values.length,
    min: sorted[0],
    median: sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle],
    max: sorted[sorted.length - 1],
    mean: values.reduce((a, b) => a + b, 0) / values.length,
  };
}

/* ------------------------------------------------------------------ *
 * 1. Environment
 * ------------------------------------------------------------------ */

function collectEnvironment() {
  const cpus = os.cpus();
  return {
    timestamp: new Date().toISOString(),
    os: {
      platform: os.platform(),
      type: os.type(),
      release: os.release(),
      version: os.version(),
      arch: os.arch(),
    },
    cpu: {
      model: cpus[0]?.model ?? 'unknown',
      logicalCores: cpus.length,
      nominalMHz: cpus[0]?.speed ?? null,
    },
    memory: {
      totalBytes: os.totalmem(),
      freeBytesAtStart: os.freemem(),
    },
    node: process.version,
    engine: {
      sampleRate: SAMPLE_RATE,
      renderQuantum: RENDER_QUANTUM,
      bpm: BPM,
      ticksPerQuarter: TICKS_PER_QUARTER,
    },
  };
}

/* ------------------------------------------------------------------ *
 * 2. Sound banks
 * ------------------------------------------------------------------ */

async function loadBank(path) {
  const bytes = await readFile(path);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const parseStart = performance.now();
  const bank = SoundBankLoader.fromArrayBuffer(buffer);
  const parseMs = performance.now() - parseStart;
  return {
    bank,
    fileBytes: bytes.byteLength,
    parseMs,
    presets: bank.presets.length,
    samples: bank.samples.length,
    compressedSamples: bank.samples.filter((sample) => sample.isCompressed).length,
    version: bank.soundBankInfo.version,
  };
}

async function measureBanks() {
  const results = {};
  for (const [key, file] of [
    ['sf2', 'GeneralUser-GS.sf2'],
    ['sf3', 'GeneralUser-GS.sf3'],
  ]) {
    const path = resolve(FIXTURES, file);
    const rssBefore = process.memoryUsage().rss;
    const heapBefore = process.memoryUsage().heapUsed;
    const started = performance.now();
    const loaded = await loadBank(path);
    const totalMs = performance.now() - started;
    const rssAfter = process.memoryUsage().rss;
    results[key] = {
      file,
      fileBytes: loaded.fileBytes,
      parseMs: Number(loaded.parseMs.toFixed(2)),
      totalLoadMs: Number(totalMs.toFixed(2)),
      presets: loaded.presets,
      samples: loaded.samples,
      compressedSamples: loaded.compressedSamples,
      version: loaded.version,
      rssDeltaBytes: rssAfter - rssBefore,
      heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
      sha256: createHash('sha256')
        .update(await readFile(path))
        .digest('hex'),
    };
  }
  return results;
}

/* ------------------------------------------------------------------ *
 * 3. Timing
 * ------------------------------------------------------------------ */

/**
 * Measures the dispatch error of a future-timed MIDI message.
 *
 * The core queues the message and dispatches it at the start of the first
 * render quantum whose engine clock has reached the requested time
 * (`spessasynth_core/src/synthesizer/processor.ts`, `processMessage` and
 * `process`). The error is therefore expected in [0, quantum).
 *
 * @param {object} bank sound bank
 * @param {number} leadFrames requested lead, in frames
 */
function measureDispatchError(bank, leadFrames) {
  const processor = new SpessaSynthProcessor(SAMPLE_RATE, { autoAllocateVoices: true });
  processor.soundBankManager.addSoundBank(bank, 'main');
  const left = new Float32Array(RENDER_QUANTUM);
  const right = new Float32Array(RENDER_QUANTUM);

  // Warm the engine so the first decoded sample is not part of the measurement.
  for (let i = 0; i < 64; i++) processor.process(left, right);

  const target = processor.currentTime + leadFrames / SAMPLE_RATE;
  processor.processMessage([0x90, 60, 100], 0, { time: target });

  for (let i = 0; i < 10_000; i++) {
    const blockStart = processor.currentTime;
    processor.process(left, right);
    if (processor.voiceCount > 0) {
      return {
        leadFrames,
        errorFrames: (blockStart - target) * SAMPLE_RATE,
        dispatchEngineTime: blockStart,
        targetEngineTime: target,
      };
    }
  }
  return {
    leadFrames,
    errorFrames: Number.NaN,
    dispatchEngineTime: null,
    targetEngineTime: target,
  };
}

/**
 * Same measurement, but with the render quantum split at the requested frame.
 *
 * This is the "worklet-side event queue" option: the engine's queue is drained
 * at the start of every `process()` call, so splitting the quantum gives the
 * event an exact frame. The audio is compared against the unsplit render to
 * see whether splitting changes the synthesis.
 */
function measureDispatchErrorSplit(bank, leadFrames) {
  const processor = new SpessaSynthProcessor(SAMPLE_RATE, { autoAllocateVoices: true });
  processor.soundBankManager.addSoundBank(bank, 'main');
  const left = new Float32Array(RENDER_QUANTUM);
  const right = new Float32Array(RENDER_QUANTUM);
  for (let i = 0; i < 64; i++) processor.process(left, right);

  const target = processor.currentTime + leadFrames / SAMPLE_RATE;
  const targetFrame = target * SAMPLE_RATE;
  processor.processMessage([0x90, 60, 100], 0, { time: target });

  for (let i = 0; i < 10_000; i++) {
    const blockStartFrame = processor.currentTime * SAMPLE_RATE;
    let consumed = 0;
    while (consumed < RENDER_QUANTUM) {
      const nextFrame = blockStartFrame + consumed;
      const room = RENDER_QUANTUM - consumed;
      const split =
        targetFrame > nextFrame && targetFrame < nextFrame + room
          ? Math.round(targetFrame - nextFrame)
          : room;
      const subStart = processor.currentTime;
      processor.process(left, right, consumed, split);
      if (processor.voiceCount > 0) {
        return {
          leadFrames,
          errorFrames: (subStart - target) * SAMPLE_RATE,
          dispatchEngineTime: subStart,
          targetEngineTime: target,
        };
      }
      consumed += split;
      if (split === 0) break;
    }
  }
  return {
    leadFrames,
    errorFrames: Number.NaN,
    dispatchEngineTime: null,
    targetEngineTime: target,
  };
}

/** Renders a short note, with and without splitting the quantum, and compares the audio. */
function measureSplitAudibleDifference(bank) {
  const render = (split) => {
    const processor = new SpessaSynthProcessor(SAMPLE_RATE, { autoAllocateVoices: true });
    processor.soundBankManager.addSoundBank(bank, 'main');
    const left = new Float32Array(RENDER_QUANTUM);
    const right = new Float32Array(RENDER_QUANTUM);
    processor.processMessage([0x90, 69, 100], 0, { time: 0 });
    processor.processMessage([0x80, 69, 0], 0, { time: 1 });
    const frames = SAMPLE_RATE / 4;
    const output = new Float32Array(frames);
    for (let offset = 0; offset < frames; offset += RENDER_QUANTUM) {
      if (split) {
        processor.process(left, right, 0, 37);
        processor.process(left, right, 37, RENDER_QUANTUM - 37);
      } else {
        processor.process(left, right);
      }
      const count = Math.min(RENDER_QUANTUM, frames - offset);
      output.set(left.subarray(0, count), offset);
    }
    return output;
  };

  const unsplit = render(false);
  const split = render(true);
  let differenceSquares = 0;
  let signalSquares = 0;
  let maxDifference = 0;
  for (let i = 0; i < unsplit.length; i++) {
    const difference = unsplit[i] - split[i];
    differenceSquares += difference * difference;
    signalSquares += unsplit[i] * unsplit[i];
    if (Math.abs(difference) > maxDifference) maxDifference = Math.abs(difference);
  }
  return {
    frames: unsplit.length,
    signalRms: rms(unsplit),
    differenceRms: rms(
      Float32Array.from({ length: unsplit.length }, (_, i) => unsplit[i] - split[i]),
    ),
    differenceToSignalDb: Number(
      toDecibels(Math.sqrt(differenceSquares / Math.max(signalSquares, 1e-30))).toFixed(2),
    ),
    maxAbsoluteDifference: maxDifference,
  };
}

function measureTiming(bank) {
  const leads = [1, 32, 64, 96, 127, 128, 129, 200, 255, 256, 300, 512, 1000, 4096];
  const plain = leads.map((lead) => measureDispatchError(bank, lead));
  const split = leads.map((lead) => measureDispatchErrorSplit(bank, lead));
  const errors = plain.map((entry) => entry.errorFrames);
  const splitErrors = split.map((entry) => entry.errorFrames);

  return {
    leads,
    plain,
    split,
    plainErrorFrames: summarise(errors),
    splitErrorFrames: summarise(splitErrors),
    maxAbsPlainErrorFrames: Math.max(...errors.map(Math.abs)),
    maxAbsSplitErrorFrames: Math.max(...splitErrors.map(Math.abs)),
    withinOneQuantum: errors.every((error) => error >= -0.001 && error < RENDER_QUANTUM),
    splitWithinOneQuantum: splitErrors.every((error) => Math.abs(error) < 0.001),
    splitAudibleDifference: measureSplitAudibleDifference(bank),
  };
}

/* ------------------------------------------------------------------ *
 * 4. Scheduler vs sequencer equivalence
 * ------------------------------------------------------------------ */

/** Renders the arrangement with future-timed messages (the scheduler path). */
function renderWithScheduler(bank, arrangement, seconds) {
  const processor = new SpessaSynthProcessor(SAMPLE_RATE, { autoAllocateVoices: true });
  processor.soundBankManager.addSoundBank(bank, 'main');
  const frames = Math.ceil(seconds * SAMPLE_RATE);
  const output = new Float32Array(frames);
  const left = new Float32Array(RENDER_QUANTUM);
  const right = new Float32Array(RENDER_QUANTUM);

  for (const event of allEvents(arrangement)) {
    const program =
      event.channel === CHORD_CHANNEL
        ? CHORD_PROGRAM
        : event.channel === BASS_CHANNEL
          ? BASS_PROGRAM
          : CLICK_PROGRAM;
    processor.processMessage([0xc0 | event.channel, program], 0, {
      time: event.startSeconds,
    });
    processor.processMessage([0x90 | event.channel, event.note, event.velocity], 0, {
      time: event.startSeconds,
    });
    processor.processMessage([0x80 | event.channel, event.note, 0], 0, {
      time: event.endSeconds,
    });
  }

  for (let offset = 0; offset < frames; offset += RENDER_QUANTUM) {
    processor.process(left, right);
    const count = Math.min(RENDER_QUANTUM, frames - offset);
    output.set(left.subarray(0, count), offset);
  }
  return output;
}

/** Renders the arrangement through the engine's own sequencer (the offline path). */
function renderWithSequencer(bank, arrangement, seconds) {
  const processor = new SpessaSynthProcessor(SAMPLE_RATE, { autoAllocateVoices: true });
  processor.soundBankManager.addSoundBank(bank, 'main');
  const sequencer = new SpessaSynthSequencer(processor);
  sequencer.loadNewSongList([buildMidiSequence(arrangement)]);
  sequencer.play();

  const frames = Math.ceil(seconds * SAMPLE_RATE);
  const output = new Float32Array(frames);
  const left = new Float32Array(RENDER_QUANTUM);
  const right = new Float32Array(RENDER_QUANTUM);

  for (let offset = 0; offset < frames; offset += RENDER_QUANTUM) {
    sequencer.processTick();
    processor.process(left, right);
    const count = Math.min(RENDER_QUANTUM, frames - offset);
    output.set(left.subarray(0, count), offset);
  }
  return output;
}

function measureEquivalence(bank, arrangement, seconds) {
  const scheduler = renderWithScheduler(bank, arrangement, seconds);
  const sequencer = renderWithSequencer(bank, arrangement, seconds);

  const schedulerOnset = firstOnset(scheduler);
  const sequencerOnset = firstOnset(sequencer);

  // Compare the envelope after aligning on the first onset.
  const align = schedulerOnset >= 0 && sequencerOnset >= 0 ? sequencerOnset - schedulerOnset : 0;
  let differenceSquares = 0;
  let signalSquares = 0;
  const length = Math.min(scheduler.length, sequencer.length) - Math.max(0, align);
  for (let i = 0; i < length; i++) {
    const reference = scheduler[i + Math.max(0, align)] ?? 0;
    const candidate = sequencer[i] ?? 0;
    const difference = reference - candidate;
    differenceSquares += difference * difference;
    signalSquares += reference * reference;
  }

  return {
    seconds,
    schedulerOnsetFrame: schedulerOnset,
    sequencerOnsetFrame: sequencerOnset,
    onsetDeltaFrames: align,
    schedulerPeak: peak(scheduler),
    sequencerPeak: peak(sequencer),
    schedulerRms: rms(scheduler),
    sequencerRms: rms(sequencer),
    peakDeltaDb: Number((toDecibels(peak(scheduler)) - toDecibels(peak(sequencer))).toFixed(3)),
    rmsDeltaDb: Number((toDecibels(rms(scheduler)) - toDecibels(rms(sequencer))).toFixed(3)),
    alignedDifferenceToSignalDb: Number(
      toDecibels(Math.sqrt(differenceSquares / Math.max(signalSquares, 1e-30))).toFixed(2),
    ),
  };
}

/* ------------------------------------------------------------------ *
 * 5. Throughput and memory over the soak length
 * ------------------------------------------------------------------ */

function measureThroughput(bank, arrangement, seconds) {
  const processor = new SpessaSynthProcessor(SAMPLE_RATE, { autoAllocateVoices: true });
  processor.soundBankManager.addSoundBank(bank, 'main');
  const sequencer = new SpessaSynthSequencer(processor);
  sequencer.loadNewSongList([buildMidiSequence(arrangement)]);
  sequencer.play();

  const frames = Math.ceil(seconds * SAMPLE_RATE);
  const left = new Float32Array(RENDER_QUANTUM);
  const right = new Float32Array(RENDER_QUANTUM);
  const rssBefore = process.memoryUsage().rss;
  const cpuBefore = process.cpuUsage();

  const started = performance.now();
  let peakVoices = 0;
  let voiceSamples = 0;
  let voiceTotal = 0;
  for (let offset = 0; offset < frames; offset += RENDER_QUANTUM) {
    sequencer.processTick();
    processor.process(left, right);
    if (processor.voiceCount > peakVoices) peakVoices = processor.voiceCount;
    voiceTotal += processor.voiceCount;
    voiceSamples++;
  }
  const elapsedSeconds = (performance.now() - started) / 1000;
  const cpu = process.cpuUsage(cpuBefore);
  const rssAfter = process.memoryUsage().rss;

  return {
    seconds,
    wallClockSeconds: Number(elapsedSeconds.toFixed(3)),
    fasterThanRealTime: Number((seconds / elapsedSeconds).toFixed(2)),
    cpuUserSeconds: Number((cpu.user / 1e6).toFixed(3)),
    cpuSystemSeconds: Number((cpu.system / 1e6).toFixed(3)),
    cpuPercentOfOneCore: Number(
      (((cpu.user + cpu.system) / 1e6 / elapsedSeconds) * 100).toFixed(2),
    ),
    peakVoices,
    meanVoices: Number((voiceTotal / Math.max(1, voiceSamples)).toFixed(2)),
    rssDeltaBytes: rssAfter - rssBefore,
    rssAfterBytes: rssAfter,
  };
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

async function main() {
  const environment = collectEnvironment();
  console.log('Measuring sound banks…');
  const banks = await measureBanks();
  const sf2 = await loadBank(resolve(FIXTURES, 'GeneralUser-GS.sf2'));

  console.log('Measuring timing…');
  const timing = measureTiming(sf2.bank);

  console.log('Measuring scheduler/sequencer equivalence…');
  const soakBars = Math.ceil(SOAK_SECONDS / ((BEATS_PER_BAR * 60) / BPM));
  const arrangement = buildArrangement(soakBars, BPM);
  const equivalence = measureEquivalence(sf2.bank, arrangement, 20);

  console.log('Measuring throughput…');
  const throughput = {};
  for (const [key, file] of [
    ['sf2', 'GeneralUser-GS.sf2'],
    ['sf3', 'GeneralUser-GS.sf3'],
  ]) {
    const loaded = await loadBank(resolve(FIXTURES, file));
    throughput[key] = measureThroughput(loaded.bank, arrangement, SOAK_SECONDS);
  }

  const report = {
    environment,
    banks,
    arrangement: {
      bars: arrangement.bars,
      bpm: arrangement.bpm,
      chordNotesPerBar: EXTENDED_CHORD_INTERVALS.length,
      notesScheduled:
        arrangement.chords.length + arrangement.bass.length + arrangement.click.length,
      digest: arrangementDigest(arrangement),
    },
    timing,
    equivalence,
    throughput,
  };

  await mkdir(OUTPUT_DIR, { recursive: true });
  const target = resolve(OUTPUT_DIR, `engine-${Date.now()}.json`);
  await writeFile(target, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nReport written to ${target}`);
  console.log(
    `Timing: max |error| = ${timing.maxAbsPlainErrorFrames} frames ` +
      `(quantum ${RENDER_QUANTUM}); within one quantum: ${timing.withinOneQuantum}`,
  );
  console.log(
    `Equivalence: onset delta = ${equivalence.onsetDeltaFrames} frames, ` +
      `level delta = ${equivalence.rmsDeltaDb} dB`,
  );
  for (const [key, value] of Object.entries(throughput)) {
    console.log(
      `Throughput ${key}: ${value.fasterThanRealTime}x real time, ` +
        `CPU ${value.cpuPercentOfOneCore}% of one core, peak voices ${value.peakVoices}`,
    );
  }
}

await main();
