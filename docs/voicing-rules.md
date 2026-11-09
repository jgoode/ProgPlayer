# PracticePlayer — Voicing rules

**Status:** Phase 2 defaults (P2.6), revised after the M-7 review questions
were answered on 2026-11-08. The chord register is **E2–G6**, centred on C3,
and the bass register is **E1–E♭2**, centred on C2, with the bass always
below the chord part. The rule table is data, so the defaults can be changed
without touching the voicing algorithm.

Requirements covered: FR-PLY-2 (register and minimal movement), FR-PLY-3 (bass
root), FR-CHD-3 (chord tones available to the engine and displays).

## 1. Registers

| Part | MIDI range | Centre | Notes |
|---|---|---|---|
| Chords | 40 (E2) – 91 (G6) | C3 (48) | Guitar-adjacent lower-middle register. |
| Bass | 28 (E1) – 39 (E♭2) | C2 (36) | The bass guitar's lowest octave, below the chord part. |

Both ranges are inclusive and are exposed as `DEFAULT_VOICING_RULES` in
`src/core/theory/voicing.ts`, so a caller can pass a different
`VoicingRules` object to `voiceChord`, `voiceProgression` or
`closePositionCandidates`.

The chord register is centred on **C3 (48)** rather than middle C, so the
block chord sits in the guitar's lower-middle register. The chord part
therefore uses the lower part of its E2–G6 range in practice: measured over
all 29 Appendix A presets in all 12 keys (1 788 voiced chords), the chord
notes actually used run from **E2 (40) to A♭4 (68)**, and the most common
lowest chord notes are B2, B♭2 and C3. The top of the register is headroom
for progressions that need to rise.

The bass register reaches **E♭2 (39)** rather than C2 (36) because it must
cover all twelve pitch classes. E1–C2 (28–36) holds only nine of them, which
leaves **C♯, D and E♭ roots with no playable bass note at all** — 126 of the
504 root × quality combinations throw instead of voicing. E1–E♭2 is the
smallest extension that covers all twelve.

The registers are **disjoint by construction**: the chord part is always
placed above the bass note for the same chord, so the bass is the lowest
sounding pitch at all times. `voiceChord` chooses the bass first and then
discards any chord candidate that would start at or below it. This matters
because the chord register reaches down to E2, which overlaps the bass
register; without the constraint a chord block could be voiced *below* the
bass line.

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

The first rule is unconditional on the chord's quality: **any** chord whose
formula contains a 9th, 11th or 13th loses its 5th, including altered
dominants such as `7♯9` and `7♯5`. The reason is density: a guitar player
wants a block of at most four notes to play or hear cleanly, and the 5th is
the most expendable tone in an extended chord. For the same reason an
altered 11th does **not** get its 5th back — `maj7♯11` keeps 1, 3, 7 and 11
only.

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

The symmetric cost has a useful property: it cannot select a voicing whose
voices cross. Matching each candidate note to the nearest previous note and
checking that the matches keep their relative order is a testable invariant,
and `countVoiceCrossings` exposes it. Measured over all 29 Appendix A
presets in all 12 keys, none of the 1 440 chord-to-chord transitions select a
crossing voicing. No extra crossing penalty is needed, and none is applied.

The first chord of a progression has no predecessor, so it is centred on
the chord centre: the candidate whose **root** is closest to C3 (MIDI 48)
wins. On a tie the root-position voicing is preferred, then the candidate
whose lowest note is closest to the centre.

## 5. Bass

The bass plays the chord **root**, not the lowest chord tone, matching
FR-PLY-3. The root is placed in the bass register as close as possible to C2
(MIDI 36), which is the centre of the bass-guitar's lowest octave, so the
bass does not leap between inversions.

The chord part is always placed **above** the bass note for the same chord.
`voiceChord` selects the bass first, then discards any chord candidate whose
lowest note is at or below it.

## 6. Worked examples

| Chord | Retained degrees | Default voicing (chord / bass) |
|---|---|---|
| Cmaj7 | 1, 3, 5, 7 | C3 E3 G3 B3 (48 52 55 59) / C2 (36) |
| Cm7 | 1, 3, 5, 7 | C3 E♭3 G3 B♭3 (48 51 55 58) / C2 (36) |
| G7 | 1, 3, 5, 7 | G2 B2 D3 F3 (43 47 50 53) / G1 (31) |
| C9 | 1, 3, 7, 9 | C3 E3 B♭3 D4 (48 52 58 62) / C2 (36) |
| Cmaj11 | 1, 3, 7, 9 | C3 E3 B3 D4 (48 52 59 62) / C2 (36) |
| Cm11 | 1, 3, 7, 9, 11 | C3 E♭3 B♭3 D4 F4 (48 51 58 62 65) / C2 (36) |
| Cmaj7♯11 | 1, 3, 7, 11 | C3 E3 B3 F♯4 (48 52 59 66) / C2 (36) |
| G7♯5 | 1, 3, 5, 7 | G2 B2 D♯3 F3 (43 47 51 53) / G1 (31) |

The examples above are the voicing of each chord **in isolation**. Inside a
progression the voice-leading rule applies instead, so the same chord may be
voiced in a different inversion. For example, in C, a ii–V–I is voiced
Dm7 = D3 F3 A3 C4 (50 53 57 60), G7 = D3 F3 G3 B3 (50 53 55 59) and
Cmaj7 = E3 G3 B3 C4 (52 55 59 60) — the G7 keeps its 3rd and 7th in common
with the surrounding chords, which is the point of the minimal-movement rule.

## 7. M-7 review questions and outcome

The nine questions below were put to the project owner on 2026-11-08. The
answers are recorded here with the decision taken for each, so that a later
listening pass can check the result against the same checklist. Where an
answer was "whatever is best for guitar", the decision was made by reasoning
and by measuring the rule over all Appendix A presets in all 12 keys; the
**by-ear** part of the M-7 procedure (`testing.md` §7) is still outstanding.

| # | Question | Answer | Decision |
|---|---|---|---|
| 1 | Is G3–C6 the right chord register? | E2–G6 | Chord register changed to MIDI 40–91, centred on C3 (48) so the block sits in the guitar's lower-middle register. |
| 2 | Should the bass centre on C3 or lower? | Best for guitar | Bass register E1–E♭2 (28–39), centred on C2 (36), below the chord part. E1–C2 was tried first and rejected: it leaves C♯, D and E♭ with no bass note. |
| 3 | Does dropping the 5th on every 9th-and-above chord always help? | Some players prefer a complete chord on sustained pads | Rule kept. Density wins for guitar: the 5th is the most expendable tone and the block stays playable. |
| 4 | Should the unaltered 11th really be dropped over a major third? | Best for guitar | Rule kept. The major 3rd and perfect 11th clash by a semitone, which is very audible on guitar. |
| 5 | Should an altered 11th keep the 5th? | Best for guitar | No. `maj7♯11` keeps 1, 3, 7, 11 only, for the same density reason as question 3. |
| 6 | Is the symmetric nearest-note movement cost the right measure? | Best for guitar | Kept, and no crossing penalty added — see below. |
| 7 | Should inversions be limited? | Best for guitar | No. All rotations remain allowed — see below. |
| 8 | Do the default voicings suit every preset in at least four keys? | Best for guitar | Verified programmatically over all 29 presets in all 12 keys; the by-ear rating is still open. |
| 9 | Should the bass follow the chord's inversion? | Root bass, matching FR-PLY-3 | Unchanged: the bass always plays the root. |

### Question 6 — movement cost

The symmetric nearest-note cost rewards common tones, which is what a player
wants when a chord changes. The concern was that it does not explicitly
prefer keeping the same voice order, so a candidate could move voices past
each other.

Measured over all 29 presets in all 12 keys (1 440 chord-to-chord
transitions), **no transition selects a crossing voicing**. The reason is
structural: the nearest-note match that produces a crossing is always more
expensive than the uncrossed alternative, so the symmetric cost cannot pick
one. A crossing penalty would therefore be dead weight, and none is applied.
`countVoiceCrossings` keeps the property testable.

### Question 7 — inversion limits

Restricting the inversions was measured, not assumed:

| Inversions allowed | Voice crossings | Total movement | Common tones held |
|---|---|---|---|
| All | 26 | 5 976 | 2 114 |
| Up to 2 | 192 | 6 782 | 2 114 |
| Up to 1 | 526 | 11 688 | 1 455 |
| Root position only | 1 126 | 19 792 | 1 210 |

(Totals are over the same 29 presets × 12 keys.) Restricting the inversions
makes progressions **worse** on every measure: crossings rise sharply,
movement nearly doubles and common tones collapse. All rotations therefore
remain allowed.

### Still to be checked by ear

The M-7 procedure requires a musician to rate the default voicings across
all presets in at least four keys as acceptable, awkward or wrong. The
questionnaire above has been answered at the rule level, but the resulting
*sound* has not been listened to. Two specific risks remain open:

- The chord register reaches down to E2. A block chord low in that range may
  fight the bass or be inaudible on small laptop speakers.
- The bass register E1–E♭2 is the bass guitar's lowest octave, which is also
  where laptop speakers roll off.

## 8. Change procedure

To change a rule after the listening review:

1. Edit the table in `src/core/theory/voicing.ts` (`VOICING_RULES`) or the
   register values in `DEFAULT_VOICING_RULES`.
2. Update the worked examples in §6 of this document.
3. Update the voicing tests in `src/core/theory/voicing.test.ts` to the new
   expected degrees and ranges.
4. Record the decision in `docs/progress.md` §4 and note the review in
   `docs/gap-analysis.md` (G-10).

The register values in `DEFAULT_VOICING_RULES` include two placement
anchors, `chordCentre` and `bassCentre`. They are data rather than literals
in the algorithm, so a caller can override them along with the bounds.
