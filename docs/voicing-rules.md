# PracticePlayer — Voicing rules

**Status:** Phase 2 defaults (P2.6). These are the OQ-6 defaults described in
`requirements.md` §12 and `implementation.md` §2.5. They are implemented in
`src/core/theory/voicing.ts` and are **pending the M-7 listening review**
(`testing.md` §7). The rule table is data, so the defaults can be changed
without touching the voicing algorithm.

Requirements covered: FR-PLY-2 (register and minimal movement), FR-PLY-3 (bass
root), FR-CHD-3 (chord tones available to the engine and displays).

## 1. Registers

| Part | MIDI range | Centre | Notes |
|---|---|---|---|
| Chords | 55 (G3) – 84 (C6) | C4 (60) | Sits around middle C, as OQ-6 proposes. |
| Bass | 28 (E1) – 52 (E3) | C3 (48) | One octave below the chord centre. |

Both ranges are inclusive and are exposed as `DEFAULT_VOICING_RULES` in
`src/core/theory/voicing.ts`, so a caller can pass a different
`VoicingRules` object to `voiceChord`, `voiceProgression` or
`closePositionCandidates`.

No voicing leaves the playable MIDI range (0–127), and the chord part is
always inside the chord register and the bass part inside the bass register.

## 2. Close position

A voicing is **close position** when every chord tone is as low as it can go
while keeping the chord tones in ascending order and the span within
`closeSpan` (24 semitones, two octaves).

The implementation enumerates every **rotation** of the retained chord tones.
Each rotation is an inversion of the chord: the chord's lowest voice becomes
the lowest note, and the remaining tones follow in close position. Rotations
are then shifted by octaves so the whole voicing fits the chord register.

## 3. Extension handling

Extensions add notes that make a block voicing muddy. Two rules apply, in
this order:

| Rule | Condition | Effect |
|---|---|---|
| `drop-fifth-for-ninth-or-higher` | The chord formula contains a 9th, 11th or 13th | The 5th is removed. |
| `drop-eleventh-over-major-third` | The chord contains a major 3rd and an **unaltered** 11th (perfect 11th, 17 semitones) | The 11th is removed. |

The second rule keeps the 11th when:

- the chord has a minor third (`m11`, `m13`); or
- the 11th is altered (`maj7♯11`, `9♯11`, `13♯11`), because an altered 11th is
  itself a colour note rather than a clash with the major third.

An altered dominant such as `7♯9` keeps its 5th, because the 5th is part of
the altered chord's identity rather than a redundant extension.

The rules live in `VOICING_RULES` in `src/core/theory/voicing.ts` as data.
`retainedFormulaDegrees(quality)` returns the degrees that survive the rules,
which is directly testable.

## 4. Voice leading

`voiceProgression` carries each voicing into the next chord and picks the
inversion with the **least movement**.

The movement score is symmetric: every note in the previous voicing is
charged its distance to the nearest note in the candidate, and every note in
the candidate is charged its distance to the nearest note in the previous
voicing. A common tone therefore costs nothing. An added or removed voice is
charged once for each side that has no counterpart.

Ties are broken deterministically: lower movement first, then the lower
lowest note, then the lower first chord note. The result is stable across
runs and platforms.

The first chord of a progression has no predecessor, so it is centred on
middle C: the candidate whose **root** is closest to MIDI 60 wins. On a tie
the root-position voicing is preferred, then the candidate whose lowest note
is closest to MIDI 60.

## 5. Bass

The bass plays the chord **root**, not the lowest chord tone. The root is
placed in the bass register as close as possible to C3 (MIDI 48), so the bass
sits an octave below the chord centre and does not leap between inversions.

## 6. Worked examples

| Chord | Retained degrees | Default voicing (chord / bass) |
|---|---|---|
| Cmaj7 | 1, 3, 5, 7 | C4 E4 G4 B4 / C3 |
| Cm7 | 1, 3, 5, 7 | C4 E♭4 G4 B♭4 / C3 |
| G7 | 1, 3, 5, 7 | G3 B3 D4 F4 / G2 |
| C9 | 1, 3, 7, 9 | C4 E4 B♭4 D5 / C3 |
| Cmaj11 | 1, 3, 7, 9 | C4 E4 B4 D5 / C3 |
| Cm11 | 1, 3, 7, 9, 11 | C4 E♭4 B♭4 D5 F5 / C3 |
| Cmaj7♯11 | 1, 3, 7, 11 | C4 E4 B4 F♯5 / C3 |
| G7♯5 | 1, 3, 5, 7 | G3 B3 D♯4 F4 / G2 |

The examples above are the voicing of each chord **in isolation**. Inside a
progression the voice-leading rule applies instead, so the same chord may be
voiced in a different inversion. For example, in C, a ii–V–I is voiced
Dm7 = D4 F4 A4 C5, G7 = D4 F4 G4 B4 and Cmaj7 = E4 G4 B4 C5 — the G7 keeps
its 3rd and 7th in common with the surrounding chords, which is the point of
the minimal-movement rule.

## 7. Questions for the M-7 listening review

These are the open questions a musician should answer by ear. Each is
recorded here so that a review can be run against a fixed checklist.

1. **Is G3–C6 the right chord register?** It centres the block chords on
   middle C, but a guitar practice app may prefer a lower or narrower range
   so that block chords fit a player's comfortable stretch.
2. **Should the bass centre on C3 (MIDI 48) or lower?** The current default
   puts the bass an octave below the chord centre, which may be muddy for a
   sustained bass voice on small speakers.
3. **Does dropping the 5th on every 9th-and-above chord always help?** Some
   players prefer a complete chord on sustained pads, where the density is
   not a problem.
4. **Should the unaltered 11th really be dropped over a major third?** The
   rule matches jazz practice for a major 11th chord, but a rock guitarist
   may prefer the added colour.
5. **Should an altered 11th keep the 5th?** Currently `maj7♯11` keeps the 5th
   and the natural 11th is only dropped when unaltered.
6. **Is the symmetric nearest-note movement cost the right measure?** It
   rewards common tones but does not prefer keeping the same voice order, so
   a candidate can move voices past each other.
7. **Should inversions be limited?** The rules currently allow every
   rotation, so a chord can be voiced in any inversion. Restricting the set
   (for example to root position and first inversion) would make progressions
   steadier but less varied.
8. **Do the default voicings suit every preset in at least four keys?** The
   M-7 procedure requires a musician to rate each as acceptable, awkward or
   wrong, with awkward and wrong cases becoming defects against these rules.
9. **Should the bass follow the chord's inversion?** The bass always plays
   the root, so a first-inversion chord still has a root bass. This matches
   FR-PLY-3 but is worth confirming by ear.

## 8. Change procedure

To change a rule after the listening review:

1. Edit the table in `src/core/theory/voicing.ts` (`VOICING_RULES`) or the
   register values in `DEFAULT_VOICING_RULES`.
2. Update the worked examples in §6 of this document.
3. Update the voicing tests in `src/core/theory/voicing.test.ts` to the new
   expected degrees and ranges.
4. Record the decision in `docs/progress.md` §4 and note the review in
   `docs/gap-analysis.md` (G-10).
