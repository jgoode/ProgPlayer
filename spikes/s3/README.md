# Spike S3 — MP3 encoder options for an MIT-licensed Electron app

Throwaway spike. **Nothing here ships.** No encoder has been added to `src/`,
`package.json` or `pnpm-lock.yaml`.

The question (implementation.md §3, spike S3; FR-IO-4; OQ-9; gap G-12): which
MP3 encoder can PracticePlayer bundle under its MIT licence, and is it fast
enough and small enough to be worth shipping?

**The answer: none, for v1.0.** Every npm-distributable JS/WASM MP3 encoder
embeds a copyleft codec, and the LGPL relinking condition is not demonstrable
for a statically linked WASM/JS bundle. **v1.0 ships WAV only.**

- Full report: [`REPORT.md`](REPORT.md)
- Decision: [`docs/adr/0004-mp3-export.md`](../../docs/adr/0004-mp3-export.md)
- Gap register: [`docs/gap-analysis.md`](../../docs/gap-analysis.md) §2 (G-12, G-24, G-25, G-26), §4

---

## Candidates surveyed

| Package                          | Version       | Wrapper licence | Embedded codec         | Notes                                                                                                   |
| -------------------------------- | ------------- | --------------- | ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `wasm-media-encoders`            | 0.7.0         | MIT             | **LAME (LGPL)**        | LAME compiled to WASM by the package author; effectively unmaintained since 2024                        |
| `@mediabunny/mp3-encoder`        | 1.65.2        | MPL-2.0         | **LAME 3.100 (LGPL)**  | Most actively maintained; ships `licenses/lame/` in the tarball; needs the WebCodecs `AudioEncoder` API |
| `@audio/encode-mp3`              | 2.0.1         | MIT             | **LAME (LGPL)**        | WASM inlined from `wasm-media-encoders`; surveyed, not benchmarked                                      |
| `@breezystack/lamejs`            | 1.2.7         | LGPL-3.0        | LAME port              | Pure JS, no WASM; last release 2023                                                                     |
| `lamejs` (original)              | 1.2.1         | LGPL-3.0        | LAME port              | **The published npm build is broken** (`ReferenceError: MPEGMode is not defined`)                       |
| `@toots/shine.js`                | 1.0.3         | LGPL-2.0        | Shine (LGPL-2.0)       | Surveyed, not benchmarked                                                                               |
| `@etercast/mp3`, `@vincaslt/mp3` | 1.0.2 / 1.0.3 | GPL-3.0         | LAME (LGPL)            | Rejected outright                                                                                       |
| `node-lame`                      | 2.0.2         | ISC             | LAME (LGPL), native    | Main-process only; unusable in a sandboxed renderer                                                     |
| `rusty_mp3`                      | 1.0.5         | **Apache-2.0**  | **own implementation** | Pure Rust, no C, no FFI, no LAME code; builds to WASM; **not on npm**                                   |

`rusty_mp3` is the only candidate whose _combined_ licence is permissive, and
it also measured best on quality. It is a crates.io crate
(<https://crates.io/crates/rusty_mp3>, repository
<https://github.com/Remade-With-Rust/remade_ffmpeg_rs>), with **no npm/WASM
distribution**.

## Reproducing the benchmark

Everything is installed **outside** the repository, in
`%TEMP%/pp-s3-bench` (override with `S3_BENCH_DIR`), so the repo's
`package.json` and `pnpm-lock.yaml` are never touched.

```sh
# 1. Install the candidate packages, bundle them for the browser and build
#    rusty_mp3 for WASM.
node spikes/s3/tools/setup-bench.mjs

# 2. Run the Node benchmark (Windows PowerShell syntax shown; adapt for POSIX).
S3_BENCH_DIR="<tmp>/pp-s3-bench" \
S3_RUSTY_WASM="<tmp>/pp-s3-bench/rusty-bench/target/wasm32-unknown-unknown/release/rusty_bench.wasm" \
node spikes/s3/tools/bench-mp3.mjs

# 3. Run the same benchmark in a real Chromium renderer.
S3_BENCH_DIR="<tmp>/pp-s3-bench" \
S3_RUSTY_WASM="<tmp>/pp-s3-bench/rusty-bench/target/wasm32-unknown-unknown/release/rusty_bench.wasm" \
S3_SECONDS=300 npx electron spikes/s3/electron/drive.cjs
```

`setup-bench.mjs` prints the exact `S3_*` values to use.

Requirements: Node ≥ 22, a Rust toolchain with the `wasm32-unknown-unknown`
target (`rustup target add wasm32-unknown-unknown`), and network access for the
initial install.

### What the harness does

1. Generates a deterministic 5-minute stereo signal at 44.1 kHz and 48 kHz:
   sustained chord tones (220 / 261.63 / 329.63 / 392 Hz, slightly
   detuned between channels), a percussive click every 500 ms, and a
   1760 Hz harmonic. No external assets are used.
2. Encodes it with every candidate at **CBR 128 kbps** and **CBR 192 kbps**,
   three runs per measurement (median reported, min and max recorded).
3. Decodes the MP3 back and computes the SNR against the original PCM.
   **The alignment lag is found first by cross-correlation** (a 4096-sample
   window over ±4096 samples) and the SNR is computed at that lag — without
   that step the measurement reports the encoder's algorithmic delay as
   noise rather than its quality.
4. Writes `results/summary.json` and `results/summary.md` (Node), and
   `results/electron-summary.json` (Electron).

### Why there are two harnesses

`@mediabunny/mp3-encoder` registers a custom encoder against the WebCodecs
`AudioEncoder` interface, which **Node does not provide**. It can only run in
a browser context — which is where the app would run it anyway. The Electron
harness therefore measures the same workload in a real Chromium renderer, and
the two hosts agree to within 0.02 dB on every SNR figure.

### Environment knobs

| Variable              | Default              | Meaning                                                                 |
| --------------------- | -------------------- | ----------------------------------------------------------------------- |
| `S3_BENCH_DIR`        | `%TEMP%/pp-s3-bench` | Where the candidates are installed                                      |
| `S3_RUSTY_WASM`       | (unset)              | Path to the built `rusty_mp3` WASM; the candidate is skipped when unset |
| `S3_SECONDS`          | `300`                | Length of the test signal                                               |
| `S3_ELECTRON_RESULTS` | (unset)              | Where the Electron harness writes its JSON                              |

## Files

| File                            | Purpose                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `tools/setup-bench.mjs`         | Creates the throwaway install, bundles the browser candidates, builds the Rust WASM |
| `tools/bench-mp3.mjs`           | The Node benchmark harness                                                          |
| `electron/drive.cjs`            | The Electron driver (loads the renderer page and prints the JSON result)            |
| `renderer/index.html`           | The benchmark page, running in a real Chromium renderer                             |
| `results/summary.json`          | Machine-readable Node measurements                                                  |
| `results/summary.md`            | Human-readable Node tables                                                          |
| `results/electron-summary.json` | Machine-readable Electron measurements                                              |

## Limitations of the measurement

- **SNR is not a listening test.** It is a signal-to-noise figure over a
  synthetic chord-plus-click signal. Perceptual quality at 128 kbps for
  piano/bass/guitar material must be reviewed by ear before shipping
  (gap **G-24**).
- **One machine only.** All figures come from a single Windows laptop
  (Intel Core 5 120U, 12 logical CPUs, Node 24.22.1, Electron 45.2.2).
  macOS and Linux are not measured, and neither is a low-end machine.
- **The `rusty_mp3` WASM build here is a spike artifact**, not a shipping
  build. It has no `wasm-bindgen` glue, no typed JS API, no bundler
  integration and no SIMD dispatch in the renderer; those are P9 work if the
  decision is revisited (gap **G-25**).
- **The LGPL relinking question is unresolved** (gap **G-26**). The spike
  does not claim that a WASM-linked LGPL component _cannot_ satisfy it — only
  that the condition is not demonstrable with the packaging available today.
- **`audiobox`, `encoRust` and `glint-audio`** are permissive but were not
  benchmarked: the first documents that its VBR, psychoacoustic noise shaping
  and transient block switching are not ported, the second is unpublished and
  self-described as a research project, and the third's embedded C++ licence
  could not be verified.
