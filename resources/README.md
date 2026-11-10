# Bundled resources

This directory holds read-only assets shipped with the application:

- `soundfonts/` — bundled SoundFont files. **Two fonts ship in Phase 4**
  (P4.6): `UprightPianoKW.sf3` (the chords) and `FingerBassYR.sf3` (the
  bass). Both are SF3 (Ogg Vorbis-compressed SoundFont) and both are
  **CC0-1.0**, so there is no attribution condition. Their licence texts
  are in `soundfonts/LICENSES/`.
- `presets/` — built-in preset definitions (added in Phase 3). The 29
  presets and `index.json` are generated deterministically by
  `scripts/generate-built-in-presets.mjs`.

Every file placed here must have a licence compatible with the project's MIT
licence, and must be listed in the dependency and licence register in
`docs/gap-analysis.md` §4 with its attribution text.

## Rebuilding the SoundFonts

The two `.sf3` files are build outputs, not hand-made files. The SF2
sources are large, so they are downloaded rather than committed:

```
pnpm run fonts:fetch    # download the SF2 sources and the conversion tool
pnpm run fonts:build    # convert them to SF3 and write the manifest
```

`fonts:build` is reproducible: it converts at a pinned `sf2-cutter` version
and Vorbis quality, and it normalizes the Ogg container (the tool writes
random serial numbers), so the same source always produces the same bytes.
`soundfonts/manifest.json` records the digest of every input and output, so
a changed font shows up as a real diff rather than silently changing what
the app plays.

## How the renderer reaches them

The renderer has no direct file access. The main process serves this
directory through the `app-asset://` protocol, which resolves **one fixed
directory** and rejects every path that escapes it — including a
percent-encoded one. The resolver is `src/main/asset-path.ts`; the protocol
handler is in `src/main/index.ts`.
