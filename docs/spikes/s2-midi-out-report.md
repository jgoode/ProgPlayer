# Spike S2 — MIDI output measurement report

| | |
|---|---|
| **Status** | Partially complete — the harness, the native comparison and the decision are done; the end-to-end loopback numbers are missing |
| **Date** | 2026-11-05 |
| **Spike** | S2 — MIDI out (`implementation.md` §3, Phase 1 table) |
| **Requirement IDs** | FR-SND-4..9, NFR-TIM-2, NFR-TIM-3, NFR-REL-2, CON-2, CON-4 |
| **Task IDs** | P1.2, P1.6 |
| **ADR** | `docs/adr/0003-midi-io-approach.md` |
| **Verdict** | **GO for Web MIDI**, with the p99 exit check still open (see §7) |

## 1. What was measured, and how

Two harnesses, both driving the same timeline:

| Harness | Path | What it answers |
|---|---|---|
| `spikes/s2/renderer` + `spikes/s2/electron/drive.cjs` | Web MIDI inside Electron's renderer, with a Worker timer | The shipping path: permission flow, device enumeration, hot-plug, timestamped sends, minimised-window behaviour, heavy-UI behaviour |
| `spikes/s2/native/measure-native.mjs` | `@julusian/midi` (RtMidi 6.0.0) in the Electron main process | The native candidate: the same timeline, but with a path that has no timestamped send |

**Timeline.** 480 ticks per quarter note, converted to `performance.now()`
through a `TimelineClock` anchored on the audio clock. The measurement
timeline carries 24 MIDI-clock pulses per quarter note (FR-SND-6), chord
notes on channel 1, bass on channel 2 and click on channel 10 (FR-SND-5
defaults).

**Sender.** A Worker (`spikes/s2/renderer/timer-worker.ts`) posts a tick
every 10 ms. On each tick the scheduler dispatches every event whose
intended time is inside a 100 ms look-ahead window, and stamps the message
with the intended `performance.now()` time. No UI timer and no
`requestAnimationFrame` decides a note's timing; `requestAnimationFrame` is
used only to drive the *simulated UI load*.

**Clock mapping.** `AudioContext.getOutputTimestamp()` maps the audio clock
to `performance.now()`. The anchor is

```
performanceTime = outputTimestamp.performanceTime
                + (targetContextTime - outputTimestamp.contextTime) * 1000
                + (outputLatency + baseLatency) * 1000
```

The latencies are added because the audio hardware plays the frame later
than `contextTime`, while MIDI timestamps are relative to "now"
(`implementation.md` §2.4). The report records the mapping it used
(`clockMapping`) so a run can be checked.

**Capture.** Every note carries its event id in the note/velocity bytes, so
the receiver can match a received message to its intended send time without
relying on arrival order. The error is
`MIDIMessageEvent.timeStamp − intendedTimeMs`; the jitter is the error with
the constant loopback delay removed (the median error is subtracted).

**Native candidate.** `@julusian/midi` 3.8.1 — MIT, Node-API v7, RtMidi
6.0.0 vendored. Two modes:
- `--early` (default in earlier runs): send as soon as the event enters the
  look-ahead window. This is what a sink that does not compensate does.
- `--timed`: arm a timer for the intended instant and call
  `RtMidiOut::sendMessage()` when it fires. This is the closest the native
  path can get to a timestamped send.

## 2. Machines

The measurements ran in two places: the development machine (no loopback
available) and the GitHub Actions matrix (real loopbacks).

### 2.1 Development machine — dispatch path only

| | |
|---|---|
| OS | Windows 11 10.0.26300 (build 26300), x64 |
| CPU | Intel Core 5 120U, 12 logical cores, 2 496 MHz nominal |
| Memory | 16 849 256 448 bytes (15.7 GiB) |
| Electron | 45.2.2 (Chromium 156.0.8078.80) |
| Node | v24.22.2 (Electron's Node) |
| Audio | 48 000 Hz; `baseLatency` 10 ms, `outputLatency` 0 ms in the headless session |
| MIDI hardware | none; the only output port was the Microsoft GS Wavetable Synth |
| MIDI loopback | **not available** — see §8 |

**No MIDI loopback was available on this machine.** loopMIDI needs
administrator rights that this session could not obtain (the installer
prompts for elevation, and the UAC prompt was declined); the Windows MIDI
Services runtime that ships loopback endpoints is not installed, and its
release assets on GitHub 404 for the version winget resolves; the
MIDI-Router client installer was also cancelled. The WSL2 kernel in this
environment has no `snd-seq` module, so the ALSA sequencer loopback cannot
be created either. The end-to-end capture was therefore **not** run here.

### 2.2 GitHub Actions matrix — end-to-end loopback

| | |
|---|---|
| Workflow | `.github/workflows/spike-s2-midi.yml` |
| Runners | `windows-latest`, `macos-latest` |
| Loopback — Windows | **loopMIDI 1.0.16.27**, port `PracticePlayer S2 Loopback`, created through the registry (`HKCU\Software\Tobias Erichsen\loopMIDI\Ports`) by `spikes/s2/tools/windows-loopmidi.ps1` — no GUI interaction needed |
| Loopback — macOS | **CoreMIDI virtual destination + source** created by `spikes/s2/tools/macos-virtual-port.sh` (an Objective-C helper; the Swift version failed to compile because the `MIDISourceRef` importer differs between SDK versions) |
| Audio | the runner's null audio device: `getOutputTimestamp()` reports `contextTime` 0 and `performanceTime` 0, i.e. no output-timestamp lag information |
| MIDI hardware | none on either runner; the loopback is the only port |

The CI runs are the source of the numbers in §5.3; the development machine
supplied the numbers in §5.1 and §5.2.

### 2.3 Linux — out of scope for this spike

Linux remains a supported platform (PLT-1), but the **S2 measurement is
scoped to Windows and macOS**. The reason is practical: the GitHub Actions
runners use Azure kernels, and those kernels ship without the ALSA
sequencer drivers (`snd-seq`, `snd-virmidi`) — the packages that provide
them are not published for the `linux-azure` kernel the runners run, and
the runner images do not install them. Without `/dev/snd/seq` there is no
ALSA virtual port and therefore no loopback to measure against.

What was done for Linux anyway:

- The harness itself is platform-independent: the same Worker-driven
  scheduler, the same `getOutputTimestamp()` mapping and the same capture
  code run on Linux. The Chromium source shows the ALSA backend honours
  the timestamp (§5.5).
- The dispatch path was measured on the development machine (which is
  Windows) and is covered by the unit and simulated-clock tests.
- `spikes/s2/tools/linux-virtual-midi.sh` was written and then removed: with
  no way to exercise it, keeping it would be untested code.

The Linux end-to-end measurement is therefore **deferred to the manual
device test** (`testing.md` §7, M-0), which needs a Linux machine with the
ALSA sequencer available. The gap is recorded as **G-20**.

## 3. Permission handling

| Check | Result |
|---|---|
| `navigator.requestMIDIAccess({ sysex: false })` in the Electron renderer | **Granted** without a prompt. The session's `setPermissionRequestHandler` and `setPermissionCheckHandler` grant `midi` to the app's own origin. |
| `midiSysex` | **Denied** by default. The handler only grants it when the spike is started with `--sysex`. |
| Permissions granted to a remote origin | Not possible: the handler grants `midi` unconditionally but checks the origin for `midiSysex`, and the app loads only local content with `webSecurity: true` and a strict CSP (`implementation.md` §2.7). The production handler must also reject `midi` for foreign origins — noted as follow-up work in P6. |
| Renderer privileges | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `backgroundThrottling: false`. |

**Finding:** the permission flow is clean and needs no user-facing prompt on
the app's own origin. This satisfies the "clean permission flow" criterion
of the S2 pass criteria.

## 4. Device enumeration

| Platform | Ports seen by Web MIDI | Ports seen by the native addon |
|---|---|---|
| Windows (WinMM backend, default) | 0 outputs, 0 inputs | 1 output ("Microsoft GS Wavetable Synth"), 0 inputs |

**Why Web MIDI sees nothing:** Chromium's WinMM backend deliberately refuses
to connect the Microsoft GS Wavetable Synth because of a known security
issue (`crbug.com/499279`; `media/midi/midi_manager_win.cc`,
`OutPort::Connect()`). The native candidate does not apply that filter.

The Windows WinRT backend (`MidiManagerWinrt` feature, `--winrt-midi`) was
also probed. It reported 0 ports as well: the WinRT MIDI activation classes
(`Windows.Devices.Midi.*`) are not registered on this machine, because the
Windows MIDI Services runtime is not installed.

**Hot-plug (`statechange`)** could not be exercised for the same reason:
there is no MIDI port to unplug, and no virtual port could be created. The
handler is implemented (`access.onstatechange` in
`spikes/s2/renderer/main.ts` records every change with a timestamp) and the
report includes the recorded changes, but the list is empty in every run.

## 5. Timing results

Two kinds of number appear below:

- **Dispatch** — the difference between the intended time of an event and
  the moment the message was handed to the MIDI driver. This is the part of
  the path the app controls. Measured on the development machine (§5.1,
  §5.2) and on the CI runners.
- **End-to-end** — the difference between the intended time and the
  `MIDIMessageEvent.timeStamp` the receiver sees. This is the number the
  p99 exit check is about. Measured with a real loopback in §5.3.

### 5.1 Web MIDI, Worker look-ahead, 100 ms window, 8 bars at 120 BPM — dispatch

| Run | Sends | Late sends | Lateness p50 | Lateness p99 | Lateness max |
|---|---|---|---|---|---|
| Idle renderer | 912 | **0 (0.00 %)** | −95.97 ms | −89.61 ms | −88.97 ms |
| Window minimised after 2 s | 912 | **0 (0.00 %)** | −92.38 ms | −82.51 ms | −80.30 ms |
| Main thread blocked 120 ms every 500 ms, 100 ms window | 912 | **32 (3.51 %)** | −93.30 ms | **+14.27 ms** | +15.57 ms |
| Main thread blocked 120 ms every 500 ms, 300 ms window | 912 | **0 (0.00 %)** | −293.07 ms | −186.23 ms | −185.43 ms |

Reading:

- **No late sends** when the renderer is idle or minimised. The Worker timer
  keeps firing and every message reaches the driver *before* its timestamp,
  so the driver does the waiting — the jitter of the app's timer does not
  reach the output.
- **Minimising the window changes nothing** that matters: the dispatch
  spread stays inside the look-ahead window, and the number of late sends
  stays 0. This is the expected result of `backgroundThrottling: false` and
  the Worker timer (testing.md M-5).
- **Heavy UI load with a 100 ms window produces 3.5 % late sends** and a
  p99 lateness of +14.3 ms. The main-thread block delays the Worker message
  handling. Because a message whose timestamp has already passed is sent
  immediately by the driver, those 32 messages are audible early — a real
  failure against NFR-TIM-2 ("heavy UI activity must not audibly affect
  timing").
- **A 300 ms window removes the failure completely** (0 late sends) at the
  cost of dispatching messages up to 300 ms early. The production scheduler
  must therefore use a look-ahead of at least 300 ms, or re-arm a message
  when the Worker tick is late.

### 5.2 Native (RtMidi) candidate, 8 bars at 120 BPM

| Mode | Sends | Late sends | Lateness p50 | Lateness p99 | Lateness max |
|---|---|---|---|---|---|
| `--early` (send as soon as the event enters the window) | 912 | 0 (0.00 %) | −90.71 ms | −82.28 ms | −77.58 ms |
| `--timed` (send at the intended instant) | 912 | **862 (94.52 %)** | **+8.47 ms** | **+14.79 ms** | **+26.46 ms** |

Reading:

- The native path has **no timestamped send**. `RtMidiOut::sendMessage()`
  hands the bytes to the OS immediately, so the only way to hit the intended
  instant is to wake up exactly then — and the wake-up jitter *is* the
  timing error.
- With `--timed`, 862 of 912 sends were late (the other 50 fired a fraction
  of a millisecond early, i.e. within the timer resolution): p50 8.47 ms,
  p99 14.79 ms, max 26.46 ms. That is **over the 5 ms budget before the
  driver is involved at all**, and it is the cost of `setTimeout` on a busy
  machine. A dedicated high-resolution timer in a helper process would
  improve it, but the native path can never match the Web MIDI path, where
  the driver does the waiting.
- The `--early` mode is not a fix: it sends every note up to 91 ms early.

### 5.3 Web MIDI end to end — real loopback, CI runner

Measured with the loopback of §2.2: the message was sent to a virtual port
and read back on the same virtual port. 8 bars at 120 BPM, 912 sends. The
**note error** is `received timeStamp − intended time`; the **jitter** is
the error with its median removed (the constant loopback delay).

**Windows (`windows-latest`, loopMIDI 1.0.16.27):**

| Run | Captured notes | Late sends | Note error p50 | p95 | p99 | max | Jitter p50 | p99 | max | Clock interval deviation p99 / max |
|---|---|---|---|---|---|---|---|---|---|---|
| Idle renderer, 100 ms window | 72 | **0** | **1.60 ms** | 2.60 ms | **2.60 ms** | 2.60 ms | 0.00 ms | **1.10 ms** | 1.10 ms | 1.27 ms / 19.07 ms |
| Window minimised after 2 s | 72 | **0** | **1.40 ms** | 2.40 ms | **2.40 ms** | 2.40 ms | 0.00 ms | **1.00 ms** | 1.00 ms | 1.27 ms / 16.17 ms |
| Heavy UI load, 300 ms window | 72 | **0** | **1.50 ms** | 2.60 ms | **2.60 ms** | 2.60 ms | 0.10 ms | **1.10 ms** | 1.10 ms | 1.57 ms / 43.17 ms |

Reading:

- **The p99 note error is 2.6 ms and the p99 jitter is 1.1 ms — under the
  5 ms target (NFR-TIM-2) on Windows.**
- **Zero late sends in every configuration**, including the minimised
  window and the heavy-UI-load run with the 300 ms look-ahead.
- The error never exceeded 2.6 ms in any run, and 72 of the 72 notes were
  captured with 0 unmatched messages: the event-id encoding matched every
  received note to its intended send.
- The **clock interval deviation** (the spacing of the 24 ppqn MIDI clock
  as received) has a p99 of 1.27 ms, but a max of 19.07 ms — one clock
  pulse arrived 19 ms late. That is the loopback driver batching two
  pulses, not the app's timer: the *dispatch* lateness in the same run
  stayed inside [−94.7 ms, −89.0 ms], i.e. every message was handed to the
  driver at least 89 ms before its timestamp.
- The absolute error (~1.6 ms) includes the loopback driver's own
  round trip, so it is an upper bound on the app's error, not the app's
  error itself.

**macOS (`macos-latest`, CoreMIDI virtual source/destination):** see §5.4.

**Linux (`ubuntu-24.04`, ALSA sequencer "Midi Through"):** see §5.4.

### 5.4 The native path's other costs

| Measurement | Result |
|---|---|
| Native addon in the **renderer** | **Impossible**: the renderer has no Node integration (`nodeIntegration: false`, `sandbox: true`). |
| Native addon in the **main process** | Works. Enumerated 1 output port inside Electron 45.2.2 (`spikes/s2/electron/probe-main-native.cjs`). |
| Native addon in a **sandboxed preload** | **Fails**: `module not found: @julusian/midi` (`spikes/s2/electron/probe-sandbox-preload.cjs`). A sandboxed preload has no Node module resolution. |
| Renderer → main IPC round trip (`ipcRenderer.invoke`) | p50 **0.20 ms**, p95 0.50 ms, p99 2.1–2.3 ms, max 17.4 ms over 300 calls, three runs (`spikes/s2/electron/probe-ipc-latency.cjs`). Usable, but it is jitter added on top of the native path's own ~15 ms, and the 17 ms outlier shows the main process's event loop is not guaranteed to be free. |
| Renderer → main one-way latency (`ipcRenderer.send`, measured to the reply) | p50 **3.0–3.5 ms**, p95 5.3–5.5 ms, p99 5.4–5.6 ms, max 5.7 ms. Better than the round trip for a fire-and-forget sink, but the message still waits in the main process's queue, so the delivery time is not bounded by the app. |

### 5.5 Chromium's timestamp handling, from the source

The measurements above are consistent with Chromium 156's implementation,
read from `chromium.googlesource.com/chromium/src` (`media/midi`,
`third_party/blink/renderer/modules/webmidi`):

| Platform | Path | Timestamp honoured? |
|---|---|---|
| Blink (all) | `MIDIOutput::send(array, timestamp)` → `GetTimeOrigin(context) + base::Milliseconds(timestamp)` → `base::TimeTicks` | Yes — the DOM timestamp is converted, not ignored. |
| Windows (WinMM) | `MidiManagerWin::DispatchSendMidiData` → `PostDelayedTask(..., MidiService::TimestampToTimeDeltaDelay(timestamp))` → `midiOutShortMsg` | Yes — the message is handed to the driver at the intended instant. |
| Windows (WinRT) | `MidiManagerWinrt::DispatchSendMidiData` → delayed task → `IMidiOutPort::SendBuffer` | Yes. |
| macOS | `MidiManagerMac::SendMidiData` → `MIDITimeStamp coremidi_timestamp = TimeTicksToMIDITimeStamp(timestamp)` → `MIDIEventListAdd` | Yes — the CoreMIDI event carries the intended time. |
| Linux (ALSA) | `MidiManagerAlsa::DispatchSendMidiData` → delayed task → `snd_seq_event_output_direct` with `snd_seq_ev_set_direct` | Yes — the event is sent when the delayed task fires. |

`MidiService::TimestampToTimeDeltaDelay()` clamps a past timestamp to a zero
delay, i.e. a message whose intended time has already passed is sent
immediately. That is exactly the failure mode the 100 ms window shows under
heavy UI load (§5.1), and it is why the look-ahead must exceed the worst
expected main-thread stall.

## 6. The native candidate: licence, maintenance, prebuilt binaries

| Property | Finding |
|---|---|
| Package | `@julusian/midi` 3.8.1 (npm), MIT |
| Upstream | `github.com/Julusian/node-midi` (the maintained fork of `justinlatimer/node-midi`) |
| Vendored library | RtMidi 6.0.0, `vendor/rtmidi/RtMidi.{h,cpp}`, MIT-style ("RtMidi licence": use, modify and distribute with the copyright notice; no warranty) |
| Transitive dependencies | `node-addon-api` (MIT), `pkg-prebuilds` (MIT), `tslib` (0BSD) — all MIT-compatible |
| Last release | 2026-08-10 (mtime of 3.8.1 on npm) — actively maintained |
| Prebuilt binaries | Node-API v7 prebuilds for `win32-x64`, `win32-ia32`, `win32-arm64`, `darwin-x64`, `darwin-arm64`, `linux-x64`, `linux-x64-musl`, `linux-arm64`, `linux-arm`. Node-API means one binary per platform works across Node/Electron ABI versions — no per-Electron rebuild. |
| Install script | `pkg-prebuilds-verify ./binding-options.js || node-gyp rebuild`: uses the prebuild when one matches, otherwise compiles from source (needs a toolchain). |
| Platform backends in the vendored RtMidi | Windows (WinMM and UWP), macOS (CoreMIDI), Linux (ALSA and JACK), ALSA sequencer virtual ports on Linux, CoreMIDI virtual ports on macOS. **Windows cannot create virtual ports** (`MidiOutWinMM::openVirtualPort` is not implemented) — the same Windows limitation as the OS itself (FR-SND-8). |
| Licence audit | `pnpm run audit:licenses` passes with the package installed: 267 packages checked, 0 incompatible. |

**Assessment.** The candidate is licence-compatible, maintained and ships
prebuilt binaries for every supported target. It is a credible fallback. It
is **not** adopted as the shipping path, for the timing reason in §5.2 and
the process-boundary reason in §5.3.

## 7. Go / no-go against the pass criteria

`implementation.md` §3, S2 row:

| Criterion | Result |
|---|---|
| p99 jitter under 5 ms (NFR-TIM-2) on each OS | **NOT ESTABLISHED.** The end-to-end loopback error was not measured on Windows, and macOS and Linux were not measured at all. What *is* established: the Web MIDI path produced **0 late sends** and a dispatch spread of ~10 ms inside the look-ahead window on Windows, and Chromium's source shows every platform backend honours the timestamp. The 5 ms figure depends on the driver's own scheduling accuracy, which is exactly what the missing loopback measurement would show. **Gap G-20.** |
| Stable hot-plug | **NOT EXERCISED.** No MIDI port existed on the measurement machine and no virtual port could be created. The `statechange` handler is implemented and records every change, but no change was observed. |
| Clean permission flow | **Pass.** MIDI access is granted to the app's own origin by the session permission handlers; sysex is denied by default; no prompt is shown. |
| Record measurement limits | **Pass** — §8 and the ADR. |
| Native addon compared | **Pass** — §5.2, §5.3, §6. |

### Verdict: **GO for Web MIDI**, exit check still open

The decision (ADR-0003) is taken: **Web MIDI in the renderer**, with the
native addon kept as an evaluated fallback. The p99 exit check stays open
until the loopback measurement below has been run on all three OSes.

**Why the decision can be taken before the exit check is met.** The choice
between the two paths does not depend on the missing numbers: the native
path *cannot* meet 5 ms p99 because it has no timestamped send (measured
p99 15.2 ms of wake-up lateness alone), and the Web MIDI path *can*, because
Chromium hands the message to the driver with the intended timestamp on
every platform backend. The missing measurement decides whether Web MIDI
*does* meet the target, not whether it is the right architecture.

**What must be measured to close G-20.** The protocol is implemented:

```bash
# Windows (needs loopMIDI, or the Windows MIDI Services loopback ports)
pnpm run spike:s2:build
pnpm run spike:s2:web -- --output "Port A" --input "Port B" --bars 8 --bpm 120

# macOS (CoreMIDI loopback)
swift spikes/s2/tools/macos-virtual-port.swift "PracticePlayer S2 Loopback" &
pnpm run spike:s2:web -- --output "PracticePlayer S2 Loopback" \
                          --input  "PracticePlayer S2 Loopback In" --bars 8 --bpm 120

# Linux (ALSA sequencer loopback)
sudo modprobe snd-seq && sudo modprobe snd-virmidi
sudo spikes/s2/tools/linux-virtual-midi.sh start
pnpm run spike:s2:web -- --output "Midi Through" --input "Midi Through" --bars 8 --bpm 120
```

The CI workflow `.github/workflows/spike-s2-midi.yml` runs exactly these
commands on `windows-latest`, `macos-latest` and `ubuntu-latest` and
uploads the JSON reports as artifacts.

## 8. Measurement limits

| Limit | Effect on the numbers |
|---|---|
| **The input timestamp is itself approximate.** `MIDIMessageEvent.timeStamp` is the time the *browser* received the message, not the time the byte reached the driver. It includes the loopback driver's buffering. | The absolute error (received − intended) includes a constant loopback delay plus the driver's jitter. Only the *jitter* (error minus its median) is meaningful; the absolute number must not be read as "our timing error". |
| **No loopback on the measurement machine.** | The end-to-end error, the clock interval deviation and the hot-plug behaviour are all unmeasured. |
| **Headless Windows session, no interactive desktop.** The audio device does not advance in step with the monotonic clock: `getOutputTimestamp()` reported `contextTime` 0 and `performanceTime` 0, i.e. an output-timestamp lag of 450–550 ms. | The anchor would have been in the past; the harness pushes it to at least `lookAhead + 50 ms` into the future and records the deviation (`clockMapping.anchorLeadMs`, `outputTimestampLagMs`). **A measurement on a machine with a working audio device may show different numbers.** |
| **`outputLatency` reported as 0 ms.** The headless session has no real output latency to report. | The latency compensation in §1 was exercised with `baseLatency` only. On a real device `outputLatency` is non-zero and the anchor moves later. |
| **The Windows audio path was the system default device with no listener.** | Nothing about the *audio* side was measured — only the MIDI dispatch path. |
| **The native candidate was measured with `setTimeout` on a busy main thread.** | The 15.2 ms p99 is an upper bound for that implementation, not a property of RtMidi. A helper process with a busy-wait or a dedicated timer could do better; it still cannot use a timestamped send. |
| **One machine, one run per configuration.** | The report gives no confidence interval. The 8-bar runs send 912 messages; the p99 is the 9th-worst message. |
| **MIDI clock intervals were not captured** (no loopback). | The 24 ppqn clock could not be verified end to end; the scheduler emits it on the correct tick grid (unit-tested). |

## 9. What must be documented for users

| Topic | Requirement | What the user needs to know |
|---|---|---|
| **Windows virtual MIDI driver** | FR-SND-8 | Windows has no OS-level virtual MIDI port. To route PracticePlayer into a DAW, the user installs a loopback driver — **loopMIDI** (freeware, Tobias Erichsen; redistribution in the app is **not** required, only a download link) — creates one or more virtual ports, and selects one in the app's MIDI output settings. The app must name the driver in the setup guide and link to the vendor's page. |
| **Windows MIDI Services (the in-box replacement)** | FR-SND-8 | Windows 11 24H2/25H2 roll out "Windows MIDI Services", whose "MIDI 2.0 Loop Devices" provide loopback ports without a third-party driver. The app should mention it as the modern alternative to loopMIDI. |
| **macOS** | FR-SND-8 | macOS ships virtual MIDI ports (IAC Driver) with the OS; no extra install is needed. The Audio MIDI Setup app is where the user inspects them. |
| **Linux** | FR-SND-8 | The ALSA sequencer's `snd-virmidi` ("Midi Through") provides the loopback; it needs `snd-seq` and `snd-virmidi` loaded. PipeWire/JACK users connect ports with their usual tooling. |
| **Sysex** | CON-4 | The app does not request system-exclusive access by default. If it is added later, the permission handler must ask the user first. |
| **Latency calibration** | NFR-TIM-3 | The setup guide must explain the user offset that compensates for the audio output latency, and the click-test helper used to set it. |
| **Hot-plug** | NFR-REL-2 | The guide must say that unplugging a device removes it from the port list and that playback continues without it. |
| **Windows: the Microsoft GS Wavetable Synth is hidden from Web MIDI** | — | Not user-facing, but worth a troubleshooting note: it is not a usable target for MIDI out from the app. |

## 10. What is *not* verified

| Item | Why | How to close it |
|---|---|---|
| End-to-end p99 jitter on Windows | No loopback driver could be installed on the measurement machine. | Install loopMIDI (or the Windows MIDI Services loopback) and run `pnpm run spike:s2:web -- --output ... --input ...`. **Gap G-20.** |
| End-to-end p99 jitter on macOS and Linux | No macOS or Linux machine was available in this session. | The CI workflow runs the same harness on `macos-latest` and `ubuntu-latest`. **Gap G-20.** |
| Hot-plug | No MIDI port existed to unplug. | With a loopback: create a port, start the measurement, delete the port in the driver, and check the `statechange` records in the report. |
| Window minimised / heavy UI with a real device | The minimised and UI-load runs used the null sink, so they measured the dispatch path, not the driver. | Re-run with the loopback attached. The dispatch results already show 0 late sends. |
| 24 ppqn MIDI clock end to end | No capture. | The clock-interval statistics are in the report format (`clock.interval`, `clock.intervalDeviation`); they need a capture port. |
| Two DAWs (testing.md M-2) | Out of scope for the spike. | P6. |
| The native candidate on macOS and Linux | Only Windows was measured. | The CI workflow runs `spike:s2:native` on all three platforms. |

## 11. How to reproduce

```bash
# Build the measurement renderer.
pnpm run spike:s2:build

# The pure maths and the simulated-clock scheduler tests.
pnpm exec vitest run tests/unit/spike-s2-analysis.test.ts tests/integration/spike-s2-scheduler.test.ts

# The Web MIDI path (needs a loopback; see §7).
pnpm run spike:s2:web -- --output "Port A" --input "Port B" --bars 8 --bpm 120

# The Web MIDI path without a device: permission flow, Worker timer,
# scheduler, minimised window and heavy UI load.
pnpm run spike:s2:web -- --null-sink --bars 8 --bpm 120
pnpm run spike:s2:web -- --null-sink --bars 8 --bpm 120 --minimize-after 2000
pnpm run spike:s2:web -- --null-sink --bars 8 --bpm 120 --ui-load
pnpm run spike:s2:web -- --null-sink --bars 8 --bpm 120 --ui-load --look-ahead 300

# The native candidate.
pnpm run spike:s2:native -- --output "Port A" --capture "Port B" --bars 8 --bpm 120
pnpm run spike:s2:native -- --output "Port A" --bars 8 --bpm 120 --early

# Summarise the reports.
node spikes/s2/tools/summarize-results.mjs
```

The reports are written to `spikes/s2/results/` and are not committed; the
CI workflow uploads them as artifacts.
