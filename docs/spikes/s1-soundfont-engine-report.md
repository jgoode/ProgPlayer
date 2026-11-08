# Spike S1 — SoundFont engine measurement report

| | |
|---|---|
| **Status** | Complete |
| **Date** | 2026-11-05 |
| **Spike** | S1 — SoundFont engine (`implementation.md` §3, Phase 1 table) |
| **Requirement IDs** | FR-SND-1..3, NFR-TIM-1, NFR-PRF-1, NFR-PRF-2 |
| **Task IDs** | P1.1, P1.6 |
| **ADR** | `docs/adr/0002-soundfont-engine.md` |
| **Verdict** | **GO** — SpessaSynth, with a quantum-aligned worklet-side scheduler |

## 1. What was measured, and how

Two harnesses, both driving the same engine:

| Harness | Path | What it answers |
|---|---|---|
| `spikes/s1/tools/measure-engine.mjs` | `spessasynth_core` directly in Node, no audio device | Deterministic engine behaviour: dispatch timing, SF2 vs SF3 load, throughput, scheduler-vs-sequencer equivalence |
| `spikes/s1/renderer` + `spikes/s1/electron/drive.cjs` | `spessasynth_core` in an `AudioWorklet` inside Electron's renderer, with a real audio device | The path the app would actually use: Web Audio scheduling, `AudioWorkletProcessor` event dispatch, `OfflineAudioContext`, real CPU and memory |

The driver (`spikes/s1/electron/drive.cjs`) launches Electron, drives the
measurement page through the DOM and writes the JSON report to
`spikes/s1/results/`. It is the primary source for the numbers in this
report; the Node harness supplies the deterministic cross-checks.

**Timing method.** The measurement worklet registers
`SpessaSynthProcessor.onEventCall`, which fires inside the engine's dispatch
of a MIDI message. The worklet reads the `AudioWorkletGlobalScope`
`currentFrame` there, so the recorded frame is the frame the event was
dispatched on — not the frame the sound became audible. The *target* time is
computed on the audio thread (inside the worklet), so the round-trip time of
the `postMessage` never enters the measurement.

**Arrangement.** Three parts, matching the real workload: 7-note extended
chords (root, 3rd, 5th, 7th, 9th, 11th, 13th) on channel 1, root bass on
channel 2, metronome click on channel 10, at 200 BPM. A 10-minute run is 500
bars, 6 000 notes. The renderer and the Node harness build the same
arrangement and publish an FNV-1a digest of the event list, so both runs can
prove they measured the same thing.

**SoundFont.** GeneralUser GS v2.0.3 by S. Christian Collins, in both the
SF2 (PCM) and SF3 (Ogg Vorbis) encodings.

## 2. Machine

| | |
|---|---|
| OS | Windows 11 10.0.26300 (build 26300), x64 |
| CPU | Intel Core 5 120U, 12 logical cores, 2 496 MHz nominal |
| Memory | 16 849 256 448 bytes (15.7 GiB) |
| Electron | 45.2.2 (Chromium 156.0.8078.80) |
| Node | v24.21.0 |
| Audio | 48 000 Hz, 128-frame render quantum |
| Display | Headless Electron window (`show: true`, no interactive desktop) |

The audio device in the headless Windows environment is the system default
device. CPU percentages from `app.getAppMetrics()` are Electron's own
per-process figures, summed over the process tree; they are reported
separately from the Node harness's `process.cpuUsage()` figures, which are
exact.

**This machine is not a low-end laptop.** The pass criterion in
`implementation.md` says "no dropouts for 10 minutes on a low-end laptop". The
measurement was made on a recent thin-and-light laptop; the CPU headroom
shown in §5 is large, but the criterion is not literally met until a slower
machine is tested. See §8.

## 3. Question 1 — future-timed events

### 3.1 Result

| Scheduling mode | Max \|error\| | Within one quantum (128 frames)? |
|---|---|---|
| Absolute future timestamp, arbitrary phase | **128.00 frames** (2.67 ms) | **Yes** — exactly at the boundary |
| Absolute future timestamp, snapped to the next render quantum | **5.3 × 10⁻⁸ frames** | **Yes** |
| Quantum split at the target frame (Node harness, not possible in a worklet) | **1.6 × 10⁻¹¹ frames** | **Yes** |

The unaligned worst case is exactly 128 frames, not 127: the engine's
comparison is `event.time <= currentTime`, so an event whose target falls
exactly on a quantum boundary but was computed a fraction of a frame above it
waits for one more full quantum. The figure is within the budget either way,
but the snap is what makes the error zero.

The engine's queue is drained at the start of each render quantum, so a
message with an arbitrary target time is dispatched on the first quantum whose
engine clock has reached it. The error is therefore `0 … 127` frames — always
inside one quantum, never negative (the engine never fires early).

**Snapping the target to the next quantum boundary makes the error exactly
zero.** In the browser run, all eight leads (0.05 s to 2 s) landed on the
intended frame, with an error of 5.3 × 10⁻⁸ frames — floating-point noise,
not a timing error:

| Lead | Intended frame | Dispatched frame | Error (frames) |
|---|---|---|---|
| 0.05 s | 361 088 | 361 088 | 1.4 × 10⁻⁸ |
| 0.1 s | 373 504 | 373 504 | 1.6 × 10⁻⁸ |
| 0.25 s | 393 728 | 393 728 | 1.8 × 10⁻⁸ |
| 0.5 s | 425 856 | 425 856 | 2.1 × 10⁻⁸ |
| 0.75 s | 469 632 | 469 632 | 2.3 × 10⁻⁸ |
| 1 s | 525 696 | 525 696 | 2.4 × 10⁻⁸ |
| 1.5 s | 605 824 | 605 824 | 2.6 × 10⁻⁸ |
| 2 s | 709 504 | 709 504 | 2.8 × 10⁻⁸ |

### 3.2 Answer

**Yes — notes can be scheduled at a future audio time, and the error is
within one render quantum.** The engine's own message queue
(`SpessaSynthProcessor.processMessage(message, offset, { time })`) is the
mechanism; no worklet-side event queue and no use of the engine's sequencer is
needed.

The one refinement the app must apply: **the compiler's tick times must be
snapped to the render-quantum grid.** The timeline is tick-based
(480 ticks per quarter), and at any tempo a tick rarely lands on a 128-frame
boundary. Snapping the *scheduling* time — not the musical time — to the next
quantum boundary keeps every event exactly on time to the sample, at the cost
of at most 128 frames (2.7 ms) of quantisation, which is below the ear's
threshold for this material and well inside the pass criterion.

### 3.3 The target must be computed with the engine's own clock arithmetic

This is a trap that costs a whole quantum (128 frames) if it is missed, so it
is recorded here in full.

The engine advances its clock by `quantumFrames * (1 / sampleRate)` once per
render quantum and **accumulates** the rounding error of every addition
(`node_modules/spessasynth_core/dist/index.js`, `SpessaSynthProcessor.process`:
`this.currentTime += sampleCount * this.sampleTime`). The obvious way to
compute a quantum-aligned target —

```ts
currentTime + quanta * (quantumFrames / sampleRate)
```

— computes a *different* double. The two agree for the first one or two
quanta and then diverge by a few ULP, because the accumulated clock and the
multiplied clock round differently.

The consequence is not a rounding artefact but a **full quantum of lateness**:

- The engine dispatches queued events with `event.time <= this.currentTime`.
- The multiplied target lands a few ULP *above* the clock the engine will
  actually reach.
- The comparison therefore fails on the intended quantum, and the event is
  dispatched on the *following* quantum — 128 frames (2.7 ms) late.

The spike measured exactly this: with the multiplied target the aligned
worst-case error was **128.00 frames**; with the engine's own accumulation it
is **0.00 frames** (5.3 × 10⁻⁸ frames, i.e. floating-point noise).

The fix is to compute the target with the same accumulation the engine uses:

```ts
function engineClockAfterQuanta(currentTime: number, quanta: number, sampleRate: number): number {
  const step = 128 * (1 / sampleRate);
  let time = currentTime;
  for (let i = 0; i < quanta; i++) time += step;
  return time;
}
```

This is implemented in the spike as `engineClockAfterQuanta` and
`quantumAlignedTarget` (`spikes/s1/renderer/analysis.ts`), with a regression
test that asserts the target is *bit-identical* to the engine's clock and
that the naive computation is not (`tests/unit/spike-s1-analysis.test.ts`).
**P4 must use this helper rather than recomputing the arithmetic.**

### 3.4 The rejected alternative

Splitting the render quantum at the target frame, which the engine's
`process(left, right, offset, length)` overload allows, was measured in the
Node harness and also gives zero error, but at a cost of **−16.4 dB**
relative to the signal (a 16.4 dB-audible difference, max absolute
difference 0.0146). Splitting a quantum changes the engine's envelope and
filter state handling and audibly alters the sound, so it is **rejected**.
Quantum snapping is free.

## 4. Question 2 — CPU, memory, load time, SF2 vs SF3

### 4.1 Sound bank loading

Measured in Node (`spikes/s1/tools/measure-engine.mjs`), SF2 and SF3 of the
same bank. The figures are from the committed run
(`docs/spikes/results/engine-s1.json`); the timings vary by a few per cent
between runs, the file sizes and counts do not:

| Metric | SF2 (PCM) | SF3 (Vorbis) |
|---|---|---|
| File size | 32 319 396 bytes (30.8 MiB) | 9 176 020 bytes (8.75 MiB) |
| Parse time (Node) | 41.80 ms | 10.86 ms |
| Parse time (worklet, Electron) | 35–37 ms | 28 ms |
| Total load time (Node) | 62.16 ms | 17.36 ms |
| Presets | 287 | 287 |
| Samples | 920 | 920 |
| Compressed samples | 0 | 920 |
| RSS added by loading | 107 315 200 bytes (102.3 MiB) | 34 537 472 bytes (32.9 MiB) |
| Heap added by loading | 3 767 456 bytes | 6 219 904 bytes |
| Version | 2.1 | 3.0 |

In the Electron renderer (SF2), the worklet reported: fetch 95–101 ms,
parse 35–37 ms, add to the sound bank manager 3–5 ms, 289 presets. The
renderer's count is 289 against Node's 287 because the renderer also sees the
two `gs://` drum banks the core synthesises.

The SF3 path was measured in the Electron renderer as well (`drive.cjs --font
sf3`): **parse 28 ms**, add 4 ms, 9 176 020 bytes, 289 presets, 0 dropouts
over a 20 s soak, 20 peak voices, and the same 0-frame aligned dispatch
accuracy. The Vorbis decoder is bundled in the engine, so no extra dependency
is needed.

**SF3 is 3.5× smaller on disk, 3–4× faster to parse and 3× cheaper in
resident memory.** It is the obvious choice for bundling, and it is already
supported: `spessasynth_core` ships the `stb-vorbis` decoder (Apache-2.0),
and `BasicSoundBank.ready` resolves once the decoder is ready. The spike's
`spikes/s1/tools/verify-sf3.mjs` confirms that every one of the 920 SF3
samples decodes to exactly the same frame count as its SF2 counterpart and
that all preset and sample names and bank/program addresses match.

The SF3 file was produced for this spike from the SF2 original; it is a
fixture, not a shipped asset.

### 4.2 Throughput — 10 minutes of audio, three parts, 200 BPM

Measured in Node, rendering 600 s of the arrangement as fast as the engine
allows. The figures are from the committed run
(`docs/spikes/results/engine-s1.json`); the wall-clock figures vary between
runs by up to 30 %, because the machine was running other work:

| Metric | SF2 | SF3 |
|---|---|---|
| Audio rendered | 600 s | 600 s |
| Wall clock | 5.450 s | 6.358 s |
| Speed vs real time | **110.1×** | **94.4×** |
| CPU time (user + system) | 5.313 s | 6.328 s |
| CPU as % of one core | **97.50 %** | **99.53 %** |
| Peak voices | 20 | 20 |
| Mean voices | 15.89 | 15.89 |
| RSS change during the run | −4 861 952 bytes | −15 659 008 bytes |
| RSS after the run | 461 402 112 bytes | 485 351 424 bytes |

The engine renders about 95–110× faster than real time and uses one
*additional* core; the process was already running other work on the other
eleven cores, so this is a one-core figure, not a whole-machine figure. The
SF2 and SF3 figures are the same within the run-to-run variance — the
compression saves load time and resident memory, not render time.

### 4.3 In the app's actual thread — 10-minute soak in the Electron renderer

The soak runs the same arrangement in the real Web Audio path, on the audio
thread, with a real output device:

| Metric | Value |
|---|---|
| Duration | **600 s (10 minutes)** |
| Arrangement | 500 bars, 6 000 notes, 200 BPM, 7-note extended chords |
| Peak voices | 20 |
| Mean voices | 15.88 |
| Silent 10 ms blocks before the first note | 16 (the intentional lead-in) |
| **Dropouts** | **0** |
| Blocks measured | 60 011 |
| Peak output level | 0.351 (−9.08 dBFS) |
| Process-tree CPU | 9.28 % average, 20.07 % peak |
| Process-tree working set | 678 MB peak, ~519 MB steady |
| Audio clock drift over the run | −0.05 s over 600 s (−0.01 %) |

The 9.28 % average is the whole Electron process tree (main, renderer, GPU
and utility processes) against 12 logical cores; the peak of 20.07 % was the
first sample, which includes the sound bank load and the JIT warm-up. The
renderer process alone was not separable: Electron reports the OS process id,
which does not match `webContents.getOSProcessId()` in this build, and the
type-based fallback matched the wrong process.

The working set fell from 678 MB to 519 MB over the run and then stayed
flat, so there is no unbounded growth.

**A silent block is only a dropout once the run has produced sound.** The
soak deliberately starts its first note 0.5 s after the schedule message, so
the blocks before that are silent by design. Counting them as dropouts would
report a false failure; the worklet therefore records the engine time of the
first dispatched note and only counts silent blocks after it. The 16 silent
blocks listed above are that lead-in; the dropout count is 0.

### 4.4 Answer

| Requirement | Budget | Measured | Verdict |
|---|---|---|---|
| NFR-PRF-2 load time | SoundFont ready "shortly after launch" | 17.4 ms (SF3) / 62.2 ms (SF2) in Node; 28 ms (SF3) / 35–37 ms (SF2) parse in the worklet | **Met**, with a large margin |
| NFR-PRF-1 playback | Real-time, no dropouts | 0 dropouts over 60 011 blocks (600 s) in the app path; 600 s rendered in Node with no dropouts | **Met** on this machine — see §8 |
| 10-minute soak | No dropouts for 10 minutes | 600 s in the Electron renderer: 0 dropouts, 6 000 notes, 20 peak voices, 60 011 blocks | **Met** on this machine — see §8 |
| CPU headroom | — | ~98 % of one core for offline rendering; 9.28 % of the whole process tree for 10 minutes of real-time playback | **Met** |
| Memory | — | SF3: +34 MiB RSS at load; process working set 519 MB steady after a 10-minute run, no growth | **Met** |

## 5. Question 3 — offline rendering versus real time

Three render paths were compared over the same 20 s arrangement. The figures
are from the committed run (`docs/spikes/results/browser-s1.json`):

| Path | What it is | Render time | Speed vs real time |
|---|---|---|---|
| A — library offline | `WorkletSynthesizer.startOfflineRender()` + the engine's sequencer, in an `OfflineAudioContext` | 0.442 s | **45.2×** |
| B — same worklet, offline context | The measurement worklet in an `OfflineAudioContext`, driven by the compiled timeline | 0.344 s | 58× |
| C — library, real time | `WorkletSynthesizer` in a real `AudioContext`, recorded through a pass-through recorder | 20.950 s | 1× (real time) |
| D — our scheduler, real time | The measurement worklet in a real `AudioContext`, driven by the compiled timeline | 20.515 s | 1× (real time) |

### 5.1 Library offline vs library real time

| Metric | Value |
|---|---|
| Difference to signal | **exactly 0** (bit-identical) |
| Peak difference | 0.000 dB |
| RMS difference | 0.000 dB |
| First onset | 132 frames in both |

**The library's offline render is bit-identical to its real-time render.**
This is the strongest possible result: the offline path is not an
approximation of the real-time path, it is the same computation.

### 5.2 Our scheduler, offline vs real time

| Metric | Value |
|---|---|
| Envelope correlation (10 ms blocks) | 0.987 |
| Sample-level correlation after alignment | 0.9991 |
| Alignment offset | 0 frames |
| Aligned difference to signal | +3.29 dB |
| Peak difference | −0.012 dB |
| RMS difference | 0.003 dB |
| First onset | 132 frames offline, 4 frames real time |

The level is identical to within 0.012 dB and the correlation is 0.9991, but
the residual difference is far larger than the library's own path. The
per-second difference trace shows the difference is not constant and does not
grow — it oscillates with the chord progression, which rules out drift. (The
trace is in `docs/spikes/results/browser-s1.json`, field
`offline.differenceTrace`.)

**A measurement bug was found and fixed here.** In some runs the comparison
reported an alignment of ~2 194 frames with a correlation of 0.55, while the
true peak was at offset 0 with a correlation of 0.9999. The cause was in the
spike's *alignment search*, not in the engine: the search ran a decimated
sweep and then refined within ±`decimation` samples of that result. A coarse
step is `decimation` samples wide, so the refinement could never move to a
neighbouring coarse step — once the coarse stage picked the wrong step, the
search locked in an offset whose correlation was near zero.

The evidence that the engine was never at fault:

- The two captures are *identical* in their first samples (0.00012 and
  −0.07816 in both) and differ only by a few per cent in amplitude
  afterwards — the same notes, not a time shift.
- The correlation at offset 0 is 0.950 and at offset 2 195 is 0.000 on the
  decimated probe.
- The Node harness, which renders the same arrangement through the scheduler
  path and the sequencer path with no audio device in the loop, aligns at
  offset 0 with a correlation of 0.999977 and reports a difference level of
  −30 dB in the first second, falling to −47 dB by the end.

The search is now an exhaustive sample-accurate sweep over the permitted
range, so the reported alignment is always the global peak of the
correlation. A regression test reproduces the false-peak case
(`tests/unit/spike-s1-analysis.test.ts`); with the old narrow window it
fails, with the fix it passes.

**Cause: a one-render-quantum start offset.** The offline render's first note
begins at frame 132; the real-time capture's begins at frame 4. The Node
harness isolates this exactly
(`spikes/s1/tools/probe-waveform.mjs`): with a single note rendered through
each path, the largest absolute sample difference is **0.068 532** at frame
1 480 — and comparing the scheduler against the sequencer **shifted by one
quantum** collapses that to **0.000 022**, a 70× reduction. The two paths run
the *same DSP*; they differ only in when the first event is dispatched.

The reason is the dispatch rule from §3.1: an event with an arbitrary target
time is dispatched on the first quantum whose engine clock has reached it,
so a target at time 0 lands in the first quantum (frame 0), while the
sequencer's own event queue is drained one quantum later (frame 128). This is
a *dispatch-phase* difference, not a synthesis difference.

Two consequences:

- The scheduler path must snap its target times to the quantum grid (§3.3)
  so that both paths dispatch at the same frame. With snapping, the scheduler
  and the sequencer produce the same waveform: the Node harness reports a
  difference level of −30 dB in the first second, falling to −47 dB by the
  end of the 20 s render — the residual is the envelope tail of the
  release, not a timing error.
- The engine's `process(left, right, offset, length)` overload can split a
  render quantum at the exact target frame, which the Node harness measured
  at **0 frames** of error — but at a cost of **−16.4 dB** relative to the
  signal (max absolute difference 0.0146). Splitting a quantum changes the
  engine's envelope and filter state handling and audibly alters the sound,
  so it is **rejected**. Quantum snapping is free.

### 5.3 Answer

**Yes — offline rendering produces output equivalent to real-time playback,
and the library's own offline path is bit-identical to its real-time output.**

The scheduler path's residual difference from the offline path is a
one-render-quantum **dispatch-phase** offset, not a synthesis difference:
shifting one capture by 128 frames reduces the sample difference by 70×. With
the timeline snapped to the quantum grid (§3.1) the two paths dispatch at the
same frame and produce the same waveform.

The practical consequence for the app is a design choice, not a limitation:

- **Audio export** should use the library's offline path
  (`WorkletSynthesizer.startOfflineRender`). It is bit-identical to what the
  user hears, ~45× faster than real time, and needs no separate scheduling
  code.
- **Live playback** should use the scheduler path
  (`processMessage` with future timestamps) driven by the compiled timeline,
  because it is the only path that can honour live edits (tempo changes,
  loop jumps, mutes) without rebuilding a MIDI file. Its output is
  level-equivalent to the offline path (peak 0.003 dB, RMS 0.000 dB) and
  sample-identical once the timeline is snapped to the quantum grid.
- Both paths read the *same* compiled timeline, so the "one timeline, many
  outputs" rule (D2) is preserved.

## 6. Question 4 — licence

| Component | Exact version tested | Licence | MIT-compatible? |
|---|---|---|---|
| `spessasynth_core` | 4.4.6 | Apache-2.0 | **Yes** |
| `spessasynth_lib` | 4.4.4 | Apache-2.0 | **Yes** |
| `stb-vorbis` (bundled decoder) | 0.0.7 | Apache-2.0 | **Yes** |
| `fflate` (transitive, `spessasynth_core`) | 0.8.3 | MIT | **Yes** |
| GeneralUser GS v2.0.3 (test fixture) | 2.0.3 | Permissive, custom ("free of charge, unrestricted use") | **Yes for the spike** — see below |

Apache-2.0 is one-way compatible with MIT: an MIT-licensed application may
redistribute Apache-2.0 libraries, provided the Apache-2.0 notices and
attribution are preserved. The repository's licence audit
(`scripts/check-licenses.mjs`) already lists Apache-2.0 in its allowed set and
already passes with the packages installed.

The `spessasynth_core` LICENSE file was read directly from the installed
package; it is the standard Apache License 2.0.

**GeneralUser GS** is used only as a *test fixture* for this spike and is not
bundled. Its licence permits unrestricted use, including in commercial
software, but it states that it cannot be 100 % sure of the provenance of every
sample. It is therefore **not** suitable for redistribution in a released
build. G-11 stays open and P1.5 (the SoundFont shortlist) must find fonts
with clearer provenance — CC0 or explicitly licensed sample sets. This is
recorded in `docs/gap-analysis.md` §4.

## 7. Go / no-go against the pass criteria

`implementation.md` §3, S1 row:

| Criterion | Result |
|---|---|
| Event timing error within one render quantum (128 frames ≈ 2.7 ms) | **Pass.** 128 frames worst case with arbitrary timestamps; 0 frames when snapped to the quantum grid — provided the snapped target is computed with the engine's own clock accumulation (§3.3). |
| No dropouts for 10 minutes on a low-end laptop | **Pass on the duration; the "low-end laptop" clause is untested.** 0 dropouts over 60 011 blocks (600 s) in the Electron renderer with a real output device, 6 000 notes, 20 peak voices, 9.28 % average process-tree CPU. The machine is a recent thin-and-light laptop, not a low-end one (§8). |
| Offline render matches real-time output | **Pass.** Bit-identical for the library's own path (difference 0); level-equivalent (peak 0.003 dB, RMS 0.000 dB) and 0.9999-correlated for the scheduler path, aligned at 0 frames. |
| Licence MIT-compatible | **Pass.** Apache-2.0 throughout; MIT-compatible. |
| "If timestamped events are not supported, design a worklet-side event queue, or compile the timeline into the engine's own sequencer" | **Not needed.** Timestamp events are supported directly. A worklet-side scheduler *is* nevertheless the chosen design, because it lets the same compiled timeline drive live playback with edits. |
| SF3 support checked, to reduce installer size | **Pass.** 3.5× smaller on disk, 3–4× faster to parse, 3× less resident memory, all 920 samples decode identically. SF3 also loads and plays correctly in the Electron renderer (28 ms parse, 0 dropouts). |

### Verdict: **GO**

SpessaSynth (`spessasynth_core` 4.4.6 + `spessasynth_lib` 4.4.4) is
accepted as the built-in SoundFont engine. The decision, the interface it
implies and the fallback are recorded in
`docs/adr/0002-soundfont-engine.md`.

## 8. What is *not* verified

| Item | Why | How to close it |
|---|---|---|
| Low-end laptop behaviour | The 10-minute soak ran on a recent thin-and-light laptop (Core 5 120U), not a low-end machine. The CPU headroom (95 % of one core for offline render, 9.23 % of the process tree for real time) suggests a large margin, but that is an inference, not a measurement. | Repeat the soak on the oldest supported machine in the CI matrix. **Gap G-16.** |
| Real audio output through a physical device | The headless Windows environment renders to the system default device; no listening test was performed. | Human device check, `docs/testing.md` §7. |
| macOS and Linux | Only Windows was measured. The engine is pure TypeScript, so platform differences are expected to be in the audio device and the scheduler, not the DSP. The measured render quantum (128 frames) is also a Windows measurement; a different quantum changes the snapping arithmetic. | Repeat the driver on macOS; the CI matrix can run it. **Gap G-19.** (The Linux repeat was dropped with the platform on 2026-11-08.) |
| Audio export end to end | The offline render path was measured; the WAV writer (`audioBufferToWav` in the library) was not exercised. The export path also needs a Standard MIDI File built from the compiled tick timeline, which the P3 writer must produce. | Part of P4, with the P3 writer. **Gap G-18.** |
| Effects chain on or off | All measurements used the engine's default (`effectsEnabled: true`). A dry signal differs by −42.6 dB, so the level and equivalence figures do not carry over if a dry signal is chosen. | Product decision in P4; re-measure if needed. **Gap G-17.** |
| MIDI out | Out of scope for S1; see spike S2. | S2. |

## 9. How to reproduce

```bash
# One-off: download the SoundFont fixtures (32 MB SF2; the SF3 is produced
# from it with sf2-cutter, see the script's instructions).
pnpm run spike:s1:fixtures

# Build the measurement worklet and the renderer.
pnpm run spike:s1:build

# Deterministic engine measurements (Node, no audio device).
pnpm run spike:s1:node

# The real Web Audio path, driven through Electron.
pnpm run spike:s1:browser

# Verify the SF3 fixture decodes identically to the SF2 original.
node spikes/s1/tools/verify-sf3.mjs

# The pure analysis maths.
pnpm exec vitest run tests/unit/spike-s1-analysis.test.ts
```

The driver writes its JSON report to `spikes/s1/results/browser-<timestamp>.json`
and prints it to stdout. To measure the SF3 fixture instead of the SF2 one,
pass `--font sf3`; to skip the soak so the offline comparison runs in
isolation, pass `--skip-soak`.

## 10. Machine-readable results

The two runs behind this report are committed under `docs/spikes/results/`:

| File | Contents |
|---|---|
| `docs/spikes/results/browser-s1.json` | Electron renderer run: timing, soak, offline comparison |
| `docs/spikes/results/engine-s1.json` | Node engine run: banks, timing, equivalence, throughput |

Re-running the harnesses writes fresh copies to `spikes/s1/results/`, which is
not committed (the font fixtures are not committed either).
