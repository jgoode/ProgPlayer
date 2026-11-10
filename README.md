# PracticePlayer

PracticePlayer is a desktop app for Windows and macOS that plays chord
progressions in a chosen key at a chosen tempo as a practice and improvisation
backing track. The v1 product plays sustained block chords, a root-note bass
line and a metronome click through a built-in SoundFont synthesiser and/or MIDI
out, with separate channels for chords, bass and click plus MIDI clock.

**Current state: Phase 4 (playback engine and walking skeleton).** The app
plays a chosen preset in a chosen key and scale at a chosen tempo through the
built-in SoundFont synthesiser: block chords, a root-note bass line and a
metronome click, with a look-ahead scheduler driven by a Worker timer. The
minimal UI offers the key, the scale, the tempo, a preset picker and
play/stop. MIDI out, export and the full UI land in later phases.

The playback behaviour — what you hear, how the timing works and what the
transport does — is documented in [docs/playback.md](docs/playback.md).

## Repository layout

```
docs/          requirements, implementation, progress, testing, gap analysis, ADRs
resources/     bundled SoundFonts and built-in presets (read-only)
src/
  core/        pure TypeScript: no Electron, DOM, audio or Node imports
  audio/       synth sink, offline renderer, click source
  midi/        MIDI out sink, port manager, MIDI clock
  main/        Electron main process: windows, files, settings
  preload/     typed contextBridge API (the only module touching ipcRenderer)
  renderer/    React UI
tests/         unit/, integration/, e2e/, fixtures/
scripts/       repository tooling (lint boundaries, licence audit)
```

## Requirements

- Node.js LTS (Node 24 or newer; the `engines` field is authoritative)
- pnpm 12 (`corepack enable` then `corepack use` if needed)

## Install

```bash
pnpm install
```

## Run

```bash
pnpm dev        # development build with hot reload
pnpm build      # production build into out/
pnpm preview    # preview the production build
```

## Test and verify

```bash
pnpm run lint           # ESLint, including the import-boundary rules
pnpm run format:check   # Prettier
pnpm run typecheck      # TypeScript strict, node and web projects
pnpm run test           # Vitest (unit, component and cross-layer tests)
pnpm run test:e2e       # build + Playwright for Electron smoke test
pnpm run audit:deps     # dependency vulnerability audit
pnpm run audit:licenses # dependency licence audit
pnpm run verify         # everything above, in order
```

The Electron smoke test launches the built app and asserts the window title is
`PracticePlayer`.

### Import boundaries

The layer rules from `docs/implementation.md` §2.2 are enforced by a local
ESLint rule (`scripts/eslint-boundaries.mjs`) and covered by a regression test
(`tests/unit/import-boundaries.test.ts`) that writes a deliberate violation,
asserts the lint failure and removes the violation again:

- `src/core` imports nothing outside `src/core` — no Electron, DOM, audio or Node.
- `src/audio` and `src/midi` import `src/core` only.
- `src/renderer` imports `src/core`, `src/audio` and `src/midi`.
- `src/main` and `src/preload` import `src/core`; only `src/preload` may use `ipcRenderer`.

## CI

`.github/workflows/ci.yml` runs install, lint, format check, type-check, unit
tests, build, the Electron smoke test, the dependency audit and the licence
audit on `windows-latest` and `macos-latest`.

Line endings are normalised to LF by `.gitattributes`, so the format check
reports the same result on every platform.

## Licence

MIT — see [LICENSE](LICENSE). Every dependency and bundled asset must be
MIT-compatible; the register lives in `docs/gap-analysis.md` §4.

## Documentation

| Document                 | Purpose                                       |
| ------------------------ | --------------------------------------------- |
| `docs/requirements.md`   | Requirement IDs (FR-, NFR-, PLT-, CON-)       |
| `docs/implementation.md` | Architecture and phased plan                  |
| `docs/progress.md`       | Task tracker, decisions, changelog            |
| `docs/testing.md`        | Test strategy and manual device procedures    |
| `docs/gap-analysis.md`   | Open gaps and the dependency/licence register |
| `docs/playback.md`       | What the playback does, for users             |
| `docs/adr/`              | Architecture decision records                 |
