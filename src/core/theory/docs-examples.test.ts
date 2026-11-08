import { describe, expect, it } from 'vitest';

import { buildChord } from '@core/theory/chords';
import { voiceChord } from '@core/theory/voicing';

const C = { letter: 'C', alteration: 0 } as const;
const G = { letter: 'G', alteration: 0 } as const;

describe('documented voicing examples', () => {
  it('matches the worked examples in docs/voicing-rules.md', () => {
    expect(voiceChord(buildChord(C, 'maj7')).notes).toEqual([60, 64, 67, 71]);
    expect(voiceChord(buildChord(C, 'm7')).notes).toEqual([60, 63, 67, 70]);
    expect(voiceChord(buildChord(G, '7')).notes).toEqual([55, 59, 62, 65]);
    expect(voiceChord(buildChord(C, '9')).notes).toEqual([60, 64, 70, 74]);
    expect(voiceChord(buildChord(C, 'maj11')).notes).toEqual([60, 64, 71, 74]);
    expect(voiceChord(buildChord(C, 'm11')).notes).toEqual([60, 63, 70, 74, 77]);
    expect(voiceChord(buildChord(C, 'maj7♯11')).notes).toEqual([60, 64, 71, 78]);
    expect(voiceChord(buildChord(G, '7♯5')).notes).toEqual([55, 59, 63, 65]);
  });

  it('places the bass root in the bass register', () => {
    expect(voiceChord(buildChord(C, 'maj7')).bass).toBe(48);
    expect(voiceChord(buildChord(G, '7')).bass).toBe(43);
  });
});
