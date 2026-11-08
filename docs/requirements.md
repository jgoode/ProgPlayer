# PracticePlayer — Requirements

| | |
|---|---|
| **Status** | Draft v0.5 — OQ-1, OQ-3, OQ-5, OQ-8, OQ-9, OQ-11, OQ-12 resolved; **Linux dropped from the supported platforms (2026-11-08)**; for review |
| **Date** | 2026-11-08 |
| **Related docs** | implementation.md, progress.md, testing.md, gap-analysis.md, agent-prompts.md (to follow) |

---

## 1. Purpose

PracticePlayer is a desktop application for Windows and macOS that plays a sequence of chord progressions in a chosen key at a chosen tempo, as a backing track for practice and improvisation.

The user chooses a key (or mode), arranges progressions into song-style sections, sets the tempo, and presses play. The app plays chords and a bass line, with a metronome click, through a built-in SoundFont synthesizer and/or MIDI out.

## 2. Goals and non-goals

### 2.1 Goals (v1)

1. Reliable, tight-timing playback of chords, bass and click on Windows and macOS.
2. A library of preset progressions, expressed in scale degrees so they work in any key or mode, which the user can extend with their own.
3. Song-style arrangement: ordered sections, each with its own progression and repeat count.
4. Practice aids: count-in, loop of a section or bar range, metronome click.
5. A clear display during playback: chord chart, guitar fretboard, scale/mode hints.
6. Persistence and export: save/load sessions, export to MIDI file and to audio (WAV/MP3).
7. Open-source distribution, with all bundled assets under compatible licenses.

### 2.2 Non-goals (v1)

- Hosting VST/VST3/CLAP plugins inside the app (see §9, Future).
- Audio clip / sample-loop playback as a sound source (see §9, Future).
- Editable per-chord rhythm patterns or style engines (v1 plays sustained block chords with a root-note bass).
- Recording, audio input, or backing-track analysis.
- Mobile or web versions.
- Cloud sync, accounts, telemetry.

## 3. Target users and use cases

**Primary user:** an instrumentalist (guitarist in particular, given the fretboard display) practising improvisation or learning progressions.

| ID | Use case |
|---|---|
| UC-1 | Pick a key and a preset progression (e.g. ii–V–I), set a tempo, loop it while improvising. |
| UC-2 | Build a multi-section arrangement (e.g. 8 bars of A, 8 bars of B, 4 bars of turnaround) and play it through. |
| UC-3 | Loop only one section, or a bar range within it, to drill a hard change. |
| UC-4 | Route chords/bass/click to an external synth or DAW over MIDI, optionally synced by MIDI clock. |
| UC-5 | Save a custom progression as a preset and reuse it later in any key. |
| UC-6 | Export the arrangement as a MIDI file or an audio file for use elsewhere. |

## 4. Platforms and distribution

| ID | Requirement |
|---|---|
| PLT-1 | Supported OS: Windows 10/11 (x64), macOS (Apple Silicon and Intel). **Linux is out of scope for v1 (dropped 2026-11-08).** |
| PLT-2 | Built with Electron and TypeScript. |
| PLT-3 | Installable packages per platform (indicative: Windows installer, macOS disk image). |
| PLT-4 | The app runs fully offline; no network access is required for any feature. |
| PLT-5 | The app is open source under the MIT license (OQ-1, resolved). |

## 5. Functional requirements

### 5.1 Key, scale and chord model

| ID | Requirement |
|---|---|
| FR-KEY-1 | The user can choose any of the 12 tonics. Enharmonic keys (e.g. F♯/G♭) are selectable with a chosen spelling (OQ-2). |
| FR-KEY-2 | Supported scale types: major, natural minor, harmonic minor, melodic minor, and all seven modes of the major scale (Ionian, Dorian, Phrygian, Lydian, Mixolydian, Aeolian, Locrian). |
| FR-KEY-3 | Progressions are stored as scale degrees (with optional accidentals) plus explicit chord quality, and are resolved to concrete chords for the selected tonic. Changing the key re-resolves the whole session. The scale type drives preset suggestions and the scale hints (see Assumption 5). |
| FR-KEY-4 | A chord may carry an explicit quality override or non-diatonic root (e.g. a dominant V7 in a minor key, a ♭VII borrowed chord) so common progressions such as the 12-bar blues and ii–V–I in minor can be expressed. |
| FR-CHD-1 | Chord vocabulary: major, minor, diminished and augmented triads; sevenths (maj7, m7, 7, m7♭5, dim7, mMaj7); extensions (9, 11, 13 and their common variants); suspended chords (sus2, sus4, 7sus4); and altered dominants (e.g. 7♯9, 7♭9, 7♯5, 7♭13). |
| FR-CHD-2 | Chord names are displayed in standard notation and spelled correctly for the key (sharps vs flats). |
| FR-CHD-3 | The set of notes for each chord (pitch classes, root, chord tones) is available to the playback engine and to the fretboard and scale-hint displays. |

### 5.2 Progression library and presets

| ID | Requirement |
|---|---|
| FR-LIB-1 | The app ships with a library of built-in preset progressions, grouped by category: rock, blues, jazz and modal vamps. The initial list is in Appendix A (OQ-3, resolved). |
| FR-LIB-2 | Presets are searchable/filterable by name and category. |
| FR-LIB-3 | The user can create a custom progression (chords, durations) and save it as a user preset. |
| FR-LIB-4 | The user can rename, edit and delete their own presets; built-in presets are read-only but can be duplicated as a starting point. |
| FR-LIB-5 | User presets persist across app restarts and are stored in a documented, versioned file format. |

### 5.3 Arrangement (sessions and sections)

| ID | Requirement |
|---|---|
| FR-ARR-1 | A **session** has one key and scale type, one tempo, one time signature, and an ordered list of **sections**. |
| FR-ARR-2 | A **section** has a name, a progression (a preset or custom), and a repeat count. |
| FR-ARR-3 | The user can add, remove, reorder, duplicate and rename sections. |
| FR-ARR-4 | Within a section the user can set how many bars each chord lasts, including chords that last less than one bar (e.g. two chords per bar). |
| FR-ARR-5 | Playback runs through the sections in order and then stops, or loops the whole arrangement (user-selectable). |
| FR-ARR-6 | Section boundaries are shown in the chord chart. |

### 5.4 Tempo and time signature

| ID | Requirement |
|---|---|
| FR-TMP-1 | The user sets the tempo in BPM. Proposed range 30–300 BPM (OQ-4). |
| FR-TMP-2 | Tempo can be changed during playback and takes effect without a glitch (at the next beat at the latest). |
| FR-TMP-3 | Supported time signatures: 4/4, 3/4, 6/8, 5/4, 7/8. |
| FR-TMP-4 | The metronome and bar grouping follow the time signature Defaults (OQ-5, resolved): BPM counts quarter notes, except 6/8 which counts dotted quarters; 6/8 groups 3+3, 7/8 groups 2+2+3, 5/4 groups 3+2 (user-switchable to 2+3). |

### 5.5 Playback

| ID | Requirement |
|---|---|
| FR-PLY-1 | Transport controls: play, pause/resume, stop, and return to start. |
| FR-PLY-2 | **Chords:** each chord is played as a sustained block chord for its full duration. Voicing uses a defined register (OQ-6), and the voicing of successive chords should avoid large jumps where reasonable. |
| FR-PLY-3 | **Bass:** the root of each chord is played in the bass register for the chord's duration. |
| FR-PLY-4 | **Metronome click:** an accented downbeat and regular beats; can be switched on and off independently of chords and bass. |
| FR-PLY-5 | **Count-in:** a configurable number of click bars before playback starts (0–4; default 1). The count-in is not shown as part of the arrangement. |
| FR-PLY-6 | **Loop:** the user can loop (a) the whole arrangement, (b) a single section, or (c) a selected bar range, indefinitely until stopped. The loop region is changeable during playback. |
| FR-PLY-7 | Chords, bass and click each have a volume control and a mute. |
| FR-PLY-8 | The current position (section, bar, beat) and the current and next chord are always visible during playback. |

### 5.6 Sound output

| ID | Requirement |
|---|---|
| FR-SND-1 | **Built-in synth:** plays SoundFont (.sf2) instruments. Chords, bass and click can each be assigned a different instrument/preset. |
| FR-SND-2 | The app bundles several SoundFonts covering at least: piano, bass, and guitar (plus click/percussion). All bundled SoundFonts must be redistributable under the project's license terms (see §8). |
| FR-SND-3 | The user can import their own .sf2 files and choose any preset from them. Imported files are referenced or copied into an app data folder; their licensing is the user's responsibility. |
| FR-SND-4 | **MIDI out:** the app can send to any available MIDI output port. The user can choose the port. |
| FR-SND-5 | Chords, bass and click are sent on separate, user-selectable MIDI channels (defaults: chords ch. 1, bass ch. 2, click ch. 10). |
| FR-SND-6 | The app can send MIDI clock (24 pulses per quarter note) plus Start/Stop/Continue messages, so a DAW can synchronize to the app. Clock output is switchable on and off. |
| FR-SND-7 | The built-in synth and MIDI out can be enabled simultaneously or independently, per part (chords, bass, click). |
| FR-SND-8 | On Windows, creating virtual MIDI ports is not supported by the OS; the app documents the need for a loopback driver (e.g. loopMIDI) to reach a DAW. On macOS the user can connect through the OS's virtual ports. |
| FR-SND-9 | Stopping or pausing playback never leaves hanging notes (all-notes-off is sent on every connected output). |

### 5.7 Display

| ID | Requirement |
|---|---|
| FR-UI-1 | **Chord chart:** a bar-by-bar grid showing all sections and chords. The current chord is highlighted and the next chord is marked. The chart follows the playhead. |
| FR-UI-2 | **Guitar fretboard:** a six-string, standard-tuning fretboard showing the chord tones of the current chord, with the root visually distinct. (Specific fingered shapes are out of scope; OQ-7.) |
| FR-UI-3 | **Scale/mode hints:** for the current chord, the app shows a scale or mode suited to improvising over it in the context of the session's key (e.g. Dorian over a ii chord in a major key), and the notes of that scale. A hint for the next chord is shown as well. For chords outside the key, the hint is chosen by chord quality (e.g. Mixolydian for a dominant 7th, altered scale for 7alt) and shown alongside the in-key scale (OQ-8, resolved; to be expanded in later iterations). |
| FR-UI-4 | Pre-play editing UI: select key/scale, tempo, time signature; browse and apply presets; build and edit sections. |
| FR-UI-5 | The UI is usable with keyboard alone for transport (space = play/pause, etc.); shortcuts are documented. |
| FR-UI-6 | Light and dark themes (follows the OS by default). |

### 5.8 Persistence and export

| ID | Requirement |
|---|---|
| FR-IO-1 | **Sessions:** save and load sessions to/from files. The format is a documented, versioned format (JSON proposed) so future versions can migrate old files. |
| FR-IO-2 | The app restores the last-used audio/MIDI settings on startup, and degrades gracefully when a saved MIDI port or SoundFont is no longer available. |
| FR-IO-3 | **MIDI export:** writes a Standard MIDI File containing tempo and time-signature meta events and separate tracks/channels for chords, bass and click. Options: include/exclude click, include/exclude count-in, number of times the arrangement repeats. |
| FR-IO-4 | **Audio export:** renders the built-in synth output to WAV. Options: include/exclude click, include/exclude count-in, repeats. Rendering runs faster than real time when possible and shows progress. **MP3 export is deferred**: every npm-distributable JS/WASM MP3 encoder embeds a copyleft codec, and the project's MIT licence (CON-4) rules out the LGPL ones; see ADR-0004. MP3 is added only when a combined-permissive encoder with validated quality is available. |
| FR-IO-5 | Audio export covers only the built-in synth. Output sent to external MIDI instruments cannot be captured by the app; the UI states this clearly. |

## 6. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-TIM-1 | Built-in synth: note scheduling is sample-accurate relative to the audio clock (look-ahead scheduling; no reliance on UI timers for note timing). |
| NFR-TIM-2 | MIDI out: timing jitter target under 5 ms during normal operation, with timestamped sends and look-ahead scheduling. Heavy UI activity must not audibly affect timing. |
| NFR-TIM-3 | Synth and MIDI out stay aligned when both are enabled. A user-adjustable offset (ms) compensates for audio output latency (OQ-10). |
| NFR-PRF-1 | Playback must run without audible dropouts on a typical mid-range laptop of the last several years. Targets for CPU and memory use are set in testing.md. |
| NFR-PRF-2 | Cold start to ready-to-play in under 5 seconds on a typical laptop (target; to be confirmed). |
| NFR-REL-1 | A missing/invalid SoundFont, absent MIDI device, or corrupt session file produces a clear error message and never crashes the app. |
| NFR-REL-2 | Hot-plugging a MIDI device is handled: the port list refreshes and a vanished port is reported without breaking playback. |
| NFR-SEC-1 | Electron hardening: context isolation on, node integration off in renderers, a minimal preload API, and no remote content loaded. |
| NFR-PRV-1 | No telemetry, analytics or network calls. |
| NFR-A11Y-1 | Sufficient colour contrast; meaning is never conveyed by colour alone (highlighted chord also has a non-colour marker); focus order and labels support keyboard and screen-reader use for core controls. |
| NFR-I18N-1 | UI strings are externalized to allow future translation. v1 ships in English. |
| NFR-MNT-1 | The music-theory core (keys, scales, chords, progression resolution) is a pure TypeScript module with no UI or audio dependencies, and is covered by unit tests. |
| NFR-MNT-2 | The audio/MIDI scheduling layer is separated from the UI so it can be tested with a simulated clock. |
| NFR-QLT-1 | The same feature set behaves identically on both supported platforms, apart from documented OS-specific MIDI port behaviour. |

## 7. Data model (conceptual)

```
Session
  key: { tonic, spelling }
  scaleType: major | naturalMinor | harmonicMinor | melodicMinor | dorian | ... 
  tempoBpm, timeSignature
  sections: [ Section ]
  mix: { chords, bass, click } -> { volume, mute, output(s), instrument/channel }
  playback: { countInBars, loopMode, loopRange }

Section
  name, repeatCount
  progression: ProgressionRef | inline Progression

Progression
  id, name, category, builtIn: boolean
  chords: [ ChordSlot ]

ChordSlot
  degree (I..VII, with optional accidental), quality / extension / alterations,
  durationBeats   (e.g. 4 in 4/4 = one bar)
```

Notes:
- Durations are stored in beats so a chord can span part of a bar or several bars.
- Built-in presets live in application data; user presets and sessions live in separate files with a `schemaVersion` field.

## 8. Constraints and dependencies

| ID | Constraint |
|---|---|
| CON-1 | Electron + TypeScript, with a React-style component UI is assumed (framework to be confirmed in implementation.md). |
| CON-2 | MIDI I/O in Electron relies on what Chromium's Web MIDI API (or a native module) can provide on each supported OS; the choice is made in implementation.md after a spike (see gap-analysis.md). |
| CON-3 | SoundFont synthesis requires an SF2-capable engine in JavaScript/WASM; candidate engines are evaluated in implementation.md. |
| CON-4 | Every dependency and every bundled asset (SoundFonts, click sounds, fonts, icons) must have a license compatible with the chosen project license, with required attributions shown in an About/Licenses screen. |
| CON-5 | Installer size grows with the number of bundled SoundFonts; a budget will be agreed (OQ-11). |
| CON-6 | macOS distribution may require code signing and notarization; Windows may need code signing to avoid SmartScreen warnings (OQ-12). |

## 9. Future scope (not v1)

- **VST3/CLAP plugin hosting** — requires a native host layer (native Node addon or separate helper process); until then, VST instruments are reachable via MIDI out to a DAW or standalone plugin host.
- **Audio clip playback** — loops or one-shots as a sound source.
- Editable rhythm patterns and style presets (comping, arpeggio, walking bass, drums).
- Transpose-on-the-fly / step through all keys each loop; gradual tempo ramp (speed trainer).
- Piano keyboard display; fingered guitar chord shapes; alternate tunings; left-handed view.
- Per-section key, tempo and time-signature changes.
- Import of chord charts from text or MusicXML; MIDI file import.
- Plug-in/extension API for community preset packs.

## 10. Assumptions

1. v1 uses one key, one tempo and one time signature per session.
2. Built-in presets are expressed in degrees and resolved per key; non-diatonic chords are marked explicitly.
3. The click uses the built-in synth or a bundled sample for internal output, and a GM percussion note on channel 10 for MIDI out.
4. SoundFont engine and MIDI I/O approach are chosen after short technical spikes; neither choice changes the requirements above.
5. **Preset resolution (confirmed 2026-11-07, closes G-01):** a preset's chord roots are fixed offsets from the tonic (major-scale degree numbering with accidentals, e.g. ♭VII) and its qualities are explicit, so a preset sounds the same in every scale type. The session's scale type is used to suggest presets (each preset declares a home scale type) and to drive scale hints, not to rewrite a preset's chords.

## 11. Acceptance criteria (summary)

| Area | Criterion |
|---|---|
| Playback | A 3-section arrangement in 4/4 plays start to finish with correct chords, bass and click at 120 BPM on both supported OSes. |
| Keys | Selecting each of the 12 tonics and each supported scale type resolves a ii–V–I (or the scale's equivalent) to the correct chords and spelling. |
| Timing | Over a 10-minute run at 140 BPM, no audible dropouts or drift; MIDI jitter within NFR-TIM-2 on each supported OS. |
| Loop | Loop of a bar range repeats seamlessly with no gap or doubled beat at the loop point. |
| MIDI | With a virtual port connected to a DAW, notes arrive on the three configured channels; clock keeps the DAW within one tick of the app; stop sends all-notes-off. |
| Export | Exported MIDI opens in a DAW with correct tempo, time signature and notes; exported WAV length matches the arrangement length to within one sample buffer. |
| Persistence | A saved session reloads to an identical arrangement; a session with a missing SoundFont loads and reports the missing asset. |
| Packaging | A clean install on each supported OS launches and plays with the bundled SoundFonts, with no network. |

## 12. Open questions

| ID | Question | Proposed default |
|---|---|---|
| OQ-1 | ~~Which open-source license?~~ **Resolved: MIT.** Dependencies must be MIT-compatible (permissive; Apache-2.0 is fine with NOTICE attribution). | — |
| OQ-2 | How are enharmonic keys offered (e.g. F♯ major vs G♭ major; D♯ minor vs E♭ minor)? | **Resolved 2026-11-07 (P2.5).** Both spellings are offered; the spelling is stored with the pitch class and preserved through scale, chord and degree resolution. All 12 tonics are available in sharp and flat spellings, and spellings that would need more than a double accidental fall back to the closest supported enharmonic and are flagged. |
| OQ-3 | ~~Initial preset list~~ **Resolved:** 29 presets across rock, blues, jazz and modal vamps (Appendix A); expandable by the user. | — |
| OQ-4 | Tempo range? | 30–300 BPM |
| OQ-5 | ~~BPM unit and beat grouping~~ **Resolved:** quarter-note BPM, except 6/8 uses dotted quarter; 7/8 groups 2+2+3; 5/4 groups 3+2 (user-switchable to 2+3). | — |
| OQ-6 | Voicing register and voice-leading rules for chords and bass? | **Implemented 2026-11-07 (P2.6); defaults documented in `docs/voicing-rules.md` and pending the M-7 listening review.** Chords are close-position in G3–C6, centred on middle C, with the inversion that moves least from the previous chord; chords with a 9th or higher drop the 5th, and an unaltered 11th is dropped over a major third. The bass plays the root in E1–E3, an octave below the chord centre. |
| OQ-7 | Fretboard: chord tones only, or also suggested fingered shapes? | Chord tones only in v1 |
| OQ-8 | ~~Scale hints for non-diatonic chords~~ **Resolved:** chord-scale chosen by chord quality, shown alongside the in-key scale. To be expanded in later iterations. | — |
| OQ-9 | ~~MP3 encoder choice and its license?~~ **Resolved 2026-11-06:** no combined-permissive JS/WASM MP3 encoder is distributed; v1.0 ships WAV only (ADR-0004). `rusty_mp3` (Apache-2.0) is the designated candidate if MP3 is reopened, subject to a listening test and a project-owned WASM build. | — |
| OQ-10 | How to calibrate latency compensation between synth and MIDI out? | Manual offset slider with a click-test helper |
| OQ-11 | ~~Installer size budget and the final list of bundled SoundFonts?~~ **Resolved 2026-11-07 (ADR-0005):** **250 MB per installer, 500 MB installed.** The 150 MB default is not reachable — the Electron runtime alone is ~115 MB of a compressed installer. The bundled set is the dedicated per-role FreePats fonts (piano, bass, acoustic guitar, electric guitar, percussion), all CC0 or CC-BY, shipped as SF3; no General MIDI bank fits the budget. |
| OQ-12 | ~~Code signing and notarization approach for macOS and Windows?~~ **Resolved 2026-11-07 (ADR-0005):** **interim releases are unsigned**, with per-platform install instructions. macOS notarization needs an Apple Developer Program membership (99 USD/year) with no free route for an ordinary open-source project; Windows signing is 9.99 USD/month (Azure Artifact Signing), 129–300 USD/year (public-CA OV) or free via SignPath Foundation for qualifying OSS; EV certificates are not recommended. The build configuration carries the signing path so adding credentials is configuration, not code. | — |

---

## Appendix A — Initial preset library (OQ-3)

Chords are written as degrees relative to the tonic (major-scale numbering, accidentals for borrowed chords). One chord per bar unless two chords are shown in a bar (separated by a slash `/`). "Home" is the scale type the preset is suggested for.

### Rock (8)

| # | Name | Home | Bars |
|---|---|---|---|
| R1 | Classic rock I–IV–V–IV | Mixolydian / Major | I · IV · V · IV |
| R2 | Mixolydian rock | Mixolydian | I · ♭VII · IV · I |
| R3 | Borrowed ♭III rock | Major | I · ♭III · IV · I |
| R4 | Minor rock vamp | Natural minor | i · ♭VII · ♭VI · ♭VII |
| R5 | Minor anthem | Natural minor | i · ♭VI · ♭III · ♭VII |
| R6 | Rock turnaround | Major | I · V · ♭VII · IV |
| R7 | 50s rock-and-roll | Major | I · vi · IV · V |
| R8 | Andalusian cadence | Natural minor / Phrygian | i · ♭VII · ♭VI · V |

### Blues (6)

| # | Name | Home | Bars |
|---|---|---|---|
| B1 | 12-bar blues | Mixolydian / Major | I7 · I7 · I7 · I7 · IV7 · IV7 · I7 · I7 · V7 · IV7 · I7 · I7 |
| B2 | 12-bar quick-change | Mixolydian / Major | I7 · IV7 · I7 · I7 · IV7 · IV7 · I7 · I7 · V7 · IV7 · I7 · V7 |
| B3 | 12-bar minor blues | Natural minor | i7 · i7 · i7 · i7 · iv7 · iv7 · i7 · i7 · ♭VI7 · V7 · i7 · V7 |
| B4 | 8-bar blues | Mixolydian / Major | I7 · V7 · IV7 · IV7 · I7 · V7 · I7 · V7 |
| B5 | Jazz blues (12-bar) | Major | I7 · IV7 · I7 · I7 · IV7 · ♯iv°7 · I7 · VI7 · ii7 · V7 · I7 / VI7 · ii7 / V7 |
| B6 | Blues turnaround | Mixolydian / Major | I7 · VI7 · ii7 · V7 |

### Jazz (8)

| # | Name | Home | Bars |
|---|---|---|---|
| J1 | ii–V–I (major) | Major | ii7 · V7 · Imaj7 · Imaj7 |
| J2 | ii–V–i (minor) | Natural / harmonic minor | iiø7 · V7♭9 · i m7 · i m7 |
| J3 | I–vi–ii–V | Major | Imaj7 · vi7 · ii7 · V7 |
| J4 | iii–vi–ii–V–I | Major | iii7 · vi7 · ii7 · V7 · Imaj7 · Imaj7 |
| J5 | I–VI7–ii–V turnaround | Major | Imaj7 / VI7 · ii7 / V7 |
| J6 | Backdoor ii–V | Major | iv7 · ♭VII7 · Imaj7 · Imaj7 |
| J7 | Tritone-substitution ii–V–I | Major | ii7 · ♭II7 · Imaj7 · Imaj7 |
| J8 | Diatonic cycle to the relative minor | Major | ii7 · V7 · Imaj7 · IVmaj7 · viiø7 · III7♭9 · vi m7 · vi m7 |

### Modal vamps (7)

| # | Name | Home | Bars |
|---|---|---|---|
| M1 | Dorian vamp | Dorian | i m7 · IV7 (2 bars each, repeated) |
| M2 | Mixolydian vamp | Mixolydian | I · ♭VII (2 bars each, repeated) |
| M3 | Phrygian vamp | Phrygian | i · ♭II (2 bars each, repeated) |
| M4 | Lydian vamp | Lydian | Imaj7 · II (2 bars each, repeated) |
| M5 | Aeolian vamp | Natural minor | i · ♭VI · ♭VII · i |
| M6 | Modal half-step shift | Dorian | i m7 (8 bars) · ♭ii m7 (4 bars) · i m7 (4 bars) |
| M7 | Locrian vamp | Locrian | i ø7 · ♭II maj7 (2 bars each, repeated) |

Notes:
- Counts: Rock 8, Blues 6, Jazz 8, Modal 7 = 29 presets.
- Presets whose "Home" is a mode are the main users of the scale-hint display (FR-UI-3).
- Chord spellings, extensions and substitutions are starting points; users can duplicate and edit any preset (FR-LIB-4).
