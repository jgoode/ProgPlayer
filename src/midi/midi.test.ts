import { describe, expect, it } from 'vitest';

import * as midi from './index';

describe('midi layer', () => {
  it('is present and intentionally free of MIDI code in Phase 0', () => {
    expect(midi).toBeDefined();
  });
});
