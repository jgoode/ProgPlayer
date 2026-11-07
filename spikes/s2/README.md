# Spike S2 — MIDI output measurement

Throwaway measurement code for the S2 spike (Web MIDI accuracy and
reliability in Electron, compared with a native RtMidi addon).

| Path                                 | What it is                                                                                                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `renderer/analysis.ts`               | Pure measurement maths: the audio-clock → `performance.now()` mapping, percentiles, the tick timeline and the event-id encoding used to match loopback messages to intended sends. |
| `renderer/scheduler.ts`              | The look-ahead scheduler. It is driven by Worker ticks; it never uses a UI timer to decide note timing.                                                                            |
| `renderer/timer-worker.ts`           | The Worker that owns the timer.                                                                                                                                                    |
| `renderer/main.ts`                   | The measurement page: MIDI access, port enumeration, `statechange` handling, the timestamped sender and the loopback capture.                                                      |
| `renderer/send.ts`                   | The send path, separated so it can be unit-tested: a port that disappears must not throw and must not stop the schedule.                                                           |
| `electron/main.cjs`                  | The Electron shell: `spike://` protocol, session MIDI permission handlers, power-save blocker, window minimise/restore.                                                            |
| `electron/drive.cjs`                 | The headless driver that runs a measurement and writes the JSON report.                                                                                                            |
| `electron/probe-main-native.cjs`     | Probes whether the native addon loads in the Electron main process.                                                                                                                |
| `electron/probe-sandbox-preload.cjs` | Probes whether the native addon loads in a sandboxed preload (it does not).                                                                                                        |
| `electron/probe-ipc-latency.cjs`     | Measures the renderer → main IPC cost a native sink would pay per message.                                                                                                         |
| `native/measure-native.mjs`          | The native (RtMidi) harness.                                                                                                                                                       |
| `tools/macos-virtual-port.sh`        | Creates the CoreMIDI loopback (macOS); `macos-virtual-port.m` is its source.                                                                                                       |
| `tools/windows-loopmidi.ps1`         | Creates and removes the loopMIDI loopback (Windows).                                                                                                                               |
| `tools/summarize-results.mjs`        | Prints a Markdown table of every report in `results/`.                                                                                                                             |

## Running

```bash
# Build the renderer.
pnpm run spike:s2:build

# Web MIDI, with a loopback (loopMIDI on Windows, the helper above on
# macOS).
pnpm run spike:s2:web -- --output "Port A" --input "Port B" --bars 8 --bpm 120

# Web MIDI without a device: exercises the permission flow, the Worker
# timer and the scheduler, but measures no driver timing.
pnpm run spike:s2:web -- --null-sink --bars 4 --bpm 120

# ... while the window is minimised.
pnpm run spike:s2:web -- --null-sink --bars 4 --bpm 120 --minimize-after 1500

# ... while the renderer main thread is blocked (NFR-TIM-2).
pnpm run spike:s2:web -- --null-sink --bars 4 --bpm 120 --ui-load

# ... while the loopback port is removed from the OS (hot-plug). The
# removal command is a JSON array of arguments in a file, because a
# shell strips the quotes from one passed on the command line.
echo '["kill","1234"]' > /tmp/hot-plug-command.json
pnpm run spike:s2:web -- --output "Port A" --input "Port B" --bars 8 --bpm 120 \
  --hot-plug-at 4000 --hot-plug-probe-delay 3000 \
  --hot-plug-command-file /tmp/hot-plug-command.json

# The native candidate.
pnpm run spike:s2:native -- --output "Port A" --capture "Port B" --bars 8 --bpm 120

# Summarise the reports.
node spikes/s2/tools/summarize-results.mjs
```

The reports are written to `spikes/s2/results/` (not committed; see
`.gitignore`). The findings are in
`docs/spikes/s2-midi-out-report.md` and the decision is in
`docs/adr/0003-midi-io-approach.md`.
