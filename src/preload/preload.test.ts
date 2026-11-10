import { describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '@core/contracts/api';

import { createPracticePlayerApi } from './api';

describe('preload layer', () => {
  it('exposes exactly the documented calls', async () => {
    const invoke = vi.fn().mockResolvedValue({ name: 'PracticePlayer', version: '0.1.0' });

    const api = createPracticePlayerApi(invoke);

    expect(Object.keys(api)).toEqual([
      'getAppInfo',
      'getBundledSoundFonts',
      'getBuiltInPresets',
      'setPowerSaveBlocker',
    ]);
    await expect(api.getAppInfo()).resolves.toEqual({ name: 'PracticePlayer', version: '0.1.0' });
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.getAppInfo);
  });

  it('routes the bundled-asset calls to their own channels', async () => {
    const invoke = vi.fn().mockResolvedValue([]);

    const api = createPracticePlayerApi(invoke);

    await api.getBundledSoundFonts();
    await api.getBuiltInPresets();
    await api.setPowerSaveBlocker(true);

    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.getBundledSoundFonts);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.getBuiltInPresets);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.setPowerSaveBlocker, true);
  });

  it('does not expose a generic IPC escape hatch', () => {
    const api = createPracticePlayerApi(vi.fn());

    expect('invoke' in api).toBe(false);
    expect('send' in api).toBe(false);
  });
});
