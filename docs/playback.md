# Playback — what the app does

This document describes the behaviour of the minimal playback UI: what the
user sees, what they hear, and how the timing works. It is the
user-facing counterpart to `docs/implementation.md` §2.3–2.4 and the
simulated-clock tests in `src/core/scheduler/`.

## The minimal UI

The window shows one control row, one transport row and a status area.

| Control         | What it does                                                                       |
| --------------- | ---------------------------------------------------------------------------------- |
| **Key**         | The tonic's letter: C, D, E, F, G, A or B.                                         |
| **Scale**       | The scale the chords are voiced and hinted in: major, the three minors, and the seven modes. |
| **Tempo**       | 30–300 BPM.                                                                        |
| **Preset**      | One of the 29 built-in presets (Appendix A of `docs/requirements.md`).             |
| **Play**        | Starts the playback, with a one-bar count-in.                                      |
| **Stop**        | Stops the playback and returns to the start.                                       |

Under the transport row the app shows the **current bar and beat**, the
**status** (`Ready`, `Loading the sound banks…`, `Playing`, `Stopped`) and
the **scheduler metrics** — how many events have been scheduled and how
many were late.

### The scale selector

The requirement names a "key selector". In this app a key is a **tonic and
a scale**, and every other part of the product (the scale hints, the
fretboard, the preset suggestions) works on that pair. The minimal UI
therefore offers both. Choosing a scale does **not** rewrite the preset's
chords: a preset's chord roots are fixed offsets from the tonic, and the
scale drives the voicing and the hints (decision of 2026-11-07, assumption
A5).

## What you hear

Three parts sound independently:

| Part    | Sound                                                | MIDI channel |
| ------- | ---------------------------------------------------- | ------------ |
| Chords  | The block chords, voiced in the selected key and scale | 1            |
| Bass    | The root-note bass line, below the chords             | 2            |
| Click   | The metronome click, accented on the bar downbeat     | 10           |

The two bundled SoundFonts are *Upright Piano KW* (the chords) and
*Finger Bass YR* (the bass). Both are CC0, so the app ships them with no
attribution condition. The **click is synthesized** inside the audio
worklet rather than played from a SoundFont: the bundled banks contain no
percussion, and the app does not bundle a drum kit.

### The count-in

Pressing **Play** plays one bar of click before the arrangement starts. The
bar readout shows `Count-in` while it runs, and the arrangement's own bars
are numbered from 1.

The count-in plays **only** on a fresh start. It does **not** repeat on a
loop wrap, and it does **not** play when a paused playback resumes.

## Timing

### The clocks

The **audio clock** (`AudioContext.currentTime`) is the master clock. The
scheduler reads it to decide what to schedule and when; the audio device
plays what it was given.

Inside the audio worklet, the engine keeps its own **render clock**, which
runs slightly ahead of the audio clock by the output latency. The sink
measures the offset between them and converts every event's target time
into the engine's clock, so an event is dispatched by the engine at exactly
the right moment rather than one output latency late.

### The look-ahead window

The scheduler keeps a **100 ms window** ahead of the audio clock. On every
timer tick it hands the sink every event that falls inside the window,
stamped with the exact time it should sound. The timer fires every
**25 ms**.

The window is **split at a loop boundary**, so a window that crosses the
end of a loop region emits the events before the boundary at their own
times, and the events of the next pass at the loop's start. That is what
makes the join seamless.

### The timer runs in a Worker

The scheduler's only timer lives in a **Web Worker**, never in the UI
thread, and the window is created with `backgroundThrottling` disabled. A
busy renderer — or a minimised window — therefore cannot delay the
scheduling passes (NFR-TIM-1).

### The tempo map

The tempo map converts between tick positions and times. It is a list of
anchors, each naming a tick, the time that tick occurs at, and the tempo in
force from that tick onwards.

A live tempo change adds an anchor at the **next beat boundary**. The times
of the events that were already scheduled never move (FR-TMP-2). The tempo
in force at the end of a loop pass carries into the next one, so a tempo
change is not undone by the wrap.

### The tempo range

30–300 BPM. The extremes are correct at both ends: the windows scale with
the tempo, so a slow tempo produces longer windows and a fast one shorter
ones.

## Looping

Three modes are available in the transport:

| Mode        | What it loops                                                  |
| ----------- | -------------------------------------------------------------- |
| **Whole**   | The entire arrangement.                                         |
| **Section** | One section — **all** of that section's repeats.                |
| **Bar range** | An exact range of bars.                                       |

Bars are numbered **globally** over the unrolled arrangement: a section
played twice occupies a continuous run of bar numbers, and a loop region is
a range of those numbers (G-07).

The join at the wrap is **seamless**: the first event after the wrap is
exactly one region length after the first event of the previous pass, with
no gap and no doubled beat. A region changed during playback takes effect
at the **next bar boundary**.

## Stopping and pausing

**Stop** releases every sounding note — both the all-notes-off and the
all-sound-off control change, on every channel that was used — and drops
the events that were scheduled but not yet dispatched. No note is left
hanging and nothing sounds after the stop (FR-SND-9).

A **pause** does the same to the notes but keeps the position. A **resume**
re-establishes the notes at the **beginning of the beat** the playback was
interrupted at, so a chord is not left truncated mid-note.

## The power-save blocker

While the app is playing, it asks the operating system not to suspend the
machine (`prevent-app-suspension`). The blocker is released the moment the
playback stops, so an idle app never keeps the machine awake.

## The bundled assets and the network

The bundled SoundFonts and the preset library are served to the renderer
through an `app-asset://` protocol that resolves **one fixed directory** and
rejects every attempt to escape it, including a percent-encoded one.

The app makes **no network calls**. The Content Security Policy allows the
`app-asset:` scheme and WebAssembly compilation (the SF3 Vorbis decoder
needs it) and nothing else — no remote origin, and no `eval()`.

## What has not been verified

The automated tests cover the timing, the loop joins, the transport and the
asset handling. **The sound itself has not been listened to** on either
supported operating system, and the manual acceptance tests **AT-1**
(playback) and **AT-4** (loop) still need a human with speakers on Windows
and macOS. See `docs/testing.md` §7.
