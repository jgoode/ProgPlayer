// Throwaway verification script for spikes/s1/fixtures/GeneralUser-GS.sf3.
// Usage: node spikes/s1/tools/verify-sf3.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { SoundBankLoader, BasicSoundBank } from 'spessasynth_core';
import { StbVorbis } from 'stb-vorbis';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, '..', 'fixtures');
const sf2Path = path.join(fixtures, 'GeneralUser-GS.sf2');
const sf3Path = path.join(fixtures, 'GeneralUser-GS.sf3');

const sf2Bytes = await readFile(sf2Path);
const sf3Bytes = await readFile(sf3Path);

await BasicSoundBank.ready;
await StbVorbis.ready;

const sf2 = SoundBankLoader.fromArrayBuffer(
  sf2Bytes.buffer.slice(sf2Bytes.byteOffset, sf2Bytes.byteOffset + sf2Bytes.byteLength),
);
const sf3 = SoundBankLoader.fromArrayBuffer(
  sf3Bytes.buffer.slice(sf3Bytes.byteOffset, sf3Bytes.byteOffset + sf3Bytes.byteLength),
);

const compressed = sf3.samples.filter((s) => s.isCompressed).length;

console.log('SF2 file:', sf2Path);
console.log('  size (bytes):', sf2Bytes.byteLength);
console.log('  version:', sf2.soundBankInfo.version);
console.log('  presets:', sf2.presets.length);
console.log('  samples:', sf2.samples.length);
console.log('SF3 file:', sf3Path);
console.log('  size (bytes):', sf3Bytes.byteLength);
console.log('  version:', sf3.soundBankInfo.version);
console.log('  presets:', sf3.presets.length);
console.log('  samples:', sf3.samples.length);
console.log('  compressed samples:', compressed);
console.log('  preset count match:', sf2.presets.length === sf3.presets.length);
console.log('  sample count match:', sf2.samples.length === sf3.samples.length);
console.log(
  '  preset names match:',
  sf2.presets.every((p, i) => p.name === sf3.presets[i].name),
);
console.log(
  '  sample names match:',
  sf2.samples.every((s, i) => s.name === sf3.samples[i].name),
);
console.log(
  '  preset bank/program addresses match:',
  sf2.presets.every(
    (p, i) =>
      p.bankMSB === sf3.presets[i].bankMSB &&
      p.bankLSB === sf3.presets[i].bankLSB &&
      p.program === sf3.presets[i].program,
  ),
);

// Decode every compressed sample with stb-vorbis and compare the decoded
// frame count against the source SF2 sample length.
let decodedChecked = 0;
let decodedMismatches = 0;
for (let i = 0; i < sf3.samples.length; i++) {
  const sample = sf3.samples[i];
  if (!sample.isCompressed) continue;
  const stored = sample.getStoredData();
  if (stored.form !== 'vorbis') throw new Error(`sample ${i} is not vorbis`);
  const decoded = StbVorbis.decode(stored.data);
  const frames = decoded.channels[0].length;
  const expected = sf2.samples[i].sampleLength;
  decodedChecked++;
  if (frames !== expected) {
    decodedMismatches++;
    if (decodedMismatches <= 10) {
      console.log(
        `  length mismatch sample ${i} (${sample.name}): decoded ${frames} vs sf2 ${expected}`,
      );
    }
  }
}

console.log('  vorbis streams decoded:', decodedChecked);
console.log('  decoded-length mismatches vs SF2:', decodedMismatches);
console.log(
  '  decoding verified:',
  decodedChecked === sf3.samples.length && decodedMismatches === 0,
);
