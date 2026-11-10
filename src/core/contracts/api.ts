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

/** The bundled sound fonts the app ships. */
export interface BundledSoundFont {
  /** The part the font plays: the chords, the bass or the click. */
  readonly part: 'chords' | 'bass' | 'click';
  /** The font's file name inside the bundled-assets directory. */
  readonly file: string;
  /** The URL the renderer fetches the font from. */
  readonly url: string;
  /** The font's display name. */
  readonly name: string;
}

/** A built-in practice preset from the library. */
export interface BuiltInPreset {
  /** The preset's identifier. */
  readonly id: string;
  /** The preset's display name. */
  readonly name: string;
  /** The preset's category. */
  readonly category: string;
  /** The URL the renderer fetches the preset document from. */
  readonly url: string;
}

/**
 * The complete surface exposed to the renderer through `contextBridge`.
 * Every method is an explicit, typed operation. There is deliberately no
 * generic `invoke(channel, ...args)` escape hatch.
 */
export interface PracticePlayerApi {
  /** Example call: returns the running app name and version. */
  getAppInfo(): Promise<AppInfo>;
  /** The bundled sound fonts, with the URL each one is served from. */
  getBundledSoundFonts(): Promise<readonly BundledSoundFont[]>;
  /** The built-in practice presets. */
  getBuiltInPresets(): Promise<readonly BuiltInPreset[]>;
  /**
   * Starts or stops the power-save blocker.
   *
   * The blocker keeps the machine awake while the app is playing, so a
   * minimised window does not have its playback disturbed
   * (implementation.md §2.4). It is active **only** during playback.
   */
  setPowerSaveBlocker(active: boolean): Promise<void>;
}

export const IPC_CHANNELS = {
  getAppInfo: 'app:get-info',
  getBundledSoundFonts: 'app:get-sound-fonts',
  getBuiltInPresets: 'app:get-presets',
  setPowerSaveBlocker: 'app:set-power-save-blocker',
} as const;
