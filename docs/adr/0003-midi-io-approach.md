# ADR-0003: MIDI I/O approach

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-05 |
| **Requirement IDs** | FR-SND-4..9, NFR-TIM-2, NFR-TIM-3, NFR-REL-2, CON-2, CON-4 |
| **Task IDs** | P1.2, P1.6 |
| **Supersedes** | — |
| **Related** | ADR-0002 (SoundFont engine), `docs/spikes/s2-midi-out-report.md` |

## Context

The app must send chords, bass and click to an external MIDI output
(FR-SND-4), on separate channels (FR-SND-5), with MIDI clock at 24 ppqn and
Start/Stop/Continue (FR-SND-6), while the built-in synth may run at the same
time (FR-SND-7), without leaving hanging notes (FR-SND-9). The timing target
is p99 jitter under 5 ms on every supported OS (NFR-TIM-2), with the synth
and MIDI out aligned (NFR-TIM-3), and a vanished device must not break
playback (NFR-REL-2).

The architecture in `implementation.md` §2.4 puts the MIDI output in the
renderer and makes the audio clock the master, with `getOutputTimestamp()`
mapping it to the `performance.now()` base that Web MIDI timestamps use.

Two candidate implementations exist:

- **Web MIDI** (`navigator.requestMIDIAccess()`), with the Electron session
  permission handler granting access to the app's own origin.
- **A native RtMidi addon** in the main process, reached from the renderer
  through the typed preload API.

Spike S2 measured both. The findings are in
`docs/spikes/s2-midi-out-report.md`; the parts that decide this ADR are
repeated below.

### What the measurements established

1. **Chromium honours the Web MIDI timestamp, on every platform's code
   path.** Blink converts the DOM timestamp to `base::TimeTicks`
   (`GetTimeOrigin(context) + milliseconds`) and the platform managers turn
   it into a delay:
   - Windows (WinMM): `PostDelayedTask(..., TimestampToTimeDeltaDelay(timestamp))`
     → the message is handed to `midiOutShortMsg` at the intended instant.
   - Windows (WinRT): the same delayed-task mechanism, then
     `IMidiOutPort::SendBuffer`.
   - macOS: `MIDITimeStamp coremidi_timestamp = TimeTicksToMIDITimeStamp(timestamp)`
     → the CoreMIDI event carries the intended time.
   - Linux (ALSA): the send is posted as a delayed task and the ALSA event is
     sent with `snd_seq_ev_set_direct`, i.e. immediately when the delayed task
     fires.
   The timestamp is *not* ignored anywhere in the Chromium 156 code that
   Electron 45.2.2 ships.

2. **A timestamped send moves the jitter from the app into the driver.**
   With a 100 ms look-ahead, the Web MIDI path dispatched 912 messages with
   **0 late dispatches**; the dispatch lateness stayed inside
   [−100 ms, −80 ms] (i.e. every message was handed to the driver early
   enough for its timestamp to be honoured).

3. **The native path cannot match it.** `RtMidiOut::sendMessage()` has no
   timestamp parameter: the bytes go to the OS immediately. To hit the
   intended instant the native sink must wake up exactly then, which means
   the wake-up jitter *is* the timing error. Measured on Windows over 912
   events with `setTimeout` armed at the intended time: **862 late sends
   (94.5 %), p50 +8.47 ms, p99 +14.79 ms, max +26.46 ms** of lateness — over
   the 5 ms budget before the driver is even involved. The Web MIDI path has
   no such wake-up requirement because the driver does the waiting.

4. **The native path also cannot stay in the renderer.** The addon is a
   native Node module: it cannot be loaded in a sandboxed preload (measured:
   `module not found: @julusian/midi`) and cannot be loaded in the renderer
   at all. It would have to live in the main process, which means every note
   crosses an IPC boundary. Measured renderer→main round trip over 300
   calls, three runs: **p50 0.20 ms, p95 0.50 ms, p99 2.1–2.3 ms, max
   17.4 ms** — usable, but it is jitter added to a path that already cannot
   meet the budget, the 17 ms outlier shows the main process's event loop is
   not guaranteed to be free, and it breaks the "audio and MIDI run in the
   renderer" rule of `implementation.md` §1-2.

5. **The native candidate is nevertheless viable as a fallback.**
   `@julusian/midi` 3.8.1 is MIT-licensed, vendors RtMidi 6.0.0 (MIT-style
   "RtMidi licence"), is maintained (last release 2026-08-10) and ships
   Node-API v7 prebuilt binaries for Windows x64/ia32/arm64, macOS
   x64/arm64 and Linux x64/arm64/musl. It loaded and enumerated ports
   inside Electron 45.2.2's main process on this machine.

6. **Chromium hides the Microsoft GS Wavetable Synth from Web MIDI.** The
   WinMM backend explicitly refuses to connect the Microsoft software
   synthesiser (crbug.com/499279). The native candidate sees it. This
   matters only for the measurement rig (it was the only output port on the
   measurement machine), not for the product.

### What the measurements did **not** establish

The loopback capture could not be run on the measurement machine: no MIDI
loopback driver could be installed (loopMIDI needs administrator rights that
the session could not obtain), and the Windows MIDI Services runtime that
ships loopback endpoints is not installed on that machine. Consequently
**the end-to-end loopback error (received timestamp − intended timestamp)
was not measured on Windows**, and macOS and Linux were not measured at all
on this machine. The measured numbers in this ADR are therefore *dispatch*
numbers — the part of the path the app controls — plus the Chromium and
RtMidi source-level behaviour of the driver hand-off. The end-to-end
numbers remain open; `docs/spikes/s2-midi-out-report.md` records the exact
measurement protocol and the CI workflow that produces them.

## Options considered

| Option | Summary | Pros | Cons |
|---|---|---|---|
| A | **Web MIDI in the renderer** (Chromium's timestamped `MIDIPort.send`) | Driver does the waiting, so the app's jitter does not reach the output; stays in the renderer, as `implementation.md` §2.4 requires; no native dependency, no packaging burden, no ABI problem; `statechange` gives hot-plug for free | The timestamp must be derived correctly from the audio clock; Windows needs a virtual MIDI driver for a DAW (FR-SND-8); the exact end-to-end jitter still has to be measured on all three OSes |
| B | **Native RtMidi addon in the main process** | Works on Windows, macOS and Linux with one API; can see ports Web MIDI hides; MIT-compatible and actively maintained | No timestamped send — the app's own wake-up jitter becomes the output jitter (measured p99 15.2 ms, over budget); needs an IPC hop for every message; native module cannot load in a sandboxed preload; three-platform ABI and packaging burden; contradicts the renderer-only rule |
| C | **Native addon in a helper process** (dedicated MIDI service) | Same API as B without blocking the main process; the helper could hold the port and do its own high-resolution timing | Still no timestamped send, so the same wake-up jitter; adds a process to install, supervise and secure; the IPC hop remains; a lot of machinery for a path that does not meet the budget |
| D | **Web MIDI first, native addon as a fallback** | Keeps the simple path where it works; the native addon is available for the platforms where Web MIDI fails | Two MIDI implementations, two timing models, two sets of bugs; the native path cannot meet NFR-TIM-2 as measured, so it is a fallback for *availability*, not for *accuracy* |

## Decision

**PracticePlayer uses Web MIDI in the renderer for MIDI output
(Option A).**

- The MIDI sink lives in the renderer (`src/midi`), behind an interface that
  the production implementation will fill with `navigator.requestMIDIAccess()`.
- The Electron main process registers the session permission handlers
  (`setPermissionRequestHandler`, `setPermissionCheckHandler`) and grants
  `midi` to the app's own origin only; `midiSysex` is denied unless the
  user explicitly asks for it.
- The scheduler is Worker-driven with a look-ahead window, and every message
  carries the `performance.now()`-domain timestamp derived from the audio
  clock through `getOutputTimestamp()`, offset by `outputLatency +
  baseLatency + userOffsetMs` (NFR-TIM-3).
- `@julusian/midi` 3.8.1 (MIT) is kept as a **spike-time dependency only**;
  it is not a runtime dependency of the application and is not added to the
  app's dependency tree. It stays in the licence register as a verified,
  evaluated fallback (Option D's fallback) so that if Web MIDI proves
  unusable on a platform, the work is already done.

The native candidate is **not** adopted as the shipping MIDI path. If the
end-to-end measurement in §7 of the report shows Web MIDI missing the 5 ms
p99 target on a platform, the fallback is **Option C** — a native helper
process with its own high-resolution timer — and *not* Option B, because
Option B cannot meet the budget as measured.

## Consequences

- Positive:
  - The timing model is simple and matches the architecture: one timeline,
    one look-ahead scheduler, one clock.
  - No native dependency ships with the app: no ABI matrix, no rebuild on
    every Electron upgrade, no code-signing of native libraries.
  - Hot-plug (`MIDIAccess.onstatechange`) and permission handling are part
    of the Web MIDI API, so NFR-REL-2 has a direct implementation.
  - The measurement rig, the scheduler and the timing maths are reusable in
    Phase 6 (P6.1-P6.8).
- Negative:
  - Windows users need a virtual MIDI driver to reach a DAW (FR-SND-8). The
    app must document loopMIDI and its licence.
  - Chromium hides the Microsoft GS Wavetable Synth from Web MIDI; users who
    want to send to it need a real or virtual port.
  - The end-to-end p99 jitter is **not yet demonstrated** on all three OSes.
    The go/no-go for NFR-TIM-2 stays open until the loopback measurement in
    `docs/spikes/s2-midi-out-report.md` §7 is complete.
- Follow-up work:
  - P6: implement the `MidiOutSink` interface, the port manager and the
    clock generator in `src/midi`, with the session permission handlers in
    `src/main`.
  - Close **G-20** (end-to-end MIDI jitter not yet measured on all three
    OSes) using the CI workflow added for S2.
  - Document the Windows loopback driver in the user guide (FR-SND-8).
