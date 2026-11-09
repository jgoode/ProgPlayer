import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { validatePresetDocument, validatePresetIndex } from '@core/arrangement/schema';
import { PRESET_CATEGORIES } from '@core/arrangement/types';

const presetDirectory = join(process.cwd(), 'resources', 'presets');

function readJson(fileName: string): unknown {
  return JSON.parse(readFileSync(join(presetDirectory, fileName), 'utf8'));
}

describe('built-in preset library (P3.4, FR-LIB-1)', () => {
  const index = validatePresetIndex(readJson('index.json'));

  it('ships the 29 presets of Appendix A', () => {
    expect(index.presets).toHaveLength(29);
  });

  it('lists the presets in Appendix A order', () => {
    expect(index.presets.map((entry) => entry.id)).toEqual([
      ...['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8'],
      ...['b1', 'b2', 'b3', 'b4', 'b5', 'b6'],
      ...['j1', 'j2', 'j3', 'j4', 'j5', 'j6', 'j7', 'j8'],
      ...['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'],
    ]);
  });

  it('gives every preset a name, a category and a home scale type', () => {
    for (const entry of index.presets) {
      const preset = validatePresetDocument(readJson(entry.file));
      expect(preset.name).toBe(entry.name);
      expect(preset.category).toBe(entry.category);
      expect(preset.builtIn).toBe(true);
      expect(preset.homeScaleTypes.length).toBeGreaterThan(0);
    }
  });

  it('uses only the four library categories', () => {
    const categories = new Set(index.presets.map((entry) => entry.category));
    for (const category of categories) {
      expect(PRESET_CATEGORIES).toContain(category);
    }
    expect(categories.size).toBe(4);
  });

  it('authorises every preset in 4/4 with whole-bar durations', () => {
    for (const entry of index.presets) {
      const preset = validatePresetDocument(readJson(entry.file));
      expect(preset.timeSignature).toBe('4/4');
      const totalBeats = preset.chords.reduce((sum, chord) => sum + chord.durationBeats, 0);
      expect(totalBeats % 4).toBe(0);
    }
  });

  it('gives every preset at least one chord', () => {
    for (const entry of index.presets) {
      const preset = validatePresetDocument(readJson(entry.file));
      expect(preset.chords.length).toBeGreaterThan(0);
    }
  });

  it('gives every preset a unique id and file name', () => {
    const ids = index.presets.map((entry) => entry.id);
    const files = index.presets.map((entry) => entry.file);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(files).size).toBe(files.length);
  });
});
