# ADR-0001: Electron, electron-vite and React as the application toolchain

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-04 |
| **Requirement IDs** | PLT-1, PLT-2, PLT-5, NFR-SEC-1, NFR-MNT-1 |
| **Task IDs** | P0.2, P0.3, P0.5 |

## Context

Phase 0 needs a cross-platform desktop shell (Windows 10/11 x64, macOS Intel
and Apple Silicon, Linux x64) that can host a Web Audio synth and Web MIDI in
the renderer while keeping the music-theory core pure TypeScript.

The repository must ship a typed, lint-enforced, testable skeleton with CI on
all three operating systems, and no runtime dependency may carry a licence
incompatible with MIT.

> **Amendment 2026-11-08.** Linux was dropped as a supported platform for
> v1.0 (PLT-1). The toolchain decision itself is unchanged; the `ubuntu-latest`
> CI leg and the Linux packaging target were removed in the same change.

## Options considered

| Option | Summary | Pros | Cons |
|---|---|---|---|
| A | Electron + electron-vite + React + TypeScript strict | Mature cross-platform reach; Web Audio and Web MIDI in the renderer; Vite-based builds and tests; large hiring/community base | Large binary; Node/Chromium security patching burden; renderer sandbox constrains direct Node access |
| B | Tauri + Rust backend | Smaller binaries; native WebView | Rust toolchain requirement; WebView versions differ per OS, so Web Audio/Web MIDI behaviour varies; larger initial investment before any app code exists |
| C | Plain web app in a browser | No shell to secure or package | No MIDI-out or file-system access with the required guarantees; fails PLT-1/PLT-2 and NFR-SEC-1 |

## Decision

Use Electron with electron-vite, React and strict TypeScript (option A).

- The main process owns windows, files and settings; the renderer owns audio
  and MIDI; `src/core` stays pure TypeScript.
- The renderer runs with `contextIsolation: true`, `nodeIntegration: false`
  and `sandbox: true`, and reaches the main process only through a small typed
  `contextBridge` API in `src/preload`.
- Layer boundaries are enforced by a local ESLint rule
  (`scripts/eslint-boundaries.mjs`) rather than a third-party dependency, so
  the check has no licence or maintenance risk.
- All dependencies are pinned to exact versions; the lockfile is committed and
  `pnpm run audit:licenses` enforces the MIT-compatible register.

## Consequences

- Positive: the architecture in `docs/implementation.md` §2 can be expressed
  and tested from day one; the boundary rules fail the build on violation.
- Negative: Electron releases require regular updates; the bundle is large;
  macOS/Windows signing and notarisation remain open (gap G-13).
- Follow-up work: packaging (Phase 10) and the licence attribution screen
  (P10.3) build on the register established here.
