# PracticePlayer — Progress Tracker

| | |
|---|---|
| **Last updated** | 2026-11-03 |
| **Current phase** | Planning complete — awaiting review before Phase 0 |
| **Plan of record** | implementation.md v0.1, requirements.md v0.2 |

**How to use this file.** Update it at the end of every working session (human or AI agent). Tick tasks, change phase status, log decisions and blockers, and add one line to the changelog. Task IDs (e.g. `P2.3`) are referenced from agent-prompts.md and commit messages.

**Status values:** `Not started` · `In progress` · `Blocked` · `Done` · `Dropped`

---

## 1. Dashboard

| Phase | Name | Size | Status | Exit check met? |
|---|---|---|---|---|
| P0 | Bootstrap and CI | S | Not started | No |
| P1 | Technical spikes | M | Not started | No |
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
| progress.md | 0.1 | This file |
| testing.md | 0.1 | Drafted; awaiting review |
| gap-analysis.md | 0.1 | Drafted; awaiting review |
| agent-prompts.md | 0.1 | Drafted; awaiting review |

## 2. Task checklists

### P0 — Bootstrap and CI
- [ ] P0.1 Create repo, MIT license, README, contribution notes
- [ ] P0.2 electron-vite + React + strict TypeScript scaffold
- [ ] P0.3 ESLint/Prettier; import-boundary rules (`core` isolation)
- [ ] P0.4 Vitest set up with a first passing test
- [ ] P0.5 Electron hardening baseline (context isolation, sandbox, CSP, minimal preload)
- [ ] P0.6 Playwright smoke test that launches the app
- [ ] P0.7 GitHub Actions matrix (Windows, macOS, Ubuntu): build, lint, test
- [ ] P0.8 ADR template and `docs/adr/` folder
- [ ] P0.9 Dependency and licence audit step in CI
- **Exit:** CI green on all three OSes; window opens on each; boundary rules fail the build when violated.

### P1 — Technical spikes
- [ ] P1.1 Spike S1: SoundFont engine (scheduled events, CPU, offline render, SF3)
- [ ] P1.2 Spike S2: MIDI out (Web MIDI vs native; jitter on each OS; hot-plug; permissions)
- [ ] P1.3 Spike S3: MP3 encoder licensing and quality
- [ ] P1.4 Spike S4: packaging, installer size, signing feasibility
- [ ] P1.5 SoundFont shortlist and licence verification (piano, bass, guitar, percussion/click)
- [ ] P1.6 ADRs written for S1–S4; gap-analysis.md updated
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
- [ ] P3.6 Standard MIDI File writer
- [ ] P3.7 Timeline golden/property tests; SMF round-trip test
- **Exit:** timeline tests green for all time signatures; SMF parses in a reference parser.

### P4 — Playback engine and walking skeleton
- [ ] P4.1 Tempo map (tick ↔ time) with live tempo change
- [ ] P4.2 Look-ahead scheduler with injected clock
- [ ] P4.3 Transport: play, pause, resume, stop
- [ ] P4.4 Count-in
- [ ] P4.5 Loop (whole, section, bar range) with seamless join
- [ ] P4.6 SynthSink using the engine chosen in S1; one bundled SoundFont
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
- [ ] P9.1 MIDI export UI and options (click, count-in, repeats)
- [ ] P9.2 WAV export via offline rendering with progress/cancel
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
| S1 SoundFont engine | — | — | — |
| S2 MIDI out | — | — | — |
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
| OQ-11 | Installer size budget; SoundFont list | Spike S4 / P1.5 | Open |
| OQ-12 | Code signing and notarization | Spike S4 | Open |
| G-01…G-14 | Gaps found during planning | See gap-analysis.md | Open |

## 6. Blockers

None.

## 7. Changelog

| Date | Change |
|---|---|
| 2026-11-03 | Initial tracker created from implementation.md v0.1 |
