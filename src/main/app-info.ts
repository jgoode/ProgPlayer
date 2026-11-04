import { app } from 'electron';

import type { AppInfo } from '@core/contracts/api';

import packageJson from '../../package.json';

/**
 * Application name and version.
 *
 * `app.getVersion()` falls back to Electron's own version when the app is
 * launched from a build directory (as the Playwright smoke test does), so the
 * version is read from the package manifest instead. `app.getName()` is
 * preferred when it matches the product name.
 */
export function getAppInfo(): AppInfo {
  const name = app.getName();
  const productName = packageJson.productName ?? packageJson.name;

  return {
    name: name === 'Electron' ? productName : name,
    version: packageJson.version,
  };
}
