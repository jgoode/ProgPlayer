import { describe, expect, it } from 'vitest';

import { IPC_CHANNELS, PRACTICE_PLAYER_API_KEY } from '@core/contracts/api';

describe('core layer', () => {
  it('exposes stable IPC channel names', () => {
    expect(IPC_CHANNELS.getAppInfo).toBe('app:get-info');
  });

  it('uses a namespaced preload API key', () => {
    expect(PRACTICE_PLAYER_API_KEY).toBe('practicePlayer');
  });
});
