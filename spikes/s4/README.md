# Spike S4 — Packaging with large assets

Throwaway spike. **Nothing here ships.** The harness is not part of the
application and none of its code enters `src/`.

The question (implementation.md §3, spike S4; PLT-3, NFR-PRF-2, CON-4..6,
OQ-11, OQ-12; gaps G-11 and G-13): can PracticePlayer package several
SoundFonts inside an installer on the supported operating systems, what does
that do to the installer size and the first-launch time, and what does
signing and notarization cost?

**The answer: yes, and the budget is 250 MB per installer.** ADR-0005 records
the decision.

- Full report: [`docs/spikes/s4-packaging-report.md`](../../docs/spikes/s4-packaging-report.md)
- SoundFont shortlist: [`docs/spikes/s4-soundfont-shortlist.md`](../../docs/spikes/s4-soundfont-shortlist.md)
- Decision: [`docs/adr/0005-packaging-and-assets.md`](../../docs/adr/0005-packaging-and-assets.md)
- Gap register: [`docs/gap-analysis.md`](../../docs/gap-analysis.md) §2 (G-11, G-13), §4

---

## What the harness does

A minimal Electron application:

- one window with a renderer that fetches a bundled asset;
- a **64 MiB** asset of incompressible pseudo-random bytes, shipped as an
  `extraResource` — outside the ASAR, so it is a plain file on disk;
- a privileged `s4://` protocol handler in the main process that serves
  exactly one directory and rejects any path that escapes it.

The path resolution is a pure function (`app/electron/asset-path.ts`) with
no Electron import, so the traversal rules are unit-tested
(`tests/unit/spike-s4-asset-path.test.ts`).

## Layout

| Path                               | What it is                                                |
| ---------------------------------- | --------------------------------------------------------- |
| `app/electron/main.ts`             | the main process: window, protocol handler, timing report |
| `app/electron/asset-path.ts`       | pure URL → path resolution (the security boundary)        |
| `app/electron/preload.ts`          | the minimal preload                                       |
| `app/renderer/`                    | the renderer that fetches the asset                       |
| `app/electron-builder.yml`         | the electron-builder configuration                        |
| `tools/build.mjs`                  | compiles the app and writes the 64 MiB asset              |
| `tools/package.mjs`                | runs electron-builder and writes `sizes.json`             |
| `tools/measure.mjs`                | launches the **packaged** app and records the timings     |
| `tools/measure-installed-size.mjs` | walks the unpacked tree for the installed size            |
| `tools/prepare-asset.mjs`          | writes the sample asset                                   |

## Running it

```bash
pnpm install --frozen-lockfile
pnpm run spike:s4:build          # compiles the app and writes the 64 MiB asset
pnpm run spike:s4:package        # runs electron-builder; writes sizes.json
pnpm run spike:s4:measure        # launches the packaged app and writes the timing JSON
node spikes/s4/tools/measure-installed-size.mjs
```

`S4_ASSET_BYTES` overrides the asset size; `S4_ASSET_FILE` packages a real
file instead of the generated sample.

On GitHub, `.github/workflows/spike-s4-packaging.yml` runs the same steps on
`windows-latest`, `macos-latest` (arm64) and `macos-15-intel` (x64) and
uploads the packages and the JSON reports.
