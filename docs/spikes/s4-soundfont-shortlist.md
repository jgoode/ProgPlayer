# S4 SoundFont shortlist

| | |
|---|---|
| **Status** | Shortlist for P1.5 |
| **Date** | 2026-11-07 |
| **Requirement IDs** | FR-SND-2, CON-4, CON-5, OQ-11 |
| **Task IDs** | P1.5 |
| **Related** | ADR-0005, `docs/spikes/s4-packaging-report.md`, `docs/gap-analysis.md` §4 |

FR-SND-2 requires the app to bundle **several** SoundFonts covering at least
piano, bass and guitar (plus click/percussion), and requires every bundled
font to be **redistributable under the project's licence terms**. CON-4
requires a licence compatible with MIT, with the required attributions shown
on an About/Licences screen.

## The compatibility test

A candidate is **ACCEPTED** only if all four hold:

1. An explicit **redistribution** grant (the licence text permits copying and
   distributing the work, or the publisher grants redistribution in writing).
2. The licence is **permissive**: MIT, CC0, or a Creative Commons
   **Attribution** licence. Copyleft (GPL, LGPL, MPL, CC-BY-SA), **NC**
   (non-commercial), **ND** (no derivatives) and "personal use" licences are
   **rejected** — not because they are bad licences, but because CON-4
   requires MIT-compatible distribution.
3. The **sample provenance is clear**: the publisher knows where the samples
   came from and can grant rights over them.
4. The font is available in a format the project can ship (SF2, SF3, or SFZ
   that the project converts to SF2/SF3 at build time).

A CC-BY font is accepted **with** an attribution obligation: the author,
title and licence URI must appear on the About/Licences screen.

## Shortlist

"SF3" is the Ogg-Vorbis-compressed variant; S1 established that SF3 is the
shipping format (3.5× smaller on disk, 3–4× faster to parse, 3× less
resident memory than SF2, sample-for-sample identical output).

**Sizes are measured, not quoted.** Every SF2 below was extracted from its
published archive and measured; every SF3 was produced locally by
`sf2-cutter` 0.1.5 (MIT, built from source) at Vorbis quality `0.4` and
validated with `sf2-cutter validate` (0 errors). **The publishers' own
"size" figures on the FreePats pages are archive sizes, not font sizes** —
Upright Piano KW is published as "27 MiB" but the extracted SF2 is 57 377 848
bytes (54.7 MiB). The tables use the measured byte counts.

### Piano

| Font | Author | Licence | Source | SF2 (measured) | SF3 (measured) | Ratio | Attribution | Quality notes | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| **Upright Piano KW** | Gonzalo / Roberto (FreePats project) | **CC0-1.0** | https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html | 57 377 848 B (54.7 MiB); small variant 9 456 310 B (9.0 MiB) | 3 746 770 B (3.6 MiB); small variant 770 174 B (0.7 MiB) | 15.3×; small 12.3× | none (public domain dedication) | Kawai upright recorded in a living room with a Zoom H1; stereo, two velocity layers; the full bank contains bass-note loops. An *upright*, not a concert grand — honest but not glamorous. | **ACCEPT** |
| **YDP Grand Piano** | Zenph Studios / OLPC; adapted by FreePats | **CC-BY-3.0** | https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html | 118 398 836 B (112.9 MiB) | 10 480 728 B (10.0 MiB) | 11.3× | author, title, licence URI (CC-BY-3.0) | Yamaha Disklavier Pro — the best-instrument option in the set, sampled from a real Yamaha Disklavier for the OLPC project. Single velocity layer. | **ACCEPT** (attribution required) |
| **MuseScore_General** | S. Christian Collins (adaptation); Frank Wen (FluidR3); Michael Cowgill (FluidR3Mono); Ethan Winer (temple blocks); Michael Schorsch (drumline cymbals) | **MIT** | https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/ | 215 614 036 B (205.6 MiB) | publisher's SF3: 39 900 972 B (38.1 MiB); locally converted: 26 683 162 B (25.4 MiB) | 5.4× (publisher); 8.1× (converted) | licence text + the acknowledgements named in the licence | A General MIDI bank, not a single instrument. The "Acoustic Grand Piano" preset is FluidR3-derived; quality is serviceable rather than inspiring. | **ACCEPT** (all roles, fallback) |
| **FluidR3Mono_GM** | Frank Wen / Michael Cowgill | **MIT** | https://github.com/LibreScore/sf3 | 124 420 332 B (118.7 MiB) | publisher's SF3: 14 563 174 B (13.9 MiB); locally converted: 16 062 736 B (15.3 MiB) | 8.5× (publisher); 7.7× (converted) | licence text | Mono conversion of FluidR3; the standard open General MIDI bank. Monophonic-per-voice but a full GM set. | **ACCEPT** (all roles, fallback) |
| **Salamander Grand Piano** | Alexander Holm | **CC-BY-3.0** | https://github.com/studiorack/salamander-grand-piano | 296 MiB | not published; convertible | — | author, title, licence URI | Yamaha C5, 48 kHz/24-bit, 16 velocity layers, hammer noise and string resonance — the best-sounding piano in the survey. Far too large to bundle at full size. | **ACCEPT only if trimmed** — see the note below |

### Bass

| Font | Author | Licence | Source | SF2 (measured) | SF3 (measured) | Ratio | Attribution | Quality notes | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| **Bass Guitar YR** (finger / picked) | Andrea Biasior; integrated by Roberto (FreePats) | **CC0-1.0** | https://freepats.zenvoid.org/ElectricGuitar/clean-electric-bass.html · https://github.com/freepats/electric-bass-YR | finger 4 220 300 B (4.0 MiB); picked 3 527 750 B (3.4 MiB) | finger 280 568 B; picked 280 042 B | 15.0×; 12.6× | none | Yamaha RBX bass, one octave per sample. Tiny. The finger/picked variants cover the two idioms a backing track needs. | **ACCEPT** |
| **MuseScore_General** / **FluidR3Mono_GM** | see above | MIT | see above | see above | see above | — | licence text | The Electric Bass (program 33) is FluidR3's — a plain sampled bass, serviceable but unremarkable. | **ACCEPT** (all roles, fallback) |
| **University of Iowa MIS double bass** | Lawrence Fritts, University of Iowa Electronic Music Studios | **Unrestricted use grant** — "may be downloaded and used for any projects, without restrictions" | https://theremin.music.uiowa.edu/MIS.html · https://theremin.music.uiowa.edu/MISdoublebass.html | not an SF2; AIFF/zip samples per note | n/a | — | no formal attribution required; attribution is good practice | A real *double bass* (bowed), not an electric bass — acoustically upright, at pp/mf/ff in an anechoic chamber. It is a research-grade sample set, not a SoundFont; the project would have to build the bank. | **ACCEPT as a source, not a font** |

### Guitar

| Font | Author | Licence | Source | SF2 (measured) | SF3 (measured) | Ratio | Attribution | Quality notes | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| **Spanish Classical Guitar** | Roberto (FreePats) | **CC0-1.0** | https://freepats.zenvoid.org/Guitar/acoustic-guitar.html | 19 822 546 B (18.9 MiB) | 1 358 248 B (1.3 MiB) | 14.6× | none | Nylon-string Spanish guitar, recorded with an AKG Perception 120; the page states the recording conditions were "far from ideal" and filters were applied to reduce noise. Honest, slightly noisy. | **ACCEPT** |
| **FSBS Electric Guitar Clean #1** (small variant) | FreePats project | **CC0-1.0** | https://github.com/freepats/electric-guitar-FSBS-clean | 10 854 982 B (10.4 MiB) (small) | 739 564 B (0.7 MiB) | 14.7× | none | Direct-sampled Fender electric guitar through an amp and effects rack; the *small* variant is the one that fits the budget. | **ACCEPT (small variant)** |
| **MuseScore_General** / **FluidR3Mono_GM** | see above | MIT | see above | see above | see above | — | licence text | The Acoustic Guitar and Electric Guitar presets are FluidR3's — plain but usable. | **ACCEPT** (all roles, fallback) |
| **University of Iowa MIS guitar** | Lawrence Fritts / Brian Penkrot (performer), University of Iowa EMS | **Unrestricted use grant** (as above) | https://theremin.music.uiowa.edu/MIS.html · https://theremin.music.uiowa.edu/MISguitar.html | not an SF2; AIFF/zip samples | n/a | — | no formal attribution required | Raimundo 118 classical guitar in an anechoic chamber, pp/mf/ff, stereo and mono, 44.1 kHz and 96 kHz. Again a source set, not a bank. | **ACCEPT as a source, not a font** |

### Percussion and click

| Font | Author | Licence | Source | SF2 (measured) | SF3 (measured) | Ratio | Attribution | Quality notes | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| **MuldjordKit** | Lars Muldjord; assembled by Roberto (FreePats) | **CC-BY-4.0** | https://freepats.zenvoid.org/Percussion/acoustic-drum-kit.html · https://github.com/freepats/muldjordkit | 219 362 048 B (209.2 MiB) | 20 253 008 B (19.3 MiB) | 10.8× | author, title, licence URI (CC-BY-4.0) | 2 kick drums, 3 hanging toms, floor tom, snare, hihat, 2 crashes, 2 rides, china. Stereo kit with velocity layers. The best free drum kit in the survey. | **ACCEPT** (attribution required) |
| **Salamander Drumkit** | Alexander Holm | **CC-BY-SA-3.0** | https://github.com/studiorack/salamander-drumkit | ~370 MB (SFZ project) | n/a | — | — | Excellent kit, but **CC-BY-SA** is copyleft: bundling it in an MIT app risks the share-alike applying to the combined work. | **REJECT** (licence) |
| **MuseScore_General** / **FluidR3Mono_GM** | see above | MIT | see above | see above | see above | — | licence text | A full GM percussion kit including a standard drum kit on bank 128. Good enough for the click channel and a usable default kit. | **ACCEPT** (all roles, fallback) |

## Rejected candidates

| Candidate | Author | Licence | Reason | Source |
|---|---|---|---|---|
| **GeneralUser GS v2.0.3** | Mike Gies | Permissive, custom ("free of charge, unrestricted use, including commercial") | **Sample provenance is not clear.** The font itself states it cannot be certain that every sample is its own, so the project cannot grant MIT-compatible redistribution rights over the whole bank. Debian's legal list rejected the same licence for the same reason. | https://github.com/ad-si/GeneralUser/blob/master/LICENSE.txt · https://lists.debian.org/debian-legal/2023/03/msg00001.html |
| **TimGM6mb** | Ian Wilson | **GPL-3.0** | Copyleft. Incompatible with MIT distribution (CON-4). | https://github.com/arbruijn/TimGM6mb/blob/master/COPYING.txt |
| **Crisis General Midi 3.01** | Christophe Maricourt | **Personal use**; "Any redistribution must be allowed by the author" | No redistribution grant; the author must approve every redistribution. | https://www.polyphone.io/en/soundfonts/instrument-sets/259-crisis-general-midi-v3-01 |
| **Musyng Kite** | Sarcyan / Frank Wen | **Personal use, don't distribute with more restrictions** | No redistribution grant. | https://www.polyphone.io/en/soundfonts/instrument-sets/258-musyng-kite |
| **Arachno SoundFont** | Maxime Abbey | "primarily distributed for private, non-commercial purposes only"; commercial use requires written consent from the original sample authors | Non-commercial, and the author disclaims the provenance of some presets. | https://www.arachnosoft.com/main/soundfont.php?documentation |
| **Salamander Drumkit** | Alexander Holm | **CC-BY-SA-3.0** | Share-alike is copyleft. | https://github.com/studiorack/salamander-drumkit |
| **Salamander Grand Piano** | Alexander Holm | CC-BY-3.0 | **Licence accepted, size rejected at full quality**: 296 MiB SF2 / 707 MiB SFZ+FLAC. Usable only if the bank is trimmed to the presets and layers the app actually needs. | https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html |
| **Giant Steps** (piano library) | Ian Wilson | "free for personal use"; redistribution not granted | No redistribution grant. | https://www.pianobook.co.uk |
| **Noire** | Native Instruments | Commercial product | Not free to redistribute. | https://www.native-instruments.com/products/noire |
| **Splendid Grand Piano** | AKAI (samples released to the public domain in 2000), mapped by kinwie | Public-domain samples | The *samples* are public domain, but the mapping is **SFZ + ARIA extensions** and only plays correctly in ARIA-based samplers. It is not a SoundFont, and the ARIA dependency is not available in the project's engine. | https://github.com/studiorack/splendid-grand-piano |

## Proposed bundled set (v1.0)

The set below covers all four roles and is entirely CC0/CC-BY. The project
converts each bank to **SF3 at build time**, which is what the installer
budget depends on.

| Role | Font | Licence | SF2 (measured) | SF3 (measured) | Obligation |
|---|---|---|---|---|---|
| Piano | Upright Piano KW (full) | CC0-1.0 | 54.7 MiB | 3.6 MiB | none |
| Piano (alternative) | YDP Grand Piano | CC-BY-3.0 | 112.9 MiB | 10.0 MiB | attribution |
| Bass | Bass Guitar YR — finger | CC0-1.0 | 4.0 MiB | 0.27 MiB | none |
| Bass | Bass Guitar YR — picked | CC0-1.0 | 3.4 MiB | 0.27 MiB | none |
| Guitar | Spanish Classical Guitar | CC0-1.0 | 18.9 MiB | 1.3 MiB | none |
| Guitar (alternative) | FSBS Electric Guitar Clean #1, small | CC0-1.0 | 10.4 MiB | 0.71 MiB | none |
| Percussion / click | MuldjordKit | CC-BY-4.0 | 209.2 MiB | 19.3 MiB | attribution |
| **Total (dedicated set)** | | | **≈ 413 MiB** | **≈ 35 MiB** | |
| General MIDI fallback | MuseScore_General | MIT | 205.6 MiB | 25.4 MiB (converted) / 38.1 MiB (publisher's) | licence + acknowledgements |

**The SF3 figures change the decision.** As SF2 the dedicated set is
**≈ 413 MiB**, which would blow the 250 MB installer budget on its own — the
earlier reading of the publishers' archive sizes suggested ~100 MiB, which
was wrong. Converted to SF3 the same set is **≈ 35 MiB**, comfortably inside
the ~135 MB that ADR-0005 leaves for assets after the ~115 MB Electron
runtime. The measured compression ratios for these banks are **10.8×–15.3×**,
higher than the 3.5× S1 measured on its test fixture, because the fixture
was not a real-world piano bank.

**The General MIDI fallback is not bundled in v1.0.** As SF3 it is 25–38 MB
and would fit, but it duplicates the roles the dedicated banks already
cover and its instruments are the serviceable FluidR3 ones; it stays a
candidate for a later "full GM bank" download.

**Fallback if the budget is still exceeded:** drop the two alternative-role
fonts (YDP Grand Piano and FSBS Electric Guitar), which brings the
dedicated set to **≈ 32 MiB as SF3**.

**The click channel** does not need a drum kit: the click is a synthesised
tick, and if a sample is wanted it can be one of the kit's own percussion
samples (MuldjordKit's closed hi-hat) rather than a separate asset. That
keeps the click deterministic and avoids a fourth licence.

## Sources

- FreePats piano (Upright Piano KW, YDP Grand Piano, Salamander Grand Piano): https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html
- FreePats licences: https://freepats.zenvoid.org/licenses.html
- FreePats unsuitable-licence guidance: https://freepats.zenvoid.org/unsuitable-licenses.html
- FreePats bass (Bass Guitar YR): https://freepats.zenvoid.org/ElectricGuitar/clean-electric-bass.html · https://github.com/freepats/electric-bass-YR
- FreePats acoustic guitar: https://freepats.zenvoid.org/Guitar/acoustic-guitar.html
- FreePats electric guitar (FSBS): https://freepats.zenvoid.org/ElectricGuitar/clean-electric-guitar.html · https://github.com/freepats/electric-guitar-FSBS-clean
- FreePats drum kit (MuldjordKit): https://freepats.zenvoid.org/Percussion/acoustic-drum-kit.html · https://github.com/freepats/muldjordkit
- MuseScore_General and its licence: https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/ · https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General_License.md
- FluidR3Mono SF3: https://github.com/LibreScore/sf3 · https://raw.githubusercontent.com/pianobooster/fluid-soundfont/main/COPYING
- University of Iowa MIS: https://theremin.music.uiowa.edu/MIS.html · piano: https://theremin.music.uiowa.edu/MISpiano.html · guitar: https://theremin.music.uiowa.edu/MISguitar.html · double bass: https://theremin.music.uiowa.edu/MISdoublebass.html
- Salamander Grand Piano licence: https://raw.githubusercontent.com/studiorack/salamander-grand-piano/master/LICENSE
- Salamander Drumkit licence: https://raw.githubusercontent.com/studiorack/salamander-drumkit/master/LICENSE
- GeneralUser GS licence: https://github.com/ad-si/GeneralUser/blob/master/LICENSE.txt
- Debian legal discussion of GeneralUser GS: https://lists.debian.org/debian-legal/2023/03/msg00001.html
- TimGM6mb licence: https://github.com/arbruijn/TimGM6mb/blob/master/COPYING.txt
- Crisis General Midi 3.01: https://www.polyphone.io/en/soundfonts/instrument-sets/259-crisis-general-midi-v3-01
- Musyng Kite: https://www.polyphone.io/en/soundfonts/instrument-sets/258-musyng-kite
- Arachno SoundFont documentation: https://www.arachnosoft.com/main/soundfont.php?documentation
- Splendid Grand Piano: https://github.com/studiorack/splendid-grand-piano

## Unverified

- **Listening quality.** The quality notes are the publishers' own
  descriptions and the sample-format metadata; no listening test has been
  done in this spike. `testing.md` §7's manual listening check is still
  required before any font is committed to v1.0.
- **University of Iowa MIS as a SoundFont.** The sets are published as
  per-note AIFF files in ZIP archives, not as SoundFonts. Building a
  playable bank from them is work that has not been costed.
- **Audio fidelity of the SF3 conversion.** The SF3 files were validated
  structurally (`sf2-cutter validate`: 0 errors) and their sizes measured,
  but the converted banks were not played back and compared against the
  SF2 originals in an audition. S1 established sample-for-sample identical
  output for its own conversion; that claim has not been re-checked for
  these ten banks.
- **Whether the project's own conversion pipeline reproduces these sizes.**
  The SF3 figures here were produced with `sf2-cutter` 0.1.5 at Vorbis
  quality `0.4`. A different tool or quality setting gives different sizes
  and different audio; the build must pin both.

## How the SF3 sizes were measured

| Step | Detail |
|---|---|
| Source archives | Downloaded from the publishers' own URLs listed above; the SF2 was extracted from the archive and the **extracted file** measured |
| Converter | `sf2-cutter` 0.1.5 (MIT), built from source (`cargo build --release --features sf3-write`), GitHub `FelixGSE/sf2-cutter` |
| Command | `sf2-cutter convert "<font>.sf2" -o "<font>.sf3" --quality 0.4` |
| Validation | every produced SF3 passed `sf2-cutter validate` with 0 errors |
| Measurement | exact byte counts of the extracted SF2 and the produced SF3 |

**Two findings worth recording.** (1) The FreePats pages publish *archive*
sizes, not font sizes — Upright Piano KW is published as "27 MiB" but its
SF2 is 54.7 MiB. Any size estimate built from the publishers' figures is
wrong by roughly a factor of two. (2) The `https://raw.githubusercontent.com/LibreScore/sf3/master/FluidR3Mono_GM.sf3`
URL returns **404**; the current release asset is
`FluidR3Mono_GM.sf3.wasm` (14 563 174 bytes), which despite the extension is
a valid RIFF `sfbk` SF3 (195 presets / 201 instruments / 1037 samples) and
is byte-identical to the publisher's copy in `musescore/MuseScore@v2.3.2`.
