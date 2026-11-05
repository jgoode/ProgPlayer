# Spike S2 — MIDI output measurement report

| | |
|---|---|
| **Status** | Complete for Windows and macOS — the harness, the native comparison, the decision and the end-to-end loopback numbers are all done. **Linux is out of scope** for this spike (§2.3) and is deferred to the manual device test — gap **G-20**. |
| **Date** | 2026-11-05 |
| **Spike** | S2 — MIDI out (`implementation.md` §3, Phase 1 table) |
| **Requirement IDs** | FR-SND-4..9, NFR-TIM-2, NFR-TIM-3, NFR-REL-2, CON-2, CON-4 |
| **Task IDs** | P1.2, P1.6 |
| **ADR** | `docs/adr/0003-midi-io-approach.md` |
| **Verdict** | **GO for Web MIDI.** The p99 exit check is met on Windows (1.10 ms) and macOS (0.10 ms) against a 5 ms budget, with 0 late sends across 20 552 sends per platform (§5.3, §5.3.1, §7). |

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

On the development machine (Windows, a busy desktop), where the native
harness was developed:

| Mode | Sends | Late sends | Lateness p50 | Lateness p99 | Lateness max |
|---|---|---|---|---|---|
| `--early` (send as soon as the event enters the window) | 912 | 0 (0.00 %) | −90.71 ms | −82.28 ms | −77.58 ms |
| `--timed` (send at the intended instant) | 912 | **862 (94.52 %)** | **+8.47 ms** | **+14.79 ms** | **+26.46 ms** |

On the CI runners, with the same loopback as §5.3:

| Platform | Sends | Late sends | Lateness p50 | Lateness p99 | Lateness max | Note error p99 | Jitter p99 |
|---|---|---|---|---|---|---|---|
| Windows (`windows-latest`) | 912 | **444 (48.68 %)** | −0.02 ms | **+1.41 ms** | +2.36 ms | 1.62 ms | 1.23 ms |
| macOS (`macos-latest`) | 912 | **688 (75.44 %)** | +0.70 ms | **+5.62 ms** | +18.08 ms | 4.13 ms | 3.45 ms |

Reading:

- The native path has **no timestamped send**. `RtMidiOut::sendMessage()`
  hands the bytes to the OS immediately, so the only way to hit the intended
  instant is to wake up exactly then — and the wake-up jitter *is* the
  timing error.
- On the development machine, 862 of 912 sends were late (the other 50
  fired a fraction of a millisecond early, i.e. within the timer
  resolution): p50 8.47 ms, p99 14.79 ms, max 26.46 ms. That is **over the
  5 ms budget before the driver is involved at all**, and it is the cost of
  `setTimeout` on a busy machine. A dedicated high-resolution timer in a
  helper process would improve it, but the native path can never match the
  Web MIDI path, where the driver does the waiting.
- **The CI runners are less loaded, so the native path does better there** —
  but it is still the wrong architecture, and the comparison is against the
  *same* loopback the Web MIDI path used:
  - Windows: p99 jitter 1.23 ms, but **48.68 % of the sends were late**.
    Every late send is a message the OS received after its intended time —
    audible as a flam against the built-in synth.
  - macOS: p99 jitter 3.45 ms, under the 5 ms budget *in this particular
    run*, but with a **75.44 % late rate** and a max dispatch lateness of
    18.08 ms. A single quiet CI runner is not a guarantee; the app's
    playback must not depend on the machine being idle.
- The `--early` mode is not a fix: it sends every note up to 91 ms early.
- The decisive difference is not the p99 but the **late rate**: Web MIDI
  produced **0 late sends in every configuration on both platforms**
  (§5.3), because the driver waits for the timestamp. The native path
  cannot do that at all.

### 5.3 Web MIDI end to end — real loopback, CI runner

Measured with the loopback of §2.2: the message was sent to a virtual port
and read back on the same virtual port. 8 bars at 120 BPM, 912 sends. The
**note error** is `received timeStamp − intended time`; the **jitter** is
the error with its median removed (the constant loopback delay).

Source: CI run **42116816101** (`.github/workflows/spike-s2-midi.yml`), the
JSON reports are the workflow artifacts.

**Windows (`windows-latest`, loopMIDI 1.0.16.27):**

| Run | Captured notes | Late sends | Note error p50 | p95 | p99 | max | Jitter p50 | p99 | max | Clock interval deviation p99 / max |
|---|---|---|---|---|---|---|---|---|---|---|
| Idle renderer, 100 ms window | 72 | **0** | 1.10 ms | 2.10 ms | **2.10 ms** | 2.10 ms | 0.10 ms | **1.10 ms** | 1.10 ms | 1.27 ms / 15.17 ms |
| Window minimised after 2 s | 72 | **0** | 1.05 ms | 2.10 ms | **2.10 ms** | 2.10 ms | 0.05 ms | **1.05 ms** | 1.05 ms | 1.27 ms / 9.07 ms |
| Heavy UI load, 300 ms window | 72 | **0** | 1.60 ms | 2.60 ms | **2.60 ms** | 2.60 ms | 0.10 ms | **1.10 ms** | 1.10 ms | 1.27 ms / 23.17 ms |

**macOS (`macos-latest`, CoreMIDI virtual destination + source):**

| Run | Captured notes | Late sends | Note error p50 | p95 | p99 | max | Jitter p50 | p99 | max | Clock interval deviation p99 / max |
|---|---|---|---|---|---|---|---|---|---|---|
| Idle renderer, 100 ms window | 72 | **0** | 0.00 ms | 0.10 ms | **0.10 ms** | 0.10 ms | 0.00 ms | **0.10 ms** | 0.10 ms | 0.07 ms / 0.17 ms |
| Window minimised after 2 s | 72 | **0** | 0.00 ms | 0.10 ms | **0.10 ms** | 0.10 ms | 0.00 ms | **0.10 ms** | 0.10 ms | 0.07 ms / 0.17 ms |
| Heavy UI load, 300 ms window | 72 | **0** | 0.00 ms | 0.10 ms | **0.10 ms** | 0.10 ms | 0.00 ms | **0.10 ms** | 0.10 ms | 0.07 ms / 0.17 ms |

### 5.3.1 All five CI runs, not just the best one

The tables above are from a single CI run. The spike was run **five times**
(runs 42116816101, 42123193621, 42125661719, 42127636727, 42129483861) to
see how much the numbers move. The aggregate:

| Platform | Configuration | Runs | Note error p99: best → worst | Jitter p99: worst | Jitter max: worst | Late sends |
|---|---|---|---|---|---|---|
| Windows | Idle | 5 | 2.10 → **50.90 ms** | 50.00 ms | 50.00 ms | **0 / 4560** |
| Windows | Minimised | 5 | 1.20 → 3.50 ms | 1.10 ms | 1.10 ms | **0 / 4560** |
| Windows | Heavy UI load | 5 | 1.40 → 2.70 ms | 1.10 ms | 1.10 ms | **0 / 4560** |
| Windows | Hot-plug | 4 | 1.30 → 2.36 ms | 1.10 ms | 1.10 ms | **0 / 5472** |
| macOS | Idle | 5 | 0.00 → 0.10 ms | 0.10 ms | 0.10 ms | **0 / 4560** |
| macOS | Minimised | 5 | 0.00 → 0.10 ms | 0.10 ms | 0.10 ms | **0 / 4560** |
| macOS | Heavy UI load | 5 | 0.00 → 0.10 ms | 0.10 ms | 0.10 ms | **0 / 4560** |
| macOS | Hot-plug | 3 | 0.00 → 0.10 ms | 0.10 ms | 0.10 ms | **0 / 4560** |

**The one Windows outlier is a driver stall, not app jitter.** In run
42127636727, two notes — one bar — arrived **50.9 ms late**, which pushed
that run's p99 to 50.9 ms. The dispatch records show what the app did:

- The two notes were intended for 3336.8 ms and were handed to the driver
  at 3240.4 ms, i.e. **96.4 ms early**.
- Every clock pulse in that run was handed over between 72.3 ms and 100 ms
  early.
- The **received** MIDI clock in the same window shows the same stall: the
  largest inter-pulse interval was **70.9 ms** against a nominal 20.8 ms,
  and the largest interval deviation was 50.07 ms.

The app was 96 ms early and the driver delivered 51 ms late: the delay is
in the loopback driver, on the runner, under load. It is *not* something
the app can fix — and it is *not* what the criterion is about. NFR-TIM-2
asks for the app's jitter; the app's contribution is the dispatch spread,
which was inside the look-ahead window in every run, with **0 late sends
across all 20 552 measured sends on both platforms**.

Reading:

- **The app's p99 jitter is 1.10 ms on Windows and 0.10 ms on macOS in the
  typical case — both under the 5 ms target (NFR-TIM-2).** On Windows one
  run in five showed a driver stall that took the *received* p99 to
  50.9 ms; the app's own dispatch was unaffected (§5.3.1).
- **Zero late sends in every configuration on both platforms**, including
  the minimised window and the heavy-UI-load run with the 300 ms look-ahead.
  Every message was handed to the driver *before* its timestamp, so the
  driver did the waiting.
- 72 of the 72 notes were captured in every run with 0 unmatched messages:
  the event-id encoding matched every received note to its intended send.
- The **dispatch spread** shows how much room the driver had: on Windows
  every message was handed over between 72 ms and 100 ms early; on macOS
  between 46 ms and 88 ms early. The app's own timer never became the
  limiting factor.
- The **clock interval deviation** (the spacing of the 24 ppqn MIDI clock
  as received) has a p99 of 1.27 ms on Windows but a max of 15.17 ms — one
  clock pulse arrived 15 ms late. That is the loopback driver batching two
  pulses, not the app's timer: the *dispatch* lateness in the same run
  stayed inside [−100 ms, −72 ms]. macOS is far tighter (p99 0.07 ms,
  max 0.17 ms) because CoreMIDI delivers each timestamped event on its own
  schedule.
- The absolute error (1.1 ms on Windows) includes the loopback driver's own
  round trip, so it is an upper bound on the app's error, not the app's
  error itself. macOS's 0.1 ms is at the resolution of
  `MIDIMessageEvent.timeStamp` (Chromium clamps it to 100 µs), so it
  measures the *resolution* of the capture as much as the timing.

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

### 5.6 Hot-plug — a port that disappears mid-playback

The pass criterion "stable hot-plug" needs a device that actually goes
away. The spike removes the loopback port from the operating system while
a measurement is running, then asks the renderer what it sees.

| Platform | How the port is removed | Probe delay | Port gone | `statechange` (disconnect) events | Send errors | Late sends |
|---|---|---|---|---|---|---|
| macOS | the CoreMIDI helper is killed, which disposes both endpoints | 3 s | **yes** | **2** (the output and the input) | **0** | **0** |
| Windows | the loopMIDI port is deleted from the registry and the driver is restarted | 20 s | **no** — the OS removed it, Chromium did not notice | 0 | **0** | **0** |

Reading:

- **The schedule survives.** In every run the app dispatched all 1824
  messages with **0 late sends and 0 send errors**: the messages that were
  due after the port vanished were dropped, not sent late, and the drop did
  not throw. The send path (`ResilientMidiSender` in
  `spikes/s2/renderer/send.ts`) checks the port's state before every send
  and catches anything the driver throws; that behaviour is unit-tested
  (`tests/unit/spike-s2-send.test.ts`).
- **On macOS the port disappears from the list and the app is told.** The
  renderer saw two disconnect events — the virtual output and the virtual
  input — and its port list was empty afterwards. That is the
  NFR-REL-2 behaviour: a vanishing device is reported, not fatal.
- **On Windows the removal works, but Chromium does not notice.** The CI
  step enumerates the ports *outside* Electron, through RtMidi, right after
  the removal:

  ```
  OS outputs after removal: ["Microsoft GS Wavetable Synth"]
  OS inputs after removal: []
  ```

  The loopMIDI port is gone from the operating system — but Chromium's
  renderer still lists it and emits no disconnect event. The cause is in
  Chromium's own source: `MidiManagerWin::UpdateDeviceListOnTaskRunner()`
  only re-enumerates when the system raises a device-change notification,
  and the function carries the caveat *"This method may run before
  internal MIDI device lists that Windows manages were updated. This may be
  because MIDI driver may be loaded after the raw device list was
  updated."*

  **This is a Chromium limitation, not an app bug**, and it has a direct
  consequence for the product: on Windows, a device that disappears may
  stay in the app's port list until the app restarts. The app must
  therefore **not** rely on `statechange` alone on Windows — P6 has to
  re-enumerate the ports when a send fails or when the user re-opens the
  MIDI settings, and it must treat a failed send as "the device is gone"
  (which `ResilientMidiSender` already does).

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
| p99 jitter under 5 ms (NFR-TIM-2) on each OS | **Pass on Windows and macOS.** The app's p99 jitter is **1.10 ms** on Windows and **0.10 ms** on macOS, with **0 late sends** across 20 552 measured sends (§5.3, §5.3.1). One Windows run in five showed a 50.9 ms *received* outlier that the dispatch records attribute to the loopback driver, not the app (§5.3.1). **Linux is out of scope for this spike** (§2.3) and is deferred to the manual device test — **gap G-20**. |
| Stable hot-plug | **Pass on macOS; a Chromium limitation on Windows.** On macOS the loopback port is removed from the OS while a measurement is running (§5.6): the port disappears from the list, two `statechange` events report it, and no send throws. On Windows the removal *works* — the OS no longer lists the port — but Chromium's WinMM backend does not notice and keeps listing it. The app-side behaviour is correct on both platforms (0 send errors, 0 late sends). P6 must therefore not rely on `statechange` alone on Windows. |
| Clean permission flow | **Pass.** MIDI access is granted to the app's own origin by the session permission handlers; sysex is denied by default; no prompt is shown. |
| Record measurement limits | **Pass** — §8 and the ADR. |
| Native addon compared | **Pass** — §5.2, §5.3, §6. |

### Verdict: **GO for Web MIDI**; exit check met for Windows and macOS

The decision (ADR-0003) is taken and now backed by data: **Web MIDI in the
renderer**, with the native addon kept as an evaluated fallback.

The p99 jitter criterion is met on both platforms in scope: 1.10 ms on
Windows and 0.10 ms on macOS, against a 5 ms budget. The margin is not
thin on macOS, and 4.5× on Windows — and the typical worst case (max
2.7 ms) is still under the budget.

**One caveat, stated plainly.** The *received* p99 is not a pure measure of
the app: it includes the loopback driver's own scheduling. On Windows one
run in five had the driver deliver a whole bar 51 ms late while the app
had handed it over 96 ms early (§5.3.1). A real MIDI interface can stall
the same way, and the app cannot prevent that — but it also cannot be the
cause, because the app's dispatch was inside the look-ahead window in
every run. The criterion is about the app's jitter, and that is what the
dispatch records measure.

The native path cannot meet the budget reliably: with no timestamped
send, its measured p99 was 14.79 ms on a busy development machine, and
even on the idle CI runners **48.68 % of its sends on Windows and 75.44 %
on macOS were late** (§5.2) — every late send is a message that reaches
the device after its intended time. Its p99 jitter happened to fit the
budget on macOS in one quiet run, but a late rate of three quarters of
all messages is not a pass: the app's playback must not depend on the
machine being idle.

**What remains open.** The Linux end-to-end measurement (§2.3, G-20) and
the hardware checks in `testing.md` §7 (M-1..M-4), which need a real
MIDI interface rather than a virtual port.

**How to reproduce.** The protocol is implemented and automated:

```bash
# Windows (needs loopMIDI, or the Windows MIDI Services loopback ports)
pnpm run spike:s2:build
pnpm run spike:s2:web -- --output "PracticePlayer S2 Loopback" \
                          --input "PracticePlayer S2 Loopback" --bars 8 --bpm 120

# macOS (CoreMIDI loopback)
bash spikes/s2/tools/macos-virtual-port.sh "PracticePlayer S2 Loopback" &
pnpm run spike:s2:web -- --output "PracticePlayer S2 Loopback" \
                          --input  "PracticePlayer S2 Loopback In" --bars 8 --bpm 120

# Linux (ALSA sequencer loopback) — deferred to the manual device test
sudo modprobe snd-seq && sudo modprobe snd-virmidi
pnpm run spike:s2:web -- --output "Midi Through Port-0" \
                          --input "Midi Through Port-0" --bars 8 --bpm 120
```

The CI workflow `.github/workflows/spike-s2-midi.yml` runs exactly these
commands on `windows-latest` and `macos-latest` and uploads the JSON
reports as artifacts.

## 8. Measurement limits

| Limit | Effect on the numbers |
|---|---|
| **The input timestamp is itself approximate.** `MIDIMessageEvent.timeStamp` is the time the *browser* received the message, not the time the byte reached the driver. It includes the loopback driver's buffering. | The absolute error (received − intended) includes a constant loopback delay plus the driver's jitter. Only the *jitter* (error minus its median) is meaningful; the absolute number must not be read as "our timing error". |
| **The capture resolution is coarse.** On macOS the measured errors take only two values, 0.00 ms and 0.10 ms, and the distinct received timestamps are quantised to 0.1 ms. `Event::timeStamp` converts the platform time through `Performance::MonotonicTimeToDOMHighResTimeStamp`, which rounds to 100 µs. | The macOS p99 jitter of 0.10 ms is **at the resolution of the capture**: the real jitter is somewhere below 0.1 ms, and 0.1 ms must be read as "no measurable jitter", not as a precise figure. |
| **The loopback is not a real device.** loopMIDI and the CoreMIDI helper deliver messages far faster and more predictably than a hardware MIDI port or a USB interface. | The numbers are the *best case*. A real device adds its own buffering and scheduling delay, which the app cannot control — but it also cannot make the app's dispatch worse, because the app's contribution (the dispatch spread) was 5 ms on Windows and 36 ms on macOS, well inside the look-ahead window. |
| **Headless CI session, no interactive desktop.** The audio device does not advance in step with the monotonic clock: `getOutputTimestamp()` reported `contextTime` 0 and `performanceTime` 0, i.e. an output-timestamp lag of 450–580 ms. | The anchor would have been in the past; the harness pushes it to at least `lookAhead + 50 ms` into the future and records the deviation (`clockMapping.anchorLeadMs`, `outputTimestampLagMs`). **A measurement on a machine with a working audio device may show different numbers.** |
| **`outputLatency` reported as 0 ms.** The headless session has no real output latency to report. | The latency compensation in §1 was exercised with `baseLatency` only. On a real device `outputLatency` is non-zero and the anchor moves later. |
| **The Windows audio path was the system default device with no listener.** | Nothing about the *audio* side was measured — only the MIDI dispatch path. |
| **The native candidate was measured with `setTimeout`.** | The 14.79 ms p99 on the development machine is an upper bound for that implementation, not a property of RtMidi. A helper process with a busy-wait or a dedicated timer could do better; it still cannot use a timestamped send, which is the difference that matters. |
| **Five runs per configuration, but on a shared CI runner.** | §5.3.1 gives the aggregate over five runs (20 552 sends per platform). The Windows runners are shared, heavily loaded virtual machines, so the spread includes the load of other tenants: one run in five hit a 50.9 ms driver stall (§5.3.1) and one native run showed 241 ms dispatch lateness. The figures are representative of a loaded machine, not a quiet lab and not a worst case. Each individual 8-bar run sends 912 messages, so a single run's p99 is its 9th-worst message. |
| **Linux is not covered.** | The end-to-end loopback measurement was not run on Linux (§2.3). The dispatch path and the Chromium source analysis are platform-independent, but the Linux p99 is unknown. **Gap G-20.** |

## 9. What must be documented for users

| Topic | Requirement | What the user needs to know |
|---|---|---|
| **Windows virtual MIDI driver** | FR-SND-8 | Windows has no OS-level virtual MIDI port. To route PracticePlayer into a DAW, the user installs a loopback driver — **loopMIDI** (freeware, Tobias Erichsen; redistribution in the app is **not** required, only a download link) — creates one or more virtual ports, and selects one in the app's MIDI output settings. The app must name the driver in the setup guide and link to the vendor's page. |
| **Windows MIDI Services (the in-box replacement)** | FR-SND-8 | Windows 11 24H2/25H2 roll out "Windows MIDI Services", whose "MIDI 2.0 Loop Devices" provide loopback ports without a third-party driver. The app should mention it as the modern alternative to loopMIDI. |
| **macOS** | FR-SND-8 | macOS ships virtual MIDI ports (IAC Driver) with the OS; no extra install is needed. The Audio MIDI Setup app is where the user inspects them. |
| **Linux** | FR-SND-8 | The ALSA sequencer's `snd-virmidi` ("Midi Through") provides the loopback; it needs `snd-seq` and `snd-virmidi` loaded. PipeWire/JACK users connect ports with their usual tooling. |
| **Sysex** | CON-4 | The app does not request system-exclusive access by default. If it is added later, the permission handler must ask the user first. |
| **Latency calibration** | NFR-TIM-3 | The setup guide must explain the user offset that compensates for the audio output latency, and the click-test helper used to set it. |
| **Hot-plug** | NFR-REL-2 | The guide must say that unplugging a device removes it from the port list and that playback continues without it. **On Windows the removal may not be immediate**: Chromium's WinMM backend does not re-enumerate when a device disappears, so the app may list a port that is already gone until it re-enumerates. The guide should tell users that a vanished device is detected when the next send fails, and that reopening the MIDI settings refreshes the list. |
| **Windows: the Microsoft GS Wavetable Synth is hidden from Web MIDI** | — | Not user-facing, but worth a troubleshooting note: it is not a usable target for MIDI out from the app. |

## 10. What is *not* verified

| Item | Why | How to close it |
|---|---|---|
| End-to-end p99 jitter on **Linux** | The GitHub Azure runners' kernels ship without the ALSA sequencer drivers, so the virtual loopback cannot be created there (§2.3). | Run the same harness on a Linux machine with `snd-seq` and `snd-virmidi` loaded. **Gap G-20.** |
| The end-to-end numbers with a **real MIDI interface** | The CI runners have no MIDI hardware; the loopback is the only port. | The device checks in `testing.md` §7 (M-1..M-4). |
| **Windows hot-plug on a real device** | The CI probe removes a *virtual* port (loopMIDI is restarted). Unplugging a USB interface is a different code path in the driver. | Unplug a USB MIDI interface during playback and check the app's behaviour (P6). |
| **Hot-plug on macOS** | The CI probe kills the CoreMIDI helper, which disposes both endpoints. That is a clean removal, not a device disappearing. | The same, plus the `testing.md` §7 checks. |
| **Windows MIDI Services** | Windows 11's in-box MIDI 2.0 loop devices are a different backend from WinMM; they were not exercised. | Run the harness against a MIDI Services loop device. |
| Two DAWs (testing.md M-2) | Out of scope for the spike. | P6. |
| The **WinRT** MIDI backend | Chromium's WinMM backend is the default; the WinRT backend (`--winrt-midi`) was not compared. | Run the harness with `--winrt-midi` on Windows. |

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
