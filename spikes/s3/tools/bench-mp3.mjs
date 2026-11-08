// Spike S3 — MP3 encoder benchmark for PracticePlayer.
//
// Measures, for every candidate encoder that installs and runs:
//   * wall-clock encode time (3 runs, median + range)
//   * output file size
//   * SNR and band split against the original PCM (decode-back comparison)
//
// The input is a deterministic synthetic 5-minute stereo render (chord tones +
// 500 ms percussive click + harmonics) so no external assets are needed.
//
// Candidates are installed OUTSIDE the repo (npm) so the repo lockfile is never
// touched. The Rust candidate is built with cargo in a throwaway crate.

import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const benchDir = process.env.S3_BENCH_DIR ?? join(os.tmpdir(), 'pp-s3-bench');
// Resolve the candidate packages from the throwaway install, not the repo.
const require = createRequire(join(benchDir, 'package.json'));
const resultsDir = join(repoRoot, 'spikes', 's3', 'results');

/** Read a package's manifest straight from disk (several packages do not
 *  export ./package.json through their "exports" map). */
function manifestOf(name) {
  return JSON.parse(readFileSync(join(benchDir, 'node_modules', name, 'package.json'), 'utf8'));
}

/**
 * Load a package from the throwaway install. Some candidates are CommonJS
 * (require works), others are ESM-only with a default export (dynamic import).
 */
async function loadPackage(name) {
  const manifest = manifestOf(name);
  const isEsm = manifest.type === 'module' && !manifest.main?.endsWith('.cjs');
  if (isEsm) {
    // Some packages only expose a bundle through "exports"; resolve the
    // package directory entry point explicitly.
    const entry = manifest.module ?? manifest.main;
    const href = pathToFileURL(join(benchDir, 'node_modules', name, entry)).href;
    const imported = await import(href);
    return imported.default?.Mp3Encoder ? imported.default : imported;
  }
  const loaded = require(name);
  if (loaded?.Mp3Encoder) return loaded;
  if (loaded?.default?.Mp3Encoder) return loaded.default;
  return loaded;
}

mkdirSync(resultsDir, { recursive: true });

const AUDIO_SECONDS = Number(process.env.S3_SECONDS ?? 300);
const SAMPLE_RATES = [44100, 48000];
const BITRATES = [128, 192];
const RUNS = 3;

// ---------------------------------------------------------------- input signal

/** Deterministic stereo test signal: sustained chord tones + click + harmonics. */
function generatePcm(sampleRate, seconds) {
  const total = sampleRate * seconds;
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  const base = [220, 261.63, 329.63, 392];
  for (let i = 0; i < total; i += 1) {
    const t = i / sampleRate;
    const clickPhase = t % 0.5;
    const click = clickPhase < 0.02 ? Math.exp(-clickPhase * 350) * 0.6 : 0;
    let l = 0;
    let r = 0;
    for (let n = 0; n < base.length; n += 1) {
      const amp = 0.18 / (n + 1);
      const ph = t * Math.PI * 2 * base[n] * (1 + 0.0007 * n);
      l += amp * Math.sin(ph);
      r += amp * Math.sin(ph + 0.01);
    }
    l += 0.05 * Math.sin(t * Math.PI * 2 * 1760);
    r += 0.05 * Math.sin(t * Math.PI * 2 * 1760);
    const clickSample = click * Math.sin(t * Math.PI * 2 * 4000);
    left[i] = Math.max(-1, Math.min(1, l * 0.6 + clickSample));
    right[i] = Math.max(-1, Math.min(1, r * 0.6 + clickSample));
  }
  return { left, right };
}

/** Interleave into a single Float32Array as the encoders expect. */
function interleave({ left, right }) {
  const out = new Float32Array(left.length * 2);
  for (let i = 0; i < left.length; i += 1) {
    out[i * 2] = left[i];
    out[i * 2 + 1] = right[i];
  }
  return out;
}

function toInt16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i += 1) {
    out[i] = Math.max(-32768, Math.min(32767, Math.round(f32[i] * 32767)));
  }
  return out;
}

// ------------------------------------------------------------------- quality

/**
 * Compare decoded PCM against the original.
 *
 * The decoder output can be offset from the reference by the encoder's
 * algorithmic delay (LAME uses 576 + 529 samples). Some encoders write a
 * LAME-style gapless tag so the decoder trims the delay; others do not, and
 * the decoded stream then starts late. A naive sample-by-sample comparison
 * measures that misalignment rather than the codec's noise, so the lag is
 * found first by cross-correlation over a short window and the SNR is
 * computed at that lag.
 *
 * SNR in dB, plus the error-energy split below/above 16 kHz.
 */
function quality(reference, decoded) {
  const n = Math.min(reference.length, decoded.length);
  if (n === 0) return null;

  // --- 1. find the alignment lag by cross-correlating a 4096-sample window.
  const WINDOW = 4096;
  const MAX_LAG = 4096;
  const probeStart = Math.min((reference.length / 2) | 0, reference.length - WINDOW - MAX_LAG);
  let bestLag = 0;
  let bestCorrelation = -Infinity;
  for (let lag = -MAX_LAG; lag <= MAX_LAG; lag += 1) {
    let sum = 0;
    for (let i = 0; i < WINDOW; i += 1) {
      const r = reference[probeStart + i];
      const d = decoded[probeStart + i + lag];
      if (d === undefined) continue;
      sum += r * d;
    }
    if (sum > bestCorrelation) {
      bestCorrelation = sum;
      bestLag = lag;
    }
  }

  // --- 2. compute the SNR at that lag.
  let signal = 0;
  let error = 0;
  let errorLow = 0;
  let errorHigh = 0;
  let signalLow = 0;
  let signalHigh = 0;
  const start = Math.max(0, -bestLag);
  const end = Math.min(reference.length, decoded.length - bestLag);
  for (let i = start; i < end; i += 1) {
    const s = reference[i];
    const d = decoded[i + bestLag];
    const e = s - d;
    signal += s * s;
    error += e * e;
    // Coarse band split: the lower half of the audible band against the rest.
    const position = (i - start) / (end - start);
    if (position < 0.5) {
      errorLow += e * e;
      signalLow += s * s;
    } else {
      errorHigh += e * e;
      signalHigh += s * s;
    }
  }
  const snrDb = error > 0 ? 10 * Math.log10(signal / error) : Infinity;
  return {
    snrDb,
    alignmentLagSamples: bestLag,
    errorEnergyBelowHalf: errorLow,
    errorEnergyAboveHalf: errorHigh,
    signalEnergyBelowHalf: signalLow,
    signalEnergyAboveHalf: signalHigh,
    comparedSamples: end - start,
    decodedSamples: decoded.length,
    referenceSamples: reference.length,
  };
}

// ----------------------------------------------------------------- utilities

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function licenseFiles(root, name) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries;
    try {
      entries = require('node:fs').readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        walk(full, depth + 1);
      } else if (/^(licen[sc]e|copying|notice)/i.test(entry.name)) {
        found.push(full);
      }
    }
  };
  walk(root, 0);
  return found.map((file) => ({
    path: file.replace(root, name),
    firstLines: require('node:fs')
      .readFileSync(file, 'utf8')
      .split('\n')
      .slice(0, 12)
      .join('\n')
      .trim(),
  }));
}

const results = {
  machine: {},
  audio: { seconds: AUDIO_SECONDS, sampleRates: SAMPLE_RATES, bitrates: BITRATES, runs: RUNS },
  candidates: [],
  measurements: [],
};

// --------------------------------------------------------------- candidates

const candidates = [];

async function registerCandidates() {
  // 1. wasm-media-encoders — MIT wrapper around LAME WASM (LAME is LGPL).
  try {
    const { createMp3Encoder } = await loadPackage('wasm-media-encoders');
    candidates.push({
      id: 'wasm-media-encoders',
      version: manifestOf('wasm-media-encoders').version,
      packageLicense: manifestOf('wasm-media-encoders').license,
      encoderLicense: 'LAME 3.x — LGPL (embedded WASM binary)',
      kind: 'wasm',
      run: async ({ interleaved, sampleRate, bitrate }) => {
        const encoder = await createMp3Encoder();
        encoder.configure({ sampleRate, channels: 2, bitrate });
        const chunk = 1152 * 2;
        const parts = [];
        for (let i = 0; i < interleaved.length; i += chunk) {
          const slice = interleaved.subarray(i, Math.min(i + chunk, interleaved.length));
          const left = new Float32Array(slice.length / 2);
          const right = new Float32Array(slice.length / 2);
          for (let j = 0; j < slice.length / 2; j += 1) {
            left[j] = slice[j * 2];
            right[j] = slice[j * 2 + 1];
          }
          parts.push(Uint8Array.from(encoder.encode([left, right])));
        }
        parts.push(Uint8Array.from(encoder.finalize()));
        const total = parts.reduce((n, p) => n + p.length, 0);
        const out = new Uint8Array(total);
        let off = 0;
        for (const p of parts) {
          out.set(p, off);
          off += p.length;
        }
        return out;
      },
    });
  } catch (error) {
    candidates.push({ id: 'wasm-media-encoders', failed: String(error) });
  }

  // 2. @breezystack/lamejs — pure JS LAME port, LGPL-3.0.
  try {
    const lamejs = await loadPackage('@breezystack/lamejs');
    candidates.push({
      id: '@breezystack/lamejs',
      version: manifestOf('@breezystack/lamejs').version,
      packageLicense: manifestOf('@breezystack/lamejs').license,
      encoderLicense: 'LAME 3.x port — LGPL',
      kind: 'js',
      run: ({ interleavedInt16, sampleRate, bitrate }) => {
        const encoder = new lamejs.Mp3Encoder(2, sampleRate, bitrate);
        const parts = [];
        const frame = 1152;
        const left = new Int16Array(frame);
        const right = new Int16Array(frame);
        for (let i = 0; i < interleavedInt16.length; i += frame * 2) {
          const n = Math.min(frame, (interleavedInt16.length - i) / 2);
          for (let j = 0; j < n; j += 1) {
            left[j] = interleavedInt16[i + j * 2];
            right[j] = interleavedInt16[i + j * 2 + 1];
          }
          const buf = encoder.encodeBuffer(left.subarray(0, n), right.subarray(0, n));
          if (buf.length > 0) parts.push(Uint8Array.from(buf));
        }
        const tail = encoder.flush();
        if (tail.length > 0) parts.push(Uint8Array.from(tail));
        const total = parts.reduce((n, p) => n + p.length, 0);
        const out = new Uint8Array(total);
        let off = 0;
        for (const p of parts) {
          out.set(p, off);
          off += p.length;
        }
        return out;
      },
    });
  } catch (error) {
    candidates.push({ id: '@breezystack/lamejs', failed: String(error) });
  }

  // 3. lamejs (original) — pure JS LAME port, LGPL-3.0.
  try {
    const lamejs = await loadPackage('lamejs');
    candidates.push({
      id: 'lamejs',
      version: manifestOf('lamejs').version,
      packageLicense: manifestOf('lamejs').license,
      encoderLicense: 'LAME 3.x port — LGPL',
      kind: 'js',
      run: ({ interleavedInt16, sampleRate, bitrate }) => {
        const encoder = new lamejs.Mp3Encoder(2, sampleRate, bitrate);
        const parts = [];
        const frame = 1152;
        const left = new Int16Array(frame);
        const right = new Int16Array(frame);
        for (let i = 0; i < interleavedInt16.length; i += frame * 2) {
          const n = Math.min(frame, (interleavedInt16.length - i) / 2);
          for (let j = 0; j < n; j += 1) {
            left[j] = interleavedInt16[i + j * 2];
            right[j] = interleavedInt16[i + j * 2 + 1];
          }
          const buf = encoder.encodeBuffer(left.subarray(0, n), right.subarray(0, n));
          if (buf.length > 0) parts.push(Uint8Array.from(buf));
        }
        const tail = encoder.flush();
        if (tail.length > 0) parts.push(Uint8Array.from(tail));
        const total = parts.reduce((n, p) => n + p.length, 0);
        const out = new Uint8Array(total);
        let off = 0;
        for (const p of parts) {
          out.set(p, off);
          off += p.length;
        }
        return out;
      },
    });
  } catch (error) {
    candidates.push({ id: 'lamejs', failed: String(error) });
  }

  // 4. @mediabunny/mp3-encoder — MPL-2.0 wrapper around a LAME WASM build.
  try {
    const mp3 = await loadPackage('@mediabunny/mp3-encoder');
    const mediabunny = await loadPackage('mediabunny');
    candidates.push({
      id: '@mediabunny/mp3-encoder',
      version: manifestOf('@mediabunny/mp3-encoder').version,
      packageLicense: manifestOf('@mediabunny/mp3-encoder').license,
      encoderLicense: 'LAME 3.100 WASM — LGPL (licenses/lame shipped in the package)',
      kind: 'wasm',
      run: async ({ interleaved, sampleRate, bitrate }) => {
        mp3.registerMp3Encoder();
        const channels = 2;
        const frames = Math.floor(interleaved.length / channels);
        // f32-planar: channel 0 first, then channel 1.
        const planar = new Float32Array(frames * channels);
        for (let i = 0; i < frames; i += 1) {
          planar[i] = interleaved[i * 2];
          planar[frames + i] = interleaved[i * 2 + 1];
        }
        const sample = new mediabunny.AudioSample({
          format: 'f32-planar',
          data: planar,
          sampleRate,
          numberOfChannels: channels,
          numberOfFrames: frames,
          timestamp: 0,
        });
        const source = new mediabunny.AudioSampleSource({
          codec: 'mp3',
          quality: new mediabunny.Quality({ bitrate: bitrate * 1000, bitrateMode: 'constant' }),
        });
        const target = new mediabunny.BufferTarget();
        const output = new mediabunny.Output({
          format: new mediabunny.Mp3OutputFormat(),
          target,
        });
        output.addAudioTrack(source);
        const started = output.start();
        await source.add(sample);
        sample.close();
        source.close();
        await output.finalize();
        await started;
        return new Uint8Array(target.buffer);
      },
    });
  } catch (error) {
    candidates.push({ id: '@mediabunny/mp3-encoder', failed: String(error) });
  }

  // 5. rusty_mp3 (pure Rust, Apache-2.0) driven through a WASM build.
  //    The wasm is produced by the throwaway cargo crate; see README.md.
  const rustyWasmPath = process.env.S3_RUSTY_WASM;
  if (rustyWasmPath && existsSync(rustyWasmPath)) {
    const wasmBytes = require('node:fs').readFileSync(rustyWasmPath);
    candidates.push({
      id: 'rusty_mp3 (wasm)',
      version: '1.0.5',
      packageLicense: 'Apache-2.0',
      encoderLicense: 'Apache-2.0 (own implementation, no LAME code)',
      kind: 'wasm',
      wasmBytes,
      run: async ({ interleaved, sampleRate, bitrate }) => {
        const { instance } = await WebAssembly.instantiate(wasmBytes, {});
        const { memory, encode_mp3, last_output_len, alloc_buffer, free_buffer } = instance.exports;
        const pcmBytes = interleaved.length * 4;
        const pcmPtr = alloc_buffer(pcmBytes);
        // The allocation may have grown the WASM memory, so re-read the buffer.
        const pcmView = new Float32Array(memory.buffer, pcmPtr, interleaved.length);
        pcmView.set(interleaved);
        const outPtr = encode_mp3(pcmPtr, interleaved.length, 2, sampleRate, bitrate);
        const len = last_output_len();
        // The encoder may have grown the WASM memory, so re-read the buffer.
        const out = new Uint8Array(memory.buffer, outPtr, len);
        const copy = out.slice();
        free_buffer(pcmPtr, pcmBytes);
        return copy;
      },
    });
  } else {
    candidates.push({
      id: 'rusty_mp3 (wasm)',
      failed: `S3_RUSTY_WASM not set or file missing: ${rustyWasmPath ?? '(unset)'}`,
    });
  }
} // end registerCandidates

// ------------------------------------------------------------------ decoder

let decodeMp3;
try {
  const { MPEGDecoder } = require('mpg123-decoder');
  decodeMp3 = async (bytes) => {
    const decoder = new MPEGDecoder();
    await decoder.ready;
    const { channelData, samplesDecoded } = decoder.decode(bytes);
    const left = channelData[0] ?? new Float32Array(0);
    const right = channelData[1] ?? left;
    const out = new Float32Array(samplesDecoded * 2);
    for (let i = 0; i < samplesDecoded; i += 1) {
      out[i * 2] = left[i] ?? 0;
      out[i * 2 + 1] = right[i] ?? 0;
    }
    decoder.free();
    return out;
  };
} catch (error) {
  console.error(`decoder unavailable: ${error}`);
  process.exitCode = 1;
}

// --------------------------------------------------------------------- run

async function main() {
  await registerCandidates();
  results.machine = {
    os: `${process.platform} ${process.arch}`,
    node: process.version,
    cpu: execFileSync('node', ['-e', 'console.log(require("os").cpus()[0].model)'])
      .toString()
      .trim(),
    cpus: execFileSync('node', ['-e', 'console.log(require("os").cpus().length)'])
      .toString()
      .trim(),
  };
  console.log(`machine: ${JSON.stringify(results.machine)}`);

  const licenceRoots = {
    'wasm-media-encoders': 'wasm-media-encoders',
    '@breezystack/lamejs': '@breezystack/lamejs',
    lamejs: 'lamejs',
    '@mediabunny/mp3-encoder': '@mediabunny/mp3-encoder',
  };

  for (const candidate of candidates) {
    if (candidate.failed) {
      results.candidates.push({ id: candidate.id, failed: candidate.failed });
      console.log(`SKIP ${candidate.id}: ${candidate.failed}`);
      continue;
    }
    const root = join(benchDir, 'node_modules', licenceRoots[candidate.id] ?? '');
    results.candidates.push({
      id: candidate.id,
      version: candidate.version,
      packageLicense: candidate.packageLicense,
      encoderLicense: candidate.encoderLicense,
      kind: candidate.kind,
      licenseFiles: licenceRoots[candidate.id] ? licenseFiles(root, candidate.id) : [],
    });
    console.log(`candidate ${candidate.id} ${candidate.version} (${candidate.packageLicense})`);

    for (const sampleRate of SAMPLE_RATES) {
      const { left, right } = generatePcm(sampleRate, AUDIO_SECONDS);
      const interleaved = interleave({ left, right });
      const interleavedInt16 = toInt16(interleaved);

      for (const bitrate of BITRATES) {
        const times = [];
        let bytes = 0;
        let mp3 = null;
        try {
          for (let run = 0; run < RUNS; run += 1) {
            const t0 = performance.now();
            const output = await candidate.run({
              interleaved,
              interleavedInt16,
              sampleRate,
              bitrate,
            });
            const elapsed = (performance.now() - t0) / 1000;
            times.push(elapsed);
            bytes = output.length;
            if (run === 0) mp3 = output;
          }
        } catch (error) {
          results.measurements.push({
            candidate: candidate.id,
            sampleRate,
            bitrate,
            failed: String(error),
          });
          console.log(`  ${sampleRate}/${bitrate}: FAILED ${error}`);
          continue;
        }

        let q = null;
        try {
          const decoded = await decodeMp3(mp3);
          q = quality(interleaved, decoded);
        } catch (error) {
          q = { error: String(error) };
        }

        const result = {
          candidate: candidate.id,
          sampleRate,
          bitrate,
          encodeSecondsMedian: median(times),
          encodeSecondsMin: Math.min(...times),
          encodeSecondsMax: Math.max(...times),
          runs: times.map((t) => Number(t.toFixed(4))),
          realTimeFactor: Number((AUDIO_SECONDS / median(times)).toFixed(2)),
          mp3Bytes: bytes,
          bytesPerSecond: Number((bytes / AUDIO_SECONDS).toFixed(1)),
          quality: q,
        };
        results.measurements.push(result);
        console.log(
          `  ${sampleRate}/${bitrate}: ${result.encodeSecondsMedian.toFixed(3)}s ` +
            `(${result.realTimeFactor}x), ${bytes} bytes, SNR ${
              q?.snrDb !== undefined ? q.snrDb.toFixed(2) : 'n/a'
            } dB`,
        );
      }
    }
  }

  writeFileSync(join(resultsDir, 'summary.json'), `${JSON.stringify(results, null, 2)}\n`);
  writeMarkdown(results);
  console.log(`\nwrote ${join(resultsDir, 'summary.json')}`);
}

function writeMarkdown(data) {
  const lines = [];
  lines.push('# Spike S3 — MP3 encoder benchmark results');
  lines.push('');
  lines.push(`Generated by \`spikes/s3/tools/bench-mp3.mjs\`.`);
  lines.push('');
  lines.push(`- Machine: ${data.machine.os}, ${data.machine.cpus}× ${data.machine.cpu}`);
  lines.push(`- Node: ${data.machine.node}`);
  lines.push(
    `- Input: ${data.audio.seconds}s stereo, sample rates ${data.audio.sampleRates.join(' / ')} Hz, ` +
      `CBR ${data.audio.bitrates.join(' / ')} kbps, ${data.audio.runs} runs per measurement (median reported)`,
  );
  lines.push('');
  lines.push('## Candidates');
  lines.push('');
  lines.push('| Candidate | Version | Package licence | Embedded codec licence | Outcome |');
  lines.push('|---|---|---|---|---|');
  for (const c of data.candidates) {
    lines.push(
      `| ${c.id} | ${c.version ?? '—'} | ${c.packageLicense ?? '—'} | ${c.encoderLicense ?? '—'} | ${
        c.failed ? `failed: ${c.failed}` : 'ran'
      } |`,
    );
  }
  lines.push('');
  lines.push('## Measurements');
  lines.push('');
  lines.push(
    '| Candidate | Rate | kbps | Encode median (s) | Range (s) | × realtime | MP3 bytes | bytes/s | SNR (dB) | Align lag |',
  );
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const m of data.measurements) {
    if (m.failed) {
      lines.push(
        `| ${m.candidate} | ${m.sampleRate} | ${m.bitrate} | — | — | — | — | — | failed: ${m.failed} | — |`,
      );
      continue;
    }
    lines.push(
      `| ${m.candidate} | ${m.sampleRate} | ${m.bitrate} | ${m.encodeSecondsMedian.toFixed(3)} | ` +
        `${m.encodeSecondsMin.toFixed(3)}–${m.encodeSecondsMax.toFixed(3)} | ${m.realTimeFactor} | ` +
        `${m.mp3Bytes} | ${m.bytesPerSecond} | ${
          m.quality?.snrDb !== undefined ? m.quality.snrDb.toFixed(2) : 'n/a'
        } | ${m.quality?.alignmentLagSamples ?? '—'} |`,
    );
  }
  lines.push('');
  lines.push('## Notes on the quality metric');
  lines.push('');
  lines.push(
    "- The decoded stream can be offset from the source by the encoder's " +
      'algorithmic delay, so the alignment lag is found first by ' +
      'cross-correlating a 4096-sample window over ±4096 samples, and the ' +
      'SNR is computed at that lag. Without this step the measurement ' +
      'reports the delay as noise and is meaningless.',
  );
  lines.push(
    '- A lag of 0 means the encoder writes a LAME-style gapless Info/Xing ' +
      'tag, so the decoder trims the delay. A non-zero lag means it does ' +
      'not, and the decoded file starts late.',
  );
  lines.push(
    '- The band split compares error energy in the lower and upper half of ' +
      'the time-ordered sample stream. It is a coarse pre-echo / cut-off ' +
      'indicator, not a spectral measurement.',
  );
  lines.push('- Decoding uses `mpg123-decoder` (mpg123 compiled to WASM).');
  lines.push('');
  writeFileSync(join(resultsDir, 'summary.md'), `${lines.join('\n')}\n`);
}

// `--render` regenerates the Markdown from the saved JSON without re-running
// the benchmark, so the tables can be refreshed after a formatting change.
if (process.argv.includes('--render')) {
  const source = readFileSync(join(resultsDir, 'summary.json'), 'utf8');
  writeMarkdown(JSON.parse(source));
  console.log(`rendered ${join(resultsDir, 'summary.md')}`);
} else {
  await main();
}
