# Contributing to PracticePlayer

Thanks for helping out. PracticePlayer is MIT-licensed and the project is
open-source; contributions of code, documentation, bug reports and test
fixtures are welcome.

## Ground rules

1. **Read the docs first.** `docs/requirements.md` defines the requirement IDs,
   `docs/implementation.md` the architecture, `docs/progress.md` the task IDs
   and `docs/testing.md` the test strategy. If a change is not covered by a
   requirement or an open question, open an issue before writing code.
2. **Respect the architecture.** `src/core` is pure TypeScript; the renderer
   never touches Node or the file system; only `src/preload` uses
   `ipcRenderer`. The lint rules enforce this — a red lint is a bug in the
   change, not in the linter.
3. **Keep the timeline single-sourced.** Arrangement, synth, MIDI out, MIDI
   export and audio export all consume the same compiled tick timeline
   (480 ticks per quarter note). Do not introduce a second clock.
4. **Never schedule notes with UI timers or `requestAnimationFrame`.** Note
   timing runs through the Worker look-ahead scheduler.
5. **Write tests with the code.** Pure logic gets unit tests; scheduler logic
   gets simulated-clock tests; every bug fix gets a regression test at the
   lowest layer that can reproduce it.
6. **Check licences.** Any new dependency or asset must be MIT-compatible, be
   listed in `docs/gap-analysis.md` §4 with its licence and attribution, and
   pass `pnpm run audit:licenses`.
7. **No network calls, no telemetry.** The app must work fully offline.
8. **Small, reviewable commits.** Reference the requirement and task IDs in
   the commit message, for example `feat(core): add scale generation (FR-KEY-2, P2.2)`.

## Local setup

```bash
pnpm install
pnpm run verify
```

`pnpm run verify` runs lint, format-independent type checks, the unit tests,
the Electron smoke test and both audits. Please make sure it is green before
opening a pull request.

## Pull requests

- Describe the user-visible behaviour change and the requirement IDs it
  satisfies.
- Update `docs/progress.md`: tick the task, add a decision-log line if you
  changed an architectural decision, and add a changelog line.
- Update the relevant docs (requirements, implementation, testing,
  gap-analysis) when behaviour or a gap changes.
- Note anything you could not verify locally (real audio, MIDI hardware,
  other operating systems) so a human can run the device procedures in
  `docs/testing.md` §7.

## Manual device testing

Audio and MIDI timing cannot be proven on CI. The procedures in
`docs/testing.md` §7 (M-1 … M-7) are part of the definition of done for the
phases that touch playback or MIDI output.

## Reporting bugs

Include the operating system and version, the app version, the steps to
reproduce, what you expected and what happened, and any relevant logs. Bug
reports about timing or audio quality should mention the audio and MIDI
devices involved.
