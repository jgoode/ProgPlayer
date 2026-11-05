// Throwaway probe: where exactly do the scheduler and sequencer waveforms
// differ? Prints the first samples of each, the samples around the largest
// difference, and a per-note-onset difference.
//
// Usage: node spikes/s1/tools/probe-waveform.mjs

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BasicMIDI,
  MIDIBuilder,
  SoundBankLoader,
  SpessaSynthProcessor,
  SpessaSynthSequencer,
} from 'spessasynth_core';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, '..', 'fixtures');

const SAMPLE_RATE = 48_000;
const RENDER_QUANTUM = 128;
const BPM = 200;
const CHORD_CHANNEL = 0;
const CHORD_PROGRAM = 0;
const CHORD_ROOT_MIDI = 60;

const bytes = await readFile(resolve(FIXTURES, 'GeneralUser-GS.sf2'));
const bank = SoundBankLoader.fromArrayBuffer(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);

const frames = 4800; // 0.1 s

/** One note, scheduled with a future timestamp. */
function renderScheduler(note, time) {
  const processor = new SpessaSynthProcessor(SAMPLE_RATE, { autoAllocateVoices: true });
  processor.soundBankManager.addSoundBank(bank, 'main');
  processor.processMessage([0xc0 | CHORD_CHANNEL, CHORD_PROGRAM], 0, { time });
  processor.processMessage([0x90 | CHORD_CHANNEL, note, 96], 0, { time });
  processor.processMessage([0x80 | CHORD_CHANNEL, note, 0], 0, { time: time + 0.5 });

  const output = new Float32Array(frames);
  const left = new Float32Array(RENDER_QUANTUM);
  const right = new Float32Array(RENDER_QUANTUM);
  for (let offset = 0; offset < frames; offset += RENDER_QUANTUM) {
    processor.process(left, right);
    const count = Math.min(RENDER_QUANTUM, frames - offset);
    output.set(left.subarray(0, count), offset);
  }
  return output;
}

/** One note, through the engine's sequencer. */
function renderSequencer(note, tick) {
  const processor = new SpessaSynthProcessor(SAMPLE_RATE, { autoAllocateVoices: true });
  processor.soundBankManager.addSoundBank(bank, 'main');

  const builder = new MIDIBuilder({
    timeDivision: 480,
    initialTempo: BPM,
    format: 1,
    name: 'probe',
  });
  builder.addTrack('chords');
  builder.programChange(tick, 1, CHORD_CHANNEL, CHORD_PROGRAM);
  builder.noteOn(tick, 1, CHORD_CHANNEL, note, 96);
  builder.noteOff(tick + 240, 1, CHORD_CHANNEL, note);
  builder.flush();

  const sequencer = new SpessaSynthSequencer(processor);
  sequencer.loadNewSongList([BasicMIDI.fromArrayBuffer(builder.writeMIDI())]);
  sequencer.play();

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

const scheduler = renderScheduler(CHORD_ROOT_MIDI, 0);
const sequencer = renderSequencer(CHORD_ROOT_MIDI, 0);

console.log(
  'scheduler[0..16]:',
  Array.from(scheduler.subarray(0, 16)).map((v) => v.toFixed(6)),
);
console.log(
  'sequencer[0..16]:',
  Array.from(sequencer.subarray(0, 16)).map((v) => v.toFixed(6)),
);

console.log(
  'scheduler[120..136]:',
  Array.from(scheduler.subarray(120, 136)).map((v) => v.toFixed(6)),
);
console.log(
  'sequencer[120..136]:',
  Array.from(sequencer.subarray(120, 136)).map((v) => v.toFixed(6)),
);

console.log(
  'scheduler[248..264]:',
  Array.from(scheduler.subarray(248, 264)).map((v) => v.toFixed(6)),
);
console.log(
  'sequencer[248..264]:',
  Array.from(sequencer.subarray(248, 264)).map((v) => v.toFixed(6)),
);

let maxDifference = 0;
let maxIndex = 0;
for (let i = 0; i < frames; i++) {
  const difference = Math.abs((scheduler[i] ?? 0) - (sequencer[i] ?? 0));
  if (difference > maxDifference) {
    maxDifference = difference;
    maxIndex = i;
  }
}
console.log(`max absolute difference ${maxDifference.toFixed(6)} at frame ${maxIndex}`);
console.log(
  `scheduler[${maxIndex}..${maxIndex + 8}]:`,
  Array.from(scheduler.subarray(maxIndex, maxIndex + 8)).map((v) => v.toFixed(6)),
);
console.log(
  `sequencer[${maxIndex}..${maxIndex + 8}]:`,
  Array.from(sequencer.subarray(maxIndex, maxIndex + 8)).map((v) => v.toFixed(6)),
);

// Compare the two, shifted by one quantum.
let maxShifted = 0;
let maxShiftedIndex = 0;
for (let i = 0; i + RENDER_QUANTUM < frames; i++) {
  const difference = Math.abs((scheduler[i] ?? 0) - (sequencer[i + RENDER_QUANTUM] ?? 0));
  if (difference > maxShifted) {
    maxShifted = difference;
    maxShiftedIndex = i;
  }
}
console.log(
  `max absolute difference shifted by one quantum: ${maxShifted.toFixed(6)} at frame ${maxShiftedIndex}`,
);
