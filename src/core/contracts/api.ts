/**
 * Shared, renderer-safe contracts.
 *
 * This module is pure TypeScript: no Electron, DOM, audio or Node imports.
 * It is the only place where the preload/renderer boundary is described, so
 * the renderer never needs to import from `src/preload`.
 */

export const PRACTICE_PLAYER_API_KEY = 'practicePlayer' as const;

export interface AppInfo {
  name: string;
  version: string;
}

/**
 * The complete surface exposed to the renderer through `contextBridge`.
 * Every method is an explicit, typed operation. There is deliberately no
 * generic `invoke(channel, ...args)` escape hatch.
 */
export interface PracticePlayerApi {
  /** Example call: returns the running app name and version. */
  getAppInfo(): Promise<AppInfo>;
}

export const IPC_CHANNELS = {
  getAppInfo: 'app:get-info',
} as const;
