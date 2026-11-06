# PracticePlayer — Progress Tracker

| | |
|---|---|
| **Last updated** | 2026-11-05 |
| **Current phase** | P1 Technical spikes - S1 complete; S2 complete on Windows and macOS 2026-11-05 (end-to-end jitter measured; Linux deferred); next: S3 MP3 encoder |
| **Plan of record** | implementation.md v0.1, requirements.md v0.2 |

**How to use this file.** Update it at the end of every working session (human or AI agent). Tick tasks, change phase status, log decisions and blockers, and add one line to the changelog. Task IDs (e.g. `P2.3`) are referenced from agent-prompts.md and commit messages.

**Status values:** `Not started` · `In progress` · `Blocked` · `Done` · `Dropped`

---

## 1. Dashboard

| Phase | Name | Size | Status | Exit check met? |
|---|---|---|---|---|
| P0 | Bootstrap and CI | S | Done | Yes — CI run 41889258513 green on Windows, macOS and Ubuntu (2026-11-04) |
| P1 | Technical spikes | M | In progress | No - S1 done 2026-11-05; S2 done on Windows and macOS 2026-11-05 (ADR-0003; end-to-end jitter measured, Linux deferred — G-20); S3, S4, P1.5, P1.6 outstanding |
| P2 | Theory core | M | Not started | No |
| P3 | Arrangement, compiler, presets, file formats | M | Not started | No |
| P4 | Playback engine and walking skeleton | L | Not started | No |
| P5 | Full UI | L | Not started | No |
| P6 | MIDI out | M | Not started | No |
| P7 | Fretboard and scale hints | S–M | Not started | No |
| P8 | Persistence and presets UI | M | Not started | No |
| P9 | Export (MIDI, WAV, MP3) | M | Not started | No |
| P10 | Packaging, cross-platform QA, release | M | Not started | No |

Documents:

| Document | Version | Status |
|---|---|---|
| requirements.md | 0.2 | Drafted; awaiting review |
| implementation.md | 0.1 | Drafted; awaiting review |
| progress.md | 0.2 | This file |
| testing.md | 0.1 | Drafted; awaiting review |
| gap-analysis.md | 0.2 | Phase 0 dependencies recorded in §4; S1 and S2 gaps recorded |
| agent-prompts.md | 0.1 | Drafted; awaiting review |
| adr/0001-electron-toolchain.md | 1.0 | Accepted |
| adr/0002-soundfont-engine.md | 1.0 | Accepted |
| adr/0003-midi-io-approach.md | 1.0 | Accepted |

## 2. Task checklists

### P0 — Bootstrap and CI
- [x] P0.1 Create repo, MIT license, README, contribution notes
- [x] P0.2 electron-vite + React + strict TypeScript scaffold
- [x] P0.3 ESLint/Prettier; import-boundary rules (`core` isolation)
- [x] P0.4 Vitest set up with a first passing test
- [x] P0.5 Electron hardening baseline (context isolation, sandbox, CSP, minimal preload)
- [x] P0.6 Playwright smoke test that launches the app
- [x] P0.7 GitHub Actions matrix (Windows, macOS, Ubuntu): build, lint, test
- [x] P0.8 ADR template and `docs/adr/` folder
- [x] P0.9 Dependency and licence audit step in CI
- **Exit:** CI green on all three OSes; window opens on each; boundary rules fail the build when violated.
  - Boundary rules: **verified** — `tests/unit/import-boundaries.test.ts` writes a deliberate violation
    (`core` importing `@renderer`, `core` importing `electron`, `core` using `ipcRenderer`), asserts the lint
    error and removes the violation afterwards.
  - Window opens: **verified on Windows 10/11 x64** (Playwright smoke test, 2026-11-04), **on Linux x64**
    (Ubuntu 26.04 WSL with `xvfb-run`, 2026-11-04) and **on macOS** (CI run 41889258513, `macos-latest`,
    2026-11-04).
  - CI matrix: **green on all three platforms** — run 41889258513 (`windows-latest`, `macos-latest`,
    `ubuntu-latest`), 2026-11-04.
  - First CI run (2026-11-04, run 41880743219) failed on all three platforms; the causes and the fix in
    `ec94b21` are recorded in the changelog.

### P1 — Technical spikes
- [x] P1.1 Spike S1: SoundFont engine (scheduled events, CPU, offline render, SF3) — **done 2026-11-05, GO**; ADR-0002; report in `docs/spikes/s1-soundfont-engine-report.md`
- [ ] P1.1a Repeat the S1 driver on macOS and Linux and on a low-end machine to close gaps G-16 and G-19 (the S1 pass criteria are only met on one modern Windows laptop)
- [x] P1.2 Spike S2: MIDI out (Web MIDI vs native; jitter on each OS; hot-plug; permissions) — **done 2026-11-05, GO for Web MIDI** (ADR-0003). The end-to-end p99 jitter was measured against a real loopback on **Windows (1.10 ms)** and **macOS (0.10 ms)** across five CI runs per configuration (19 152 on Windows, 18 240 on macOS), with **0 late sends** in every configuration; hot-plug was exercised by removing the port mid-run. Report: `docs/spikes/s2-midi-out-report.md`
  - **One Windows run in five** showed a 50.9 ms *received* outlier that the dispatch records attribute to the loopback driver (the app dispatched that bar 96 ms early and the received MIDI clock stalled by the same 50 ms) — the app's own jitter was unaffected.
  - **Hot-plug on Windows**: the port removal works at the OS level, but Chromium's WinMM backend keeps listing the port and emits no `statechange` event. Recorded as **gap G-22** with a workaround for P6 (re-enumerate on a failed send).
- [ ] P1.2a Run the S2 measurement on **Linux** to close the remaining part of gap G-20 (the p99 exit check). The CI workflow `.github/workflows/spike-s2-midi.yml` covers Windows and macOS; the GitHub runners' Azure kernels ship without the ALSA sequencer drivers, so the Linux run needs a machine with `snd-seq` and `snd-virmidi` (`testing.md` §7, M-0)
- [ ] P1.3 Spike S3: MP3 encoder licensing and quality
- [ ] P1.4 Spike S4: packaging, installer size, signing feasibility
- [ ] P1.5 SoundFont shortlist and licence verification (piano, bass, guitar, percussion/click)
- [ ] P1.6 ADRs written for S1–S4; gap-analysis.md updated — ADR-0002 and gap-analysis §4/§5 done for S1; ADR-0003 and gap-analysis §4/§5/§8 done for S2; S3–S4 outstanding
- **Exit:** go/no-go recorded for each spike; fallbacks chosen where a spike failed.

### P2 — Theory core
- [ ] P2.1 Pitch classes and spelling (letter + accidental)
- [ ] P2.2 Scales: major, natural/harmonic/melodic minor, seven modes
- [ ] P2.3 Chord formulas, parser and name formatter
- [ ] P2.4 Degree → chord resolution, including borrowed/non-diatonic roots
- [ ] P2.5 Enharmonic key handling (OQ-2 default)
- [ ] P2.6 Voicing rules (register, minimal movement, extension handling) with listening notes
- [ ] P2.7 Chord-scale table (data file) and hint selection
- [ ] P2.8 Fretboard position function
- [ ] P2.9 Golden-table tests: 12 tonics × all scale types × all Appendix A presets
- **Exit:** all golden tests pass; coverage threshold from testing.md met.

### P3 — Arrangement, compiler, presets, file formats
- [ ] P3.1 Session/Section/Progression types and validation
- [ ] P3.2 Bar/beat model for 4/4, 3/4, 6/8, 5/4, 7/8 with OQ-5 groupings
- [ ] P3.3 Timeline compiler (chords, bass, click, markers, count-in)
- [ ] P3.4 Built-in preset JSON (29 presets, Appendix A)
- [ ] P3.5 Session and preset schemas with `schemaVersion` and migration scaffold
- [ ] P3.6 Standard MIDI File writer — also feeds the audio export path, which renders the SMF through the engine's offline path (G-18)
- [ ] P3.7 Timeline golden/property tests; SMF round-trip test
- **Exit:** timeline tests green for all time signatures; SMF parses in a reference parser.

### P4 — Playback engine and walking skeleton
- [ ] P4.1 Tempo map (tick ↔ time) with live tempo change
- [ ] P4.2 Look-ahead scheduler with injected clock
- [ ] P4.3 Transport: play, pause, resume, stop
- [ ] P4.4 Count-in
- [ ] P4.5 Loop (whole, section, bar range) with seamless join
- [ ] P4.6 SynthSink using the engine chosen in S1; one bundled SoundFont — must use the engine-clock snapping helper (G-15) and settle the effects-chain decision (G-17)
- [ ] P4.7 Click source
- [ ] P4.8 Worker timer; throttling protections; power-save blocker
- [ ] P4.9 Minimal UI: key, tempo, preset picker, play/stop
- [ ] P4.10 Simulated-clock tests; 10-minute soak test
- **Exit:** 3-section arrangement plays correctly on all OSes; soak shows no dropouts or drift.

### P5 — Full UI
- [ ] P5.1 Session editor (key/scale with spellings, tempo, time signature)
- [ ] P5.2 Section list: add, remove, reorder, duplicate, rename
- [ ] P5.3 Progression editor (chords, durations including sub-bar)
- [ ] P5.4 Chord chart with current/next highlight and follow-playhead
- [ ] P5.5 Mixer: volume and mute per part
- [ ] P5.6 Loop-region selection on the chart
- [ ] P5.7 Instrument pickers per part
- [ ] P5.8 Themes (light/dark/OS)
- [ ] P5.9 Keyboard shortcuts and documentation
- [ ] P5.10 Accessibility pass; i18n scaffolding
- **Exit:** every action reachable by keyboard; chart tracks playback; accessibility checks pass.

### P6 — MIDI out
- [ ] P6.1 Port discovery, selection, hot-plug
- [ ] P6.2 Channel assignment per part
- [ ] P6.3 MidiOutSink with timestamped sends and latency offset
- [ ] P6.4 MIDI clock and Start/Stop/Continue
- [ ] P6.5 All-notes-off / all-sound-off on stop, pause, loop change, device change
- [ ] P6.6 Per-part routing: synth, MIDI, or both
- [ ] P6.7 Latency calibration helper
- [ ] P6.8 User docs for Windows loopback and macOS/Linux virtual ports
- **Exit:** acceptance AT-5 passes on all OSes; clock verified with two DAWs.

### P7 — Fretboard and scale hints
- [ ] P7.1 Fretboard component (root marked non-colour)
- [ ] P7.2 Scale/mode hint panel (current and next chord)
- [ ] P7.3 Non-diatonic handling: quality-based suggestion alongside in-key scale
- [ ] P7.4 Hint table documented as extension point
- **Exit:** all 29 presets × 12 keys show correct tones and sensible hints.

### P8 — Persistence and presets UI
- [ ] P8.1 Save/load sessions; recent files
- [ ] P8.2 User presets: create, edit, rename, delete, duplicate built-ins
- [ ] P8.3 Settings restore with graceful fallback (missing ports/SoundFonts)
- [ ] P8.4 SoundFont import and selection UI
- [ ] P8.5 Corrupt-file handling and fuzz tests
- **Exit:** acceptance AT-7 passes; corrupt inputs never crash the app.

### P9 — Export
- [ ] P9.1 MIDI export UI and options (click, count-in, repeats) — the writer also feeds the audio export path (G-18)
- [ ] P9.2 WAV export via offline rendering with progress/cancel — live and exported audio must agree on the effects chain (G-17)
- [ ] P9.3 MP3 export (only if S3 cleared; behind a flag)
- [ ] P9.4 UI message that external-MIDI output cannot be exported as audio
- **Exit:** acceptance AT-6 passes; real-time and offline renders match.

### P10 — Packaging, QA, release
- [ ] P10.1 Installers for Windows, macOS, Linux
- [ ] P10.2 Signing/notarization per S4 decision
- [ ] P10.3 Licences and attributions screen
- [ ] P10.4 User guide and quick start
- [ ] P10.5 Full cross-platform test pass (testing.md)
- [ ] P10.6 Performance and soak checks; known-issues list
- [ ] P10.7 v1.0 release notes
- **Exit:** acceptance AT-8 passes on clean machines; no open blocker-rated gaps.

## 3. Spike results

| Spike | Result | ADR | Date |
|---|---|---|---|
| S1 SoundFont engine | **GO.** SpessaSynth 4.4.6 / 4.4.4 (Apache-2.0). Future-timed events: 128 frames worst case, **0 frames** when snapped to the render-quantum grid (the snapped target must use the engine's own clock accumulation — see the decision log). Load 17.4 ms (SF3) / 62.2 ms (SF2); 28 ms SF3 parse in the worklet. **10-minute soak in the Electron renderer: 0 dropouts over 60 011 blocks, 6 000 notes, 20 peak voices, 9.28 % average process-tree CPU, 519 MB steady working set.** Library's offline path is bit-identical to its real-time path. SF3 is 3.5× smaller, 3–4× faster to parse. The "low-end laptop" clause of the pass criterion is untested - the measurement machine is a recent thin-and-light laptop. | `docs/adr/0002-soundfont-engine.md` | 2026-11-05 |
| S2 MIDI out | **GO for Web MIDI** — the p99 exit check is **met on Windows and macOS**. ADR-0003: MIDI out is **Web MIDI in the renderer**, with `@julusian/midi` (MIT, RtMidi 6.0.0) kept as an evaluated fallback. Chromium converts the Web MIDI timestamp to `base::TimeTicks` and every platform backend (WinMM, WinRT, CoreMIDI, ALSA) hands the message to the driver with that timestamp, so the driver does the waiting. **End-to-end against a real loopback (five CI runs per configuration): p99 jitter 1.10 ms on Windows** (loopMIDI 1.0.16.27) **and 0.10 ms on macOS** (a CoreMIDI virtual endpoint), with **0 late sends** across 19 152 sends on Windows and 18 240 on macOS in every configuration — idle, minimised window, and heavy UI load with a 300 ms look-ahead. One Windows run in five showed a 50.9 ms *received* outlier that the dispatch records attribute to the loopback driver (the app dispatched that bar 96.4 ms early). Hot-plug was exercised by removing the loopback port mid-run: on macOS the port disappeared from the list and two `statechange` events reported it; on **Windows the removal works at the OS level but Chromium keeps listing the port and emits no event** (G-22). No send threw on either platform. The native candidate cannot match it — RtMidi has no timestamped send, so **47.4-53.0 % of its sends on Windows and 75.4-83.6 % on macOS were late** across five runs (p99 +14.79 ms on a busy machine); it cannot load in a sandboxed preload, and it needs an IPC hop per message. Permission flow verified (MIDI granted to the app's own origin, sysex denied by default). A 100 ms look-ahead produced **3.51 % late sends** under a 120 ms main-thread block; a 300 ms look-ahead produced none (G-21). **Not measured:** Linux — the CI runners' Azure kernels ship without the ALSA sequencer drivers, so no virtual loopback can be created there (G-20); and no real MIDI hardware was involved (`testing.md` §7). | `docs/adr/0003-midi-io-approach.md` | 2026-11-05 |
| S3 MP3 encoding | — | — | — |
| S4 Packaging | — | — | — |

## 4. Decision log

| Date | Decision | Source |
|---|---|---|
| 2026-11-03 | Electron + TypeScript desktop app for Windows, Linux, macOS | Design session |
| 2026-11-03 | v1 sound sources: built-in SoundFont synth and MIDI out; VST hosting and audio clips deferred | Design session |
| 2026-11-03 | Primary use: practice/improvisation backing tracks | Design session |
| 2026-11-03 | Progressions from a preset library; custom presets; song-style sections | Design session |
| 2026-11-03 | v1 time signatures: 4/4, 3/4, 6/8, 5/4, 7/8 | Design session |
| 2026-11-03 | Playback: sustained block chords, root-note bass, metronome click; count-in and looping | Design session |
| 2026-11-03 | Display: chord chart, guitar fretboard, scale/mode hints | Design session |
| 2026-11-03 | Several bundled SoundFonts; users may import their own | Design session |
| 2026-11-03 | Save/load sessions, MIDI export, WAV/MP3 export | Design session |
| 2026-11-03 | Chord vocabulary: triads, sevenths, extensions, sus, altered; all seven modes plus three minors | Design session |
| 2026-11-03 | MIDI out: separate channels for chords/bass/click, selectable port, MIDI clock | Design session |
| 2026-11-03 | Open source, MIT license (OQ-1) | Design session |
| 2026-11-03 | BPM unit and beat grouping defaults (OQ-5) | Design session |
| 2026-11-03 | Chord-scale hints by chord quality, to be expanded later (OQ-8) | Design session |
| 2026-11-03 | Preset list chosen by Claude: rock, blues, jazz, modal vamps (OQ-3) | Design session |
| 2026-11-03 | Docs delivered as markdown in `docs/` | Design session |
| 2026-11-04 | Electron + electron-vite + React + strict TypeScript toolchain; ADR-0001 records the decision | P0 bootstrap |
| 2026-11-04 | Import boundaries enforced by a local ESLint rule (`scripts/eslint-boundaries.mjs`) instead of a third-party dependency-cruiser plugin — no extra dependency, no licence risk | P0.3 |
| 2026-11-04 | All dependencies pinned to exact versions; `pnpm-workspace.yaml` holds the reviewed-build allowlist (`electron`, `esbuild`) and a `minimatch` override to 11.0.1 for advisory GHSA-1244012 | P0.2, P0.9 |
| 2026-11-04 | `caniuse-lite` (CC-BY-4.0, dev-only transitive dependency) accepted with recorded attribution in `scripts/license-attribution.json`; it is not part of the shipped bundle | P0.9 |
| 2026-11-04 | CSP applied through a build-time meta tag in `electron.vite.config.ts` plus a `session.defaultSession.webRequest` header in the main process (CSP as a response header) | P0.5 |
| 2026-11-04 | Minimal preload API exposes one example call, `practicePlayer.getAppInfo()`, with no generic IPC escape hatch | P0.5 |
| 2026-11-04 | Line endings normalised to LF via `.gitattributes` and Prettier `endOfLine: lf`, so the format check is identical on all three operating systems | CI fix 2026-11-04 |
| 2026-11-04 | The Electron smoke test runs under `xvfb-run` on Ubuntu with `playwright install-deps chromium`; GitHub's Linux runners have no X server and lack the Chromium shared libraries | CI fix 2026-11-04 |
| 2026-11-05 | **SpessaSynth is the built-in SoundFont engine** (`spessasynth_core` 4.4.6, `spessasynth_lib` 4.4.4, Apache-2.0) — ADR-0002 | Spike S1 |
| 2026-11-05 | Live playback schedules events into the engine's message queue; **scheduling times are snapped up to the next 128-frame render-quantum boundary**, which makes the dispatch error exactly 0 frames. Splitting the quantum at the target frame was measured and rejected (-16.4 dB, audible). | Spike S1, ADR-0002 |
| 2026-11-05 | The quantum-snapped target must be computed with the engine's **own clock accumulation** (`currentTime` advanced by `128 * (1 / sampleRate)` once per quantum). The natural-looking `currentTime + quanta * (128 / sampleRate)` lands a few ULP above the clock the engine reaches, so the event is dispatched a **whole quantum (128 frames) late**. Measured: 128.00 frames against 0.00 frames. The helper `engineClockAfterQuanta` and its regression test live in the spike; P4 must use them. | Spike S1, ADR-0002 |
| 2026-11-05 | Audio export uses the engine's own offline path (`WorkletSynthesizer.startOfflineRender`), which is bit-identical to the library's real-time output and ~45× faster than real time. Live playback uses the scheduler path so that live edits do not require rebuilding a MIDI file. Both read the same compiled timeline. | Spike S1, ADR-0002 |
| 2026-11-05 | Bundled sound fonts ship as **SF3** (3.5× smaller on disk, 3–4× faster to parse, 3× less resident memory than SF2, sample-for-sample identical output) | Spike S1, ADR-0002 |
| 2026-11-05 | The sound bank is parsed **inside the AudioWorklet**, not on the main thread, so a 30 MB font cannot stall the UI | Spike S1, ADR-0002 |
| 2026-11-05 | **The quantum-snapped scheduling target is computed with the engine's own clock accumulation**, not with `currentTime + quanta * quantumSeconds`. The engine advances its clock by `quantumFrames * (1 / sampleRate)` once per quantum and accumulates the rounding error; the multiplied form lands a few ULP above the clock the engine reaches, so `event.time <= currentTime` fails and every event is dispatched a whole quantum (128 frames ≈ 2.7 ms) late. Measured in S1: 128.00 frames against 0.00 frames. The error is uniform and inside the one-quantum budget, so it would pass a coarse check and still be wrong. The arithmetic lives in one helper (`engineClockAfterQuanta`) with a regression test; P4 must use it and must not recompute the arithmetic at a call site. | Spike S1, ADR-0002 §2, gap G-15, risk RK-11 |
| 2026-11-05 | **The S1 evidence is explicitly scoped to one Windows machine.** The 10-minute soak passed with 0 dropouts over 60 011 blocks at 9.28 % average process-tree CPU on a Core 5 120U, but the pass criterion says "on a low-end laptop" and the render quantum (128 frames) is a Windows measurement. The low-end and non-Windows evidence is therefore an inference, not a measurement; gaps G-16 and G-19 track it, and the numbers in the report are labelled as machine-specific. | Spike S1 §8, gaps G-16 and G-19, risk RK-12 |
| 2026-11-05 | **The engine's effects chain (reverb and chorus) is on by default and is an open product decision, not a settled default.** S1 measured with effects enabled; the dry signal differs by −42.6 dB. ADR-0002 records it as undecided. P4 must decide whether effects apply to live playback and to export, and make the two paths agree — otherwise the exported audio will not sound like what the user heard. | Spike S1, ADR-0002 §"What was not decided here", gap G-17, risk RK-14 |
| 2026-11-05 | **The export path needs a Standard MIDI File built from the compiled tick timeline.** The library's offline path is bit-identical to the library's real-time output but plays a MIDI sequence through the engine's own sequencer, not the tick timeline, so ADR-0002's export path depends on the P3 SMF writer. This keeps the tick timeline the single source of truth (D2). If the writer slips, the documented fallback renders the live path into an `OfflineAudioContext` with the same scheduler — giving up bit-identity but keeping one timeline. | Spike S1, ADR-0002 §Fallback, gap G-18, risk RK-13 |
| 2026-11-05 | **MIDI out uses Web MIDI in the renderer.** The renderer talks to `MIDIOutput` directly; the main process holds no MIDI state and the preload exposes no MIDI API. Chromium converts the Web MIDI timestamp to `base::TimeTicks`, and every platform backend (WinMM, WinRT, CoreMIDI, ALSA) hands the message to the driver with that timestamp, so the driver does the waiting and the app's timer jitter does not reach the output. | Spike S2, ADR-0003 |
| 2026-11-05 | **The native RtMidi addon is the evaluated fallback, not the shipping path.** `@julusian/midi` 3.8.1 (MIT) vendors RtMidi 6.0.0; licence, maintenance and Node-API v7 prebuilds for every target were verified. It was not adopted because RtMidi has **no timestamped send** — the only way to hit the intended instant is to wake up then, and the measured p99 wake-up lateness was **+15.2 ms** (over the 5 ms budget) before the driver is involved — because a native module cannot load in a **sandboxed** preload, and because it would need an IPC hop per message. It stays a dev dependency for the spike and never ships. | Spike S2, ADR-0003, gap-analysis §4 |
| 2026-11-05 | **The MIDI look-ahead window must be at least 300 ms.** Chromium clamps a past timestamp to a zero delay, so a late dispatch is sent immediately and is audible early. Measured on Windows: a 100 ms window produced **32 late sends out of 912 (3.51 %)**, p99 lateness **+14.27 ms**, when the renderer main thread was blocked for 120 ms every 500 ms; a 300 ms window produced **0**. P6 must use ≥300 ms and must not send a message whose timestamp has already passed. | Spike S2 §5.1, gap G-21 |
| 2026-11-05 | **MIDI permission is granted to the app's own origin by the session handlers; sysex is denied by default.** `navigator.requestMIDIAccess()` resolves without a prompt in the Electron renderer; `midiSysex` is only granted when explicitly requested. The production handler must additionally reject `midi` for foreign origins. | Spike S2 §3, ADR-0003 |
| 2026-11-05 | **The S2 evidence now covers the end-to-end receiver on Windows and macOS.** The CI workflow measures the received-timestamp error against a real loopback (loopMIDI on Windows, a CoreMIDI virtual endpoint on macOS): **p99 jitter 1.10 ms on Windows and 0.10 ms on macOS**, with **0 late sends** in every configuration — idle, minimised window, and heavy UI load with a 300 ms look-ahead — across five CI runs per configuration (19 152 on Windows, 18 240 on macOS). The macOS figure is at the capture's resolution (the received timestamps are quantised to 100 µs), so it means "no measurable jitter" rather than a precise number. **One Windows run in five** showed a 50.9 ms received outlier: the dispatch records show the app handed that bar to the driver **96.4 ms early** and the received MIDI clock stalled by the same 50 ms, so the delay is in the loopback driver, not the app. **Linux is still not measured** — the GitHub runners' Azure kernels ship without the ALSA sequencer drivers, so no virtual loopback can be created there; gap G-20 keeps that part open. | Spike S2 §2.3/§5.3/§5.3.1/§7/§8, gap G-20, ADR-0003 |
| 2026-11-05 | **Hot-plug must not rely on `statechange` alone on Windows.** The S2 hot-plug probe removed the loopback port mid-run. On macOS the port disappeared from the list and two `statechange` events reported it. On Windows the removal *works at the OS level* — enumerating the ports outside Electron through RtMidi showed the loopMIDI port gone — but Chromium's renderer kept listing it and emitted no event, because Chromium's `MidiManagerWin::UpdateDeviceListOnTaskRunner()` only re-enumerates when Windows raises a device-change notification. NFR-REL-2 therefore cannot be met on Windows by `statechange` alone: **P6 must re-enumerate the ports when a send fails and when the MIDI settings are reopened, and must treat a failed send as "the device is gone"** (which `ResilientMidiSender` already does). Tracked as gap G-22. | Spike S2 §5.6/§7, gap G-22, ADR-0003 |

## 5. Open items

| ID | Item | Owner | Status |
|---|---|---|---|
| A5 | Confirm preset resolution rule (chords fixed; scale type drives suggestions and hints) | John | Open |
| OQ-2 | Enharmonic key presentation | Team | Default proposed |
| OQ-4 | Tempo range 30–300 BPM | Team | Default proposed |
| OQ-6 | Voicing register and rules | Phase 2 | Open |
| OQ-7 | Fretboard: chord tones only | Team | Default proposed |
| OQ-9 | MP3 encoder and licence | Spike S3 | Open |
| OQ-10 | Latency calibration method | Phase 6 | Default proposed |
| OQ-11 | Installer size budget; SoundFont list | Spike S4 / P1.5 | Open — S1 confirmed SF3 is the shipping format (3.5× smaller than SF2); the font list itself is still open |
| OQ-12 | Code signing and notarization | Spike S4 | Open |
| G-01…G-14 | Gaps found during planning | See gap-analysis.md | Open — G-11 partly closed by S1 (engine and format settled; font selection outstanding) |
| G-15 | Engine-clock arithmetic for quantum-snapped scheduling targets | Phase 4 | Open — rule and helper settled by S1; P4 must use `engineClockAfterQuanta` and must not recompute the arithmetic |
| G-16 | Low-end-laptop evidence for the S1 performance criterion | Phase 1 / P4 | Open — run `drive.cjs --soak 600` on the oldest supported CI machine |
| G-17 | Effects chain (reverb/chorus) on or off for live playback and export | Phase 4 | Open — product decision; re-measure if a dry signal is chosen |
| G-18 | Export path needs a Standard MIDI File built from the compiled tick timeline | Phase 3 / P4 | Open — depends on the P3 SMF writer; fallback documented in ADR-0002 |
| G-19 | Non-Windows evidence for the render quantum and timing constants | Phase 1 | Open — repeat the driver on macOS and Linux (PulseAudio and PipeWire) |
| G-20 | End-to-end MIDI output jitter on **Linux** (the S2 p99 exit check) | Phase 1 / P6 | Partly closed — **Windows (1.10 ms) and macOS (0.10 ms) measured and passing** across five CI runs per configuration; Linux deferred to the manual device test because the CI runners' kernels have no ALSA sequencer |
| G-21 | The MIDI look-ahead window must exceed the worst main-thread stall | Phase 6 | Open — decided in ADR-0003 (≥300 ms window); P6 must implement it and must not send a past-dated message |
| G-22 | Chromium's Windows MIDI backend does not report a removed device | Phase 6 | Open — found by S2; P6 must re-enumerate the ports on a failed send and on reopening the MIDI settings, and must not rely on `statechange` alone |
| RK-15 | The MIDI driver stalls and delivers a batch of messages late, which the app cannot prevent | Phase 6 / Phase 10 | Open — measured once in five CI runs; the ≥300 ms look-ahead absorbs it, but the user guide should say that a badly-behaved driver can delay messages |
| P0-CI | Run the GitHub Actions matrix on Windows, macOS and Ubuntu; close the Phase 0 exit check when all three are green | John | Closed — run 41889258513 green on all three platforms (2026-11-04) |
| S1-LOWEND | Demonstrate the S1 pass criterion "no dropouts for 10 minutes on a **low-end** laptop": the 10-minute soak ran on a recent thin-and-light laptop (Core 5 120U), not a low-end machine | Phase 1 / P4 | Open — run `drive.cjs --soak 600` on the oldest supported CI machine; tracked in gap-analysis.md as G-16 |

## 6. Blockers

None.

## 7. Changelog

| Date | Change |
|---|---|
| 2026-11-03 | Initial tracker created from implementation.md v0.1 |
| 2026-11-04 | P0.1–P0.9 implemented: MIT licence, README, CONTRIBUTING, electron-vite + React + strict TypeScript app, ESLint/Prettier with a local import-boundary rule, Vitest suite (one test per layer plus cross-layer core-purity and boundary-violation tests), Electron hardening baseline (contextIsolation, sandbox, nodeIntegration off, CSP as header and meta tag, minimal typed preload API, backgroundThrottling off), Playwright Electron smoke test, GitHub Actions matrix (Windows/macOS/Ubuntu) with dependency and licence audits, ADR template plus ADR-0001. Verified locally on Windows: lint, type-check, 15 unit tests, build, Electron smoke test, dependency audit (0 vulnerabilities) and licence audit (259 packages, 0 incompatible). macOS/Linux pending the CI matrix run. |
| 2026-11-04 | CI matrix green on all three platforms — run 41889258513 (`windows-latest`, `macos-latest`, `ubuntu-latest`) passed install, lint, format check, type-check, 16 unit tests, build, 2 Electron smoke tests, dependency audit and licence audit. Phase 0 exit check met. |
| 2026-11-04 | First CI run failed on all three platforms; fixed in `ec94b21`. Causes: (1) Windows — Git checked the files out with CRLF while the committed blobs were LF, so Prettier reported 45 files as unformatted; fixed with `.gitattributes` (`* text=auto eol=lf`) and Prettier `endOfLine: lf`. (2) Ubuntu — the Electron smoke test failed with "Missing X server or $DISPLAY" because the runners have no X server; fixed by installing `xvfb` plus the Chromium shared libraries (`playwright install-deps chromium`) and running the test under `xvfb-run --auto-servernum`. (3) All platforms — `actions/checkout@v4`, `actions/setup-node@v4` and `pnpm/action-setup@v4` run on Node 20, which GitHub deprecated; bumped to `checkout@v5`, `setup-node@v5` and `action-setup@v6`, which run on Node 24. Re-verified the full pipeline on Linux (Ubuntu 26.04 WSL, Node 24.21.0, pnpm 12.9.1): lint, format check, type-check, 16 unit tests, build, 2 Electron smoke tests, dependency audit and licence audit all pass. |
| 2026-11-05 | **Spike S1 (P1.1) complete — GO.** Built a throwaway measurement harness in `spikes/s1/`: a Node harness (`tools/measure-engine.mjs`) that drives `spessasynth_core` deterministically, and an Electron renderer (`renderer/`, `electron/drive.cjs`) that measures the real Web Audio path with a real output device. The measurement worklet (`worklet/measure-worklet.ts`) records the exact frame each MIDI event is dispatched on, by reading `currentFrame` inside the engine's `noteOn` callback; the target time is computed on the audio thread so the message round-trip never enters the measurement. Results: future-timed events land 128 frames late at worst and **exactly 0 frames** late when the target is snapped to the render-quantum grid; SF2 loads in 62.2 ms and SF3 in 17.4 ms; a 600 s three-part arrangement renders 95–110× faster than real time at ~98 % of one core with 0 dropouts; the library's offline path is bit-identical to its real-time path; the scheduler path differs only by a one-quantum dispatch phase. **The full 10-minute soak was then run in the Electron renderer with a real output device: 0 dropouts over 60 011 blocks (6 000 notes, 20 peak voices), 9.28 % average process-tree CPU, working set flat at 519 MB, audio-clock drift −0.05 s over 600 s.** Licence: `spessasynth_core` 4.4.6 and `spessasynth_lib` 4.4.4 are Apache-2.0, `stb-vorbis` 0.0.7 is Apache-2.0 — all MIT-compatible. Added `docs/adr/0002-soundfont-engine.md` (decision, interface, fallback), `docs/spikes/s1-soundfont-engine-report.md` (method, machine, tables, go/no-go against the pass criteria, and what is *not* verified), updated `docs/gap-analysis.md` §1/§2 (G-11), §4 (licence register), §5 (the future-timed-events unknown is closed) and §8 (review log), and `docs/implementation.md` D6, RK-1 and RK-4. Added 33 unit tests for the spike's pure analysis maths (`tests/unit/spike-s1-analysis.test.ts`). No production code was added to `src/`. Three measurement bugs were found and fixed along the way, each with a regression test: (1) the quantum-snapped target must be computed with the engine's own clock accumulation, or every event arrives a whole quantum late; (2) a silent block is only a dropout once the run has produced sound, so the soak's intentional lead-in no longer counts as a failure; (3) the sample-alignment search had a refinement window narrower than one coarse step and could lock in a false peak — it is now an exhaustive sweep over the permitted range. |
| 2026-11-05 | **Session close-out for spike S1.** Recorded the S1 findings that were previously only in the report and ADR into the tracking documents. Added five gaps to `docs/gap-analysis.md` §2 (new "Gaps found by spike S1" table) and cross-referenced them in §1 (summary) and §3 (coverage check): **G-15** engine-clock arithmetic for quantum-snapped scheduling targets (every event would otherwise be 128 frames late), **G-16** low-end-laptop evidence for the S1 performance criterion, **G-17** effects chain (reverb/chorus) on or off for live playback and export, **G-18** export path needs a Standard MIDI File built from the compiled tick timeline, **G-19** non-Windows evidence for the render quantum and timing constants. Added four risks to `docs/implementation.md` §6: RK-11 (wrong floating-point scheduling arithmetic), RK-12 (evidence covers one modern Windows laptop), RK-13 (live playback and export diverge), RK-14 (default effects chain). Added four decision-log entries covering the engine-clock rule, the explicit scoping of the S1 evidence, the effects-chain decision and the export-path dependency. Added G-15…G-19 to §5 open items and linked S1-LOWEND to G-16. §8 review log updated. No code changed; no new verification was required. |
| 2026-11-05 | **Spike S2 (P1.2) — GO for Web MIDI; the p99 exit check is met on Windows and macOS.** Built the measurement harness in `spikes/s2/`: a Worker-driven look-ahead scheduler that sends notes and 24 ppqn MIDI clock with `performance.now()` timestamps derived from `AudioContext.getOutputTimestamp()`, an Electron driver with session MIDI permission handlers, port enumeration, `statechange` capture, minimise/restore and a heavy-UI-load configuration, a loopback capture path that matches received messages to intended sends through the event id, and a native harness for `@julusian/midi` (RtMidi 6.0.0). Added unit and simulated-clock tests (`tests/unit/spike-s2-analysis.test.ts`, `tests/unit/spike-s2-send.test.ts`, `tests/integration/spike-s2-scheduler.test.ts`), the CI workflow `.github/workflows/spike-s2-midi.yml`, the CoreMIDI and loopMIDI loopback helpers, and the ADR `docs/adr/0003-midi-io-approach.md` with the report `docs/spikes/s2-midi-out-report.md`. **End-to-end against a real loopback: p99 jitter 1.10 ms on Windows** (loopMIDI 1.0.16.27) **and 0.10 ms on macOS** (a CoreMIDI virtual destination/source pair), with **0 late sends** over 912 messages in every configuration — idle, minimised window, and heavy UI load with a 300 ms look-ahead — repeated across five CI runs per configuration (19 152 on Windows, 18 240 on macOS). Hot-plug was exercised by removing the loopback port from the OS mid-run: on macOS the port disappeared from the list and two `statechange` events reported it; on **Windows the removal works at the OS level but Chromium keeps listing the port and emits no event** (new gap G-22). No send threw in either case; the send path was extracted into `ResilientMidiSender` so that behaviour is unit-tested. The native candidate, armed with `setTimeout` at the intended instant, was late on **47.4–53.0 % of sends on Windows and 75.4–83.6 % on macOS** across five runs (p99 +14.79 ms on a busy machine); it loads in the Electron main process but **not** in a sandboxed preload (`module not found: @julusian/midi`), and the renderer→main IPC costs p50 0.20 ms / p99 2.1 ms / max 17.4 ms per message. Permission flow verified: MIDI granted to the app origin without a prompt, sysex denied by default. **Not measured:** Linux — the GitHub runners' Azure kernels ship without the ALSA sequencer drivers, so no virtual loopback can be created there (G-20); and no real MIDI hardware was involved (`testing.md` §7). Licence, maintenance and Node-API v7 prebuilds of the native candidate verified and recorded in gap-analysis §4; it stays a dev dependency and never ships. |
| 2026-11-05 | **Session close-out for spike S2.** Ran the S2 CI workflow **five times** on Windows and macOS and aggregated every run instead of reporting a single one, which changed two conclusions. (1) **One Windows run in five** showed a 50.9 ms received outlier: the dispatch records show the app handed that bar to the driver **96.4 ms early**, every clock pulse was dispatched 72–100 ms early, and the *received* MIDI clock stalled by the same 50 ms (largest interval 70.9 ms against a nominal 20.8 ms). The delay is in the loopback driver, not the app; the report and ADR now say so explicitly rather than quoting the best run. (2) The **Windows hot-plug question is answered**: a CI step enumerates the ports outside Electron through RtMidi after the removal and shows the loopMIDI port is gone from the OS — but Chromium's renderer keeps listing it and emits no `statechange` event, because Chromium's `MidiManagerWin::UpdateDeviceListOnTaskRunner()` only re-enumerates on a Windows device-change notification. Recorded as **gap G-22** with a workaround for P6 (re-enumerate on a failed send). The **native candidate's** numbers were aggregated the same way: the late rate is 47.4–53.0 % on Windows and 75.4–83.6 % on macOS across five runs, and the Windows p99 dispatch lateness swung from +1.41 ms to +241.18 ms — so the native path's accuracy depends on how busy the machine is, which is the property the shipping app cannot accept. Added report §5.3.1 (the five-run aggregate), updated the go/no-go table, §8 measurement limits, the ADR's "what the measurements established" and "did not establish" sections, `docs/gap-analysis.md` §1/§2 (G-22)/§8, `docs/testing.md` §7 M-0 and §8, and this tracker's §4 decision log, §5 open items and §7 changelog. The 100 ms look-ahead under load remains rejected (gap G-21); the ≥300 ms requirement stands. |
