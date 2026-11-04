# PracticePlayer — AI Agent Prompts

| | |
|---|---|
| **Status** | Draft v0.1 — for review |
| **Date** | 2026-11-03 |
| **Depends on** | requirements.md (v0.2), implementation.md (v0.1), progress.md, testing.md, gap-analysis.md |

## How to use this file

1. Start every agent session with the **Shared preamble** (§1), then paste **one** task prompt (§3–§5). Keep one phase or spike per session so the agent's context stays focused.
2. Run phases in the order in implementation.md. P1 spikes can run in parallel with P2 (theory) because they are independent; everything else follows the dependency table in testing.md §12.
3. Before accepting a session's work, check the **Exit check** against the repo, run CI, and confirm progress.md was updated.
4. If an agent hits an open gap (G-xx), it must stop and ask rather than guess; once resolved, copy the decision into gap-analysis.md and progress.md.
5. Prompts reference documents by path. The agent must read the files named under "Read first"; do not paste the full docs into the prompt.

---

## 1. Shared preamble (paste at the start of every session)

```
You are a senior TypeScript/Electron engineer working on PracticePlayer, an open-source (MIT)
cross-platform desktop app (Windows, macOS, Linux) that plays chord progressions in a chosen key
at a chosen tempo as a practice/improvisation backing track. It uses a built-in SoundFont synth
and MIDI out (separate channels for chords, bass, click; MIDI clock).

Source of truth (in the repo's docs/ folder): requirements.md, implementation.md, progress.md,
testing.md, gap-analysis.md. Requirement IDs (FR-*, NFR-*, PLT-*, CON-*) are defined in
requirements.md. Task IDs (P0.1 ...) are in progress.md.

Rules:
1. Read the files listed under "Read first" before writing code. Do not invent requirements; if
   something is unspecified or conflicts with the docs, STOP and ask, naming the gap ID (G-xx) if
   one exists.
2. Architecture constraints (implementation.md §1-2): TypeScript strict; src/core is pure TS with
   no Electron/DOM/audio imports; audio and MIDI run in the renderer; main process handles
   windows, files, settings; renderer has no direct fs or Node access; contextIsolation on,
   sandbox on, nodeIntegration off, minimal typed preload API; no network calls.
3. One timeline, many outputs: the arrangement compiles to a tick-based timeline (480 ticks per
   quarter) that drives the synth, MIDI out, MIDI export and audio export. Scheduling uses a
   Worker timer with look-ahead; never UI timers or requestAnimationFrame for note timing.
4. Licensing: every dependency and asset must be MIT-compatible. Before adding a runtime
   dependency, state its licence and add it to the register in gap-analysis.md §4.
5. Testing: write tests with the code (testing.md). Pure logic gets unit tests; scheduler logic
   gets simulated-clock tests; fix every bug with a regression test at the lowest possible layer.
6. Work in small, reviewable commits that reference requirement and task IDs.
7. Definition of done: typed, linted, tests pass, runs on the CI matrix (Windows, macOS, Ubuntu),
   behaviour documented, progress.md updated (tick tasks, status, decisions, changelog).
8. Never claim something works unless you ran it. Report what you ran and what you could not run
   (for example, real audio or MIDI hardware) so a human can do the device checks in testing.md §7.
9. At the end of the session output: what changed, how to run/test it, what is unverified, open
   questions, and the exact progress.md edits you made.
```

## 2. Prompt template (for new tasks, bug fixes and follow-ups)

```
[Shared preamble]

TASK: <one sentence>
Read first: <docs/sections>
Context: <what exists in the repo now>
Requirements: <IDs>
Deliverables: <files/behaviour>
Constraints: <extra constraints, gap decisions already made>
Tests: <what must be added>
Exit check: <observable pass criteria>
Out of scope: <what not to touch>
```

**Bug-fix variant.** Add: steps to reproduce, expected versus actual, platform, severity (testing.md §10). Require a failing regression test first, then the fix.

**Gap-closure variant.** Provide the decision for a G-xx item; ask the agent to update requirements.md/implementation.md wording, tests and gap-analysis.md status only, with no feature code.

---

## 3. Phase 0 — Bootstrap and CI

```
TASK: Bootstrap the PracticePlayer repository (Phase 0, tasks P0.1-P0.9).
Read first: implementation.md §1-2 and §3 Phase 0; testing.md §2, §10, §11; gap-analysis.md §4.
Requirements: PLT-1, PLT-2, PLT-5, NFR-SEC-1, NFR-MNT-1 (structure).
Deliverables:
- Repo with MIT LICENSE, README (what the app is, how to run/test), CONTRIBUTING notes.
- electron-vite + React + strict TypeScript app that opens a window showing "PracticePlayer".
- Folder layout from implementation.md §2.2 (src/core, src/audio, src/midi, src/main,
  src/preload, src/renderer, tests/, resources/, docs/ including docs/adr/ and an ADR template).
- ESLint + Prettier; import-boundary rules (core imports nothing outside core; audio/midi import
  core only; only preload touches ipcRenderer). A deliberate violation must fail the lint.
- Electron hardening baseline: contextIsolation, sandbox, nodeIntegration off, CSP, minimal
  typed preload API with one example call, backgroundThrottling disabled.
- Vitest with one passing test per layer folder; Playwright-for-Electron smoke test that launches
  the app and checks the window title.
- GitHub Actions: matrix (windows-latest, macos-latest, ubuntu-latest) running install, lint,
  type-check, unit tests, smoke test, and a dependency+licence audit step.
Constraints: pnpm; Node LTS; no audio or MIDI code yet.
Exit check: CI green on all three OSes; app window opens on each; boundary rules demonstrably
fail on a deliberate violation (add that as a documented test, then remove the violation).
Out of scope: any feature code.
```

## 4. Phase 1 — Technical spikes

Run each spike as its own session. Spike code lives in `spikes/<name>/` and is throwaway; the outputs are measurements, an ADR in `docs/adr/` and an update to gap-analysis.md §4–§5 and progress.md §3.

### Spike S1 — SoundFont engine

```
TASK: Spike S1 — evaluate SpessaSynth (spessasynth_lib / spessasynth_core) as the built-in
SoundFont engine inside Electron's renderer.
Read first: implementation.md §2.3-2.4 and Phase 1 table (S1); requirements FR-SND-1..3,
NFR-TIM-1, NFR-PRF-1/2; gap-analysis.md RK-1, G-11, G-14.
Questions to answer with evidence:
1. Can notes be scheduled at a future audio time with error within one render quantum (128
   frames)? If not, can we add a worklet-side event queue, or must we use the engine's own
   sequencer driven from our compiled timeline?
2. CPU, memory and load time with a ~30-50 MB SoundFont, three parts (chords, bass, click) at
   200 BPM with extended chords (7+ notes) for 10 minutes. Compare SF2 vs SF3.
3. Does OfflineAudioContext (or the library's offline rendering) produce output equivalent to
   real-time playback? Same timing and level?
4. Licence of the exact version tested (state it); anything incompatible with MIT distribution?
Deliverables: a runnable spike page/app, a measurement report (tables, method, machine specs,
OS), ADR "SoundFont engine" with decision and fallback, updates to gap-analysis.md §4-§5.
Constraints: no production code in src/ except if the ADR proposes an interface to add.
Exit check: written go/no-go with numbers against the pass criteria in implementation.md.
```

### Spike S2 — MIDI out

```
TASK: Spike S2 — measure Web MIDI output accuracy and reliability in Electron on Windows,
macOS and Linux, and compare with a native RtMidi-based Node addon.
Read first: implementation.md §2.4 and Phase 1 table (S2); requirements FR-SND-4..9,
NFR-TIM-2/3, NFR-REL-2; gap-analysis.md RK-2, RK-3, G-03, G-04; testing.md §7-§8.
Do:
- Implement a sender that schedules notes and MIDI clock (24 ppqn) with timestamps from a
  Worker-driven look-ahead loop; map audio-clock time to performance.now via getOutputTimestamp.
- Measure jitter by looping back to a second port (loopMIDI on Windows, IAC on macOS, ALSA virtual
  on Linux) and comparing received timestamps to intended ones; report p50/p95/p99/max and note
  measurement limits.
- Test permission handling in Electron (session permission handlers), device enumeration,
  hot-plug, and behaviour with the window minimized.
- Repeat with a native addon candidate; verify its licence, maintenance and prebuilt binaries.
Deliverables: spike code, measurement report per OS, ADR "MIDI I/O approach", updated
gap-analysis.md, notes on what must be documented for users (Windows loopback driver).
Exit check: go/no-go against "p99 jitter under 5 ms on each OS" with data.
```

### Spike S3 — MP3 encoder

```
TASK: Spike S3 — find an MP3 encoder option compatible with an MIT-licensed Electron app.
Read first: requirements FR-IO-4, OQ-9; gap-analysis.md G-12 and §4.
Do: survey JS/WASM MP3 encoders (licence, maintenance, size, speed, quality at 128-192 kbps);
encode a 5-minute stereo 44.1/48 kHz render; compare file sizes and encode time; analyse the
licence consequences of bundling (MIT app, LGPL or other component).
Deliverables: comparison table, recommendation, ADR "MP3 export" (including the option "ship WAV
only in v1.0"), updates to gap-analysis.md.
Exit check: a clear decision with licence reasoning; no encoder added to src/ in this task.
```

### Spike S4 — Packaging and SoundFont assets

```
TASK: Spike S4 — prove packaging with large assets on all three OSes and shortlist SoundFonts.
Read first: implementation.md Phase 1 table (S4) and tasks P1.4/P1.5; requirements FR-SND-2,
PLT-3, NFR-PRF-2, CON-4..6, OQ-11/12; gap-analysis.md G-11, G-13.
Do:
- Package a trivial Electron app with electron-builder for Windows (installer), macOS (dmg;
  arm64 + x64) and Linux (AppImage + deb) in CI; bundle a large sample asset via asarUnpack or
  extraResources; serve it to the renderer through a custom protocol handler.
- Measure installer size and first-launch load time.
- Investigate macOS notarization and Windows signing options and costs; document the interim
  unsigned-install instructions.
- Shortlist SoundFonts for piano, bass, guitar and percussion/click. For each record author,
  licence text, source URL, redistribution and attribution terms, size (SF2 and SF3), quality
  notes. Reject any font whose licence is not compatible with MIT distribution.
Deliverables: CI packaging workflow, measurements, SoundFont shortlist table, ADR "Packaging and
assets", updates to gap-analysis.md (G-11, G-13, §4).
Exit check: installers produced on all three OSes; size budget recommendation (OQ-11); signing path
(OQ-12).
```

## 5. Phases 2–10

### Phase 2 — Theory core

```
TASK: Implement the music-theory core in src/core/theory (Phase 2, tasks P2.1-P2.9).
Read first: requirements §5.1 (FR-KEY, FR-CHD), Appendix A, Assumption A5, OQ-2/OQ-6;
implementation.md §2.5 and Phase 2; testing.md §4.1; gap-analysis.md G-01, G-09, G-10.
Prerequisite: G-01 resolved (preset chords fixed relative to tonic with explicit qualities; scale
type drives suggestions/hints). If not recorded as closed, stop and ask.
Deliverables (pure TypeScript, no UI/audio imports):
- Pitch classes with spelling (letter + accidental), enharmonic key handling.
- Scale generation: major, natural/harmonic/melodic minor, seven modes, all 12 tonics.
- Chord formulas for every quality in FR-CHD-1; name parser and formatter (round-trip).
- Degree-to-chord resolution including borrowed/non-diatonic roots.
- Voicing: close position in a documented register, minimal movement between chords, extension
  rules (drop 5th with 9th+, 11th over major thirds unless altered), bass root in the bass
  register. Keep rules table-driven and documented in docs/voicing-rules.md.
- Chord-scale hint table as a JSON data file (chord quality -> scale/mode), plus a function
  returning both the in-key scale and the quality-based suggestion.
- Fretboard position function (standard tuning, configurable fret range).
Tests: golden tables for 12 tonics x all scale types; every Appendix A preset in all 12 keys;
voicing invariants; chord-name round trips; an independent oracle used only as a dev dependency.
Exit check: all tests green on the CI matrix; core coverage at or above the testing.md threshold;
list of voicing questions for a musician's listening review (M-7).
Out of scope: UI, audio, file formats.
```

### Phase 3 — Arrangement, compiler, presets, formats

```
TASK: Implement arrangement model, timeline compiler, built-in presets, file formats and the
SMF writer (Phase 3, tasks P3.1-P3.7).
Read first: requirements §5.2-5.4, §5.8 (FR-IO-1, FR-IO-3), §7, Appendix A; implementation.md §2.3,
§2.6 and Phase 3; testing.md §4.2-4.3; gap-analysis.md G-05, G-06, G-07.
Decisions required first (stop and ask if open): G-05 click pattern, G-06 sub-bar chord splits.
Deliverables:
- Types and validation for Session, Section, Progression, ChordSlot (durations in beats).
- Bar/beat model for 4/4, 3/4, 6/8, 5/4, 7/8 with OQ-5 groupings.
- Timeline compiler at 480 ticks per quarter: noteOn/noteOff per part and channel, click events
  with accents, markers (bar, beat, chordChange, sectionStart), count-in region before tick 0,
  repeat unrolling and global bar numbering (G-07).
- The 29 built-in presets from Appendix A as JSON resources, each with name, category, home
  scale type and degree/quality/duration data.
- Session and preset JSON schemas with schemaVersion, validation with precise error messages,
  and a migration scaffold.
- Standard MIDI File writer producing tempo/time-signature meta events and separate tracks.
Tests: property-based timeline invariants; golden timelines (single-section loop, 3-section
arrangement, 7/8 arrangement); session save/load round trip; SMF parses in a reference parser.
Exit check: tests green on all three OSes; SMF round-trip passes.
Out of scope: playback, UI.
```

### Phase 4 — Playback engine and walking skeleton

```
TASK: Implement the scheduler, transport, built-in synth playback and a minimal UI so a chosen
preset can be heard on all three OSes (Phase 4, tasks P4.1-P4.10).
Read first: implementation.md §2.3-2.4 and Phase 4; the S1 ADR; requirements §5.5 (FR-PLY),
FR-TMP-1/2, FR-SND-1/2, NFR-TIM-1; testing.md §4.4-4.5, §8; gap-analysis.md G-02, G-07, G-08, G-14.
Prerequisites: Phase 1 S1 ADR and Phase 3 complete; decisions for G-02 (count-in/resume), G-07
(loop region definition) recorded.
Deliverables:
- Tempo map (tick <-> time) with live tempo change applied at the next beat.
- Look-ahead scheduler with injected clock and sinks; Worker-based timer; loop windows split at
  the loop boundary so the join is seamless.
- Transport: play, pause, resume, stop; count-in; loop (whole arrangement, section, bar range).
- SynthSink using the engine selected in S1; one bundled SoundFont (licence verified); click
  source; all-notes-off on stop/pause.
- Window created with backgroundThrottling disabled; powerSaveBlocker active only during playback.
- Minimal UI: key and scale selector, tempo, preset picker, play/stop, current bar/beat readout.
Tests: simulated-clock tests for every scenario in testing.md §4.4; recording-sink tests; a
10-minute soak harness; report late-event metric.
Exit check: AT-1 and AT-4 pass manually with the minimal UI on all OSes; soak run has no dropouts
or drift; scheduler metrics recorded.
Out of scope: full UI, MIDI out, export.
```

### Phase 5 — Full UI

```
TASK: Build the full editing and playback UI (Phase 5, tasks P5.1-P5.10).
Read first: requirements §5.3, §5.5, §5.7 (FR-UI-1/4/5/6), NFR-A11Y-1, NFR-I18N-1;
implementation.md Phase 5; testing.md §4.6; gap-analysis.md G-08.
Prerequisite: G-08 (live edits during playback) decided.
Deliverables:
- Session editor: key/scale selector with enharmonic spelling, tempo, time signature.
- Section list with add, remove, reorder, duplicate, rename; progression editor with sub-bar
  durations limited to valid splits (G-06).
- Chord chart: bar grid, section boundaries, current and next chord (non-colour marker), follows
  the playhead; mouse and keyboard selection of loop regions.
- Mixer: volume and mute per part; instrument pickers per part.
- Light/dark/OS themes; keyboard shortcuts (documented); i18n scaffolding with externalised
  strings (English only).
Tests: component tests, keyboard-only flow tests, contrast/accessibility checks, Playwright
scenario that builds an arrangement and plays it.
Exit check: every action reachable by keyboard; chart tracks playback within one beat at all
tempos; accessibility checks pass; screenshots for light and dark themes added to docs.
Out of scope: MIDI out, fretboard, export, saved presets.
```

### Phase 6 — MIDI out

```
TASK: Implement MIDI output, clock sync and routing (Phase 6, tasks P6.1-P6.8).
Read first: requirements §5.6 (FR-SND-4..9); implementation.md §2.4 and Phase 6; the S2 ADR;
testing.md §4.5, §7 (M-1..M-4); gap-analysis.md G-03, G-04, RK-2, RK-3.
Prerequisite: G-03 (Start/clock semantics) and G-04 (program change) decided.
Deliverables:
- Port discovery, selection, hot-plug handling; clear messages when a port disappears.
- Channel assignment per part (defaults chords 1, bass 2, click 10).
- MidiOutSink with timestamped sends and a user latency offset; per-part routing to synth, MIDI,
  or both.
- MIDI clock (24 ppqn) with Start/Stop/Continue per the decision; all-notes-off and all-sound-off
  on stop, pause, loop-region change and device change.
- Latency calibration helper; settings persisted.
- User documentation for Windows loopback drivers and macOS/Linux virtual ports.
Tests: fake-port unit tests (byte-exact messages, clock spacing, timestamps); scripted manual
procedures M-1..M-4 results recorded in docs/test-runs/.
Exit check: AT-5 passes on all three OSes; clock verified against two DAWs; device removal does
not crash or leave hanging notes.
Out of scope: export, new UI beyond MIDI settings.
```

### Phase 7 — Fretboard and scale hints

```
TASK: Add the guitar fretboard and scale/mode hint displays (Phase 7, tasks P7.1-P7.4).
Read first: requirements FR-UI-2/3, OQ-7/OQ-8; implementation.md §2.5 and Phase 7; testing.md §4.1,
§4.6.
Deliverables:
- Fretboard component using the Phase 2 position function: root with a non-colour marker, chord
  tones for the current chord, optional preview of the next chord.
- Scale/mode hint panel for current and next chord: in-key scale, quality-based suggestion for
  chords outside the key, scale notes listed.
- Documentation of the hint data table as the extension point for later iterations.
Tests: component tests for all 29 presets in all 12 keys (tones and hints correct); accessibility
checks.
Exit check: tones and hints verified against golden data; hints reviewed by a musician.
Out of scope: fingered shapes, other instruments.
```

### Phase 8 — Persistence and presets UI

```
TASK: Implement saving, loading, user presets, settings restore and SoundFont import (Phase 8,
tasks P8.1-P8.5).
Read first: requirements §5.2 (FR-LIB-2..5), §5.6 (FR-SND-3), §5.8 (FR-IO-1/2), NFR-REL-1;
implementation.md §2.6-2.7 and Phase 8; testing.md §4.3, AT-7.
Deliverables:
- Save/load sessions (.ppsession) via main-process dialogs; recent files.
- User presets: create from the current progression, edit, rename, delete; duplicate built-ins;
  stored in userData with schemaVersion and migrations.
- Settings restore on startup with graceful fallback when ports or SoundFonts are missing.
- SoundFont import (copy into userData/soundfonts) and selection UI; clear licence reminder.
- Corrupt/unknown-version file handling with specific, user-friendly messages.
Tests: round-trip tests, fixtures for missing assets and corrupt files, fuzz test over file
mutations, Playwright save/restart/load scenario.
Exit check: AT-7 passes on all OSes; fuzzing never produces an uncaught exception.
Out of scope: export.
```

### Phase 9 — Export

```
TASK: Implement MIDI and audio export (Phase 9, tasks P9.1-P9.4).
Read first: requirements §5.8 (FR-IO-3..5); implementation.md Phase 9; the S3 ADR; testing.md
§4.3, AT-6.
Deliverables:
- MIDI export dialog with options: include click, include count-in, repeats; uses the Phase 3
  timeline and SMF writer.
- WAV export via offline rendering using the S1-selected engine: progress, cancel, 16/24-bit
  options, 44.1/48 kHz; length matches the arrangement to within one buffer.
- MP3 export only if S3 cleared a compatible encoder; otherwise a feature flag stays off and the
  UI shows WAV only.
- Clear UI text that audio from external MIDI instruments cannot be captured (FR-IO-5).
Tests: SMF and WAV structural tests; offline-versus-real-time comparison (length, RMS envelope);
e2e export scenario.
Exit check: AT-6 passes on all OSes; MIDI file opens in a DAW with correct tempo, time signature
and notes.
Out of scope: new sound sources.
```

### Phase 10 — Packaging, QA and release

```
TASK: Produce release candidates and complete cross-platform QA (Phase 10, tasks P10.1-P10.7).
Read first: implementation.md Phase 10; requirements §4 (PLT), §8 (CON), §11; the S4 ADR;
testing.md §5, §7, §10; gap-analysis.md §4, G-13.
Deliverables:
- Installers for Windows, macOS (signed and notarized if decided in S4), and Linux, produced by CI.
- Licences/attributions screen generated from the register in gap-analysis.md §4 (SoundFonts,
  dependencies, Apache-2.0 NOTICE entries).
- User guide and quick start (installing, choosing a key and preset, MIDI setup per OS, export).
- Full run of AT-1...AT-8 and manual procedures M-1...M-7 on all OSes; results in docs/test-runs/.
- Known-issues list and v1.0 release notes; the requirement-level traceability matrix.
Exit check: AT-8 passes on clean machines; no open S1/S2 defects; no open gaps rated Blocker;
all licence register rows Verified.
Out of scope: new features (log them in gap-analysis.md §6).
```

---

## 6. Session handoff prompt (end of any session)

```
Summarise the state of the repo for the next session in this exact structure:
1. What was completed (task IDs).
2. What is partially done and where (files/branches).
3. Decisions made and why (add to progress.md decision log).
4. Gaps/risks discovered (add to gap-analysis.md with IDs).
5. Commands to build, run and test.
6. What could not be verified without real devices (reference testing.md §7 procedure IDs).
7. The next recommended task.
Then apply items 3-4 to the docs and update progress.md checkboxes and changelog.
```
