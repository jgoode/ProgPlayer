# Architecture Decision Records

Short, immutable records of decisions with lasting impact on the codebase.
One file per decision, numbered sequentially.

## Format

Copy `template.md` to `NNNN-short-title.md` and fill it in. Keep it to one
page: context, options considered, decision, consequences.

## Index

| ADR | Title | Status | Date |
|---|---|---|---|
| [0001](0001-electron-toolchain.md) | Electron, electron-vite and React as the application toolchain | Accepted | 2026-11-04 |

## Rules

- A decision is recorded here when it constrains the architecture, the process
  or the licensing, and is unlikely to be revisited casually.
- Superseded records stay in place with their status changed to
  `Superseded by ADR-NNNN`; they are never deleted.
- The decision is also summarised in `docs/progress.md` §4 (decision log).
