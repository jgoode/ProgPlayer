# ADR-0005: Packaging and assets

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-07 |
| **Requirement IDs** | PLT-3, NFR-PRF-2, CON-4, CON-5, CON-6, OQ-11, OQ-12 |
| **Task IDs** | P1.4, P1.5, P10.1, P10.2 |
| **Supersedes** | — |
| **Related** | ADR-0002 (SoundFont engine), ADR-0004 (MP3 export), `spikes/s4/` (the spike harness), `docs/spikes/s4-packaging-report.md`, `docs/spikes/s4-soundfont-shortlist.md`, `docs/gap-analysis.md` §4 |

## Context

FR-SND-2 requires the app to bundle several SoundFonts covering at least
piano, bass and guitar (plus click/percussion), and every bundled font must
be redistributable under the project's MIT terms (CON-4). CON-5 says the
installer size grows with the number of bundled fonts and that a budget must
be agreed (OQ-11). CON-6 says macOS distribution may require code signing
and notarization and Windows may need signing to avoid SmartScreen warnings
(OQ-12). PLT-3 requires installable packages per platform.

Spike S4 packaged a throwaway Electron application with electron-builder
26.18.0 on all three operating systems and bundled a 64 MiB asset as an
`extraResource`, served to the renderer through a custom protocol handler.
The harness is in `spikes/s4/`; **nothing in it ships**. The measurements are
in `docs/spikes/s4-packaging-report.md`.

### What the spike measured

| Platform | Installer | Download size | Installed size | First launch, 64 MiB asset |
|---|---|---|---|---|
| Windows x64 | NSIS `.exe` | 178.63 MB | 420.48 MB | **1 390 ms** |
| macOS arm64 | `.dmg` | 179.27 MB | 323.03 MB¹ | **680 ms** |
| macOS x64 | `.dmg` | 182.96 MB | 326.50 MB¹ | **1 764 ms** |
| Linux x64 | AppImage | 183.88 MB | 337.46 MB | **5 483 ms**² |
| Linux x64 | `.deb` | 160.01 MB | — | — |

¹ The macOS figure is measured from the CI artefact's unpacked bundle with
the real symlink layout restored by hand; the CI installed-size step for
macOS was added after the green packaging run and has not been re-run on
GitHub Actions (see the report's "Unverified").
² The Linux figure is dominated by Xvfb's first paint on the CI runner, not
by the app: the renderer had loaded and the asset had been fetched in
513 ms and 241 ms respectively.

Three facts come out of this:

1. **The 64 MiB asset costs 64 MB of installed size and roughly 64 MB of
   installer size** on every platform. The Electron runtime itself is
   ~110–115 MB of the installer.
2. **The first launch is comfortably inside NFR-PRF-2's 5-second target**
   on Windows and macOS (0.68–1.76 s). The Linux CI number exceeds it, but
   the Linux breakdown shows the app was ready and the asset fetched in
   under 0.8 s — the 5.5 s is the virtual framebuffer's first paint.
3. **The asset does not have to be inside the ASAR.** Shipping it as an
   `extraResource` keeps it a plain file on disk, compresses once in the
   installer, and lets the protocol handler stream it.

### The SoundFont question

The size budget is dominated by the fonts, and the fonts are dominated by
licences. A survey of the candidates (full table in
`docs/spikes/s4-soundfont-shortlist.md`) found:

- **FreePats** (Upright Piano KW, Bass Guitar YR, Spanish Classical Guitar,
  FSBS Electric Guitar, MuldjordKit) — CC0 and CC-BY, explicit redistribution
  rights. **Measured: ≈ 413 MiB as SF2, ≈ 35 MiB as SF3** for the dedicated
  role fonts. The SF3 figures are the project's own build-time
  measurements (`sf2-cutter` 0.1.5, MIT, Vorbis quality `0.4`), not
  published figures — no publisher ships an SF3 build of these banks.
- **MuseScore_General** and **FluidR3Mono_GM** — MIT, with SF3 builds
  published by their authors (38.1 MiB and 13.9 MiB measured).
- **Rejected on licence**: GeneralUser GS (provenance not clear), TimGM6mb
  (GPL), Crisis General MIDI (personal use), Musyng Kite (personal use),
  Arachno SoundFont (non-commercial), Salamander Drumkit (CC-BY-SA).

S1 established that **SF3 is the shipping format**: 3.5× smaller on disk,
3–4× faster to parse, 3× less resident memory, sample-for-sample identical
output. On the real banks the measured compression is better still —
**10.8×–15.3×** — which is what makes the dedicated set fit the budget.

**The publishers' size figures cannot be used.** The FreePats pages publish
*archive* sizes, not font sizes: Upright Piano KW is published as "27 MiB"
but its extracted SF2 is 54.7 MiB. The shortlist therefore quotes measured
byte counts throughout.

## Options considered

### Where the bundled assets live

| Option | Summary | Pros | Cons |
|---|---|---|---|
| **A** | `extraResources` — assets outside the ASAR, in `resources/assets` | Plain files on disk; the installer compresses them once; the protocol handler can stream them; easy to measure and to replace | Two places to look for resources |
| B | Inside the ASAR | One bundle; nothing to configure | The renderer cannot read raw asset bytes easily; large assets are read through the ASAR filesystem layer, which is slower and awkward to range-read; replacing an asset means rewriting the archive |
| C | `asarUnpack` | Assets are real files, but still inside the archive directory | The same as B for the renderer, with the extra indirection of `app.asar.unpacked`; no advantage over A |

### Which fonts to bundle

| Option | Summary | Pros | Cons |
|---|---|---|---|
| **A** | Dedicated FreePats fonts per role (≈ 35 MiB as SF3, measured) | CC0 for three of them, so no attribution burden beyond a courtesy credit; small; good enough for a backing track; one font per role means the user can pick the instrument per channel | The piano is an upright, not a concert grand; no General MIDI set; the project owns the SF2→SF3 conversion |
| B | One General MIDI set (MuseScore_General, MIT) | Covers every role with one licence; SF3 published at 38 MB; the same bank ships in MuseScore | 206 MiB as SF2 — more than the whole budget; FluidR3's instruments are serviceable rather than good; the user cannot choose between a piano and an electric guitar *within* the bank without it being a GM preset list |
| C | Both | Maximum choice | ≈ 35 MiB + 25–38 MiB as SF3 — fits, but the GM bank duplicates roles the dedicated banks already cover |

### How to sign

| Option | Summary | Pros | Cons |
|---|---|---|---|
| **A** | **Ship unsigned first; sign when the money is available** | No cost, no delay; the interim install notes are written; the code path for signing is prepared in the build config | Windows SmartScreen and macOS Gatekeeper warnings; on Windows 11 with Smart App Control the app may not run at all |
| B | Apple Developer Program (99 USD/yr) + a public-CA or Azure certificate from day one | Clean install experience on all three platforms | A paid decision the project has not made; Windows signing is a second, recurring cost; a single paid account owned by one person is a continuity risk for an open-source project |
| C | Sign only on macOS | Fixes the harshest warning (Gatekeeper) | Still leaves SmartScreen; still 99 USD/yr |

## Decision

### Assets ship as `extraResources`, outside the ASAR

Bundled SoundFonts and other large assets ship in `resources/assets` as
`extraResources`, never inside the ASAR. The renderer reaches them through a
**custom protocol handler** registered as a privileged scheme in the main
process, with `standard: true`, `secure: true`, `supportFetchAPI: true` and
`bypassCSP: false`. The handler serves exactly one directory and rejects any
path that escapes it, including percent-encoded traversal.

The handler is the only way the renderer reads bundled assets. The renderer
has no `fs` access and no Node integration, as NFR-SEC-1 and
`implementation.md` §2 require.

### The installer size budget is **250 MB** per platform

OQ-11 is answered with a **250 MB** budget for the *installer* (the file a
user downloads) and **500 MB** for the *installed* application.

The reasoning: the measured installers with a 64 MiB asset are 160–184 MB,
so the Electron runtime plus the app is ~115 MB. A budget of 250 MB leaves
roughly **135 MB for bundled assets and the real application** — enough for
the dedicated role fonts (**≈ 35 MiB as SF3**, measured) with headroom, and
enough to absorb a larger font later without re-planning the release.

The same set is **≈ 413 MiB as SF2**, which would *not* fit — the SF3
conversion is what makes the dedicated set viable, not a nicety.

The 150 MB figure originally suggested in `requirements.md` OQ-11 is **not
reachable**: the Electron runtime alone accounts for ~115 MB of a compressed
installer, so a 150 MB installer would leave ~35 MB for every font, every
asset and the app itself. The budget is therefore raised to 250 MB.

**Fonts ship as SF3.** The dedicated per-role set is the recommended bundle
in `docs/spikes/s4-soundfont-shortlist.md`; a General MIDI fallback bank is
*not* bundled in v1.0 because it duplicates roles the dedicated banks
already cover. The conversion is a build step: `sf2-cutter` (MIT) at a
pinned Vorbis quality, with the output validated in the build.

### The build signs when credentials are present, and is unsigned until then

The build is **unsigned for the interim releases**, and the build
configuration carries the signing path so that adding credentials is a
configuration change, not a code change:

- **macOS**: hardened runtime on, `notarize: true` in the electron-builder
  config, notarization through `xcrun notarytool` with the ticket stapled to
  the DMG. This needs an **Apple Developer Program membership at 99 USD per
  year** and a Developer ID Application certificate. There is no free route
  to a Developer ID certificate for an ordinary open-source project; only
  Apple's fee waiver for eligible nonprofits, accredited educational
  institutions and government entities.
- **Windows**: Authenticode signing of the NSIS installer. The cheapest
  viable route is **Azure Artifact Signing** (formerly Trusted Signing) at
  **9.99 USD/month**; a public-CA OV certificate is 129–300 USD/year. **EV
  certificates are not worth buying for this**: Microsoft removed the EV
  OIDs from the Trusted Root Program in August 2024 and EV no longer buys a
  SmartScreen bypass. The free route for a qualifying open-source project
  is **SignPath Foundation**, which signs releases for free but reviews each
  one manually.
- **Linux**: no signing is required for an AppImage or a `.deb`. The release
  publishes SHA-256 checksums; a detached GPG signature over the checksum
  file is optional.

**Interim unsigned releases are documented** with per-platform install
instructions in `docs/spikes/s4-packaging-report.md` §6: Gatekeeper's
"Open Anyway", SmartScreen's "More info → Run anyway" (and the Smart App
Control caveat), `chmod +x` for the AppImage and `sudo apt install ./file.deb`
for the deb.

## Consequences

- **Positive**:
  - The packaging approach is proven on all three operating systems: a
    64 MiB bundled asset packages, installs and loads on Windows, macOS
    (arm64 and x64) and Linux, inside NFR-PRF-2's 5-second target.
  - The size budget is now a number the release pipeline can be checked
    against, and the asset budget inside it is large enough for the
    recommended font set.
  - Every bundled font has a verified, MIT-compatible licence and a known
    attribution obligation, so the About/Licences screen (P10.3) can be
    generated from a known list.
  - The signing path is identified and costed, with a free route on both
    Windows and macOS for qualifying organisations, so signing can be
    switched on without changing the packaging code.
- **Negative**:
  - The installer budget is 250 MB rather than the 150 MB originally
    suggested; users download more than the plan assumed.
  - Unsigned interim releases produce OS warnings, and on Windows 11 with
    Smart App Control enabled the app may be blocked with no per-app bypass.
  - The dedicated font set is smaller than a General MIDI bank: the
    bundled piano is an upright, and there is no orchestral GM set.
  - The bundled fonts have had **no listening test** in this spike; the
    quality notes come from the publishers.
- **Follow-up work**:
  - P4/P8: build the per-role SoundFont banks as SF3 in the project's own
    pipeline, pinned to `sf2-cutter` and a fixed Vorbis quality, and check
    the output sizes against the shortlist's measured figures (≈ 35 MiB for
    the dedicated set). The SF3 files measured in the spike were validated
    structurally but not auditioned against the SF2 originals.
  - P10.1: add the real application to the electron-builder configuration
    and add the size check to the release workflow.
  - P10.2: obtain credentials (Apple Developer Program or SignPath
    Foundation) and turn on signing and notarization.
  - P10.3: generate the About/Licences screen from the register in
    `docs/gap-analysis.md` §4, including the CC-BY attributions for
    MuldjordKit and YDP Grand Piano.
  - Human listening test (`testing.md` §7) of the shortlisted fonts before
    any font is committed to v1.0.
  - Re-run the packaging workflow on GitHub Actions once the billing block
    is lifted, to capture the macOS installed-size figure in CI.
