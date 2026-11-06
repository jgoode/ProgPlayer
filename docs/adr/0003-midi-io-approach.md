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
   Measured end to end against a real loopback — loopMIDI on Windows, a
   CoreMIDI virtual endpoint on macOS — over 912 sends (8 bars at 120 BPM),
   repeated across five CI runs per configuration (20 552 sends in total):

   | Platform | p99 jitter | max error | Late sends |
   |---|---|---|---|
   | Windows (`windows-latest`) | **1.10 ms** | 2.10 ms | **0 / 20 552** |
   | macOS (`macos-latest`) | **0.10 ms** | 0.10 ms | **0 / 20 552** |

   Both are inside the 5 ms budget (NFR-TIM-2). Zero sends were late in
   every configuration — idle, minimised, and heavy UI load — so the
   driver always received the message before its timestamp.

   One Windows run in five showed a **50.9 ms received outlier**: one bar
   arrived 51 ms late. The dispatch records show the app had handed that
   bar to the driver **96.4 ms early**, and the received MIDI clock in the
   same window stalled by the same 50 ms. The delay is in the loopback
   driver, not in the app — and the app cannot prevent a driver stall, but
   it also cannot be the cause of one.

3. **The native path cannot match it.** `RtMidiOut::sendMessage()` has no
   timestamp parameter: the bytes go to the OS immediately. To hit the
   intended instant the native sink must wake up exactly then, which means
   the wake-up jitter *is* the timing error. Measured with the same
   loopback on the same runners, over five runs each: **47.4–53.0 % of the
   sends were late on Windows and 75.4–83.6 % on macOS** (Windows p99
   dispatch lateness swung from +1.41 ms to +241.18 ms across the five
   runs; on a busy development machine, p50 +8.47 ms, p99 +14.79 ms, max
   +26.46 ms). The Web MIDI path has no such wake-up requirement because
   the driver does the waiting.

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

7. **A vanishing device does not break the schedule.** The hot-plug probe
   removes the loopback port from the OS while the measurement runs. The
   app keeps scheduling, no send throws, and no send is late (NFR-REL-2).
   On macOS the port also disappears from the port list and the
   `statechange` event reports it. **On Windows it does not**: the removal
   works — the OS no longer lists the port, confirmed by enumerating the
   ports outside Electron through RtMidi — but Chromium's WinMM backend
   keeps the stale port in its list and emits no event. Chromium only
   re-enumerates on a Windows device-change notification, and its own
   source notes that the raw device list may be updated before the
   MIDI driver's. **Consequence for P6: on Windows the app must not rely
   on `statechange` alone.** It must re-enumerate the ports when a send
   fails and when the MIDI settings are reopened, and treat a failed send
   as "the device is gone" — which `ResilientMidiSender` already does.

### What the measurements did **not** establish

- **Linux was not measured end to end.** The GitHub Azure runners' kernels
  ship without the ALSA sequencer drivers, so the virtual loopback cannot be
  created there. The dispatch path is platform-independent and Chromium's
  ALSA backend honours the timestamp (point 1), but the Linux p99 is
  unknown. **Gap G-20.**
- **No real MIDI hardware was involved.** The loopbacks are virtual ports;
  a USB interface adds its own buffering, which the app cannot control.
  The device checks in `testing.md` §7 (M-1..M-4) remain.
- **The macOS figure is at the capture's resolution.** The received
  timestamps are quantised to 100 µs, so 0.10 ms means "no measurable
  jitter", not a precise measurement.
- **The measurements are from a shared CI runner, not a quiet lab.** The
  Windows runners are shared, heavily loaded virtual machines, and the
  Windows results include one driver stall in five runs (§ "What the
  measurements established", point 2). The numbers are representative of a
  loaded machine, not a worst case.
- **The jitter criterion is measured, the *absolute* accuracy is not.** The
  received error includes the loopback driver's own round trip, so the
  1.10 ms is an upper bound on the app's error.

## Options considered

| Option | Summary | Pros | Cons |
|---|---|---|---|
| A | **Web MIDI in the renderer** (Chromium's timestamped `MIDIPort.send`) | Driver does the waiting, so the app's jitter does not reach the output (measured p99 jitter 1.10 ms on Windows, 0.10 ms on macOS, 0 late sends); stays in the renderer, as `implementation.md` §2.4 requires; no native dependency, no packaging burden, no ABI problem; hot-plug works on macOS and Linux | The timestamp must be derived correctly from the audio clock; Windows needs a virtual MIDI driver for a DAW (FR-SND-8); **Chromium's Windows backend does not report a removed device**, so hot-plug needs a send-failure fallback there; Linux not yet measured end to end (G-20) |
| B | **Native RtMidi addon in the main process** | Works on Windows, macOS and Linux with one API; can see ports Web MIDI hides; MIT-compatible and actively maintained | No timestamped send — the app's own wake-up jitter becomes the output jitter (measured: 47.4–53.0 % of sends late on Windows, 75.4–83.6 % on macOS across five runs; p99 +14.79 ms on a busy machine); needs an IPC hop for every message; native module cannot load in a sandboxed preload; three-platform ABI and packaging burden; contradicts the renderer-only rule |
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

The native candidate is **not** adopted as the shipping MIDI path. It
cannot meet the 5 ms budget as measured — on the same runners and the same
loopback, **47.4-53.0 % of its sends on Windows and 75.4-83.6 % on macOS were
late** — because it has no timestamped send. The fallback, if Web MIDI
proves unusable on a platform, is **Option C** — a native helper process
with its own high-resolution timer — and *not* Option B.

The end-to-end measurement **meets the exit check on Windows and macOS**:
p99 jitter 1.10 ms and 0.10 ms respectively, against a 5 ms budget, with
0 late sends in every configuration. The Linux measurement is out of scope
for this spike (G-20).

## Consequences

- Positive:
  - The timing model is simple and matches the architecture: one timeline,
    one look-ahead scheduler, one clock.
  - No native dependency ships with the app: no ABI matrix, no rebuild on
    every Electron upgrade, no code-signing of native libraries.
  - Hot-plug (`MIDIAccess.onstatechange`) and permission handling are part
    of the Web MIDI API, so NFR-REL-2 has a direct implementation — and the
    hot-plug probe showed that a port disappearing mid-playback does not
    throw and does not stop the schedule.
  - The hot-plug probe also found that **Chromium's Windows backend keeps a
    removed device in its port list**. The app must therefore treat a
    failed send as "the device is gone" and re-enumerate the ports, not
    wait for a `statechange` that will never come on Windows. This is a
    concrete requirement to carry into P6.
  - The measurement rig, the scheduler and the timing maths are reusable in
    Phase 6 (P6.1-P6.8).
  - The scheduler's look-ahead must be **at least 300 ms**: with a 100 ms
    window, heavy UI load made 3.5 % of the sends late, because the
    main-thread block delayed the Worker message handling and the driver
    clamps a past timestamp to an immediate send.
- Negative:
  - Windows users need a virtual MIDI driver to reach a DAW (FR-SND-8). The
    app must document loopMIDI and its licence.
  - Chromium hides the Microsoft GS Wavetable Synth from Web MIDI; users who
    want to send to it need a real or virtual port.
  - The end-to-end p99 jitter is **demonstrated on Windows and macOS only**.
    The Linux figure is unknown (G-20) and the real-hardware figure is
    unknown (`testing.md` §7).
- Follow-up work:
  - P6: implement the `MidiOutSink` interface, the port manager and the
    clock generator in `src/midi`, with the session permission handlers in
    `src/main`.
  - P6: on Windows, re-enumerate the ports when a send fails or the MIDI
    settings are reopened, because Chromium's WinMM backend does not
    report a removed device.
  - Close **G-20** by running the S2 harness on a Linux machine with the
    ALSA sequencer available.
  - Run the device checks in `testing.md` §7 (M-1..M-4) with a real MIDI
    interface.
  - Document the Windows loopback driver in the user guide (FR-SND-8).
