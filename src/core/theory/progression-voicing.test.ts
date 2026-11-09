import { describe, expect, it } from 'vitest';

import { buildChord } from '@core/theory/chords';
import { voiceProgression } from '@core/theory/voicing';

const C = { letter: 'C', alteration: 0 } as const;
const D = { letter: 'D', alteration: 0 } as const;
const G = { letter: 'G', alteration: 0 } as const;

describe('progression voicing', () => {
  it('keeps common tones between ii-V-I in C', () => {
    const voicings = voiceProgression([
      buildChord(D, 'm7'),
      buildChord(G, '7'),
      buildChord(C, 'maj7'),
    ]);
    expect(voicings.map((voicing) => voicing.notes)).toEqual([
      [50, 53, 57, 60],
      [50, 53, 55, 59],
      [52, 55, 59, 60],
    ]);
  });

  it('prefers root position for the first chord when the root is near the chord centre', () => {
    const voicings = voiceProgression([buildChord(C, 'maj7')]);
    expect(voicings[0]?.notes).toEqual([48, 52, 55, 59]);
  });
});
