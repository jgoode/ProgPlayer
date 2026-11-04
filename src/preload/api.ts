import { IPC_CHANNELS, type AppInfo, type PracticePlayerApi } from '@core/contracts/api';

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
  };
}
