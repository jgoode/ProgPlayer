# ADR-0002: SpessaSynth as the built-in SoundFont engine

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-05 |
| **Requirement IDs** | FR-SND-1, FR-SND-2, FR-SND-3, NFR-TIM-1, NFR-PRF-1, NFR-PRF-2, CON-4 |
| **Task IDs** | P1.1, P1.6, P4.6 |
| **Supersedes** | — |
| **Evidence** | `docs/spikes/s1-soundfont-engine-report.md` |

## Context

PracticePlayer needs a built-in SoundFont synthesizer that runs in the
renderer, plays three parts (chords, bass, click) from one compiled tick
timeline, meets the timing budget (NFR-TIM-1), loads quickly enough
(NFR-PRF-2) and is distributable under the project's MIT licence (CON-4).

Spike S1 was to answer four questions with measurements, not opinions:

1. Can notes be scheduled at a future audio time with an error within one
   render quantum (128 frames)?
2. What are the CPU, memory and load-time costs of a 30–50 MB SoundFont
   played as three parts at 200 BPM for 10 minutes, and how do SF2 and SF3
   compare?
3. Does `OfflineAudioContext` (or the library's own offline rendering)
   produce output equivalent to real-time playback?
4. Is the licence of the exact version tested compatible with MIT
   distribution?

The measurements are in `docs/spikes/s1-soundfont-engine-report.md`. The
headline numbers:

| Question | Answer |
|---|---|
| Future-timed events | **Yes.** 128 frames worst case with arbitrary timestamps; **0 frames** when the target is snapped to the render-quantum grid — provided the snapped target uses the engine's own clock accumulation (see below). |
| CPU / memory / load time | Load 17.4 ms (SF3) / 62.2 ms (SF2) in Node; 28 ms (SF3) / 35–37 ms (SF2) parse in the worklet. ~98 % of one core for an offline render 95–110× faster than real time. **A 10-minute soak in the Electron renderer with a real output device: 0 dropouts over 60 011 blocks (6 000 notes, 20 peak voices), 9.28 % average process-tree CPU, working set flat at 519 MB.** |
| SF2 vs SF3 | SF3 is 3.5× smaller on disk, 3.8× faster to parse, 3× cheaper in resident memory, and decodes sample-for-sample identically. |
| Offline vs real time | The library's offline path is **bit-identical** to its real-time path. The scheduler path differs only by a one-quantum dispatch phase, which quantum snapping removes; after snapping, the two align at 0 frames with a correlation of 0.9991. |
| Licence | `spessasynth_core` 4.4.6 and `spessasynth_lib` 4.4.4 are **Apache-2.0**; the bundled `stb-vorbis` 0.0.7 decoder is Apache-2.0; `fflate` 0.8.3 is MIT. All MIT-compatible. |

## Options considered

| Option | Summary | Pros | Cons |
|---|---|---|---|
| A | **SpessaSynth** (`spessasynth_core` + `spessasynth_lib`) in the renderer | Future-timed events with 0-frame error when quantum-snapped; Apache-2.0; pure TypeScript, no WASM boundary; SF3 support with a 3.5× size reduction; the same engine serves live playback, offline render and MIDI export | ~1 MB of JavaScript; the offline path needs a MIDI sequence rather than the tick timeline; the scheduler path's dispatch phase differs from the sequencer path by one quantum unless the timeline is snapped |
| B | **FluidSynth-WASM** | Mature synthesis; widely used | LGPL-family licensing, which conflicts with the MIT distribution expectation (CON-4) unless the boundary is kept strictly separate; WASM boundary in the audio thread; not measured, because S1 did not fail |
| C | **Web Audio's own oscillators / a hand-written synth** | No dependency at all | Not a SoundFont engine: it fails FR-SND-1's requirement to load and play a SoundFont; no sampler quality; would have to be built and maintained from scratch |
| D | **A native addon** (e.g. a C++ SoundFont library) | Full control over the DSP | Platform-specific builds for three operating systems; a much larger maintenance and packaging burden (the same problem S2 will face for MIDI); the renderer would lose the Web Audio scheduling model |

## Decision

Use **SpessaSynth** (option A), pinned to `spessasynth_core` 4.4.6 and
`spessasynth_lib` 4.4.4, with these rules:

### 1. One engine, two entry points

The compiled tick timeline is the single source of truth (D2). It feeds two
render paths, both using the same engine and the same sound bank:

- **Live playback** — a `SynthSink` that runs `SpessaSynthProcessor` inside
  an `AudioWorklet` and schedules each event with
  `processMessage(message, offset, { time })`.
- **Audio export** — `WorkletSynthesizer.startOfflineRender()` in an
  `OfflineAudioContext`, driven by a MIDI file written from the same
  timeline.

The export path is preferred for export because it is bit-identical to the
library's own real-time output and ~45× faster than real time. The
scheduler path is used for live playback because it can honour live edits
(tempo changes, loop jumps, mutes) without rebuilding a MIDI file.

### 2. Scheduling times are snapped to the render-quantum grid

The engine drains its message queue at the start of each render quantum, so
an event with an arbitrary target time is dispatched on the first quantum
whose clock has reached it — an error of 0…127 frames. The app therefore
snaps each event's *scheduling* time up to the next 128-frame boundary
before handing it to the engine. The error becomes exactly 0 frames, and the
snapping cost (at most 2.7 ms) is well below the audible threshold for this
material.

**The snapped target must be computed with the engine's own clock
arithmetic.** The engine advances its clock by `quantumFrames * (1 /
sampleRate)` once per quantum and accumulates the rounding error of each
addition. The natural-looking `currentTime + quanta * (quantumFrames /
sampleRate)` computes a different double, which lands a few ULP above the
clock the engine will actually reach. The engine's `event.time <= currentTime`
test then fails and the event is dispatched a **whole quantum (128 frames)
late** — the very error the snap exists to remove. The measured difference is
128.00 frames against 0.00 frames.

The spike's `engineClockAfterQuanta` (`spikes/s1/renderer/analysis.ts`)
replicates the engine's accumulation and is covered by a regression test that
asserts the target is bit-identical to the engine's clock. P4 must use that
helper rather than recomputing the arithmetic. Tracked as gap **G-15** and
risk **RK-11**.

The alternative — splitting the render quantum at the target frame with
`process(left, right, offset, length)` — also gives 0 frames of error, but
measured **−16.4 dB** relative to the signal. It is rejected.

The snap is applied to the *scheduling* time only. The musical time (the
tick position) is untouched, so the MIDI export and the MIDI-out stream
remain exact.

### 3. SoundFonts are shipped as SF3

Where a bundled font is available in both encodings, ship the SF3: 3.5×
smaller on disk, 3–4× faster to parse and 3× cheaper in resident memory, with
sample-for-sample identical output. The engine ships the `stb-vorbis`
decoder, so this needs no extra dependency.

### 4. The sound bank is loaded in the worklet

The sound bank is parsed inside the `AudioWorklet`, not on the main thread,
so a 30 MB font cannot stall the UI. Measured parse time is 35–37 ms for
SF2 and 28 ms for SF3 in the worklet (14 ms in Node); the decoded samples are
cached by the engine and shared by every voice.

## Consequences

- Positive: the timing criterion is met with a large margin (0 frames of
  error, against a 128-frame budget); the load-time criterion is met with a
  large margin (19–64 ms against "shortly after launch"); the licence is
  compatible with MIT distribution; the same engine drives audio, MIDI export
  and audio export, so the "one timeline, many outputs" rule holds.
- Negative: the app takes a ~1 MB JavaScript dependency (267 kB gzipped for
  the bundled worklet) and must keep the Apache-2.0 attribution notices;
  the live and export paths are two code paths that must be kept in step;
  the quantum-snapping rule is easy to get wrong — the target must be
  computed with the engine's own clock accumulation, or every event arrives a
  whole quantum late — and must be unit-tested.
- Follow-up work: P4.6 implements `SynthSink` on this decision; the
  quantum-snapping rule needs a regression test at the timeline-compilation
  layer; the licence attribution screen (P10.3) must include the Apache-2.0
  notices for `spessasynth_core`, `spessasynth_lib` and `stb-vorbis`.

## Fallback

If SpessaSynth is abandoned later, the fallback is **FluidSynth-WASM**
(option B), behind the same `SynthSink` interface. Two things must be true
before it is adopted:

1. **The licence must be resolved.** FluidSynth itself is LGPL. Bundling it
   in the renderer as WASM means the application becomes an aggregate work
   that must comply with the LGPL's terms — dynamic linking, relinking
   rights, and source availability for the WASM binary. That is a genuine
   conflict with the project's MIT distribution expectation (CON-4) and is
   why it was not chosen. A permissively-licensed wrapper around a
   permissively-licensed core would be acceptable; a plain FluidSynth build
   would need legal review, not just a licence-audit entry.
2. **The timing and CPU measurements must be repeated.** This ADR's numbers
   are specific to SpessaSynth and say nothing about a WASM engine.

The `SynthSink` interface is deliberately narrow — load a bank, schedule
events at audio-clock times, start/stop, report voice count — so that
swapping the engine is a change behind one interface rather than a change
throughout the playback code.

A second, cheaper fallback is available for a *partial* failure: if only the
offline export path breaks — for instance if the P3 Standard MIDI File
writer slips — the app can still export WAV by rendering the live path into
an `OfflineAudioContext` with the same scheduler, at the cost of the
bit-identical guarantee. The primary export path depends on the P3 writer;
tracked as gap **G-18** and risk **RK-13**.

## What was not decided here

- **Which sound fonts to bundle.** G-11 and P1.5 remain open. GeneralUser GS
  was used as a measurement fixture only; its licence permits use but it
  states that it cannot be certain of every sample's provenance, which makes
  it unsuitable for redistribution in a released build.
- **Whether to ship the engine's effects (reverb, chorus) or a dry signal.**
  The measurements were made with the engine's default (`effectsEnabled:
  true`); a dry signal is audibly different (−42.6 dB) and is a product
  decision for P4. Live playback and export must agree either way; if a dry
  signal is chosen, the S1 effects-on figures do not carry over and the
  level and offline/real-time equivalence must be re-measured. Tracked as gap
  **G-17** and risk **RK-14**.
- **MIDI out.** Out of scope; see spike S2.
