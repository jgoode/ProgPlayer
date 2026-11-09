# PracticePlayer file formats

The persisted formats for PracticePlayer. Every document carries a
`schemaVersion`; a loader migrates an older document to the current version
before validating it, and refuses a document from a newer version.

The definitions live in `src/core/arrangement/schema.ts` (zod schemas) and
`src/core/arrangement/migration.ts` (the migration chain). The JSON Schema
published below is **generated from the same zod definitions** by
`sessionJsonSchema()` and `presetJsonSchema()`, so the published schema and
the validator cannot drift apart.

Current schema version: **1**.

---

## Session file (`.ppsession`, JSON)

A session is one key, one scale type, one tempo, one time signature and an
ordered list of sections (FR-ARR-1).

```json
{
  "schemaVersion": 1,
  "name": "My practice session",
  "key": { "tonic": { "letter": "C", "alteration": 0 }, "spelling": "sharps" },
  "scaleType": "major",
  "tempoBpm": 120,
  "timeSignature": "4/4",
  "beatGrouping": "3+2",
  "sections": [
    {
      "name": "Verse",
      "repeatCount": 2,
      "presetId": "r1",
      "progression": {
        "id": "r1",
        "name": "Classic rock I–IV–V–IV",
        "category": "rock",
        "builtIn": true,
        "chords": [
          { "degree": 1, "quality": "", "durationBeats": 4 },
          { "degree": 4, "quality": "", "durationBeats": 4 }
        ]
      }
    }
  ],
  "mix": {
    "chords": { "volume": 0.8, "muted": false, "channel": 1 },
    "bass": { "volume": 0.8, "muted": false, "channel": 2 },
    "click": { "volume": 0.7, "muted": false, "channel": 10 }
  },
  "playback": {
    "countInBars": 1,
    "loopMode": "off",
    "loopBarRange": { "startBar": 1, "endBar": 8 }
  }
}
```

### Fields

| Field | Type | Meaning |
|---|---|---|
| `schemaVersion` | integer ≥ 1 | The format version of this document. |
| `name` | non-empty string | The session's display name. |
| `key` | object | The session's key: a `key.tonic` and a `key.spelling`. |
| `key.tonic` | `{ letter, alteration }` | The tonic: a letter `C`–`B` and an alteration in −2…2 (OQ-2). |
| `key.spelling` | `"sharps"` \| `"flats"` | The spelling preference used for display. |
| `scaleType` | scale type name | One of the scale types in FR-KEY-2 (`major`, `naturalMinor`, `dorian`, …). |
| `tempoBpm` | number 30–300 | Quarter-note BPM, except in 6/8 where it counts dotted quarters (OQ-5, OQ-4). |
| `timeSignature` | `"4/4"` \| `"3/4"` \| `"6/8"` \| `"5/4"` \| `"7/8"` | FR-TMP-3. |
| `beatGrouping` | `"3+2"` \| `"2+3"`, optional | The 5/4 accent grouping (FR-TMP-4). Ignored in other meters. |
| `sections` | array, at least one | The ordered sections (FR-ARR-2). |
| `sections[].name` | non-empty string | The section's display name. |
| `sections[].repeatCount` | integer 1–1000 | How many times the section is played. The compiler unrolls it (G-07). |
| `sections[].presetId` | string, optional | The library preset the section came from. |
| `sections[].progression` | progression object | The chords the section plays. |
| `sections[].progression.chords[]` | chord slot | One chord, with its duration. |
| `sections[].progression.chords[].degree` | integer 1–7 | A major-scale degree. |
| `sections[].progression.chords[].alteration` | integer −2…2, optional | −1 is flat, +1 is sharp. Omitted for an unaltered degree. |
| `sections[].progression.chords[].quality` | chord quality | An explicit quality from FR-CHD-1 (`""`, `"m"`, `"7"`, `"m7♭5"`, `"7♭9"`, …). Never inferred from the scale type (A5, G-01). |
| `sections[].progression.chords[].durationBeats` | positive number | The duration in **quarter-note beats**. One 4/4 bar is 4 beats, one 6/8 bar is 3 beats, one 7/8 bar is 3.5 beats. |
| `mix` | object | The mixer settings for the three parts: `mix.chords`, `mix.bass` and `mix.click`. |
| `mix.<part>` | `{ volume, muted, channel }` | Per-part mixer and MIDI channel (FR-PLY-7, FR-SND-5). `volume` is 0–1, `channel` is 1–16. |
| `playback` | object | The playback settings: `playback.countInBars`, `playback.loopMode` and an optional `playback.loopBarRange`. |
| `playback.countInBars` | integer 0–4 | Count-in bars before the arrangement starts (FR-PLY-5). |
| `playback.loopMode` | `"off"` \| `"whole"` \| `"section"` \| `"barRange"` | The loop mode (FR-PLY-6). |
| `playback.loopBarRange` | `{ startBar, endBar }`, optional | A loop range in **global expanded-bar numbers** (G-07). Both are 1-based and inclusive. |

### Rules the schema does not check

The schema checks the *shape* of a document. Two *musical* rules are checked
by `validateSession()` (`src/core/arrangement/validation.ts`), because they
depend on the meter:

1. **A chord change must land on a legal split** (G-06). The legal positions
   are: 4/4 and 3/4 every quarter; 6/8 the two dotted quarters; 7/8 the
   2+2+3 group starts; 5/4 every quarter.
2. **A section must fill a whole number of bars**, so the global bar
   numbering is well defined.

Both produce an error naming the offending field.

### Error reporting

An invalid document produces a `ValidationError` whose `issues` list names
each offending field by path, for example:

```
sections[0].progression.chords[2].durationBeats: chord change at tick 720 of the bar
is not a legal split in 7/8; legal splits are at ticks 0, 480, 960
```

---

## Preset document (JSON)

A preset is a progression plus its library metadata (FR-LIB-1, FR-LIB-5).

```json
{
  "schemaVersion": 1,
  "id": "r1",
  "name": "Classic rock I–IV–V–IV",
  "category": "rock",
  "builtIn": true,
  "homeScaleTypes": ["mixolydian", "major"],
  "timeSignature": "4/4",
  "chords": [
    { "degree": 1, "quality": "", "durationBeats": 4 },
    { "degree": 4, "quality": "", "durationBeats": 4 }
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `schemaVersion` | integer ≥ 1 | The format version of this document. |
| `id` | non-empty string | The preset's identifier, unique within the library. |
| `name` | non-empty string | The display name. |
| `category` | `"rock"` \| `"blues"` \| `"jazz"` \| `"modal"` | The library category (FR-LIB-1). |
| `builtIn` | boolean | `true` for the bundled presets. Built-in presets are read-only but can be duplicated (FR-LIB-4). |
| `homeScaleTypes` | array of scale-type names | The scale types the preset is suggested for. This drives preset *suggestions* only; it never rewrites the chords (A5, G-01). |
| `timeSignature` | time signature | The meter the durations were authored in. The 29 bundled presets are authored in 4/4. |
| `chords` | array of chord slots | The chords, as in the session format. `chords[]` is one chord slot. |

### The built-in library

`resources/presets/` holds the 29 presets of Appendix A as one document each,
plus `index.json`, the manifest that lists them in Appendix A order. They are
generated from `tests/fixtures/theory/appendix-a-presets.json` by
`scripts/generate-built-in-presets.mjs`:

```
node scripts/generate-built-in-presets.mjs
```

The generator is deterministic and idempotent, and it fails loudly if the
fixture and the encoded bar structure disagree.

---

## Migrations

`migrateDocument()` (`src/core/arrangement/migration.ts`) upgrades a document
one version at a time. The chain is a list of single-version steps, so a
future version appends one function and touches none of the existing ones:

```ts
export const MIGRATIONS: readonly MigrationStep[] = [
  // {
  //   fromVersion: 1,
  //   description: 'Move the mix settings into a per-part object.',
  //   migrate: (document) => { /* ... */ },
  // },
];
```

A document whose `schemaVersion` is **newer** than the current version is
rejected with a `MigrationError` naming both versions — the app cannot know
what a future format means, and guessing would risk losing data. A document
with no usable `schemaVersion` is rejected the same way.

---

## Timeline

The session is not stored as a timeline: the timeline is **derived** from it,
by `compileTimeline()` in `src/core/compiler/compile.ts`. One timeline drives
the synth, MIDI out, MIDI export and audio export (implementation.md D2), so
all four outputs agree by construction.

The timeline is tick-based at **480 ticks per quarter note** and contains:

- `note` events for the chord and bass parts, each with its part, MIDI
  channel, pitch, velocity, start tick and end tick;
- `click` events with an accent strength of `bar`, `group` or `beat` (G-05);
- `marker` events of kind `bar`, `beat`, `chordChange` or `sectionStart`.

The count-in region sits **before tick 0** and is not part of the arrangement's
bar numbering, so bar 1 is always the first bar of the first section.
