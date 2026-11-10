import {
  IPC_CHANNELS,
  type AppInfo,
  type BuiltInPreset,
  type BundledSoundFont,
  type PracticePlayerApi,
} from '@core/contracts/api';

export type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

/**
 * Builds the typed API that is exposed to the renderer.
 *
 * `invoke` is injected so that the surface can be unit tested without an
 * Electron runtime. Only the channels listed in `IPC_CHANNELS` are reachable.
 */
export function createPracticePlayerApi(invoke: Invoke): PracticePlayerApi {
  return {
    getAppInfo: () => invoke(IPC_CHANNELS.getAppInfo) as Promise<AppInfo>,
    getBundledSoundFonts: () =>
      invoke(IPC_CHANNELS.getBundledSoundFonts) as Promise<readonly BundledSoundFont[]>,
    getBuiltInPresets: () =>
      invoke(IPC_CHANNELS.getBuiltInPresets) as Promise<readonly BuiltInPreset[]>,
    setPowerSaveBlocker: (active: boolean) =>
      invoke(IPC_CHANNELS.setPowerSaveBlocker, active) as Promise<void>,
  };
}
