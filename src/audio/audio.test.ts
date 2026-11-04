import { describe, expect, it } from 'vitest';

import * as audio from './index';

describe('audio layer', () => {
  it('is present and intentionally free of audio code in Phase 0', () => {
    expect(audio).toBeDefined();
  });
});
