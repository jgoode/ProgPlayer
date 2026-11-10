/**
 * The bundled assets (P4.6, ADR-0005).
 *
 * The bundled SoundFonts and the preset library ship as `extraResources`,
 * outside the ASAR, and the renderer reaches them through the
 * `app-asset://` protocol. The protocol serves exactly one directory and
 * rejects any path that escapes it.
 *
 * The location of that directory depends on how the app is running:
 *
 * - **Packaged:** electron-builder copies the assets into
 *   `process.resourcesPath`, next to the ASAR.
 * - **Development from the built output:** `app.getAppPath()` is the
 *   `out/main` folder, so the project root is found by walking up.
 * - **Development from the Vite dev server:** `app.getAppPath()` is the
 *   project root already.
 *
 * The resolution is therefore a search, not a fixed path.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { app } from 'electron';

/** The name of the folder the bundled assets live in, inside the resources. */
export const ASSET_FOLDER = 'assets';

/** The name of the resources folder in the project. */
const RESOURCES_FOLDER = 'resources';

/** The directories that hold the bundled assets. */
export interface AssetLayout {
  /** The directory the `app-asset://` protocol serves. */
  readonly root: string;
  /** The directory the SoundFonts are in. */
  readonly soundFonts: string;
  /** The directory the preset library is in. */
  readonly presets: string;
}

/**
 * Walks up from `start` looking for the project's `resources` folder.
 *
 * The search stops at the filesystem root, so it cannot loop.
 */
function findResourcesFolder(start: string): string | null {
  let current = start;
  for (;;) {
    const candidate = join(current, RESOURCES_FOLDER);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/**
 * The directory the bundled assets are read from.
 *
 * In a packaged app the assets are the `resources/assets` folder that
 * electron-builder copies them into; in development they are the
 * project's `resources` folder.
 */
export function bundledAssetRoot(): string {
  if (app.isPackaged) {
    const packaged = join(process.resourcesPath, ASSET_FOLDER);
    if (existsSync(packaged)) {
      return packaged;
    }
    return process.resourcesPath;
  }

  const found = findResourcesFolder(app.getAppPath());
  return found ?? join(app.getAppPath(), RESOURCES_FOLDER);
}

/**
 * The full layout of the bundled assets.
 *
 * The preset library and the SoundFonts are looked up separately, because
 * a packaged build can ship them in different folders.
 */
export function bundledAssetLayout(): AssetLayout {
  const root = bundledAssetRoot();
  const presets = join(root, 'presets');
  if (existsSync(presets)) {
    return { root, soundFonts: join(root, 'soundfonts'), presets };
  }
  return {
    root,
    soundFonts: join(root, 'soundfonts'),
    presets: join(root, RESOURCES_FOLDER, 'presets'),
  };
}
