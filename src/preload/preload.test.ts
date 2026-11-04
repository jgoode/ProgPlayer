import { describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '@core/contracts/api';

import { createPracticePlayerApi } from './api';

describe('preload layer', () => {
  it('exposes only the documented example call', async () => {
    const invoke = vi.fn().mockResolvedValue({ name: 'PracticePlayer', version: '0.1.0' });

    const api = createPracticePlayerApi(invoke);

    expect(Object.keys(api)).toEqual(['getAppInfo']);
    await expect(api.getAppInfo()).resolves.toEqual({ name: 'PracticePlayer', version: '0.1.0' });
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.getAppInfo);
  });

  it('does not expose a generic IPC escape hatch', () => {
    const api = createPracticePlayerApi(vi.fn());

    expect('invoke' in api).toBe(false);
    expect('send' in api).toBe(false);
  });
});
