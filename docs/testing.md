# PracticePlayer — Test Plan

| | |
|---|---|
| **Status** | Draft v0.1 — for review |
| **Date** | 2026-11-03 |
| **Depends on** | requirements.md (v0.2), implementation.md (v0.1) |

---

## 1. Purpose and scope

This plan defines how PracticePlayer is verified: what is tested at each layer, on which platforms, with what data, and what must pass before a phase or the v1.0 release is declared done. It covers functional behaviour, timing, cross-platform behaviour, robustness, accessibility, security hygiene and packaging.

Out of scope for v1: automated listening-quality assessment (sound quality is reviewed by ear), VST hosting, and audio-clip playback (not in v1).

## 2. Test strategy

Audio and MIDI timing cannot be fully proven by automated tests on a CI runner, so the plan splits work into what a machine can prove deterministically and what needs real devices.

| Layer | What it proves | Tooling | Runs |
|---|---|---|---|
| **L1 Unit** | Theory, spelling, voicing, chord-scale selection, compiler, tempo map, file formats | Vitest | Every commit, both supported OSes |
| **L2 Integration (simulated clock)** | Scheduler, transport, loop, count-in, tempo change, all-notes-off, sink behaviour against fake sinks | Vitest with an injected fake clock | Every commit |
| **L3 Component / UI** | Chord chart, fretboard, editors, keyboard operation, accessibility rules | Vitest + Testing Library; axe-style checks | Every commit |
| **L4 End-to-end** | App launches, edits a session, plays with the synth muted/real, saves and reloads, exports | Playwright for Electron | Every commit (smoke), nightly (full) |
| **L5 Device tests (semi-manual)** | Real audio output, MIDI loopback and DAW behaviour, hot-plug, clock sync | Scripted procedures in §7 | Per phase exit and release |
| **L6 Soak / performance** | No dropouts or drift over long runs; CPU/memory within budget | Automated harness + manual run | Nightly (headless where possible), release |
| **L7 Packaging** | Clean install, launch, play offline on each supported OS | Fresh VMs/machines | Release candidate |

Principles:

1. Everything not tied to a device lives in `core` and is tested at L1/L2 with deterministic inputs.
2. The scheduler takes a clock and sinks by injection; tests use a fake clock and recording sinks, so timing logic (loop joins, tempo changes) is verified exactly rather than "by ear".
3. One timeline feeds every output (implementation.md D2), so most output tests assert on the timeline once, then check each sink's conversion separately.
4. Each defect fixed gets a regression test at the lowest layer that can reproduce it.

## 3. Test environments

| Axis | Values |
|---|---|
| **Operating systems** | Windows 10 and 11 (x64); macOS current and previous major release, on Apple Silicon and Intel. **Linux is out of scope (dropped 2026-11-08).** |
| **Hardware tiers** | "Low" (older dual/quad-core laptop, integrated audio) and "typical" (recent mid-range laptop); the low tier is used for soak and performance gates |
| **Audio devices** | Built-in output, USB audio interface, Bluetooth headphones (latency check), headphones hot-unplug |
| **MIDI loopback** | Windows: loopMIDI; macOS: IAC Driver |
| **MIDI receivers** | One DAW or MIDI monitor per supported OS; at least two different DAWs/hosts across the matrix for clock tests |
| **Locale / display** | English UI; light and dark themes; 100% and 150% display scaling |

CI runners (GitHub Actions) cover L1–L4 on both supported OSes. L5–L7 need real machines or VMs with audio and MIDI loopback and are run manually or on a self-hosted runner.

## 4. Test design by area

### 4.1 Theory core (L1)

| Area | Tests |
|---|---|
| Spelling | Every tonic in sharp and flat spellings; scale degrees spelled with correct letter names; double accidentals handled or the key excluded per gap G-09. |
| Scales | Interval patterns for major, natural/harmonic/melodic minor and the seven modes, for all 12 tonics, against golden tables. |
| Chords | Every chord quality in FR-CHD-1 built on several roots; chord-name formatting and parsing round-trip. |
| Resolution | Each preset in Appendix A resolves for all 12 tonics (and all scale types it declares as home) to expected names and pitch classes. |
| Voicing | Register limits respected; minimal movement between successive chords; extension handling rules (drop 5th with 9th+; 11th over major third); bass note is the root; no voicing outside the playable MIDI range. |
| Chord-scales | The table returns a scale for every supported quality; non-diatonic chords return both the quality-based suggestion and the in-key scale. |
| Fretboard | Standard tuning positions for known chords; fret range limits; every chord tone appears at least once within the default range. |

**Independent oracle:** golden tables are generated with a separate music-theory library used only as a dev dependency (for example `tonal`, MIT) and cross-checked by hand for a sampled subset (all keys for the 12-bar blues, ii–V–I major and minor, and one of each mode vamp). The oracle must never be imported by application code.

### 4.2 Arrangement and compiler (L1)

- Bar/beat model for 4/4, 3/4, 6/8, 5/4, 7/8 with the agreed groupings (OQ-5): click accents land where expected.
- Timeline invariants (property-based tests): events sorted by tick; every `noteOn` has a matching `noteOff`; no negative durations; chord durations sum to section length; section repeats multiply correctly; count-in ticks precede tick 0 and are excluded from bar numbering.
- Sub-bar chord durations (two chords per bar) compile correctly in every time signature (see gap G-06).
- Golden timelines for three representative arrangements (single section loop; three sections with repeats; a 7/8 arrangement).

### 4.3 File formats (L1)

- Session and preset schemas: valid files load; invalid files produce typed errors naming the field; unknown future `schemaVersion` is rejected with a clear message; older versions migrate.
- Round trip: save → load → save yields identical content.
- SMF writer: output parses in a reference parser; tempo, time signature and note data match the timeline; channel assignment matches settings; options (click on/off, count-in on/off, repeats) change the output as specified.
- WAV writer: header fields correct; length equals expected samples; known-signal test (a sine) round-trips.
- Fuzz: random byte mutations of valid session and preset files never throw uncaught exceptions.

### 4.4 Scheduler and transport (L2, fake clock)

| Scenario | Expected result |
|---|---|
| Play from start | Events are emitted in order, each stamped at the correct time for the tempo map; nothing emitted earlier than the look-ahead window. |
| Pause/resume | No events lost or duplicated; held notes are released on pause and re-established or restarted per the rule chosen for G-02. |
| Stop | All-notes-off (CC 123) and all-sound-off (CC 120) issued per active channel on each sink; scheduler clears pending events. |
| Count-in | Click only during count-in; bar numbering begins at 1 after count-in; count-in not repeated on loop wrap. |
| Loop: whole arrangement, section, bar range | Join is seamless: the first event after the wrap is exactly one beat/bar after the last, no doubled or missing click; works at loop lengths of one bar and one chord. |
| Loop region changed during playback | New region takes effect at the next bar boundary without glitches. |
| Tempo change during playback | New tempo applies from the next beat; times before the change are unaffected; MIDI clock tick spacing changes accordingly. |
| Tempo extremes | 30 and 300 BPM produce correct timing; windows scale with tempo. |
| Late timer | If the fake timer fires late by more than the look-ahead, the scheduler catches up without bursts of simultaneous notes and records a "late event" metric. |
| Window hidden/minimized | Timer is in a Worker; test asserts the scheduler does not depend on UI timers (structural test) and the manual test in §7 verifies real behaviour. |
| Device removed mid-play | Sink reports an error; playback continues on remaining sinks; no unhandled rejection. |

### 4.5 Sinks (L2 with fakes, L5 with real devices)

- **SynthSink:** program/instrument assignment; note on/off mapping; polyphony stress (extended chords at fast tempo); stop releases all notes. Offline render produces non-silent output with the expected length and no clipping at default volumes.
- **MidiOutSink:** correct status bytes and channels per part; velocity ranges; program change behaviour (per gap G-04); clock messages: 24 per quarter note, spaced to the tempo map; Start/Stop/Continue at the right moments (gap G-03).
- **Latency offset:** offset shifts MIDI timestamps by exactly the configured amount.

### 4.6 UI and accessibility (L3/L4)

- Every control reachable by keyboard; tab order logical; shortcut table matches the documentation.
- Current chord is distinguishable without colour (FR-UI-1, NFR-A11Y-1); root marker on the fretboard is non-colour.
- Contrast ratios meet the target in light and dark themes.
- Core controls have accessible names; screen-reader smoke test on each supported OS (Narrator on Windows, VoiceOver on macOS) at release.
- Chord chart follows the playhead; selecting a loop range with the mouse and with the keyboard both work.

### 4.7 Security and privacy hygiene (L4 / CI)

- Automated check that renderer windows are created with context isolation on, node integration off, sandbox on.
- CSP present; no network requests during a full scripted session (verified by blocking network in the e2e run).
- Preload exposes only the documented API (snapshot test of the exposed surface).
- Dependency and licence audit step fails the build on a non-compatible licence (CON-4).

## 5. Acceptance tests (from requirements §11)

Each acceptance test is run on both supported OSes before v1.0. IDs are referenced from progress.md and gap-analysis.md.

| ID | Area | Procedure | Pass criteria |
|---|---|---|---|
| **AT-1** | Playback | Load a 3-section arrangement in 4/4; tempo 120 BPM; play to the end with synth enabled. | Correct chords, bass and click throughout; section boundaries respected; position display matches what is heard. |
| **AT-2** | Keys | For each of the 12 tonics and each supported scale type, apply the ii–V–I (or the scale's equivalent preset) and inspect chord names and notes. | All chords and spellings match the golden tables. |
| **AT-3** | Timing | Play a 3-section arrangement at 140 BPM for 10 minutes on the low-tier machine with the window minimized for part of the run. | No audible dropouts; no drift versus a reference metronome; late-event count and MIDI jitter within budget (§8). |
| **AT-4** | Loop | Loop a bar range of two bars and a section for 5 minutes; change the range mid-play. | Seamless join; no gap or doubled beat; change takes effect at the next bar. |
| **AT-5** | MIDI | Connect a virtual port to a DAW/monitor; assign chords/bass/click to channels 1/2/10; enable clock; play, pause, resume, stop; unplug and re-plug the port. | Notes arrive on the right channels; DAW tempo follows the app within one tick; stop leaves no hanging notes; hot-plug handled without a crash. |
| **AT-6** | Export | Export MIDI and WAV with several option combinations. | MIDI opens in a DAW with correct tempo/time signature/notes; WAV length matches expected length within one buffer; WAV and live playback sound the same. **MP3 is not part of v1.0** (ADR-0004); if MP3 is later enabled, the file must play and have the right length. |
| **AT-7** | Persistence | Save a session; restart; reload. Remove a SoundFont and a MIDI port referenced by the session; reload. Load a corrupted file. | Identical arrangement after reload; missing assets reported clearly with sensible fallback; corrupt file produces a clear error and no crash. |
| **AT-8** | Packaging | On a clean machine (no dev tools), install from the release artefact, disconnect from the network, launch and play. | Starts within target, plays using bundled SoundFonts, no network access, licences screen present. |

## 6. Traceability

| Requirement group | Primary test layers | Acceptance tests |
|---|---|---|
| FR-KEY, FR-CHD | L1 | AT-2 |
| FR-LIB | L1, L3, L4 | AT-7 |
| FR-ARR, FR-TMP | L1, L2, L3 | AT-1, AT-4 |
| FR-PLY | L2, L4, L5 | AT-1, AT-3, AT-4 |
| FR-SND-1..3 | L2, L5 | AT-1 |
| FR-SND-4..9 | L2, L5 | AT-5 |
| FR-UI | L3, L4 | AT-1, AT-4 |
| FR-IO | L1, L4, L5 | AT-6, AT-7 |
| NFR-TIM | L2, L5, L6 | AT-3, AT-5 |
| NFR-PRF | L6 | AT-3, AT-8 |
| NFR-REL | L1, L4, L5 | AT-5, AT-7 |
| NFR-SEC, NFR-PRV | L4 / CI | AT-8 |
| NFR-A11Y, NFR-I18N | L3, L5 | — (checklist in §4.6) |
| NFR-MNT | CI structure checks | — |
| PLT | L7 | AT-8 |

A full requirement-level matrix (each FR/NFR ID to its test case IDs) is generated in Phase 10 and stored alongside this file.

## 7. Manual and device test procedures (L5)

**M-0 MIDI output jitter (the S2 exit check).** Requires a MIDI loopback:
loopMIDI or the Windows MIDI Services "MIDI 2.0 Loop Devices" on Windows, the
OS's IAC Driver on macOS (see `docs/spikes/s2-midi-out-report.md` §9). Run
`pnpm run spike:s2:web -- --output "<send port>" --input "<capture port>" --bars 8 --bpm 120`
and repeat with `--minimize-after 2000` and with `--ui-load`. Record the
p50/p95/p99/max of the received-timestamp error in the report. **Expected:**
p99 under 5 ms on each supported OS (NFR-TIM-2), 0 late sends in every
configuration, and no change when the window is minimised. The measurement is
limited by the precision of the input timestamp, so the absolute error
includes a constant loopback delay — read the *jitter*, not the absolute
number. This procedure covers the real-hardware half of gap G-20; the
Linux half was dropped with the platform (2026-11-08).

**Status (2026-11-05):** the procedure has already been run against a
virtual loopback on Windows and macOS by the CI workflow
`.github/workflows/spike-s2-midi.yml`, five runs per configuration:
**p99 jitter 1.10 ms on Windows** (1.10–50.00 ms across five runs, one driver
stall) **and 0.10 ms on macOS**, 0 late sends across 19 152 sends on Windows
and 18 240 on macOS. One Windows run in five showed a
50.9 ms *received* outlier that the dispatch records attribute to the
loopback driver (the app had dispatched that bar 96 ms early), so a run
on real hardware may show driver stalls too. **What is still missing is a run
against real MIDI hardware**, which is what this procedure is for. (Linux is
no longer a supported platform, so it is not part of this matrix — dropped
2026-11-08.)

**M-1 MIDI note routing.** Create loopback port; open a MIDI monitor; assign channels; play a 4-bar loop; confirm note numbers and channels for chords, bass and click; stop; confirm all-notes-off on each used channel.

**M-2 MIDI clock sync.** Open a DAW (two different DAWs across the test round) set to external MIDI clock; play from the app; confirm tempo display matches and transport follows Start/Stop/Continue; change tempo mid-play and confirm the DAW follows within a beat.

**M-3 Latency calibration.** Route the same part to the internal synth and an external synth that outputs a click sound; use the calibration helper to align; verify by ear and by recording both outputs that the offset is under 10 ms (target; adjust after measurement).

**M-4 Hot-plug.** During playback unplug/replug a USB MIDI device and a USB audio interface; confirm graceful messages and recovery without restarting the app.

**M-5 Minimize and sleep.** Minimize the window for 5 minutes during playback; lock the screen; confirm no dropouts. Confirm the OS does not suspend the app (power-save blocker active during playback only, released on stop).

**M-6 Output device change.** Switch the system output device and unplug headphones during playback; confirm the app follows the new default or reports clearly (see gap G-14).

**M-7 Listening review.** A musician reviews voicings across all presets in at least four keys and rates them (acceptable / awkward / wrong); awkward and wrong cases become defects against the voicing rules.

The current rule defaults are documented in `docs/voicing-rules.md`; §7 of that
document lists the nine questions the review must answer. Minimum coverage:

- Keys: at least four of the 12 tonics, including one sharp key and one flat
  key (e.g. C, G, D♭ and B♭).
- Presets: all 29 Appendix A presets.
- Ratings: every preset × key combination is rated acceptable, awkward or
  wrong, with a note for anything not acceptable.
- Checks: chord register (G3–C6), bass register (E1–E3), the dropped 5th on
  9th-and-above chords, the dropped unaltered 11th over a major third, and
  the size of the jumps between successive voicings.
- Outcome: awkward and wrong cases become defects against the rule table, and
  the rules, the worked examples in `docs/voicing-rules.md` and the voicing
  tests are updated together.

**M-8 Bundled SoundFont review (S4 follow-up).** Before any font is committed to
v1.0, play each shortlisted bank in the app for its role — piano, bass, guitar,
click/percussion — over a short progression at a practice tempo, and record the
result. For each bank record: (1) whether the SF3 build sounds like the SF2
original (audition both if the conversion is available, otherwise the bank
alone), (2) whether the bank is usable for its role at the app's default
velocity, and (3) an accept / reject rating. A bank rated reject is replaced
or dropped; it is not shipped. The ratings are recorded in
`docs/spikes/s4-soundfont-shortlist.md` and the gap (G-33) is closed only when
every bundled bank has a recorded rating. Automated listening quality is out of
scope for v1 (`testing.md` §1), so this procedure is the evidence.

## 8. Performance and timing budgets

Initial targets (to be tightened or relaxed with measurements from spikes S1/S2):

| Metric | Target |
|---|---|
| Synth scheduling error (audio clock) | Within one render quantum (128 frames, about 2.7 ms at 48 kHz) |
| MIDI out jitter (p99) | Under 5 ms on every supported OS (NFR-TIM-2) — **measured: 1.10 ms on Windows** (typical case; 1.10–50.00 ms across five runs, one driver stall) **and 0.10 ms on macOS**, 0 late sends across 19 152 sends on Windows and 18 240 on macOS. Real-hardware runs still outstanding (gap G-20) |
| MIDI look-ahead window | At least 300 ms, and larger than the worst expected main-thread stall (S2: a 100 ms window produced 3.51 % late sends under a 120 ms block; a 300 ms window produced none — gap G-21) |
| Late MIDI sends (message handed to the driver after its intended time) | 0 in every configuration, including a blocked main thread and a minimised window |
| Late scheduler events during a 10-minute soak | 0 events later than the look-ahead window |
| Audio dropouts during soak (low-tier machine) | 0 audible; 0 reported underruns |
| CPU use during playback (typical machine) | Under 25% of one core average (to be confirmed by S1) |
| Memory with all bundled SoundFonts loaded | Within the budget set in spike S4 |
| Cold start to ready | Under 5 seconds (NFR-PRF-2) |
| Offline WAV render speed | At least 5× faster than real time on a typical machine (target) |

**Measurement method:** scheduler reports lateness (scheduled time versus actual dispatch time) into a ring buffer exposed in a debug panel; MIDI jitter is measured by loopback capture on a second port compared against intended timestamps (note the measurement itself is limited by input timestamp precision); CPU and memory are sampled with the OS tools over the soak run.

## 9. Test data and fixtures

- `fixtures/golden/` — theory golden tables (generated by the oracle script, committed, reviewed).
- `fixtures/sessions/` — valid sessions for each time signature; sessions with missing SoundFonts/ports; corrupt and truncated files; files from older and newer schema versions.
- `fixtures/presets/` — valid and invalid preset files.
- `fixtures/audio/` — short reference renders for regression comparison (compared by length and RMS envelope, not bit-exact, because the synth may change).
- A tiny test SoundFont (a few kilobytes) for fast CI runs; bundled production SoundFonts are used only in L5–L7 runs.

## 10. Coverage targets and quality gates

| Gate | Threshold |
|---|---|
| Line coverage, `core` | ≥ 90% (branches ≥ 85%) |
| Line coverage, whole project | ≥ 70% |
| Lint, type-check | Zero errors |
| Licence/dependency audit | Zero incompatible licences |
| Phase exit | All tests for that phase green on both supported OSes plus the phase exit check in implementation.md |
| Release candidate | AT-1…AT-8 pass on both supported OSes; no open defects of severity S1 or S2; known-issues list published |

**Defect severity:**

| Severity | Definition | Examples |
|---|---|---|
| S1 Blocker | Crash, data loss, or playback unusable | Crash on launch; session file overwritten with garbage; no sound on an OS |
| S2 Major | Core feature broken or timing audibly wrong | Loop join glitch; hanging notes; wrong chord spelling in a preset |
| S3 Minor | Feature works with a clear workaround | Cosmetic misalignment; unhelpful message wording |
| S4 Trivial | Polish | Spelling in a tooltip |

## 11. Continuous integration

| Job | Trigger | Content |
|---|---|---|
| `check` | Every push/PR | Lint, type-check, L1–L3 on Windows and macOS |
| `e2e-smoke` | Every push/PR | Playwright launch-and-play-silent on both supported OSes |
| `e2e-full` | Nightly | Full Playwright suite including save/load and exports |
| `soak` | Nightly (where hardware allows) | Headless long-run scheduler/offline-render consistency test |
| `audit` | Every push/PR | Dependency vulnerability and licence audit |
| `spike-s2-midi` | Push to `spike/s2/**` | The S2 MIDI measurement on Windows and macOS: sets up the platform's MIDI loopback, runs the Web MIDI harness (idle, minimised, UI-load) and the native candidate, uploads the JSON reports as artifacts. Closes gap G-20 when the loopbacks are available |
| `package` | Tag / release branch | Build installers; run AT-8 steps on clean machines manually |

## 12. Phase 0 test inventory (bootstrap)

| Layer | Test | File | Checks |
|---|---|---|---|
| L1 | Core contracts | `src/core/core.test.ts` | IPC channel names and preload API key are stable |
| L1 | Core purity | `tests/unit/core-purity.test.ts` | No Electron, DOM, audio or Node imports in `src/core` (NFR-MNT-1) |
| L1 | Layer boundary rules | `tests/unit/import-boundaries.test.ts` | A deliberate violation fails the lint: `core` importing `@renderer`, `core` importing `electron`, `core` using `ipcRenderer`; the violation is removed after each case |
| L3 | Audio / MIDI layer presence | `src/audio/audio.test.ts`, `src/midi/midi.test.ts` | The layers exist and contain no feature code in Phase 0 |
| L4 | Security baseline | `src/main/main.test.ts` | `contextIsolation` on, `nodeIntegration` off, `sandbox` on, `backgroundThrottling` off, CSP present |
| L4 | Preload surface | `src/preload/preload.test.ts` | The exposed API has exactly one method and no generic IPC escape hatch |
| L3 | Renderer shell | `src/renderer/src/App.test.tsx` | The "PracticePlayer" heading renders |
| L4 | Electron smoke | `tests/e2e/smoke.spec.ts` | The built app launches and the window title is `PracticePlayer` |
| CI | Dependency audit | `pnpm run audit:deps` | No high/critical advisories |
| CI | Licence audit | `pnpm run audit:licenses` | Every installed package has a permissive licence or a recorded attribution |

**Deliberate violation procedure.** The boundary rule is demonstrated
automatically: `tests/unit/import-boundaries.test.ts` writes a violating file
into `src/core/__boundary_probe__/`, lints it with the project's ESLint
configuration, asserts the expected error message and deletes the file in
`afterEach`. The repository therefore never contains a violation. To reproduce
the failure by hand, add `import { app } from 'electron'` to any file in
`src/core/` and run `pnpm run lint`.

**Not covered in Phase 0.** Real audio output, MIDI hardware, packaging and
the device procedures in §7 do not apply yet: the app has no audio or MIDI
code. They become applicable from Phase 1 (spikes) onwards.

### 12.1 Phase 1 test inventory (spikes)

| Layer | Test | File | Checks |
|---|---|---|---|
| L1 | S2 measurement maths | `tests/unit/spike-s2-analysis.test.ts` | The audio-clock → `performance.now()` mapping (including the latency compensation), the tick → milliseconds conversion at 480 ppq with 24 ppqn clock, the percentile function, and the event-id encoding/decoding used to match loopback messages to intended sends |
| L2 | S2 scheduler (simulated clock) | `tests/integration/spike-s2-scheduler.test.ts` | The Worker-driven look-ahead scheduler dispatches every event exactly once, in tick order, inside the look-ahead window; a late Worker tick never produces a past-dated send (gap G-21); the stop path emits all-notes-off |
| L5 | S2 Web MIDI measurement | `spikes/s2/electron/drive.cjs` | Permission handling, device enumeration, `statechange` (hot-plug), timestamped sends, the minimised-window and heavy-UI configurations, and the loopback capture. Report format in `spikes/s2/results/` |
| L5 | S2 native candidate | `spikes/s2/native/measure-native.mjs` | The same timeline through `@julusian/midi` (RtMidi), in `--early` and `--timed` modes, plus the main-process ↔ renderer IPC round-trip cost |
| CI | S2 matrix | `.github/workflows/spike-s2-midi.yml` | The measurement on `windows-latest` and `macos-latest` with the platform's MIDI loopback; the reports are uploaded as artifacts |

### 12.2 Phase 2 test inventory (theory core)

| Layer | Test | File | Checks |
|---|---|---|---|
| L1 | Pitch spelling | `src/core/theory/pitch.test.ts` | Letter + accidental mapping, Unicode and ASCII parsing, double accidentals, enharmonic listing |
| L1 | Scales | `src/core/theory/scales.test.ts` | Major, the three minors and the seven modes; consecutive-letter spelling; flat keys stay flat; every scale type for all 12 canonical tonics |
| L1 | Chord formulas | `src/core/theory/chords.test.ts` | Every quality in FR-CHD-1 on several roots; diatonic letter spelling; parser/formatter round trip over every quality and 13 root spellings |
| L1 | Degree resolution | `src/core/theory/degree.test.ts` | Major-scale degree numbering, borrowed flat and sharp roots, explicit quality override, scale-type independence (A5), enharmonic fallback beyond double accidentals |
| L1 | Voicing | `src/core/theory/voicing.test.ts` | Register limits, close-position span, dropped 5th for 9th-and-above chords, dropped unaltered 11th over a major third, kept minor/altered 11ths, minimal movement, root bass |
| L1 | Documented examples | `src/core/theory/docs-examples.test.ts` | The worked examples in `docs/voicing-rules.md` §6 match the implementation |
| L1 | Hints and fretboard | `src/core/theory/hints-fretboard.test.ts` | A suggestion for every quality; the suggestion contains the chord's core tones; both the in-key scale and the suggestion are returned; standard tuning, fret-range limits and chord-tone coverage |
| L1 | Edge cases | `src/core/theory/coverage.test.ts` | In-key scale lookup, unsupported-accidental fallbacks, missing degree positions, chromatic hint scales and voice-leading scoring |
| L1 | Golden tables | `tests/unit/theory-golden.test.ts` | 17 tonic spellings × 11 scale types and all 29 Appendix A presets × 12 keys match the committed golden tables, which are generated by the `tonal` oracle (`tests/fixtures/golden/generate.mjs`) and reviewed by hand for the 12-bar blues, ii–V–I major and minor and one of each mode vamp |
| L1 | Core purity | `tests/unit/core-purity.test.ts` | The theory core imports nothing outside `src/core` |

**Oracle independence.** `tonal` is a development dependency only. The
application code never imports it, the golden tables are committed as JSON,
and the generator (`tests/fixtures/golden/generate.mjs`) is the only file that
uses the oracle.

## 13. Entry and exit criteria per phase

| Phase | Entry | Exit |
|---|---|---|
| P0 | Plan approved | CI green on both supported OSes; smoke test passes |
| P1 | P0 done | Spike results recorded; measurement scripts committed for reuse |
| P2 | P1 SoundFont/MIDI decisions not required | Golden tables pass for all keys/scales/presets; core coverage ≥ 90% lines and ≥ 85% branches; voicing rules documented with the M-7 review questions listed |
| P3 | P2 done | Timeline invariants and SMF round-trip pass |
| P4 | P1 (S1) and P3 done | AT-1 and AT-4 pass with the minimal UI; soak run passes |
| P5 | P4 done | UI tests and accessibility checks pass |
| P6 | P4 and P1 (S2) done | AT-5 passes on both supported OSes; M-1…M-4 completed |
| P7 | P2 and P5 done | Fretboard and hint tests pass for all presets in all keys |
| P8 | P3 and P5 done | AT-7 passes; fuzz tests pass |
| P9 | P3, P4, P8 done | AT-6 passes |
| P10 | All previous | AT-1…AT-8 pass; release gate met |

## 14. Reporting

Test results are summarized in progress.md at each phase exit (counts, failures, open defects). Defects are tracked as issues labelled with severity and requirement IDs. Measurement outputs from L5/L6 runs are kept as dated notes under `docs/test-runs/`.
