/**
 * End-to-end smoke test: every built-in preset to a parseable SMF.
 *
 * This exercises the whole Phase 3 path the way an application uses it:
 * read a built-in preset from `resources/presets/`, build a session around
 * it, compile the timeline, write the SMF, and read the file back with the
 * reference parser.
 *
 * Every preset is checked, so a preset that cannot be played is caught
 * even though the unit tests only exercise a representative sample.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseMidi } from 'midi-file';
import { describe, expect, it } from 'vitest';

import { compileTimeline } from '@core/compiler/compile';
import { validatePresetDocument, validateSessionDocument } from '@core/arrangement/schema';
import { writeSmf } from '@core/formats/smf';

const presetDirectory = join(process.cwd(), 'resources', 'presets');

interface IndexEntry {
  readonly id: string;
  readonly file: string;
  readonly name: string;
}

const index = JSON.parse(readFileSync(join(presetDirectory, 'index.json'), 'utf8')) as {
  readonly presets: readonly IndexEntry[];
};

describe('every built-in preset plays and exports', () => {
  it('has a preset for every library entry', () => {
    expect(index.presets.length).toBe(29);
  });

  it.each(index.presets.map((entry) => [entry.id, entry.file] as const))(
    'compiles and exports %s as a parseable SMF',
    (presetId, fileName) => {
      const preset = validatePresetDocument(
        JSON.parse(readFileSync(join(presetDirectory, fileName), 'utf8')),
      );

      const session = validateSessionDocument({
        schemaVersion: 1,
        name: preset.name,
        key: { tonic: { letter: 'C', alteration: 0 }, spelling: 'sharps' },
        scaleType: 'major',
        tempoBpm: 120,
        timeSignature: preset.timeSignature,
        sections: [
          {
            name: preset.name,
            repeatCount: 1,
            presetId: preset.id,
            progression: {
              id: preset.id,
              name: preset.name,
              category: preset.category,
              builtIn: true,
              chords: preset.chords,
            },
          },
        ],
        mix: {
          chords: { volume: 0.8, muted: false, channel: 1 },
          bass: { volume: 0.8, muted: false, channel: 2 },
          click: { volume: 0.7, muted: false, channel: 10 },
        },
        playback: { countInBars: 1, loopMode: 'off' },
      });

      const timeline = compileTimeline(session);
      expect(timeline.totalBars).toBeGreaterThan(0);

      const bytes = writeSmf(timeline);
      const parsed = parseMidi(bytes);

      expect(parsed.header.format).toBe(1);
      expect(parsed.header.ticksPerBeat).toBe(480);
      expect(parsed.header.numTracks).toBe(parsed.tracks.length);

      // The chords track must carry the arrangement's notes.
      const chordTrack = parsed.tracks.find(
        (track) => track[0]?.type === 'trackName' && track[0]?.text === 'Chords',
      );
      const noteOns = (chordTrack ?? []).filter((event) => event.type === 'noteOn');
      expect(noteOns.length).toBeGreaterThan(0);
      expect(presetId).toBe(preset.id);
    },
  );
});
