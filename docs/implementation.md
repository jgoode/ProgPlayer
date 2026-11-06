# PracticePlayer — Implementation Plan

| | |
|---|---|
| **Status** | Draft v0.1 — for review |
| **Date** | 2026-11-03 |
| **Depends on** | requirements.md (v0.2) |
| **Companion docs** | progress.md, testing.md, gap-analysis.md, agent-prompts.md (to follow) |

This plan turns the requirements into an ordered set of phases. Each phase ends with something runnable and a defined exit check. Requirement IDs (FR-, NFR-, etc.) refer to requirements.md. Items marked **Proposed** are recommendations to confirm in Phase 0 or settle by a spike in Phase 1.

---

## 1. Guiding decisions

| # | Decision | Status |
|---|---|---|
| D1 | Electron + TypeScript (strict mode) with a React UI, bundled by Vite (electron-vite). | Decided (stack); tooling Proposed |
| D2 | **One timeline, many outputs.** The arrangement is compiled once into a tick-based event timeline. The same timeline drives the built-in synth, MIDI out, MIDI file export and audio export. This keeps all outputs consistent and gives tests a single artefact to assert on. | Proposed |
| D3 | The music-theory core and the compiler are pure TypeScript with no DOM, Electron or audio dependencies (NFR-MNT-1). | Decided |
| D4 | Audio and MIDI run in the renderer process (Web Audio, AudioWorklet, Web MIDI). The main process only handles windows, files, settings and OS integration. | Proposed (revisit if spike S2 fails) |
| D5 | Look-ahead scheduling driven by a Web Worker timer, never by UI timers or `requestAnimationFrame`. Notes are stamped with future audio-clock or MIDI timestamps. | Proposed |
| D6 | SoundFont engine: SpessaSynth (`spessasynth_core` 4.4.6 / `spessasynth_lib` 4.4.4), Apache-2.0. Live playback schedules events into the engine's message queue with times snapped to the render-quantum grid and computed with the engine's own clock accumulation; audio export uses the engine's own offline path. | **Decided** — ADR-0002, spike S1 (2026-11-05) |
| D7 | MIDI I/O: Web MIDI first; a native RtMidi-based addon is the fallback. | Proposed, confirmed by spike S2 |
| D8 | WAV export in v1. MP3 depends on the licensing outcome of spike S3. | Proposed |
| D9 | License: MIT. All dependencies and bundled assets must be MIT-compatible (requirements OQ-1, CON-4). | Decided |
| D10 | Decisions with lasting impact are recorded as short ADRs in `docs/adr/`. | Proposed |

## 2. Architecture

### 2.1 Process model

```
┌──────────────────────────── Electron ────────────────────────────┐
│ Main process                                                      │
│  • window lifecycle, menus, power-save blocker during playback    │
│  • file dialogs and file I/O (sessions, presets, exports)         │
│  • settings store, imported SoundFont management                  │
│  • custom protocol for bundled/imported SoundFont bytes           │
└───────────────▲───────────────────────────────────────────────────┘
                │ typed IPC (contextBridge, minimal surface)
┌───────────────┴──────────────── Renderer ─────────────────────────┐
│ React UI  ── Zustand store ── Transport/Scheduler                  │
│                                  │ (timer in Web Worker)           │
│            core (pure TS): theory · arrangement · compiler         │
│                                  │ timeline events                 │
│              ┌───────────────────┼──────────────────────┐          │
│         SynthSink           MidiOutSink            ExportSinks     │
│     (SoundFont engine,     (Web MIDI: ports,     (SMF writer,      │
│      AudioWorklet)          channels, clock)      offline render)  │
└────────────────────────────────────────────────────────────────────┘
```

### 2.2 Repository layout (Proposed)

```
practiceplayer/
  docs/                    requirements, implementation, progress, testing, gap-analysis, adr/
  resources/
    soundfonts/            bundled SoundFonts (+ LICENSES/ with attribution)
    presets/               built-in presets (JSON)
  src/
    core/                  PURE TS — no electron/DOM imports (lint-enforced)
      theory/              pitch, spelling, scales, chords, voicing, chord-scales
      arrangement/         Session, Section, Progression types, validation
      compiler/            arrangement -> timeline (ticks)
      scheduler/           tick<->time maps, look-ahead logic, loop handling (clock-injected)
      formats/             session/preset schemas + migrations, SMF writer, WAV writer
    audio/                 SynthSink, offline renderer, click source, latency helpers
    midi/                  MidiOutSink, port manager, MIDI clock generator
    main/                  Electron main process
    preload/               contextBridge API
    renderer/              React app: components, store, hooks, themes
  tests/
    unit/ integration/ e2e/ fixtures/
```

Import rules (enforced by lint/dependency-cruiser): `core` imports nothing outside `core`; `audio` and `midi` import `core` only; `renderer` imports `core`, `audio`, `midi`; only `preload` touches `ipcRenderer`.

### 2.3 Core data flow

1. **Resolve:** `Session` (tonic, scale type, sections) → concrete chords via the theory module (FR-KEY-3).
2. **Voice:** each chord → voiced notes for the chord part and a root note for the bass part (FR-PLY-2, FR-PLY-3).
3. **Compile:** produce a `Timeline` of events at 480 ticks per quarter note:
   - `noteOn/noteOff {part, channel, pitch, velocity}`
   - `click {accent}`
   - markers: `bar`, `beat`, `chordChange`, `sectionStart`
   - the count-in is compiled as a leading region that is excluded from the arrangement's bar numbering.
4. **Schedule:** the transport walks the timeline in short look-ahead windows (about 100 ms, refilled every 25 ms from a Worker timer) and hands each event to the enabled sinks with a target time.
5. **Sinks:** each sink converts "tick N" to its own clock (audio-clock time, MIDI timestamp, or file position).

### 2.4 Timing design

- **Clocks:** the audio clock (`AudioContext.currentTime`) is the master. `getOutputTimestamp()` maps it to `performance.now()` so MIDI timestamps (which use the `performance.now` time base in Web MIDI) line up with audio.
- **Tempo:** a tempo map (anchor tick, anchor time, microseconds per quarter) converts ticks to seconds. A live tempo change creates a new anchor at the next beat boundary (FR-TMP-2).
- **Loop:** when a window crosses the loop end, the scheduler splits it and continues from the loop start, offsetting times so the join is seamless (acceptance criterion "Loop").
- **Latency alignment:** MIDI sends are delayed by `outputLatency + baseLatency + userOffsetMs` so that internal synth and external MIDI line up (NFR-TIM-3, OQ-10). Click-test helper in settings to calibrate.
- **Background throttling:** the window is created with `backgroundThrottling: false`, the timer lives in a Worker, and `powerSaveBlocker` (`prevent-app-suspension`) is active during playback so minimizing the window does not disturb timing.
- **MIDI clock:** 24 pulses per quarter note scheduled from the same tempo map. Start is sent at the beginning of the count-in; Stop on stop; Continue on resume (Proposed; confirm with testing against two DAWs).
- **Safety:** every stop, pause, loop-region change or device removal sends All Notes Off (CC 123) and All Sound Off (CC 120) per used channel, and flushes pending synth notes (FR-SND-9).

### 2.5 Theory core specifics

- Pitch classes with explicit spelling (letter + accidental), so G♭ major and F♯ major are distinct (FR-KEY-1, FR-CHD-2).
- Scale generation for major, three minors and the seven modes from interval patterns.
- Chord formulas as data (quality → intervals/alterations); parser/formatter for chord names.
- **Voicing:** a small rule set (Proposed): close position in the chord register; choose the inversion with minimal movement from the previous chord; for chords with a 9th or higher, drop the 5th and (over a major third) the 11th unless altered. Bass plays the root in the bass register. A rule table is documented and reviewed by ear in Phase 2.
- **Chord-scale hints:** a data-driven table (chord quality → suggested scale/mode, plus the in-key scale), kept in a JSON file so later iterations can expand it without code changes (OQ-8).
- **Fretboard:** pure function from (chord tones, tuning, fret range) → list of fret positions; standard tuning E A D G B E, default 15 frets (adjustable) (FR-UI-2).

### 2.6 Files and storage

| Item | Location | Format |
|---|---|---|
| Settings (ports, channels, instruments, latency offset, theme, last session) | `userData/settings.json` | JSON + `schemaVersion` |
| User presets | `userData/presets/user-presets.json` | JSON + `schemaVersion` |
| Sessions | user-chosen path, extension `.ppsession` | JSON + `schemaVersion` |
| Imported SoundFonts | `userData/soundfonts/` (copied) | `.sf2` / `.sf3` |
| Bundled SoundFonts and built-in presets | app resources (read-only) | `.sf2`/`.sf3`, JSON |

Schemas are defined once (zod or similar) and used for validation on load, with migration functions per version (FR-IO-1, FR-IO-2, NFR-REL-1).

### 2.7 Security and IPC

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; strict Content-Security-Policy; no remote content (NFR-SEC-1, NFR-PRV-1).
- The preload script exposes a small typed API (open/save dialogs, read/write settings and presets, list/import SoundFonts, write export files). No generic file or IPC access.
- Large SoundFont bytes are served to the renderer through a custom protocol handler rather than through IPC messages, to avoid copying hundreds of MB through the IPC channel.
- Web MIDI permission is granted only to the app's own origin via the session permission handlers.

### 2.8 Proposed tooling

Node LTS, pnpm, electron-vite, React, Zustand (state), Vitest (unit/integration), Playwright for Electron (end-to-end), ESLint + Prettier, electron-builder (packaging), GitHub Actions matrix (Windows, macOS, Ubuntu), Changesets or tag-based releases. Logging to `userData/logs/`.

## 3. Phased plan

Relative size: S ≈ days, M ≈ 1–2 weeks, L ≈ several weeks, for one developer working with an AI agent. Each phase updates progress.md, testing.md and gap-analysis.md.

### Phase 0 — Bootstrap and CI (S)

**Goal:** an empty but properly wired app builds, runs and is tested on all three OSes.

Tasks: create repo, MIT license, README; set up electron-vite + React + strict TypeScript; lint/format; import-boundary rules; Vitest + a first test; Playwright smoke test launching the app; Electron hardening baseline (§2.7); GitHub Actions matrix that builds, lints and tests on Windows, macOS and Linux; ADR template.

Covers: PLT-1, PLT-2, PLT-5, NFR-SEC-1, NFR-MNT-1 (structure).
**Exit:** CI is green on all three OSes; the app window opens on each; import rules fail the build when violated.

### Phase 1 — Technical spikes (M)

Throwaway prototypes in `spikes/`; each ends with an ADR and a go/no-go.

| Spike | Question | Method | Pass criteria |
|---|---|---|---|
| **S1** SoundFont engine | Can SpessaSynth (lead) meet our needs? Compare with a FluidSynth-WASM option if S1 fails. | Load a bundled font; play 3 parts (chords, bass, click) at 200 BPM; test whether note events can be given a future time or must be sent "now"; test offline render via `OfflineAudioContext`; measure CPU, load time, memory; check SF3 (compressed) support to reduce installer size. | Event timing error within one render quantum (128 frames ≈ 2.7 ms at 48 kHz); no dropouts for 10 minutes on a low-end laptop; offline render matches real-time output; license MIT-compatible. If timestamped events are not supported, design a worklet-side event queue, or compile the timeline into the engine's own sequencer. |
| **S2** MIDI out | Is Web MIDI in Electron accurate and reliable on all three OSes? Is a native addon needed? | Send timestamped notes and clock to a loopback (loopMIDI on Windows, IAC on macOS, ALSA virtual port on Linux); capture on a second port; compare against the audio clock; test hot-plug and permission handling; repeat with an RtMidi-based Node addon. | p99 jitter under 5 ms (NFR-TIM-2) on each OS; stable hot-plug; clean permission flow. Record measurement limits (input timestamps are themselves approximate). |
| **S3** MP3 encoding | Which MP3 encoder is license-compatible with MIT and good enough? | Survey JS/WASM encoders; check licences (many are LGPL), bundle-size and speed; test encode of a 5-minute render. | A clearly compatible encoder, or a decision to ship WAV only in v1 and defer MP3. |
| **S4** Packaging | Can we ship several SoundFonts at the target size on all three OSes? | electron-builder on each OS; try SF2 vs SF3; asar unpack; first-launch load time; macOS signing/notarization feasibility; Windows signing options. | Installer within the agreed size budget (OQ-11); sound loads within the NFR-PRF-2 start-up target; signing path identified (OQ-12). |

Also in Phase 1: shortlist SoundFonts for piano, bass, guitar and percussion/click, and verify each licence and attribution requirement (candidates to check include GeneralUser GS and FluidR3 GM, plus dedicated permissive/CC0 piano, bass and guitar fonts).

Covers: FR-SND-1..4, NFR-TIM-1..3, CON-2..6, OQ-9..12.
**Exit:** ADRs for the SoundFont engine, MIDI approach, MP3 decision and packaging; gap-analysis.md updated with the findings.

### Phase 2 — Theory core (M)

Tasks: pitch/spelling; scales (major, three minors, seven modes); chord formulas and name formatting; degree → chord resolution including borrowed/non-diatonic roots (FR-KEY-4); voicing rules (§2.5); chord-scale table; fretboard function; rules for enharmonic keys (OQ-2 default).

Covers: FR-KEY-1..4, FR-CHD-1..3, FR-UI-2/3 (data side), NFR-MNT-1.
**Exit:** golden-table unit tests for all 12 tonics × all scale types and every preset in Appendix A resolve to correct chords and spellings; voicing rules documented with listening notes; coverage threshold met (see testing.md).

### Phase 3 — Arrangement, compiler, presets, file formats (M)

Tasks: Session/Section/Progression types and validation; timing model for bars, beats and compound/odd meters with the OQ-5 groupings; compiler to timeline (chords, bass, click, markers, count-in, loop metadata); built-in preset JSON for the 29 presets in Appendix A; session and preset schemas with `schemaVersion` and migration scaffolding; SMF writer (as it only needs the timeline).

Covers: FR-ARR-1..6, FR-LIB-1/5, FR-TMP-3/4, FR-IO-1, FR-IO-3 (core).
**Exit:** property and golden tests on timelines (note counts, durations, bar boundaries) for all time signatures; round-trip tests for session files; an SMF exported from the timeline parses correctly in a reference parser.

### Phase 4 — Playback engine and walking skeleton (L)

Tasks: tempo map; look-ahead scheduler with injected clock (so it is testable with a simulated clock, NFR-MNT-2); transport (play, pause, resume, stop); count-in; loop (whole, section, bar range); live tempo change; SynthSink using the engine chosen in S1, with one bundled SoundFont; click source; Worker timer; throttling protections; **minimal UI**: key, tempo, a preset picker, play/stop, so the whole path can be heard on all OSes.

Covers: FR-PLY-1..8 (core), FR-TMP-1/2, FR-SND-1/2 (basic), NFR-TIM-1, NFR-PRF-1.
**Exit:** a 3-section arrangement plays correctly on all three OSes; simulated-clock tests prove loop-join and tempo-change correctness; 10-minute soak test at 140 BPM shows no dropouts or drift.

### Phase 5 — Full UI (L)

Tasks: session editor (key/scale selector with enharmonic spellings, tempo, time signature); section list (add/remove/reorder/duplicate/rename); progression editor; chord chart with current/next highlighting and playhead following; mixer (volume/mute per part); loop-region selection on the chart; instrument pickers per part; light/dark themes; keyboard shortcuts; accessibility pass (contrast, non-colour markers, labels, focus order); i18n scaffolding.

Covers: FR-UI-1/4/5/6, FR-ARR-3/4/6, FR-PLY-6/7/8, NFR-A11Y-1, NFR-I18N-1.
**Exit:** all editing and transport actions available by mouse and keyboard; chord chart tracks playback within one beat visually at all supported tempos; accessibility checks pass.

### Phase 6 — MIDI out (M)

Tasks: port discovery, selection, hot-plug handling; channel assignment per part; MidiOutSink with timestamped sends and latency offset; MIDI clock and Start/Stop/Continue; all-notes-off on every stop/pause/device change; per-part routing to synth, MIDI, or both; settings persistence; documentation for Windows loopback drivers and macOS/Linux virtual ports; latency calibration helper.

Covers: FR-SND-4..9, NFR-TIM-2/3, NFR-REL-2.
**Exit:** acceptance "MIDI" test passes on all three OSes against a DAW or a MIDI monitor; clock verified against two DAWs; unplugging a device mid-play does not crash or hang notes.

### Phase 7 — Fretboard and scale hints (S–M)

Tasks: fretboard component fed by the theory module (root highlighted, non-colour marker for the root); scale/mode hint panel for current and next chord with scale notes; chord-scale table review; display of in-key scale alongside the quality-based suggestion for non-diatonic chords.

Covers: FR-UI-2, FR-UI-3.
**Exit:** all 29 presets in all 12 keys show correct tones and sensible hints; hint table documented as the extension point for later iterations.

### Phase 8 — Persistence and presets UI (M)

Tasks: save/load sessions; recent files; user presets (create, edit, rename, delete, duplicate built-ins); restore settings on startup with graceful fallback for missing ports or SoundFonts; SoundFont import and selection UI; corrupt-file handling with clear messages.

Covers: FR-LIB-2..5, FR-IO-1/2, FR-SND-3, NFR-REL-1.
**Exit:** acceptance "Persistence" passes; fuzzed/corrupt session and preset files never crash the app.

### Phase 9 — Export (M)

Tasks: MIDI export UI and options (click, count-in, repeats); WAV export via offline rendering with progress and cancel; MP3 export if S3 cleared it; clear UI messaging that external-MIDI output cannot be exported as audio (FR-IO-5).

Covers: FR-IO-3..5.
**Exit:** acceptance "Export" passes; exported MIDI opens correctly in a DAW; exported WAV length matches within one buffer; real-time and offline renders sound the same.

### Phase 10 — Packaging, cross-platform QA, release (M)

Tasks: installers for all three OSes; signing and notarization as decided in S4; licence and attribution screen (SoundFonts, dependencies); user guide and quick start; known-issues list; full cross-platform test pass using testing.md; performance and soak checks; v1.0 release notes.

Covers: PLT-3/4, NFR-PRF-1/2, NFR-QLT-1, CON-4..6.
**Exit:** clean-machine installs on each OS pass the "Packaging" acceptance criterion; all open gap-analysis items rated blocker are closed.

## 4. Requirement coverage

| Requirement group | Phase(s) |
|---|---|
| PLT-* | 0, 10 |
| FR-KEY, FR-CHD | 2 |
| FR-LIB | 3 (data), 8 (UI) |
| FR-ARR, FR-TMP | 3, 4, 5 |
| FR-PLY | 4, 5 |
| FR-SND | 1 (spikes), 4 (synth), 6 (MIDI), 8 (import) |
| FR-UI | 5, 7 |
| FR-IO | 3 (formats), 8 (sessions), 9 (export) |
| NFR-TIM, NFR-PRF | 1, 4, 6, 10 |
| NFR-REL, NFR-SEC, NFR-PRV | 0, 6, 8 |
| NFR-A11Y, NFR-I18N | 5 |
| NFR-MNT | 0, 2, 4 |

## 5. Cross-cutting practices

- **Definition of done (every task):** typed and linted; unit tests; passes the CI matrix; user-visible behaviour documented; requirement IDs referenced in the commit/PR; progress.md updated.
- **ADRs:** one short file per decision (context, options, decision, consequences) in `docs/adr/`.
- **Feature flags:** MP3 export and any experimental sink sit behind flags until their exit criteria pass.
- **Error handling:** typed errors from the core; user-facing messages produced in the renderer; all unexpected errors logged to `userData/logs/`.
- **Security and dependency hygiene:** lockfile committed; automated dependency and licence audit in CI to enforce CON-4.
- **Performance budget:** CPU and memory targets recorded in testing.md after Phase 1 measurements, then enforced by the soak test.

## 6. Risks and mitigations

| ID | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| RK-1 | The chosen SoundFont engine cannot accept future-timed events | **Closed** - measured in S1 | **Resolved 2026-11-05.** SpessaSynth accepts future-timed events directly: 128 frames worst case, 0 frames when the target is snapped to the render-quantum grid. ADR-0002 mandates the snap and requires the snapped target to be computed with the engine's own clock accumulation, or every event arrives a whole quantum late. No worklet-side event queue and no use of the engine's sequencer is needed for live playback. |
| RK-2 | Web MIDI timing or permissions are unreliable on one OS | **Low / Low** - measured on Windows and macOS; **one Windows hot-plug caveat remains (G-22)** | **Reduced 2026-11-05, then measured.** ADR-0003 adopts Web MIDI in the renderer. The permission flow is verified (MIDI granted to the app's own origin by the session handlers, sysex denied by default). The end-to-end loopback measurement gives a **p99 jitter of 1.10 ms on Windows** (loopMIDI; 1.10–50.00 ms across the five runs, one driver stall) **and 0.10 ms on macOS** (a CoreMIDI virtual endpoint), with **0 late sends** across 19 152 sends on Windows and 18 240 on macOS in every configuration — idle, minimised window, and heavy UI load with a 300 ms look-ahead — repeated across five CI runs per configuration. Chromium converts the Web MIDI timestamp to `base::TimeTicks` and every backend (WinMM, WinRT, CoreMIDI, ALSA) hands the message to the driver with that timestamp, so the driver does the waiting. The native RtMidi fallback was evaluated and **not** adopted: it has no timestamped send (**47.4-53.0 % of its sends on Windows and 75.4-83.6 % on macOS were late**; p99 +14.79 ms on a busy machine), cannot load in a sandboxed preload and needs an IPC hop per message. **Hot-plug was exercised by removing the loopback port mid-run:** on macOS the port disappeared from the list and a `statechange` event reported it; on **Windows the removal works at the OS level but Chromium keeps listing the port and emits no event**, because Chromium's WinMM backend only re-enumerates on a Windows device-change notification — **gap G-22**, so P6 must re-enumerate the ports on a failed send rather than rely on `statechange`. **Residual risk:** the Linux end-to-end p99 is unmeasured (the CI runners' kernels have no ALSA sequencer) and no real MIDI hardware was involved - gap G-20 and the device checks in `testing.md` §7. |
| RK-3 | Windows has no virtual MIDI ports | Certain / Medium | Document loopback drivers (FR-SND-8); built-in synth works without any setup. **Documented in `docs/spikes/s2-midi-out-report.md` §9:** loopMIDI (freeware, link to the vendor) and the in-box Windows MIDI Services "MIDI 2.0 Loop Devices" on Windows 11 24H2/25H2; the OS's own IAC Driver on macOS; ALSA `snd-virmidi` on Linux. |
| RK-4 | SoundFont licences or size block bundling | **Reduced** - engine licence verified in S1; font licences still open | The *engine* is Apache-2.0 and MIT-compatible (ADR-0002). SF3 is confirmed as the shipping format: 3.5× smaller on disk, 3–4× faster to parse, 3× less resident memory than SF2. The remaining risk is the *font* licences (G-11): the measurement fixture is not suitable for redistribution, so P1.5 must shortlist fonts with clear provenance; fewer or smaller fonts and optional download of extra fonts remain the fallback. |
| RK-5 | MP3 encoder licensing conflicts with MIT | Medium / Low | Spike S3; ship WAV first |
| RK-6 | Timer throttling or power-saving affects timing when minimized | Medium / High | Worker timer, `backgroundThrottling: false`, `powerSaveBlocker`; soak tests with the window minimized |
| RK-7 | Audio stack differences on Linux (PulseAudio/PipeWire/ALSA) | Medium / Medium | Test on at least two distributions in CI/manual QA; document known issues |
| RK-8 | Music-theory errors (spelling, modes, voicing) | Medium / Medium | Golden-table tests for every key/scale/preset; review by a musician; keep chord/hint tables as data |
| RK-9 | Signing/notarization delays release | Medium / Medium | Decide in S4; requires an Apple Developer account for macOS notarization; unsigned builds documented as interim |
| RK-10 | Scope creep (VST hosting, audio clips, style engines) | High / Medium | Keep to requirements §2.2 and §9; changes go through gap-analysis.md |
| RK-11 | The scheduling target is computed with the wrong floating-point arithmetic, so every note is dispatched a whole quantum late | **Medium / High** - the error is uniform and within the one-quantum budget, so a coarse test passes | Found and measured in S1 (128.00 frames against 0.00). The engine's clock must be replicated exactly: `currentTime` advanced by `quantumFrames * (1 / sampleRate)` once per quantum, accumulating the rounding error. ADR-0002 §2 and gap G-15; the helper `engineClockAfterQuanta` and its regression test are the reference. Keep the arithmetic in one helper, never at a call site. |
| RK-12 | The performance evidence covers one modern Windows laptop, so the low-end and non-Windows budgets rest on inference | **Medium / Medium** | S1 measured 0 dropouts over 60 011 blocks in 10 minutes at 9.28 % average process-tree CPU on a Core 5 120U. Gaps G-16 and G-19 track the outstanding evidence: repeat the driver on the oldest machine in the support matrix and on macOS and Linux (PulseAudio and PipeWire), and record the actual render quantum per platform — a different quantum size changes the snapping arithmetic. |
| RK-13 | Live playback and audio export diverge because one path uses the engine's sequencer and the other the scheduler | **Medium / Medium** | The library's offline path is bit-identical to its real-time output but plays a MIDI sequence, so the export path needs an SMF built from the compiled tick timeline (the P3 writer). Gap G-18. If the writer slips, the documented fallback renders the live path into an `OfflineAudioContext` with the same scheduler, giving up bit-identity but keeping one timeline (D2). |
| RK-14 | The engine's default reverb and chorus make live playback and exported audio sound different from what users expect | **Medium / Medium** | Measured in S1 with effects on; the dry signal differs by −42.6 dB. Gap G-17: decide in P4 whether effects apply to live playback and export and make the two paths agree. If a dry signal is chosen, disable effects in both paths and re-measure — the S1 effects-on figures do not carry over. |
| RK-15 | The MIDI driver stalls and delivers a batch of messages late, which the app cannot prevent | **Medium / Medium** - measured once in five CI runs, under load | One Windows CI run in five had the loopback driver deliver a whole bar **51 ms late** while the app had dispatched it **96.4 ms early**; the received MIDI clock stalled by the same 50 ms in the same window. The app's dispatch was inside the look-ahead window in every run, so the app was not the cause. A real MIDI interface can stall the same way. **Mitigation:** the app dispatches every message early (the ≥300 ms look-ahead, gap G-21) so a driver stall absorbs into the slack rather than adding to it; the app cannot add latency to cover a stall, so the user guide should tell users that a busy or badly-behaved driver can drop or delay messages. **Verification:** the device checks in `testing.md` §7 (M-1..M-4) with real hardware. |

## 7. Next documents

- **progress.md** — phase and task tracker generated from this plan (status, owner, dates, blockers).
- **testing.md** — test strategy by layer (unit, simulated-clock integration, cross-platform manual audio/MIDI checks, end-to-end, soak), the acceptance tests from requirements §11, and performance budgets.
- **gap-analysis.md** — requirement-by-requirement gaps, spike outcomes, deferred items and licence status.
- **agent-prompts.md** — one self-contained prompt per phase/task for an AI coding agent, each with context, constraints, requirement IDs and exit checks.
