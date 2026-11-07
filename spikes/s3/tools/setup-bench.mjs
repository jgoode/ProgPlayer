// Sets up the throwaway benchmark environment for spike S3.
//
// Everything is installed OUTSIDE the repository so the repo's package.json and
// pnpm-lock.yaml are never touched:
//   * npm packages  -> %TEMP%/pp-s3-bench/node_modules
//   * Rust crate    -> %TEMP%/pp-s3-bench/rusty-bench (builds rusty_mp3 to WASM)
//
// Run: node spikes/s3/tools/setup-bench.mjs

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const benchDir = process.env.S3_BENCH_DIR ?? join(os.tmpdir(), 'pp-s3-bench');
const nodeModules = join(benchDir, 'node_modules');
const rustDir = join(benchDir, 'rusty-bench');

mkdirSync(benchDir, { recursive: true });

// ---------------------------------------------------------------- npm packages

const npmPackages = [
  'wasm-media-encoders@0.7.0',
  '@breezystack/lamejs@1.2.7',
  'lamejs@1.2.1',
  'mediabunny@1.65.2',
  '@mediabunny/mp3-encoder@1.65.2',
  'mpg123-decoder@1.0.3',
  // Bundler for the browser-side candidates (see the esbuild step below).
  'esbuild@0.25.12',
];

const manifestPath = join(benchDir, 'package.json');
if (!existsSync(manifestPath)) {
  writeFileSync(
    manifestPath,
    `${JSON.stringify({ name: 'pp-s3-bench', private: true, version: '0.0.0', type: 'module' }, null, 2)}\n`,
  );
}

console.log(`installing benchmark packages into ${benchDir}`);
execFileSync('npm', ['install', '--no-audit', '--no-fund', '--no-save', ...npmPackages], {
  cwd: benchDir,
  stdio: 'inherit',
});

for (const spec of npmPackages) {
  const name = spec.slice(0, spec.lastIndexOf('@'));
  const manifest = JSON.parse(readFileSync(join(nodeModules, name, 'package.json'), 'utf8'));
  console.log(`  ${name} ${manifest.version} — ${manifest.license}`);
}

// ------------------------------------------------- browser bundles (esbuild)
// The Electron renderer loads the candidates as plain ES modules, but the
// published packages use bare specifiers (e.g. "@swc/helpers/_/_define_property")
// that a browser cannot resolve. Bundle them into the throwaway directory.

console.log('bundling the browser candidates with esbuild');
const bundleDir = join(benchDir, 'browser-bundles');
mkdirSync(bundleDir, { recursive: true });

// The combined entry point has to live inside the throwaway install so that
// esbuild resolves `mediabunny` and `@mediabunny/mp3-encoder` from its
// node_modules.
writeFileSync(
  join(benchDir, 'browser-entry.mjs'),
  `export * as mediabunny from 'mediabunny';
export { registerMp3Encoder } from '@mediabunny/mp3-encoder';
`,
);

const bundles = [
  // mediabunny and its mp3 encoder package must share one bundle: the
  // encoder registers itself into the mediabunny module it imports, and two
  // separate bundles would each carry their own copy.
  { entry: 'browser-entry.mjs', out: 'mediabunny.mjs' },
  {
    entry: 'node_modules/wasm-media-encoders/dist/es/index.mjs',
    out: 'wasm-media-encoders.mjs',
  },
  {
    entry: 'node_modules/@breezystack/lamejs/dist/lamejs.js',
    out: 'lamejs.mjs',
  },
];

for (const bundle of bundles) {
  execFileSync(
    process.execPath,
    [
      join(benchDir, 'node_modules', 'esbuild', 'bin', 'esbuild'),
      join(benchDir, bundle.entry),
      '--bundle',
      '--format=esm',
      '--platform=browser',
      `--outfile=${join(bundleDir, bundle.out)}`,
    ],
    { stdio: 'inherit' },
  );
}

// ---------------------------------------------------------------- Rust crate

if (!existsSync(join(rustDir, 'Cargo.toml'))) {
  console.log(`creating the Rust benchmark crate in ${rustDir}`);
  execFileSync('cargo', ['new', '--bin', 'rusty-bench'], { cwd: benchDir, stdio: 'inherit' });
}

const cargoToml = `[package]
name = "rusty-bench"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
rusty_mp3 = "1.0.5"

[profile.release]
opt-level = 3
lto = true
codegen-units = 1
panic = "abort"
strip = true
`;
writeFileSync(join(rustDir, 'Cargo.toml'), cargoToml);

const libRs = `use std::alloc::{alloc, dealloc, Layout};
use std::sync::Mutex;
use rusty_mp3::{Mp3Encoder, Mp3EncoderConfig};

static LAST_OUTPUT: Mutex<Option<Vec<u8>>> = Mutex::new(None);

/// Allocate \`size\` bytes of WASM-linear memory for the caller to write into.
#[unsafe(no_mangle)]
pub extern "C" fn alloc_buffer(size: usize) -> *mut u8 {
    unsafe { alloc(Layout::from_size_align(size, 16).unwrap()) }
}

/// Release a buffer previously returned by \`alloc_buffer\`.
#[unsafe(no_mangle)]
pub extern "C" fn free_buffer(ptr: *mut u8, size: usize) {
    unsafe { dealloc(ptr, Layout::from_size_align(size, 16).unwrap()) }
}

/// Encode interleaved f32 PCM to MP3.
/// Returns a pointer to the encoded bytes; use \`last_output_len\` for the length.
/// The bytes live in a static buffer so the caller can read them back after the
/// call (the WASM memory may have grown during encoding, so the caller must
/// re-read \`memory.buffer\` afterwards).
#[unsafe(no_mangle)]
pub extern "C" fn encode_mp3(
    pcm_ptr: *const f32,
    pcm_len: usize,
    channels: u16,
    sample_rate: u32,
    bitrate_kbps: u32,
) -> *const u8 {
    let pcm = unsafe { std::slice::from_raw_parts(pcm_ptr, pcm_len) };
    let mut enc = Mp3Encoder::new(Mp3EncoderConfig { bitrate_kbps, vbr_quality: None });
    let _ = enc.push_pcm_f32(pcm, channels, sample_rate);
    enc.finish();
    let mut mp3 = Vec::new();
    while let Ok(packet) = enc.next_packet() {
        mp3.extend_from_slice(&packet);
    }
    let len = mp3.len();
    let ptr = mp3.as_ptr();
    *LAST_OUTPUT.lock().unwrap() = Some(mp3);
    ptr
}

#[unsafe(no_mangle)]
pub extern "C" fn last_output_len() -> usize {
    LAST_OUTPUT.lock().unwrap().as_ref().map_or(0, |v| v.len())
}
`;
writeFileSync(join(rustDir, 'src', 'lib.rs'), libRs);

console.log('building rusty_mp3 for wasm32-unknown-unknown');
execFileSync('rustup', ['target', 'add', 'wasm32-unknown-unknown'], { stdio: 'inherit' });
execFileSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown', '--lib'], {
  cwd: rustDir,
  stdio: 'inherit',
});

const wasmPath = join(rustDir, 'target', 'wasm32-unknown-unknown', 'release', 'rusty_bench.wasm');
const wasmSize = readFileSync(wasmPath).length;
console.log(`\nwasm: ${wasmPath} (${wasmSize} bytes)`);
console.log(
  `\nTo run the benchmark:\n  S3_BENCH_DIR=${benchDir} S3_RUSTY_WASM=${wasmPath} node spikes/s3/tools/bench-mp3.mjs`,
);
