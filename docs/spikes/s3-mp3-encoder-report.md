# Spike S3 — MP3 encoder for an MIT-licensed Electron app

|                     |                                                                                   |
| ------------------- | --------------------------------------------------------------------------------- |
| **Date**            | 2026-11-06                                                                        |
| **Requirement IDs** | FR-IO-4, OQ-9, CON-4                                                              |
| **Task IDs**        | P1.3                                                                              |
| **Decision**        | ADR-0004 — **v1.0 ships WAV only; no MP3 encoder is added to the app**            |
| **Harness**         | `spikes/s3/` (throwaway; nothing added to `src/`, `package.json` or the lockfile) |

## 1. What was asked

FR-IO-4 requires the audio export to render to WAV **and to MP3**, with the
encoder choice "subject to licensing" (OQ-9). CON-4 requires every
dependency and bundled asset to have a licence compatible with the project's
MIT licence. OQ-9 pre-answers the failure mode: _"ship WAV first if
licensing is unresolved"_.

This spike had to: survey the JS/WASM MP3 encoders on their licence,
maintenance, size, speed and quality at 128–192 kbps; encode a **5-minute
stereo 44.1/48 kHz render**; compare file sizes and encode times; and
analyse what bundling an LGPL or other copyleft component would mean for an
MIT app.

## 2. The survey

Eight npm-distributable candidates and four Rust crates were examined. The
licence column is the decisive one.

| #   | Candidate                                              | Wrapper licence       | Embedded codec                                                                   | Combined           | Maintained                                                                      | Shipped size                                                                                                 |
| --- | ------------------------------------------------------ | --------------------- | -------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | `wasm-media-encoders` 0.7.0                            | **MIT**               | **LAME, LGPL**                                                                   | **LGPL**           | 0.7.0 published 2024-05-24; repo pushed 2025-08-07; 8 open issues               | 2.96 MB unpacked; `mp3.wasm` **132 999 B** (66 140 B gzipped); ESM bundle 783 kB                             |
| 2   | `@mediabunny/mp3-encoder` 1.65.2 + `mediabunny` 1.65.2 | **MPL-2.0**           | **LAME 3.100, LGPL** (ships `licenses/lame/COPYING` and `licenses/lame/LICENSE`) | **MPL-2.0 + LGPL** | 1.65.2 published 2026-11-04; repo pushed 2026-11-05; 7 438★; 56 open issues     | mp3-encoder 2.33 MB; min bundle 473 611 B with the WASM inlined; `mediabunny` core 11.36 MB (tree-shakeable) |
| 3   | `@audio/encode-mp3` 2.0.1                              | **MIT**               | **LAME, LGPL** (inlined from `wasm-media-encoders`)                              | **LGPL**           | publish date not established; repo `audiojs/encode`                             | `mp3-encode.js` 197 996 B with the WASM inlined                                                              |
| 4   | `@breezystack/lamejs` 1.2.7                            | **LGPL-3.0**          | LAME port, LGPL                                                                  | **LGPL**           | published 2023-10-17; upstream last push 2024-08-10; 51 open issues             | 471 068 B; no runtime deps                                                                                   |
| 5   | `lamejs` 1.2.1 (upstream)                              | **LGPL-3.0**          | LAME port, LGPL                                                                  | **LGPL**           | published 2021-12-02; last push 2024-08-10                                      | 6.46 MB; **broken at runtime** (see §4.4)                                                                    |
| 6   | `@toots/shine.js` 1.0.3                                | **LGPL-2.0**          | Shine, LGPL-2.0                                                                  | **LGPL**           | published 2023-01-01; last push 2023-12-01                                      | 172 536 B                                                                                                    |
| 7   | `@etercast/mp3` 1.0.2 / `@vincaslt/mp3` 1.0.3          | **GPL-3.0**           | LAME, LGPL                                                                       | **GPL-3.0 + LGPL** | published 2020-04 / 2021-09                                                     | 39 kB / 220 kB; needs a separate `mp3.wasm` file                                                             |
| 8   | `node-lame` 2.0.2                                      | ISC                   | LAME, LGPL (native)                                                              | **LGPL**           | published 2026-01-22                                                            | native addon — main process only, unusable in a sandboxed renderer                                           |
| 9   | `rusty_mp3` 1.0.5 (Rust crate)                         | **Apache-2.0**        | Apache-2.0 — pure Rust, **no C, no FFI, no runtime deps**                        | **PERMISSIVE**     | published 2026-10-24; 17 versions since 2026-07-29; repo pushed 2026-11-01; 15★ | crate 279 858 B; **no npm package exists**                                                                   |
| 10  | `audiobox` 0.5.1 (Rust crate)                          | **MIT**               | MIT                                                                              | **PERMISSIVE**     | published 2026-10-26                                                            | crate 579 936 B; MPEG-1 CBR only — VBR, psychoacoustic noise shaping and transient switching not ported      |
| 11  | `encoRust` (`mp3-core`)                                | **MIT OR Apache-2.0** | MIT/Apache-2.0                                                                   | **PERMISSIVE**     | **not published to crates.io**; self-described "research project"               | unpublished                                                                                                  |
| 12  | `glint-audio` 0.12.0 (Rust crate)                      | **MIT** wrapper       | clean-room C++17 — **licence not verified**                                      | **Unknown**        | published 2026-11-02                                                            | needs a C++17 compiler at build time                                                                         |

Also considered and excluded: `@rocket.chat/mp3-encoder` (MIT metadata,
embedded licence unverified), `shine-rs` / `mp3lame-encoder` /
`oxiaudio-encode-mp3-lame` (LGPL FFI), and the `lamejs` fork family
(`lamejs-fixed`, `@jambonz/lamejs` and ~8 others — all LGPL-3.0, all around
6.4 MB).

**The pattern is unambiguous:** every encoder that is _distributed as a
JavaScript or WebAssembly package_ embeds a copyleft codec. The only
_combined_-permissive encoders are Rust projects, and **none of them ships
a maintained npm/WASM build**.

### 2.1 The governing fact

**A wrapper package's own licence does not override the licence of the codec
binary it embeds.** `wasm-media-encoders` publishes an MIT `LICENSE` file,
but the `mp3.wasm` it ships is LAME, compiled from the `arseneyr/lame`
submodule, and LAME is LGPL. The MIT text covers the JavaScript wrapper, not
the WASM binary. The same applies to `@audio/encode-mp3` (MIT wrapper,
inlined LGPL LAME) and to `@mediabunny/mp3-encoder` (MPL-2.0 wrapper, LGPL
LAME).

### 2.2 What LGPL would require of an Electron app

LGPL-2.1 §6 and LGPL-3.0 §§4–5 allow a Combined Work under the app's own
terms only if the app also satisfies the LGPL's own conditions:

1. give prominent notice that the Library is used, and supply a copy of the
   licence;
2. convey the Library's **complete corresponding source**, including any
   modifications; and
3. provide a **real relinking path**, so the user can replace the Library
   with a modified version.

**Condition 3 is where the LGPL options fail for this app.** An LGPL
component linked into a WASM module or a bundled JavaScript file is
statically linked into the renderer: there is no shared library to swap and
the shipped `.wasm` is not a relinkable object. Whether an Emscripten-built
LAME can satisfy the relinking condition in practice is **unresolved** — no
authoritative FSF statement on WASM linking was found during the spike, and
this report does not treat the question as settled in either direction
(tracked as **G-26**).

LGPL-3.0 is stricter still. The "Limited Library" route in §5(e) requires
the component to be a **shared library loaded at runtime**, which a WASM
module in a bundle is not. The remaining route requires conveying the
Corresponding Source of the Combined Work under GPLv3-compatible terms —
that is, the whole application — which would stop the app being MIT.

An About/Licences screen satisfies the _notice_ obligation only. It does
not satisfy source availability or relinking. **Meeting CON-4 with any LGPL
option would require amending CON-4**, which is a product and legal
decision, not an implementation detail.

### 2.3 Patents are not the blocker

| Jurisdiction          | Status                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| EU and most countries | Patents required to implement MP3 expired by **December 2012** at the latest                    |
| United States         | Substantially patent-free since **16 April 2017**; decoding patent-free since 22 September 2015 |
| Japan                 | Fraunhofer-managed MP3 patents expired **23 April 2017**                                        |
| Worldwide programmes  | Technicolor and Fraunhofer **ended the MP3 software licensing programmes in 2017**              |

MP3 encoding is not patent-encumbered in practice. **The binding constraint
is copyright/licence, not patents.** (Not legal advice.)

## 3. The measurement

### 3.1 Method

- **Input:** a deterministic 5-minute stereo signal — four chord tones with
  slight detuning, a 1.76 kHz harmonic, and a 4 kHz click every 0.5 s —
  generated at 44 100 Hz and 48 000 Hz.
- **Encoders:** CBR at 128 and 192 kbps, **three runs per configuration**,
  median reported (the range is in the machine-readable results).
- **Two hosts:** Node 24.22.1 (`spikes/s3/tools/bench-mp3.mjs`) and a real
  **Electron 45.2.2 Chromium renderer** (`spikes/s3/electron/drive.cjs` +
  `spikes/s3/renderer/index.html`), because `@mediabunny/mp3-encoder` needs
  the WebCodecs `AudioEncoder` API that Node does not provide.
- **Quality:** each MP3 was decoded and compared against the source PCM.

**The quality metric needed one correction during the spike, and it matters.**
A naive sample-by-sample comparison measures the encoder's _algorithmic
delay_ rather than its noise, and reported nonsense (negative SNR) on the
first run. The final method finds the alignment lag by cross-correlating a
4096-sample window over ±4096 samples and computes the SNR at that lag. The
lag is itself a finding: **0 means the encoder writes a LAME-style gapless
Info/Xing tag** so the decoder trims the delay; a non-zero lag means it does
not and the decoded file starts late.

### 3.2 Results

Machine: win32 x64, 12× Intel Core 5 120U.

**5-minute stereo render, 44.1 kHz** — Node / Electron:

| Candidate                 | kbps | Node median (s) | Node ×rt | Electron median (s) | Electron ×rt | MP3 bytes | SNR Node / Electron (dB)  | Align lag |
| ------------------------- | ---- | --------------- | -------- | ------------------- | ------------ | --------- | ------------------------- | --------- |
| `rusty_mp3` (wasm)        | 128  | 3.96            | 75.8     | 3.85                | 77.9         | 4 790 079 | **35.26 / 35.26**         | 0         |
| `rusty_mp3` (wasm)        | 192  | 5.33            | 56.2     | 5.36                | 55.9         | 7 190 862 | **39.67 / 39.67**         | 0         |
| `wasm-media-encoders`     | 128  | 2.79            | 107.4    | 3.36                | 89.3         | 4 800 679 | 25.90 / 25.90             | 2210      |
| `wasm-media-encoders`     | 192  | 2.94            | 102.0    | 3.00                | 100.0        | 7 201 018 | 30.40 / 30.40             | 2210      |
| `@mediabunny/mp3-encoder` | 128  | —               | —        | 3.28                | 91.4         | 4 800 887 | — / 25.91                 | 0         |
| `@mediabunny/mp3-encoder` | 192  | —               | —        | 3.90                | 77.0         | 7 201 226 | — / 30.40                 | 0         |
| `@breezystack/lamejs`     | 128  | 9.21            | 32.6     | 8.92                | 33.6         | 4 800 679 | 18.91 / 18.91             | 2210      |
| `@breezystack/lamejs`     | 192  | 9.30            | 32.3     | 8.98                | 33.4         | 7 201 018 | 29.53 / 29.53             | 2210      |
| `lamejs` 1.2.1            | any  | **failed**      | —        | **failed**          | —            | —         | `MPEGMode is not defined` | —         |

**5-minute stereo render, 48 kHz** — Node / Electron:

| Candidate                 | kbps | Node median (s) | Node ×rt | Electron median (s) | Electron ×rt | MP3 bytes | SNR Node / Electron (dB)  | Align lag |
| ------------------------- | ---- | --------------- | -------- | ------------------- | ------------ | --------- | ------------------------- | --------- |
| `rusty_mp3` (wasm)        | 128  | 4.18            | 71.8     | 4.04                | 74.3         | 4 800 768 | **35.02 / 35.02**         | 0         |
| `rusty_mp3` (wasm)        | 192  | 5.24            | 57.2     | 5.31                | 56.5         | 7 201 152 | **39.52 / 39.52**         | 0         |
| `wasm-media-encoders`     | 128  | 3.48            | 86.2     | 3.58                | 83.8         | 4 800 384 | 25.89 / 25.89             | 2210      |
| `wasm-media-encoders`     | 192  | 3.19            | 94.1     | 3.15                | 95.4         | 7 200 576 | 30.38 / 30.38             | 2210      |
| `@mediabunny/mp3-encoder` | 128  | —               | —        | 4.14                | 72.4         | 4 800 576 | — / 25.88                 | 0         |
| `@mediabunny/mp3-encoder` | 192  | —               | —        | 4.01                | 74.8         | 7 200 768 | — / 30.39                 | 0         |
| `@breezystack/lamejs`     | 128  | 9.30            | 32.3     | 9.44                | 31.8         | 4 800 384 | 18.63 / 18.63             | 2210      |
| `@breezystack/lamejs`     | 192  | 9.72            | 30.9     | 9.66                | 31.1         | 7 200 576 | 29.75 / 29.75             | 2210      |
| `lamejs` 1.2.1            | any  | **failed**      | —        | **failed**          | —            | —         | `MPEGMode is not defined` | —         |

`@mediabunny/mp3-encoder` has no Node column because it **cannot run in
Node** — it needs the WebCodecs `AudioEncoder` API (§4.2).

Machine-readable results: `spikes/s3/results/summary.json` (Node),
`spikes/s3/results/electron-summary.json` (Electron), and
`spikes/s3/results/summary.md` (the Node run rendered as a table).

### 3.3 What the numbers say

1. **Speed was never the constraint.** Every working candidate encoded
   5 minutes of stereo audio in **under 10 seconds** — between **31× and
   107× faster than real time** (the fastest was `wasm-media-encoders` at
   44.1 kHz/128 kbps, which also reached 115× in an earlier run), against
   FR-IO-4's requirement that rendering runs faster than real time where
   possible. Even the slowest candidate (the pure-JS `@breezystack/lamejs`,
   at 31×) is more than fast enough for an export.

2. **Node and Chromium agree.** The two hosts agree to within 0.02 dB on
   every SNR figure and within a few per cent on encode time. The
   Electron numbers are not systematically slower, so the WASM path is not
   penalised by the browser host.

3. **File size is determined by the bitrate, not the encoder.** At 128 kbps
   every candidate produced 4 790 079–4 800 887 bytes (within 0.2 % of the
   4 800 000-byte CBR ideal); at 192 kbps, 7 190 862–7 201 226 bytes. The
   encoders differ by tens of bytes.

4. **`rusty_mp3` measured best on quality**, by a wide margin: **35.2 dB at
   128 kbps and 39.6 dB at 192 kbps**, against **25.9 dB / 30.4 dB** for
   both LAME-based candidates. That is roughly **9 dB** at 128 kbps and
   **9 dB** at 192 kbps. The alignment lag confirms the measurement is
   sound rather than an artefact: `rusty_mp3` and `@mediabunny` are
   gapless-tagged and align at 0, while `wasm-media-encoders` and
   `@breezystack/lamejs` write no Info/Xing frame and show a consistent
   **2210-sample** offset that the cross-correlation step removes before
   the SNR is computed.

   The two LAME-based candidates measured **identically to within 0.01 dB**
   at every configuration, which is consistent with them being the same
   codec. `@mediabunny/mp3-encoder` documents its build as **LAME 3.100**
   (with the LAME tarball and the WASM SHA-256 recorded in its README);
   `wasm-media-encoders` does not state a LAME version, and none could be
   recovered from its `mp3.wasm`, so the exact version of that build is
   **unknown**.

   The published ODG comparison for `rusty_mp3` (LAME better by 0.225 ODG
   at 128 kbps, 0.084 at 192 kbps) was **not** reproduced here. The SNR
   gap and the ODG gap are different metrics and point the same way, but
   neither is a listening test.

5. **The pure-JS port measured worst** — 18.9 dB at 128 kbps, about 7 dB
   below the LAME builds and 16 dB below `rusty_mp3`, and 3–4× slower.

6. **Size is not the constraint either.** The `rusty_mp3` WASM build is
   **143 882 bytes** (55 590 gzipped); LAME's `mp3.wasm` is **132 999
   bytes** (66 140 gzipped); `@mediabunny/mp3-encoder`'s minified bundle is
   473 611 bytes with the WASM inlined. All are small next to the
   SoundFonts the app already ships.

## 4. Findings that are not about licences

### 4.1 `lamejs@1.2.1` is broken

Constructing the encoder throws `ReferenceError: MPEGMode is not defined` —
the known upstream bundling defect (zhuker/lamejs issues #91 and #103).
`MPEGMode.js` is required by `Encoder.js` and `Lame.js` but never imported
into their scope. Only the `@breezystack` fork works.

### 4.2 `@mediabunny/mp3-encoder` needs the WebCodecs API

It registers a custom encoder against the WebCodecs `AudioEncoder`
interface, which Node does not provide. It could not be benchmarked in Node
at all; it ran in the Chromium renderer without difficulty.

### 4.3 Bundling `mediabunny` and its encoder package separately breaks them

Bundling the two packages independently produced a _"Mediabunny was loaded
twice"_ warning and the encoder failed with _"This specific encoder
configuration (mp3, 128000 bps, 2 channels, 44100 Hz) is not supported in
this environment"_. The cause: `@mediabunny/mp3-encoder` registers itself
into the `mediabunny` module it imports, and two separate bundles each
carry their own copy of that module. The fix is a single shared bundle.
**This is a real integration constraint for anyone adopting that package in
the app.**

### 4.4 The published WASM packages use bare specifiers

`wasm-media-encoders` imports `@swc/helpers/_/_define_property`, which a
browser cannot resolve. The spike bundles the candidates with esbuild before
loading them in the renderer — something the app's own build would have to
do too.

### 4.5 `rusty_mp3`'s provenance is clean

The crate's `Cargo.toml` declares `license = "Apache-2.0"`, its `LICENSE`
file is the Apache 2.0 text, and it has **no dependencies** — `[dependencies]`
is empty. `grep` over `src/` finds no `extern "C"`, no `bindgen` and no LAME
code; the mentions of "LAME" are comments about the gapless tag _format_,
which is a de-facto convention, not LAME's code. The README states the
decoder passes all 16 ISO 11172-4 / 13818-4 Layer III conformance vectors
and matches FFmpeg bit for bit on a 678-stream corpus, and that WebAssembly
builds produce bit-identical output to native. The crate is **not**
published to npm.

## 5. Decision

**v1.0 ships WAV only. No MP3 encoder is added to the app.** See
[ADR-0004](../../docs/adr/0004-mp3-export.md) for the full options table and
the conditions for revisiting the decision.

In short:

- **No LGPL, MPL or GPL component enters the shipped bundle**, so the app
  stays MIT end to end and the About/Licences screen stays a formality.
- **No runtime dependency, no WASM packaging, no CSP change.**
- **No quality risk in v1.0** — WAV export is lossless and needs no
  psychoacoustic model.
- **`rusty_mp3` is the designated candidate** if MP3 is reopened: it is the
  only combined-permissive encoder found, and it measured best on quality.
  Taking it up means the project owns the WASM build (G-25) and must pass a
  human listening test (G-24).
- **MP3 is not patent-blocked**, so a future decision is a pure
  licence-and-quality decision.

## 6. What this spike did **not** establish

- **No listening test.** The SNR figures are a proxy on a synthetic signal.
  `testing.md` §1 puts automated listening quality out of scope for v1, so
  this is closed by a human (**G-24**).
- **One machine, one platform.** Everything was measured on one Windows
  laptop, in Node and Electron. No macOS, no Linux, no low-end machine.
- **The `rusty_mp3` WASM build is spike scaffolding.** It has no
  `wasm-bindgen` glue, no typed JS API, no bundler integration and no SIMD
  dispatch in the renderer. Those are Phase 9 work if the ADR is revisited
  (**G-25**).
- **The LGPL/WASM relinking question is unresolved** (**G-26**). This
  report does not claim it is impossible; it claims it is not demonstrable
  with the packaging available today.
- **`audiobox`, `encoRust` and `glint-audio` were not benchmarked.** They
  are permissive, but `audiobox` documents that its VBR, psychoacoustic
  noise shaping and transient block switching are not ported, `encoRust` is
  unpublished and self-described as a research project, and the embedded
  C++ licence in `glint-audio` could not be verified.
- **`@rocket.chat/mp3-encoder`'s embedded licence was not verified.**

## 7. Reproducing this

```
# One-time setup: throwaway install, browser bundles, and the Rust WASM build.
node spikes/s3/tools/setup-bench.mjs

# Node run (5-minute render, three runs per configuration).
# S3_BENCH_DIR points at the throwaway install; S3_RUSTY_WASM at the built wasm.
S3_BENCH_DIR=<bench dir> S3_RUSTY_WASM=<bench dir>/rusty-bench/target/wasm32-unknown-unknown/release/rusty_bench.wasm \
  node spikes/s3/tools/bench-mp3.mjs

# Electron run (the same measurements in a real Chromium renderer).
S3_BENCH_DIR=<bench dir> S3_RUSTY_WASM=<bench dir>/rusty-bench/target/wasm32-unknown-unknown/release/rusty_bench.wasm \
  S3_SECONDS=300 npx electron spikes/s3/electron/drive.cjs
```

Both write JSON to `spikes/s3/results/`. The throwaway install lives
outside the repository (a temporary directory), so **nothing in this spike
is a dependency of the app**.
