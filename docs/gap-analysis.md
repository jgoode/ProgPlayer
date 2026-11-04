# PracticePlayer — Gap Analysis

| | |
|---|---|
| **Status** | Draft v0.1 — for review |
| **Date** | 2026-11-03 |
| **Depends on** | requirements.md (v0.2), implementation.md (v0.1), testing.md (v0.1) |

**Purpose.** Record where the requirements, plan and tests do not yet fully answer a question, where technical risk is high, and what is deliberately deferred. This file is a living register: each gap has an ID, a proposed resolution, a decide-by phase and a status. Gaps are closed here (never deleted) and the decision is copied to progress.md's decision log.

**Severity:** *Blocker* = must be resolved before the named phase can start or finish · *Major* = affects behaviour users will notice · *Minor* = detail or polish.

---

## 1. Summary

| Area | Current state | Main concern |
|---|---|---|
| Music model (keys, chords, presets) | Fully specified | Preset resolution rule needs confirmation (G-01); voicing rules not yet decided (G-10) |
| Playback and timing | Specified; design proven only on paper | Future-timed events in the SoundFont engine and Web MIDI jitter (spikes S1/S2) |
| MIDI out | Specified | Program-change and Start/clock semantics undecided (G-03, G-04) |
| Odd/compound meters | Grouping defaults chosen | Click accents and sub-bar chord splits not defined (G-05, G-06) |
| Looping and live editing | Loop modes specified | Interaction with sections, repeats and live edits undefined (G-07, G-08) |
| Sound assets | Plan exists | Licences and size not verified (G-11) |
| Export | Specified | MP3 licence (G-12); audio device handling (G-14) |
| Distribution | Plan exists | Signing and notarization undecided (G-13) |

## 2. Gaps found while planning

| ID | Gap | Why it matters | Proposed resolution | Decide by | Severity | Status |
|---|---|---|---|---|---|---|
| **G-01** | **Preset resolution rule.** Requirements say progressions resolve "for the selected key and scale type", but a preset such as ii–V–I is ambiguous if the user picks Dorian. | Determines the preset data format and what the scale selector actually does. | Assumption A5: preset chords are fixed offsets from the tonic with explicit qualities; scale type drives preset suggestions (home scale) and scale hints, never rewrites chords. | Before P2 | Blocker (for P2/P3) | Open — needs John's confirmation |
| **G-02** | **Count-in and resume behaviour.** Not defined: is there a count-in after pause/resume, after changing tempo, or when starting from a loop region in mid-song? What happens to held notes on resume? | Affects transport logic and user expectation. | Count-in only on a fresh Play from stop; none on resume or loop wrap; setting "count-in on resume" optional later. On resume, notes restart at the current chord's beginning of the current beat. | P4 | Major | Open |
| **G-03** | **MIDI Start/Stop/Continue and clock semantics.** When is Start sent relative to the count-in; is clock sent while stopped; how do DAWs handle Start with a count-in? | DAW sync may be off by a bar. | Send clock continuously while playing; Start at the first count-in click; Stop on stop; Continue on resume; no clock while stopped. Option to send Start at bar 1 instead of count-in start. Verify with two DAWs (testing M-2). | P6 | Major | Open |
| **G-04** | **Program change / bank select on MIDI out.** The app lets users pick instruments for the internal synth, but not stated whether external MIDI parts send program changes. | External General MIDI devices will sound as piano unless told otherwise. | Per-part optional program change (and bank MSB/LSB) sent at play start; off by default for virtual instruments the user controls themselves. | P6 | Major | Open |
| **G-05** | **Click patterns for compound/odd meters.** Accent pattern for 6/8 (click on dotted quarters only, or all eighths with accents?), 7/8 (2+2+3) and 5/4 (3+2). | Click is core to practice; a wrong feel is quickly noticed. | Click on every beat unit defined by OQ-5; accent on group starts (stronger on bar start); optional subdivision click for 6/8 and 7/8 as a later setting. | P3 | Major | Open |
| **G-06** | **Sub-bar chord durations versus meter.** FR-ARR-4 allows chords shorter than a bar, but how are two chords split in a 7/8 or 5/4 bar? | Compiler must know legal boundaries. | Chord changes may fall on any beat-group boundary (e.g. 7/8: after beat 2, 4 or on 2+2 / 3 groupings); the editor offers only valid splits. | P3 | Major | Open |
| **G-07** | **Loop region definition.** Loop of a bar range that crosses sections or repeats; numbering of bars with repeated sections; what happens at the end of a loop region inside a repeat. | Loop is a headline practice feature. | Bars are numbered globally over the expanded arrangement (repeats unrolled); loop region is a range of expanded bars; selecting a section loops all its repeats unless the user chooses one pass. | P4 | Major | Open |
| **G-08** | **Live edits during playback.** Can the user change key, tempo, chords or sections while playing? Only tempo is required (FR-TMP-2). | Prevents crashes and surprises; affects compiler/scheduler design. | v1: tempo, volumes, mutes, loop region, instrument changes are live; edits to chords/sections/key/time signature stop or require "apply at next loop/bar" confirmation (design in P5). | P5 | Major | Open |
| **G-09** | **Remote keys and double accidentals.** Some modes/minors on sharp keys need double accidentals (e.g. G♯ harmonic minor); some key/mode combinations are rarely used. | Spelling correctness (FR-CHD-2) and UI clutter. | Offer all 12 tonics with a spelling choice; where the combination needs more than a double accidental, show the enharmonic equivalent and note it; supported down to double accidentals; tests per key/scale. | P2 | Minor | Open |
| **G-10** | **Voicing and register rules.** OQ-6 not yet decided; extension voicing (dropping 5th/11th) needs musician review; bass register and instrument ranges unspecified. | Poor voicings are the likeliest source of "it sounds wrong" feedback. | Implement the rule set in implementation.md §2.5; review by ear with M-7; keep rules table-driven so they can be tuned. | P2 | Major | Open |
| **G-11** | **SoundFont licences, quality and size.** No fonts chosen or verified; installer size budget not set (OQ-11). | May block bundling; affects installer size and load time. | P1.5 shortlist with licence check (permissive/CC0, redistribution allowed, attribution requirements recorded in §4); prefer SF3 compression; budget around 150 MB initially. | P1 | Blocker (for P4 bundling) | Open |
| **G-12** | **MP3 encoder licence.** Most easily available JS/WASM MP3 encoders are LGPL, which may conflict with MIT distribution expectations. | Could force WAV-only in v1. | Spike S3; if unresolved, ship WAV in v1.0 and add MP3 in a later release. | P1 | Minor (v1.0 can ship without) | Open |
| **G-13** | **Signing and notarization.** macOS notarization needs an Apple Developer account; Windows signing needs a certificate or a signing service; Linux needs no signing. | Unsigned builds trigger OS warnings; affects release credibility. | Decide in S4; document unsigned-install steps as interim. | P1 (decision), P10 (done) | Major | Open |
| **G-14** | **Audio output device and sample rate.** Requirements do not cover choosing the output device, sample rate (44.1 vs 48 kHz), or behaviour on device change. | Real-world setups (USB interfaces, Bluetooth) vary; Linux audio especially. | v1: follow the system default device; surface the active device and sample rate in settings; react to device changes by re-creating the audio context where possible; add explicit device picker if S1/S4 show it is needed. | P4 | Major | Open |

### Minor clarifications to confirm

| ID | Question | Default |
|---|---|---|
| C-1 | Session file extension and name | `.ppsession` (JSON) |
| C-2 | Windows on ARM, 32-bit systems, Linux ARM | Not supported in v1 |
| C-3 | Linux package formats | AppImage plus .deb |
| C-4 | Tempo range | 30–300 BPM (OQ-4) |
| C-5 | Metronome click sound choices | Two built-in click voices; more later |
| C-6 | Default MIDI channels | Chords 1, bass 2, click 10 |
| C-7 | Default velocities and per-part levels | Chosen in P4; adjustable in mixer |

## 3. Requirement coverage check

Every requirement group has a phase and a test route. This table records whether the plan leaves any group exposed.

| Group | Planned in | Tested by | Exposure |
|---|---|---|---|
| FR-KEY, FR-CHD | P2 | L1, AT-2 | G-01, G-09, G-10 |
| FR-LIB | P3, P8 | L1/L3/L4, AT-7 | None beyond G-01 |
| FR-ARR | P3, P5 | L1/L2/L3, AT-1 | G-06, G-07, G-08 |
| FR-TMP | P3, P4 | L1/L2 | G-05 |
| FR-PLY | P4, P5 | L2/L4/L5, AT-1/3/4 | G-02, G-07 |
| FR-SND-1..3 | P1, P4, P8 | L2/L5 | G-11, G-14 |
| FR-SND-4..9 | P6 | L2/L5, AT-5 | G-03, G-04; risk RK-2 |
| FR-UI | P5, P7 | L3/L4 | G-08 |
| FR-IO | P3, P8, P9 | L1/L4/L5, AT-6/7 | G-12 |
| NFR-TIM, NFR-PRF | P1, P4, P6, P10 | L2/L5/L6, AT-3 | Risks RK-1, RK-2, RK-6 |
| NFR-REL, NFR-SEC, NFR-PRV | P0, P6, P8 | L1/L4/L5, AT-5/7/8 | None |
| NFR-A11Y, NFR-I18N | P5 | L3/L5 | Screen-reader coverage is manual |
| PLT | P0, P10 | L7, AT-8 | G-13 |

## 4. Licence and dependency register

Status key: **Expected** = believed compatible from general knowledge, to be confirmed by the CI audit · **Verified** = checked against the package's own published licence · **Unknown** = must be researched.

| Component | Role | Licence | Status | Notes |
|---|---|---|---|---|
| Electron 45.2.2 | App shell | MIT | Verified | Pinned exact version (P0.2). |
| React 19.3.1, React DOM 19.3.1 | UI | MIT | Verified | Pinned exact versions; runtime dependencies (P0.2). |
| Vite 7.3.7, electron-vite 5.0.0, @vitejs/plugin-react 5.1.0 | Build | MIT | Verified | Dev dependencies (P0.2). |
| TypeScript 5.9.3 | Language | Apache-2.0 | Verified | Dev dependency. |
| Vitest 5.1.0, @vitest/coverage-v8 5.1.0 | Testing | MIT | Verified | Dev dependencies (P0.4). |
| Testing Library React 16.3.3, @testing-library/jest-dom 7.0.1, jsdom 30.1.3 | Component testing | MIT | Verified | Dev dependencies (P0.4). |
| ESLint 9.39.5, @eslint/js 9.39.5, typescript-eslint 8.72.1, eslint-plugin-react-hooks 7.1.1, eslint-config-prettier 10.1.8 | Linting | MIT | Verified | Dev dependencies (P0.3). |
| Prettier 3.9.10 | Formatting | MIT | Verified | Dev dependency (P0.3). |
| Playwright 1.64.1 | E2E testing | Apache-2.0 | Verified | Dev dependency (P0.6). |
| `caniuse-lite` (transitive, dev only) | Browser usage data for Babel/browserslist | CC-BY-4.0 | Verified (attribution required) | Not shipped in the app bundle. Attribution text recorded in `scripts/license-attribution.json`; audited by `pnpm run audit:licenses` (P0.9). |
| Zustand | State | MIT | Expected | Planned for Phase 5; not installed yet. |
| electron-builder | Packaging | MIT | Expected | Planned for Phase 10. |
| zod (or equivalent) | Schema validation | MIT | Expected | Planned for Phase 3. |
| `tonal` (or equivalent) | Test oracle for theory | MIT | Expected | Dev/test only; never in the app bundle. |
| `spessasynth_lib` / `spessasynth_core` | SoundFont synth, offline render | Apache-2.0 (current releases) | Verified for current releases | Older releases list MIT and Apache-2.0 (the package's bundled Vorbis decoder is Apache-2.0). Pin a version, re-check its licence, include a NOTICE entry. Apache-2.0 is compatible with distributing an MIT-licensed app. |
| FluidSynth-WASM wrapper | Alternative synth if S1 fails | LGPL-family | Unknown | Only if S1 rules out SpessaSynth; assess linking terms |
| RtMidi-based Node addon | Fallback MIDI I/O | MIT-style (verify) | Unknown | Only if S2 rules out Web MIDI; check prebuilt binaries for all targets |
| MP3 encoder (JS/WASM) | MP3 export | Often LGPL | Unknown | Spike S3 |
| Bundled SoundFonts (piano, bass, guitar, click/percussion) | Sound content | Per font | Unknown | Spike P1.5; record author, licence, URL, attribution text |
| Fonts, icons, click samples | UI/audio assets | Per asset | Unknown | Prefer system fonts and self-authored click samples |

Requirements on the register: every row ends as **Verified** before the first release; the attribution screen (P10.3) is generated from this table.

## 5. Spike-driven unknowns

| Unknown | Spike | If the answer is "no" |
|---|---|---|
| Can the SoundFont engine accept future-timed events with sub-quantum accuracy? | S1 | Worklet-side event queue, or play through the engine's own sequencer from the compiled timeline; as a last resort evaluate FluidSynth-WASM |
| Can Web MIDI meet 5 ms p99 jitter on all OSes? | S2 | Native RtMidi-based addon behind the same sink interface; document platform limitations |
| Is any MP3 encoder licence-compatible and fast enough? | S3 | WAV only in v1.0 |
| Do bundled fonts fit the size/load-time budget? | S4 | SF3 compression; fewer fonts; optional download of extra fonts after v1 |
| Is macOS/Windows signing achievable without delaying release? | S4 | Unsigned interim builds with clear install notes |

## 6. Deliberately deferred (not gaps)

| Item | Reason deferred | Path to add later |
|---|---|---|
| VST3/CLAP hosting | Needs native plugin hosting; large effort; MIDI out to a DAW or standalone host covers the use case | Native addon or helper process hosting plug-ins, exposed as another sink |
| Audio clip playback | Not selected for v1 | New sink plus a clip library/import UI |
| Editable rhythm patterns, style presets, drums | v1 is block chords + root bass | Pattern engine in the compiler; new data model for styles |
| Transpose on the fly, step through keys, tempo ramp | Not selected for v1 | Compile-time transforms and a transport mode |
| Piano keyboard view, fingered guitar shapes, alternate tunings | Not selected for v1 | Additional display components over the theory module |
| Per-section key/tempo/time-signature | Adds compiler/timing complexity | Tempo map already supports multiple anchors; extend the data model |
| Chord chart import, MIDI file import | Not selected for v1 | Parsers feeding the arrangement model |
| Expanded chord-scale hints | Requested for later iterations (OQ-8) | Extend the hint data table; no code change needed |

## 7. How gaps are closed

1. Decision made (by John or by spike result) and recorded in the gap's row (status → *Closed*, with date and one-line outcome).
2. Requirements or implementation docs updated; version bumped.
3. Matching tests added in testing.md and the progress.md decision log updated.
4. If a gap cannot be closed in its decide-by phase, escalate it in progress.md as a blocker.

## 8. Review log

| Date | Reviewer | Notes |
|---|---|---|
| 2026-11-03 | Initial draft | Gaps G-01…G-14 identified while writing implementation and test plans |
