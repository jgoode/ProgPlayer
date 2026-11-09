/**
 * The built-in presets must match Appendix A exactly (P3.4, FR-LIB-1).
 *
 * The structural test in `built-in-presets.test.ts` checks the shape of the
 * library: how many presets there are, that they are in order, that each one
 * has the required fields. This test checks the *content* — that each
 * generated preset carries the chords, the name and the home scale types
 * that Appendix A specifies.
 *
 * Appendix A's table is the source of truth, and `appendix-a-presets.json`
 * is that table in machine-readable form.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { validatePresetDocument, validatePresetIndex } from '@core/arrangement/schema';

const presetDirectory = join(process.cwd(), 'resources', 'presets');
const fixturePath = join(process.cwd(), 'tests', 'fixtures', 'theory', 'appendix-a-presets.json');

interface AppendixChord {
  readonly degree: number;
  readonly quality: string;
  readonly alteration?: number;
}

interface AppendixPreset {
  readonly name: string;
  readonly home: readonly string[];
  readonly chords: readonly AppendixChord[];
}

type AppendixFixture = Record<string, AppendixPreset>;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('built-in preset content matches Appendix A', () => {
  const fixture = readJson(fixturePath) as AppendixFixture;
  const index = validatePresetIndex(readJson(join(presetDirectory, 'index.json')));

  it('has a fixture entry for every shipped preset', () => {
    // The fixture keys are upper-case ("R1"); the preset ids are lower-case.
    for (const entry of index.presets) {
      expect(Object.keys(fixture)).toContain(entry.id.toUpperCase());
    }
  });

  it('ships every preset the fixture describes', () => {
    expect(index.presets).toHaveLength(Object.keys(fixture).length);
  });

  it('gives each preset the name, home scale types and chords of Appendix A', () => {
    for (const entry of index.presets) {
      const expected = fixture[entry.id.toUpperCase()];
      if (expected === undefined) {
        throw new Error(`no Appendix A entry for preset ${entry.id}`);
      }
      const actual = validatePresetDocument(readJson(join(presetDirectory, entry.file)));

      expect(actual.name).toBe(expected.name);
      expect([...actual.homeScaleTypes].sort()).toEqual([...expected.home].sort());

      expect(actual.chords.map((chord) => chord.degree)).toEqual(
        expected.chords.map((chord) => chord.degree),
      );
      expect(actual.chords.map((chord) => chord.quality)).toEqual(
        expected.chords.map((chord) => chord.quality),
      );
      expect(actual.chords.map((chord) => chord.alteration ?? 0)).toEqual(
        expected.chords.map((chord) => chord.alteration ?? 0),
      );
    }
  });

  it('gives each chord a duration that fills a whole number of 4/4 bars', () => {
    for (const entry of index.presets) {
      const preset = validatePresetDocument(readJson(join(presetDirectory, entry.file)));
      const totalBeats = preset.chords.reduce((sum, chord) => sum + chord.durationBeats, 0);
      expect(totalBeats % 4).toBe(0);
      expect(totalBeats).toBeGreaterThan(0);
    }
  });
});
