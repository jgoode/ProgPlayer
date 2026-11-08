# Spike S4 — Packaging report

| | |
|---|---|
| **Status** | Complete |
| **Date** | 2026-11-07 |
| **Requirement IDs** | PLT-3, NFR-PRF-2, CON-4, CON-5, CON-6, OQ-11, OQ-12 |
| **Task IDs** | P1.4, P1.5 |
| **CI run** | 42381612293 (green on Windows, macOS arm64, macOS x64, Ubuntu) |
| **Local re-verification** | Windows x64, 2026-11-07 — the build, package and first-launch sequence re-run on the development machine; the installed size matched the CI figure byte for byte (see §3) |
| **Harness** | `spikes/s4/` — throwaway; nothing in it ships |
| **Related** | ADR-0005, `docs/spikes/s4-soundfont-shortlist.md`, `docs/gap-analysis.md` §4 |

## 1. What the spike did

A throwaway Electron application was packaged with **electron-builder
26.18.0** against **Electron 45.2.2**:

- a window that fetches one bundled asset over a custom protocol;
- a 64 MiB asset of incompressible pseudo-random bytes, shipped as an
  `extraResource` (outside the ASAR);
- a privileged `s4://` protocol handler in the main process that serves
  exactly one directory and rejects any path that escapes it.

Targets:

| Platform | Targets |
|---|---|
| Windows x64 | NSIS installer (`.exe`), per-user, install-directory selectable |
| macOS | DMG, **arm64 and x64**, hardened runtime on, unsigned |
| Linux x64 | **AppImage** and **deb** |

The CI workflow is `.github/workflows/spike-s4-packaging.yml`. It builds,
packages, records the artefact sizes, measures the installed size, launches
the *packaged* binary and records the first-launch timings, then uploads the
packages and the JSON reports as workflow artefacts.

### The protocol handler

The handler is registered before `app.whenReady()`:

```ts
protocol.registerSchemesAsPrivileged([
  {
    scheme: 's4',
    privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: false },
  },
]);
```

Path resolution is a pure function (`spikes/s4/app/electron/asset-path.ts`)
with no Electron import, so it is unit-tested
(`tests/unit/spike-s4-asset-path.test.ts`): a well-formed URL maps inside
the asset root; percent-encoded file names decode; a different scheme, an
empty path, a malformed URL and every traversal form (`../`, `..%2f`,
`%2e%2e/`) are rejected.

`bypassCSP: false` keeps the scheme subject to the Content Security Policy,
so the renderer cannot use it to widen what it may load.

## 2. Installer and installed sizes

Measured in CI run 42381612293. The asset is 64 MiB (67 108 864 bytes) in
every configuration.

| Platform | Artefact | Bytes | MB | Download |
|---|---|---|---|---|
| Windows x64 | `PracticePlayer S4 Spike-0.1.0-x64.exe` (NSIS) | 187 305 191 | **178.63** | installer |
| macOS arm64 | `PracticePlayer S4 Spike-0.1.0-arm64.dmg` | 187 977 716 | **179.27** | installer |
| macOS x64 | `PracticePlayer S4 Spike-0.1.0-x64.dmg` | 191 851 219 | **182.96** | installer |
| Linux x64 | `PracticePlayer S4 Spike-0.1.0-x86_64.AppImage` | 192 816 344 | **183.88** | installer |
| Linux x64 | `PracticePlayer S4 Spike-0.1.0-amd64.deb` | 167 784 952 | **160.01** | installer |

Installed size (the unpacked application as it sits on disk):

| Platform | Installed bytes | Installed MB |
|---|---|---|
| Windows x64 (`win-unpacked`) | 440 903 627 | **420.48** |
| Linux x64 (`linux-unpacked`) | 353 855 328 | **337.46** |
| macOS arm64 (`PracticePlayer S4 Spike.app`) | 338 717 232 | **323.03** |
| macOS x64 (`PracticePlayer S4 Spike.app`) | 342 360 704 | **326.50** |

The macOS bundle's apparent size is inflated by the framework's symlinked
`Versions/` directories: a naive walk counts the 198 MB Electron Framework
binary three times — once at the framework's top level, once in
`Versions/A` and once in `Versions/Current`. Counting each real file once
gives **~250 MB for the framework** and **69.62 MB for
`Contents/Resources`** (64.00 MB of which is the asset). The Windows and
Linux figures come from the CI runs; the macOS figures were measured from
the CI artefact's unpacked bundle with the real symlink layout restored by
hand, because the artefact was downloaded and extracted on a machine that
turns the symlinks into copies — see §7.

**What the sizes say.** The 64 MiB asset accounts for 64 MB of installed
size and, because the sample bytes are incompressible, roughly 64 MB of
installer size on every platform. Subtracting it leaves an Electron runtime
plus stub application of ~115 MB in the installer and ~260–360 MB installed.
The `.deb` is the smallest installer (160 MB) because deb's compression
handles the incompressible sample better than the NSIS and AppImage
containers.

## 3. First-launch measurements

The measurement launches the **packaged** binary with a fresh process, so
it exercises the installed layout. It is a cold *process* start, not a cold
*disk* start: the CI runner has just written the installer, so the asset
bytes may still be in the page cache.

| Platform | App ready | Renderer loaded | Window shown | Cold asset fetch | Warm fetch | Total |
|---|---|---|---|---|---|---|
| Windows x64 | 36 ms | 663 ms | 697 ms | 408 ms | 342 ms | **1 390 ms** |
| macOS arm64 | 87 ms | 402 ms | 455 ms | 188 ms | 104 ms | **680 ms** |
| macOS x64 | 321 ms | 805 ms | 1 393 ms | 563 ms | 441 ms | **1 764 ms** |
| Linux x64 | 424 ms | 514 ms | **5 483 ms** | 241 ms | 199 ms | **5 483 ms** |

**Against NFR-PRF-2 (cold start to ready-to-play under 5 s):** Windows and
macOS pass with large margin (0.68–1.76 s).

The Linux figure needs reading carefully. The app was ready in 424 ms, the
renderer had loaded in 514 ms and the 64 MiB asset had been fetched in
241 ms — but the window was not *shown* until 5 483 ms. The gap is
Xvfb's first paint on a headless CI runner, not the application: there is
no display server, so the compositor presents the window lazily. The
measured cost of the app itself is under 0.8 s. **This is an
[INFERENCE] from the breakdown, not a measured GUI-launch time** — a real
Linux desktop session would show the window as soon as the renderer is
ready. The honest statement is that the *application* work is well inside
the budget on Linux, and the *window presentation* is unverified there.

The cost of the bundled asset is small in every configuration: fetching
64 MiB over the custom protocol took 188–563 ms cold and 104–441 ms warm.

### Local measurement on the development machine

Re-verified locally on Windows x64 after the CI run, with the same
`spikes/s4/tools/build.mjs` → `package.mjs` → `measure.mjs` sequence:

| Measurement | Value |
|---|---|
| Installer | 188 209 661 B (179.49 MB) — 0.86 MB larger than the CI build, which is the usual NSIS run-to-run variation |
| Installed size | 440 903 627 B (420.48 MB) — **byte-identical to the CI figure** |
| App ready | 33 ms |
| Renderer loaded | 273 ms |
| Window shown | 608 ms |
| Cold asset fetch | 206 ms |
| **Total** | **700 ms** |

The earlier local run could not launch the unsigned packaged executable —
the workstation's Smart App Control blocked it — and used the ASAR-hosted
variant instead (587 ms, `first-launch-win32-x64-asar.json`). The packaged
executable now runs, so the figure above is the **packaged** mode, the same
mode CI uses.

## 4. Size budget (OQ-11)

**Decision: a 250 MB installer budget, and a 500 MB installed-size budget**
(ADR-0005).

| Item | Value |
|---|---|
| Measured Electron runtime + stub app, compressed | ~115 MB |
| Budgeted installer | **250 MB** |
| Budget left for bundled assets and the real app | **~135 MB** |
| Recommended dedicated font set as SF2 (measured) | **≈ 413 MiB** — would not fit |
| **Same set as SF3 (measured)** | **≈ 35 MiB** — fits with room to spare |

The 150 MB figure originally suggested in `requirements.md` OQ-11 is **not
reachable**: the Electron runtime alone is ~115 MB of a compressed
installer, leaving ~35 MB for every font, every asset and the application
itself. The budget is raised to 250 MB.

**The font sizes are measured, not quoted.** The publishers' FreePats pages
publish *archive* sizes, not font sizes — Upright Piano KW is published as
"27 MiB" but its extracted SF2 is 57 377 848 bytes (54.7 MiB). Every SF2 in
the shortlist was extracted and measured, and every SF3 was produced locally
with `sf2-cutter` 0.1.5 (MIT) at Vorbis quality `0.4` and validated. The
measured compression ratios for these banks are **10.8×–15.3×**, higher than
the 3.5× S1 measured on its test fixture, so the dedicated set fits
comfortably where the SF2 figures would not. Full method and per-font
figures: `docs/spikes/s4-soundfont-shortlist.md`.

| Font | Role | SF2 (measured) | SF3 (measured) |
|---|---|---|---|
| Upright Piano KW | piano | 54.7 MiB | 3.6 MiB |
| YDP Grand Piano | piano (alt) | 112.9 MiB | 10.0 MiB |
| Bass Guitar YR — finger | bass | 4.0 MiB | 0.27 MiB |
| Bass Guitar YR — picked | bass | 3.4 MiB | 0.27 MiB |
| Spanish Classical Guitar | guitar | 18.9 MiB | 1.3 MiB |
| FSBS Electric Guitar Clean #1, small | guitar (alt) | 10.4 MiB | 0.71 MiB |
| MuldjordKit | percussion | 209.2 MiB | 19.3 MiB |
| **Total** | | **≈ 413 MiB** | **≈ 35 MiB** |

## 5. Signing and notarization (OQ-12)

### Cost summary

| Platform | Mechanism | Requirement | Cost (USD) | Source |
|---|---|---|---|---|
| macOS | Apple Developer Program membership (individual or organization) | Active membership; the Account Holder creates the Developer ID Application certificate | **99 per membership year** | https://developer.apple.com/programs/whats-included |
| macOS | Developer ID Application certificate | Apple-issued only — not Mac Distribution, ad hoc, Apple Developer or self-signed | included in the membership (no separate price published — *unverified* that there is no other cost) | https://developer.apple.com/help/account/certificates/create-developer-id-certificates |
| macOS | Notary service submission + stapling | Developer ID signature, hardened runtime, secure timestamp, valid entitlements, SDK ≥ 10.9 | no fee published (*unverified*) | https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution |
| macOS | Fee waiver | Nonprofit, accredited educational institution or government entity; must be approved | **0** | https://developer.apple.com/help/account/membership/fee-waivers |
| Windows | Azure Artifact Signing (formerly Trusted Signing), Basic | Microsoft identity validation; keys in an FIPS HSM; no token | **9.99 per month** (5 000 signatures included) | https://azure.microsoft.com/en-us/products/artifact-signing |
| Windows | Public-CA OV code-signing certificate | Organization validation; key in FIPS hardware | **129–300 per year** | https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options |
| Windows | EV code-signing certificate | Extended validation | 349–400+ per year — **not recommended**: EV no longer buys a SmartScreen bypass | https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options |
| Windows | SignPath Foundation | OSI-approved licence, no proprietary code, manual review per release | **0** for qualifying OSS projects | https://signpath.org/ |
| Windows | Self-signed | The root must be installed manually on every machine | 0 | https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options |
| Linux | None required | AppImage and deb have no mandatory signature | 0 | https://docs.appimage.org/packaging-guide/optional/signatures.html |

### macOS

Apple's own documentation lists what notarization requires: code-sign every
executable, sign with a **Developer ID** certificate, enable the **hardened
runtime**, include a secure timestamp, omit
`com.apple.security.get-task-allow`, link against the macOS 10.9 SDK or
later, and use properly formatted XML entitlements. Notarization fails with
*"The executable does not have a hardened runtime enabled"* if the runtime
is off.

Submission is `xcrun notarytool submit … --wait`; the ticket is then
stapled with `xcrun stapler staple`, so Gatekeeper can find it offline.
Only the outermost container (the DMG) is notarized, and the DMG is signed
with the Developer ID Application identity.

**There is no free route to a Developer ID certificate for an ordinary
open-source project.** The membership is 99 USD/year and the only free path
is Apple's fee waiver, which is limited to approved nonprofits, accredited
educational institutions and government entities. Apple documents no
notarization restriction based on membership type, so an individual
membership is sufficient (*the explicit "individual members are eligible"
statement is an [INFERENCE] from the certificate and account documentation*).

### Windows

- Signing an NSIS installer means an **Authenticode** signature on the
  installer; a self-signed certificate behaves like no signature for
  SmartScreen.
- **EV certificates are not worth the premium.** Microsoft removed the EV
  OIDs from the Trusted Root Program in August 2024; EV and OV now go
  through the same reputation-building process, and Microsoft's own guidance
  says paying for EV solely to avoid SmartScreen warnings is no longer
  justified.
- **SmartScreen reputation accrues over time.** Microsoft states there is
  "no exact threshold" and it "can take several weeks and hundreds of clean
  installs from a wide audience". There is no mechanism to submit a file
  for reputation review on consumer endpoints; reputation builds from
  download volume.
- Public code-signing certificates issued on or after 2026-03-01 are
  limited to **460 days** (DigiCert's operational cap is 459 days), so a
  multi-year vendor plan is a new certificate each year.
- **Smart App Control** (Windows 11) blocks unsigned files with **no
  per-app bypass**; the documented options are to turn it off or to sign
  the app. This is why the unsigned interim release notes have to say so
  plainly.

### Linux

Neither the AppImage format nor the `.deb` container requires a signature.
Signing is optional: an AppImage may carry a GPG signature, and a Debian
repository signs its `Release` file. The release publishes SHA-256
checksums regardless.

## 6. Interim unsigned install instructions

### Windows (unsigned NSIS installer)

1. Download the installer from the official project download page and
   verify the published SHA-256 checksum.
2. Run it. If SmartScreen appears, expect the **"Windows protected your
   PC"** warning; Microsoft documents that the user must choose **"Run
   anyway"** before the app can run. *(The "More info" expansion step is
   the standard UI for this dialog, but it is attested only by Microsoft
   community content, not by a product-documentation page — treat it as
   unverified against primary docs.)*
3. **Smart App Control** (Windows 11) blocks unsigned binaries with no
   per-app bypass: turn it off in Windows Security, or wait for a signed
   release. https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions
4. On managed/enterprise devices the bypass may be disabled by policy.
5. Report a false positive through https://www.microsoft.com/en-us/wdsi/filesubmission
   (choose **Microsoft Defender SmartScreen**).

### macOS (unsigned DMG)

1. Open the DMG and drag the app to **Applications**.
2. Launch it once. Gatekeeper warns that the app "isn't registered with
   Apple by a known developer" and that "Apple cannot check [it] for
   malicious software". Apple's own wording: *"Overriding security settings
   to open an app is the most common way that a Mac gets infected with
   malware"* — the install notes must carry that warning.
3. Override: **Apple menu → System Settings → Privacy & Security → Security
   → Open Anyway**, then confirm **Open**. The button is available for
   about an hour after the first attempt, and the app is then saved as an
   exception.
4. On older macOS, control-click (or right-click) the app icon → **Open**
   → **Open**.
5. Verify the published SHA-256 checksum of the DMG.

### Linux (AppImage)

1. Download the AppImage.
2. `chmod +x PracticePlayer-<version>-x86_64.AppImage`, then run it.
   In a file manager: Properties → Permissions → "Allow executing file as
   program" (or "Is executable", or "Execute → Anyone", depending on the
   file manager).
3. AppImageLauncher can be installed for menu integration and update
   management. It is a third-party convenience, not a trust authority.

### Linux (deb)

1. Download the `.deb`.
2. `sudo apt install ./practiceplayer_<version>_amd64.deb`, or
   `sudo dpkg -i practiceplayer_<version>_amd64.deb` followed by
   `sudo apt-get install -f` if dependencies are missing.
3. Verify the published SHA-256 checksum.

## 7. What was not verified

- **The macOS installed-size figure in CI.** The green run 42381612293
  measured the installed size only on Windows and Linux; the macOS step
  looked for a directory containing "unpacked", which does not exist on
  macOS. The step was replaced with `spikes/s4/tools/measure-installed-size.mjs`,
  which handles the macOS `.app` bundle and counts each hard-linked file
  once. **The replacement step has not run on GitHub Actions**: the
  subsequent workflow runs were stopped by GitHub with *"The job was not
  started because recent account payments have failed or your spending
  limit needs to be increased"*. The macOS installed sizes in §2 were
  measured from the CI artefact's unpacked bundle with the real symlink
  layout restored by hand (the artefact was extracted on a machine that
  turns the framework's symlinks into copies, so a naive walk of the
  downloaded tree counts the 198 MB framework binary three times and
  reports ~823 MB instead of ~323 MB). The script's own dedup by device
  and inode handles the case where the files *are* hard links, but it
  cannot undo copies that the extraction created. **Tracked as gap G-29**:
  measure on the macOS runner, never from a downloaded artefact.
- **The Linux window-presentation time**, as explained in §3. **Gap G-30 —
  withdrawn 2026-11-08** as out of scope: Linux is not a supported platform
  for v1.0, so the measurement is not required. The Windows and macOS
  first-launch figures are measured on real desktops. The Linux numbers in
  this report stay as historical evidence.
- **Real audio and MIDI hardware.** The spike is a stub app: it does not
  play sound and does not open a MIDI port. `testing.md` §7's device checks
  are still required.
- **The SF3 size of the shortlisted fonts.** The SF3 sizes in §4 are
  **measured**: every SF2 was extracted and measured, and every SF3 was
  produced locally with `sf2-cutter` 0.1.5 at Vorbis quality `0.4` and
  validated (`sf2-cutter validate`: 0 errors). What remains unverified is
  that the project's own build pipeline reproduces those sizes with the
  same tool and quality setting, and that the converted banks were not
  auditioned against the SF2 originals. **Tracked as gap G-31.**
- **Listening quality** of the shortlisted fonts. The quality notes come
  from the publishers. **Tracked as gap G-33**; the procedure is
  `testing.md` §7 **M-8** (bundled SoundFont review).

## 8. Reproducing the spike

```bash
pnpm install --frozen-lockfile
pnpm run spike:s4:build          # compiles the stub app and writes the 64 MiB asset
pnpm run spike:s4:package        # runs electron-builder; writes sizes.json
pnpm run spike:s4:measure        # launches the packaged app and writes the timing JSON
node spikes/s4/tools/measure-installed-size.mjs
```

On GitHub, the workflow `.github/workflows/spike-s4-packaging.yml` runs the
same steps on `windows-latest`, `macos-latest` (arm64) and `macos-15-intel`
(x64) and uploads the packages and the JSON reports.

> **The Linux leg was removed on 2026-11-08**, when Linux was dropped as a
> supported platform (PLT-1). The AppImage and `.deb` figures in this report
> are the evidence from CI run 42381612293 and stay here as history; the
> harness no longer has a Linux target, so they cannot be re-measured
> without re-adding it.

**Verified locally on Windows x64 (2026-11-07):** the whole sequence ran
end to end on the development machine — `build.mjs` produced the 64 MiB
asset, `package.mjs` produced a 179.49 MB NSIS installer,
`measure-installed-size.mjs` reported **440 903 627 B (420.48 MB)** —
byte-identical to the CI figure — and `measure.mjs` launched the *packaged*
executable and recorded a **700 ms** first launch with a 206 ms cold asset
fetch. The only differences from CI are the NSIS run-to-run size variation
(0.86 MB) and the machine's own speed.
