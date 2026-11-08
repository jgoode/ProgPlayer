# ADR-0004: MP3 export

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-06 |
| **Requirement IDs** | FR-IO-4, OQ-9, CON-4 |
| **Task IDs** | P1.3, P9.3 |
| **Supersedes** | — |
| **Related** | ADR-0002 (SoundFont engine), `spikes/s3/` (the spike harness), `docs/gap-analysis.md` §4 |

## Context

FR-IO-4 requires the audio export to render the built-in synth output to
**WAV and to MP3**, and explicitly makes the MP3 encoder choice subject to
licensing (OQ-9). CON-4 requires every dependency and every bundled asset to
have a licence compatible with the project's MIT licence, with the required
attributions on an About/Licences screen. OQ-9 pre-answers the failure mode:
*"ship WAV first if licensing is unresolved"*.

Spike S3 surveyed the JS/WASM MP3 encoders that could run in the renderer
(`implementation.md` §2.3) and measured them. The harness is in `spikes/s3/`;
it is a throwaway spike and **no encoder was added to `src/`, to
`package.json` or to the lockfile**.

### The licence finding

Every MP3 encoder that is practical to ship and that is *distributed as a
JavaScript or WebAssembly package* embeds a copyleft codec. **A wrapper
package's own licence does not override the licence of the codec binary it
embeds** — the obligations attach to the shipped `.wasm`/`.js` whatever the
`package.json` says.

| Package | Wrapper licence | Embedded codec | Combined |
|---|---|---|---|
| `wasm-media-encoders` 0.7.0 | MIT | **LAME, LGPL** (compiled from the `arseneyr/lame` submodule) | LGPL |
| `@mediabunny/mp3-encoder` 1.65.2 | MPL-2.0 | **LAME 3.100, LGPL** (the package ships `licenses/lame/COPYING` and `licenses/lame/LICENSE`) | MPL-2.0 **and** LGPL |
| `@audio/encode-mp3` 2.0.1 | MIT | **LAME, LGPL** (inlined from `wasm-media-encoders`) | LGPL |
| `@breezystack/lamejs` 1.2.7 | LGPL-3.0 | LAME port, LGPL | LGPL |
| `lamejs` 1.2.1 | LGPL-3.0 | LAME port, LGPL | LGPL — **and broken** (see below) |
| `@toots/shine.js` 1.0.3 | LGPL-2.0 | Shine, LGPL-2.0 | LGPL |
| `@etercast/mp3`, `@vincaslt/mp3` | GPL-3.0 | LAME, LGPL | GPL-3.0 **and** LGPL |
| `rusty_mp3` 1.0.5 (Rust crate) | Apache-2.0 | Apache-2.0 — pure Rust, no C, no FFI | **Permissive** |

The only *combined*-permissive encoders found are Rust projects
(`rusty_mp3` Apache-2.0, `audiobox` MIT, `encoRust` MIT/Apache-2.0,
`glint-audio` MIT). **None of them is distributed as a maintained npm/WASM
package**: `rusty_mp3` has no npm wrapper at all, and `audiobox`/`encoRust`
do not ship a WASM build.

### Why LGPL does not fit this app

LGPL-2.1 §6 and LGPL-3.0 §§4–5 allow a Combined Work under the app's own
terms only if the app also satisfies the LGPL's own conditions. In practice
that means the app must ship:

1. the LGPL component's **complete corresponding source**, and
2. a **real relinking path**, so the user can replace the LGPL component
   with a modified version.

Condition 2 is the problem. An LGPL component linked into a **WASM or
JavaScript bundle** is statically linked into the renderer: there is no
shared library to swap, and the shipped `.wasm` is not a relinkable object.
Whether an Emscripten-produced LAME build can satisfy the relinking
condition in practice is **unresolved** — no authoritative FSF statement on
WASM linking was found during the spike, and this ADR does not treat the
question as settled in either direction.

LGPL-3.0 is stricter still: the "Limited Library" route in §5(e) requires
the LGPL component to be a **shared library loaded at runtime**, which a
WASM module in a bundle is not. The remaining route requires conveying the
Corresponding Source of the Combined Work under GPLv3-compatible terms —
that is, the whole application, which would stop the app being MIT.

An About/Licences screen satisfies the *notice* obligation only. It does
not satisfy source availability or relinking. **Meeting CON-4 with any of
the LGPL options would require amending CON-4**, which is a product and
legal decision, not an implementation detail.

### The patent question is not the blocker

MP3 encoding is not patent-encumbered in practice: the core patents expired
in the EU and most other jurisdictions by the end of 2012, in the United
States on 16 April 2017 and in Japan on 23 April 2017, and the
Technicolor/Fraunhofer licensing programmes were wound up in 2017. **The
binding constraint is copyright/licence, not patents.** (Not legal advice.)

### What the measurements established

The spike encoded a **5-minute stereo render at 44.1 kHz and 48 kHz**,
at 128 and 192 kbps, with three runs per configuration, in Node and in a
real Electron (Chromium) renderer. Quality was measured by decoding the
result and comparing it against the source PCM, **after finding the
encoder's algorithmic delay by cross-correlation** — without that step the
measurement reports the delay as noise and is meaningless.

1. **All the practical candidates are fast enough.** Every working
   candidate encoded 5 minutes of stereo audio in **under 10 seconds**, i.e.
   at least **31× faster than real time** (the fastest, the LAME WASM
   builds, reached **107×**), against FR-IO-4's requirement that rendering
   runs faster than real time where possible. Speed is not the constraint.

2. **`rusty_mp3` is the quality leader** — and it is the only
   combined-permissive encoder. Measured SNR against the source PCM:
   **35.2 dB at 128 kbps and 39.6 dB at 192 kbps** (44.1 kHz);
   35.0 dB and 39.6 dB (48 kHz). It also writes a LAME-style Info/Xing
   gapless tag, so the decoded output is sample-aligned (measured
   alignment lag: 0).

3. **The LAME-based candidates measure lower, and the difference is a real
   quality difference, not a measurement artefact.** `wasm-media-encoders`
   and `@mediabunny/mp3-encoder` both measured **25.9 dB at 128 kbps and
   30.4 dB at 192 kbps** — about 9 dB below `rusty_mp3` — and identically
   to within 0.01 dB at every configuration, which is consistent with them
   being the same codec. The alignment lag confirms the measurement is
   sound: `rusty_mp3` and `@mediabunny` are gapless-tagged and align at 0,
   while `wasm-media-encoders` writes no Info/Xing frame and shows a
   consistent **2210-sample** offset, which the cross-correlation step
   removes before the SNR is computed.

4. **`lamejs@1.2.1` is broken and cannot be used.** Constructing its
   encoder throws `ReferenceError: MPEGMode is not defined` — the known
   bundling defect (upstream issues #91 and #103). Only the
   `@breezystack/lamejs` fork works; it is LGPL and, being a pure-JS port,
   is the slowest candidate.

5. **`@mediabunny/mp3-encoder` needs the WebCodecs `AudioEncoder` API**,
   which Node does not provide — it only runs in the renderer. In Node the
   benchmark could not run it at all; in Chromium it encoded the full
   5-minute render in about 4 seconds.

6. **Size is not the constraint either.** The measured artifacts: the
   `rusty_mp3` WASM build is **143 882 bytes** (55 590 gzipped); LAME's
   `mp3.wasm` in `wasm-media-encoders` is **132 999 bytes** (66 140
   gzipped); `@mediabunny/mp3-encoder`'s minified bundle is 473 611 bytes
   with the WASM inlined, and its `mediabunny` core is a further
   tree-shakeable dependency. All are small next to the SoundFonts the app
   already ships.

### What the measurements did **not** establish

- **No listening test.** The SNR figures are a proxy. The ODG comparison
  the `rusty_mp3` crate publishes (LAME better by 0.225 ODG at 128 kbps,
  0.084 at 192 kbps) was not reproduced here. A human listening test is
  still needed before any MP3 encoder ships.
- **One machine, one platform.** Everything was measured on one Windows
  laptop (Core 5 120U, 12 logical CPUs), in Node 24.22.1 and Electron
  45.2.2. No macOS or Linux measurement, and no low-end machine.
- **`rusty_mp3` was built by the spike, not by a published package.** The
  spike compiles the crate to WASM through a throwaway `wasm-bindgen` shim.
  There is **no maintained npm distribution**, no typed JS API, no bundler
  integration and no SIMD dispatch in the renderer. That work is P9 work if
  this ADR is revisited.
- **The LGPL relinking question is unresolved** (above). This ADR does not
  claim it is impossible; it claims it is not demonstrable with the
  packaging available today.
- **`audiobox`, `encoRust` and `glint-audio` were not benchmarked.** They
  are permissive, but `audiobox` documents that its VBR, psychoacoustic
  noise shaping and transient block switching are not ported, `encoRust`
  describes itself as a research project and is unpublished on crates.io,
  and the embedded C++ licence in `glint-audio` could not be verified.

## Options considered

| Option | Summary | Pros | Cons |
|---|---|---|---|
| A | **Ship WAV only in v1.0; no MP3 encoder** | Keeps the app MIT with no copyleft component; no dependency, no packaging work, no attribution burden; WAV is lossless and every DAW and DAW-adjacent tool reads it; FR-IO-4's WAV half and P9.2 are unaffected | Users who wanted MP3 do not get it in v1.0; a 5-minute stereo 48 kHz WAV is about 55 MiB, so sharing a track is clumsy; the requirement text must be amended |
| B | **Ship `wasm-media-encoders` (MIT wrapper / LGPL LAME)** | Real LAME quality; small (133 KB WASM); works in the renderer with no Node APIs | Ships an LGPL component whose relinking condition cannot be demonstrated for a static WASM bundle; MIT on the wrapper does not make the `.wasm` MIT; the project has been effectively unmaintained since 2024; measured ~9 dB below `rusty_mp3` on this signal |
| C | **Ship `@mediabunny/mp3-encoder` (MPL-2.0 / LGPL LAME)** | The most actively maintained candidate (published 2026-11-04); best-documented provenance for its LAME build (SHA-256 of the LAME tarball and of the WASM); encodes in a Worker | MPL-2.0 is a file-level copyleft already outside CON-4's permissive set, and it embeds LGPL LAME as well — **two** obligations, one of them unresolved; needs the WebCodecs `AudioEncoder` API, so it cannot be used outside a renderer; pulls in a large `mediabunny` core; measured ~9 dB below `rusty_mp3` |
| D | **Ship `rusty_mp3`, built from the Rust crate to WASM** | **The only combined-permissive option** (Apache-2.0, pure Rust, no C, no FFI); best measured quality (35.2 dB at 128 kbps, 39.6 dB at 192 kbps); gapless-tagged, so the output is sample-aligned; small (144 KB WASM, 56 KB gzipped); no LGPL anywhere in the tree | **No npm/WASM distribution exists** — the project would have to build, package, version and support a WASM build of a third-party Rust crate; the encoder is young (first release July 2026) with a small maintainer base; no listening test yet; no SIMD dispatch in the renderer; still needs an Apache-2.0 NOTICE entry |
| E | **Ship a pure-JS LAME port (`@breezystack/lamejs`)** | No WASM at all; runs anywhere | LGPL-3.0, so the same unresolved relinking question; the slowest candidate; upstream `lamejs` is broken; the port is reported below reference LAME |
| F | **Ship an LGPL encoder and amend CON-4** | Delivers MP3 in v1.0 | Requires a product/legal decision to relax the project's licence policy, a source-offer process, a relinkable packaging design, LAME attribution and an About/Licences entry — none of which the project has |

## Decision

**PracticePlayer v1.0 ships WAV export only. No MP3 encoder is added to
the application (Option A).**

- **FR-IO-4 is amended** so that the MP3 clause reads: *"**MP3 export is
  deferred**: every npm-distributable JS/WASM MP3 encoder embeds a
  copyleft codec, and the project's MIT licence (CON-4) rules out the LGPL
  ones; see ADR-0004. MP3 is added only when a combined-permissive encoder
  with validated quality is available."* The WAV half of the requirement,
  and P9.2, are unaffected.
- **P9.3 is moved out of v1.0** and re-scoped as "MP3 export, conditional
  on Option D's prerequisites being met". It is not implemented behind a
  flag; it is not implemented at all.
- **Nothing is added to `src/`, `package.json` or the lockfile.** The
  candidates stay in the throwaway spike directory. The licence register
  (`docs/gap-analysis.md` §4) records the evaluated candidates as
  **Verified** and **not adopted**, so the work is not repeated.
- **`rusty_mp3` is the designated candidate if MP3 is revisited.** It is
  the only encoder found that satisfies CON-4 *and* measured best. If the
  project takes it up, it must build the WASM from the crate itself, ship
  the Apache-2.0 NOTICE, and pass a human listening test before shipping.
- **Option C is not adopted even though it is the best-maintained
  candidate**, because MPL-2.0 plus embedded LGPL LAME is two obligations
  rather than one, and the LGPL one is the unresolved one.
- **Options B and E are rejected on licence grounds**, not on quality or
  speed: the LGPL relinking condition is not demonstrable for a static WASM
  or bundled-JS component, so shipping them would make the app's licence
  position wrong.
- **Option F is not refused on principle** — it is a legitimate path if
  the project later decides that LGPL is acceptable. It is a product and
  legal decision (amending CON-4), and it is out of scope for a spike.

### Conditions for revisiting this decision

MP3 export is re-opened when **any** of these becomes true:

1. A maintained, npm/WASM-distributed MP3 encoder with a combined-permissive
   licence (Apache-2.0, MIT, BSD, ISC) is available, with quality evidence
   at 128 and 192 kbps. `rusty_mp3` reaching an npm/WASM distribution would
   satisfy this.
2. `rusty_mp3` is adopted on the strength of Option D — the project builds
   and ships its own WASM, and a human listening test passes.
3. CON-4 is amended by the project owner to accept LGPL-2.1 with a source
   offer and a demonstrably relinkable component, plus LAME attribution.

## Consequences

- Positive:
  - The app stays **MIT end to end**. No LGPL, MPL or GPL component enters
    the shipped bundle, and the About/Licences screen stays a formality
    rather than a licence-compliance project.
  - **No runtime dependency, no WASM packaging, no CSP change.** The
    `wasm-unsafe-eval` question, the worker bundling, the SIMD dispatch
    and the WASM asset paths are all avoided.
  - **No quality risk in v1.0.** WAV export is lossless and needs no
    psychoacoustic model, so the export is bit-faithful to the render.
  - **The evaluation is not wasted.** The licence register now records
    **eight npm-distributable candidates** with their licences verified,
    the measured speed and quality of the **four that run**, and the
    known-broken or unsuitable entries (`lamejs@1.2.1`, the stale
    `wasm-media-encoders`). A future spike starts from measurements, not
    from a search.
  - The **patent question is closed**: MP3 encoding is not patent-blocked,
    so a future MP3 decision is a pure licence-and-quality decision.
- Negative:
  - **v1.0 users cannot export MP3.** Users who want a small shareable file
    must convert the WAV themselves. This is the cost of keeping the app
    MIT, and it is the cost OQ-9 explicitly anticipated.
  - **A 5-minute stereo 48 kHz/16-bit WAV is about 55 MiB** (192 000 bytes
    per second), so sharing a track is clumsy. The export UI must say so
    plainly rather than leaving users to discover the file size.
  - The `rusty_mp3` option carries a **build-and-support burden** that no
    npm package would: the project would own a WASM build of someone
    else's Rust crate, including the toolchain pin, the SBOM and the
    upgrade path.
  - **The measured quality gap is unverified by ear.** The 9 dB SNR
    difference between `rusty_mp3` and the LAME-based candidates on this
    synthetic signal is a proxy, not a listening test.
- Follow-up work:
  - Amend FR-IO-4 and OQ-9 in `docs/requirements.md`, and re-scope P9.3 in
    `docs/implementation.md` and `docs/progress.md`.
  - Record the evaluated candidates in `docs/gap-analysis.md` §4 and close
    G-12 and OQ-9.
  - Keep the `spikes/s3/` harness so the measurements can be repeated on
    macOS, and on a low-end machine, before any encoder ships. (The Linux
    repeat was dropped with the platform on 2026-11-08.)
  - If Option D is ever taken up: a human listening test at 128 and 192
    kbps, an Apache-2.0 NOTICE entry, a typed JS API over the WASM build,
    and the `wasm-unsafe-eval` CSP change that WASM requires.
  - Publish the export size in the UI so users know what they are getting
    (WAV only, and roughly how big).
