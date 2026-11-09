import { describe, expect, it } from 'vitest';

import { buildChord } from '@core/theory/chords';
import { voiceChord } from '@core/theory/voicing';

const C = { letter: 'C', alteration: 0 } as const;
const G = { letter: 'G', alteration: 0 } as const;

describe('documented voicing examples', () => {
  it('matches the worked examples in docs/voicing-rules.md', () => {
    expect(voiceChord(buildChord(C, 'maj7')).notes).toEqual([48, 52, 55, 59]);
    expect(voiceChord(buildChord(C, 'm7')).notes).toEqual([48, 51, 55, 58]);
    expect(voiceChord(buildChord(G, '7')).notes).toEqual([43, 47, 50, 53]);
    expect(voiceChord(buildChord(C, '9')).notes).toEqual([48, 52, 58, 62]);
    expect(voiceChord(buildChord(C, 'maj11')).notes).toEqual([48, 52, 59, 62]);
    expect(voiceChord(buildChord(C, 'm11')).notes).toEqual([48, 51, 58, 62, 65]);
    expect(voiceChord(buildChord(C, 'maj7♯11')).notes).toEqual([48, 52, 59, 66]);
    expect(voiceChord(buildChord(G, '7♯5')).notes).toEqual([43, 47, 51, 53]);
  });

  it('places the bass root in the bass register', () => {
    expect(voiceChord(buildChord(C, 'maj7')).bass).toBe(36);
    expect(voiceChord(buildChord(G, '7')).bass).toBe(31);
  });
});
