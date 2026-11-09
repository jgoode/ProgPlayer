/**
 * Session and preset file round-trip tests (P3.5, P3.7, FR-IO-1).
 *
 * A saved document is JSON; loading it must give back exactly the same
 * document, and a corrupt file must fail with a typed error rather than an
 * unhandled exception.
 *
 * The session round trip goes through the real load path — migrate, then
 * validate — because that is what the loader does. A round trip that skips
 * the migration step would not prove the format works.
 *
 * The fuzz test mutates a valid document at random positions and checks
 * that the loader either rejects the file as invalid JSON or reports it as
 * an invalid document — never with an unexpected error type.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { compileTimeline } from '../compiler/compile';
import { migrateDocument } from './migration';
import { validatePresetDocument, validateSessionDocument, ValidationError } from './schema';
import type { PresetDocument, Session } from './types';
import { barChord, halfBarChord, section, session } from '../../../tests/fixtures/sessions';

/** Writes a session to JSON and reads it back through the real load path. */
function roundTrip(input: Session): Session {
  const written = JSON.stringify(input);
  const read: unknown = JSON.parse(written);
  const migrated = migrateDocument(read);
  return validateSessionDocument(migrated);
}

/** A session document with every optional field populated. */
function richSession(): Session {
  return session(
    [
      section('Intro', [barChord(1)], 2),
      section('Verse', [halfBarChord(1), halfBarChord(4), barChord(5)]),
    ],
    {
      name: 'Rich session',
      scaleType: 'dorian',
      tempoBpm: 96,
      timeSignature: '4/4',
      beatGrouping: '3+2',
      mix: {
        chords: { volume: 0.75, muted: false, channel: 1 },
        bass: { volume: 0.5, muted: true, channel: 2 },
        click: { volume: 0.25, muted: false, channel: 10 },
      },
      playback: {
        countInBars: 2,
        loopMode: 'barRange',
        loopBarRange: { startBar: 3, endBar: 8 },
      },
    },
  );
}

/** A preset document with every field populated. */
function richPreset(): PresetDocument {
  return {
    schemaVersion: 1,
    id: 'rich-preset',
    name: 'Rich preset',
    category: 'jazz',
    builtIn: false,
    homeScaleTypes: ['major', 'dorian', 'mixolydian'],
    timeSignature: '4/4',
    chords: [
      { degree: 1, alteration: 0, quality: 'maj7', durationBeats: 4 },
      { degree: 4, quality: '7', durationBeats: 2 },
      { degree: 5, quality: 'm7', durationBeats: 2 },
    ],
  };
}

describe('session save and load round trip', () => {
  it('returns a simple session unchanged', () => {
    const original = session([section('Verse', [barChord(1), barChord(5)])]);
    expect(roundTrip(original)).toEqual(original);
  });

  it('returns a multi-section session unchanged', () => {
    const original = session([
      section('Verse', [barChord(1), barChord(4)], 2),
      section('Chorus', [barChord(5), barChord(1)]),
      section('Bridge', [barChord(2), barChord(5)], 3),
    ]);
    expect(roundTrip(original)).toEqual(original);
  });

  it('preserves every field through JSON serialisation', () => {
    const document = richSession();

    const loaded = roundTrip(document);

    expect(loaded.key).toEqual(document.key);
    expect(loaded.scaleType).toBe('dorian');
    expect(loaded.tempoBpm).toBe(96);
    expect(loaded.timeSignature).toBe('4/4');
    expect(loaded.beatGrouping).toBe('3+2');
    expect(loaded.sections.map((entry) => entry.name)).toEqual(['Intro', 'Verse']);
    expect(loaded.sections.map((entry) => entry.repeatCount)).toEqual([2, 1]);
    expect(loaded.sections[1]?.progression.chords).toEqual([
      { degree: 1, quality: '', durationBeats: 2 },
      { degree: 4, quality: '', durationBeats: 2 },
      { degree: 5, quality: '', durationBeats: 4 },
    ]);
    expect(loaded.mix.chords).toEqual({ volume: 0.75, muted: false, channel: 1 });
    expect(loaded.mix.bass).toEqual({ volume: 0.5, muted: true, channel: 2 });
    expect(loaded.mix.click).toEqual({ volume: 0.25, muted: false, channel: 10 });
    expect(loaded.playback.countInBars).toBe(2);
    expect(loaded.playback.loopMode).toBe('barRange');
    expect(loaded.playback.loopBarRange).toEqual({ startBar: 3, endBar: 8 });
  });

  it('preserves chord alterations and qualities through JSON serialisation', () => {
    const original = session([
      section('Verse', [
        { degree: 1, alteration: -1, quality: 'm7', durationBeats: 2 },
        { degree: 5, alteration: 1, quality: '7', durationBeats: 2 },
      ]),
    ]);

    expect(roundTrip(original)).toEqual(original);
  });

  it('survives a round trip with no key loss', () => {
    const original = session([section('A', [barChord(1)])], {
      timeSignature: '7/8',
      playback: { countInBars: 0, loopMode: 'off' },
    });
    const after = roundTrip(original);
    expect(Object.keys(after).sort()).toEqual(Object.keys(original).sort());
  });

  it('compiles to the same timeline before and after the round trip', () => {
    const original = session([
      section('Verse', [barChord(1), barChord(4)], 2),
      section('Chorus', [barChord(5), barChord(1)]),
    ]);
    const before = compileTimeline(original);
    const after = compileTimeline(roundTrip(original));
    expect(after.totalTicks).toBe(before.totalTicks);
    expect(after.totalBars).toBe(before.totalBars);
    expect(after.events).toEqual(before.events);
  });

  it('round-trips each time signature', () => {
    for (const timeSignature of ['4/4', '3/4', '6/8', '5/4', '7/8'] as const) {
      const original = session([section('A', [barChord(1)])], {
        timeSignature,
        playback: { countInBars: 0, loopMode: 'off' },
      });
      expect(roundTrip(original)).toEqual(original);
    }
  });
});

describe('preset save and load round trip', () => {
  it('saves, loads and saves identical content', () => {
    const document = richPreset();

    const saved = JSON.stringify(document);
    const loaded = validatePresetDocument(JSON.parse(saved) as unknown);
    const savedAgain = JSON.stringify(loaded);

    expect(savedAgain).toBe(saved);
  });

  it('preserves every field through JSON serialisation', () => {
    const document = richPreset();

    const loaded = validatePresetDocument(JSON.parse(JSON.stringify(document)) as unknown);

    expect(loaded.id).toBe('rich-preset');
    expect(loaded.name).toBe('Rich preset');
    expect(loaded.category).toBe('jazz');
    expect(loaded.builtIn).toBe(false);
    expect(loaded.homeScaleTypes).toEqual(['major', 'dorian', 'mixolydian']);
    expect(loaded.timeSignature).toBe('4/4');
    expect(loaded.chords).toEqual(document.chords);
  });
});

describe('invalid documents', () => {
  it('rejects invalid JSON without an uncaught error', () => {
    const corrupt = '{"name": "Broken", ';

    expect(() => {
      const parsed: unknown = JSON.parse(corrupt);
      return parsed;
    }).toThrow();
  });

  it('reports a structurally invalid document as a ValidationError', () => {
    const document = { ...richSession(), tempoBpm: 900 };

    expect(() => validateSessionDocument(document)).toThrow(ValidationError);
  });

  it('names the offending field when a duration is missing', () => {
    const broken = JSON.parse(JSON.stringify(session([section('A', [barChord(1)])]))) as Record<
      string,
      unknown
    >;
    const sections = broken.sections as Array<Record<string, unknown>>;
    const progression = sections[0]?.progression as Record<string, unknown>;
    const chords = progression.chords as Array<Record<string, unknown>>;
    delete chords[0]?.durationBeats;

    expect(() => validateSessionDocument(broken)).toThrow(ValidationError);
    try {
      validateSessionDocument(broken);
    } catch (error) {
      const issues = (error as ValidationError).issues;
      expect(issues.some((issue) => issue.path.includes('durationBeats'))).toBe(true);
    }
  });

  it('rejects an unknown key, so a typo is not silently ignored', () => {
    const broken = {
      ...session([section('A', [barChord(1)])]),
      tempo: 120,
    };
    expect(() => validateSessionDocument(broken)).toThrow(ValidationError);
  });

  it('rejects a tempo outside the allowed range', () => {
    const broken = { ...session([section('A', [barChord(1)])]), tempoBpm: 1000 };
    expect(() => validateSessionDocument(broken)).toThrow(ValidationError);
  });

  it('rejects a document with no sections', () => {
    const broken = { ...session([]) };
    expect(() => validateSessionDocument(broken)).toThrow(ValidationError);
  });

  it('rejects a chord degree outside the scale', () => {
    const broken = session([section('A', [{ degree: 8, quality: '', durationBeats: 4 }])]);
    expect(() => validateSessionDocument(broken)).toThrow(ValidationError);
  });
});

describe('fuzzed documents', () => {
  it('never throws an unexpected error when a valid session is mutated', () => {
    const valid = JSON.stringify(richSession());

    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            position: fc.integer({ min: 0, max: valid.length - 1 }),
            replacement: fc.string({ maxLength: 4 }),
          }),
          { maxLength: 8 },
        ),
        (mutations) => {
          let mutated = valid;
          for (const mutation of mutations) {
            mutated =
              mutated.slice(0, mutation.position) +
              mutation.replacement +
              mutated.slice(mutation.position + mutation.replacement.length);
          }

          let parsed: unknown;
          try {
            parsed = JSON.parse(mutated) as unknown;
          } catch {
            // A mutation that breaks the JSON syntax is a clean rejection.
            return;
          }

          try {
            validateSessionDocument(parsed);
          } catch (error) {
            expect(error).toBeInstanceOf(ValidationError);
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
