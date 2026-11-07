/**
 * Pure path resolution for the Spike S4 custom asset protocol.
 *
 * The rule is deliberately narrow: the protocol serves exactly one directory
 * (the directory that electron-builder copies the large sample asset into via
 * `extraResources`), and every request must resolve to a file inside it.
 *
 * This module is pure TypeScript with no Electron import, so the traversal
 * rules can be unit tested without an Electron runtime.
 */

import { isAbsolute, join, normalize, resolve, sep } from 'node:path';

export const ASSET_SCHEME = 's4';

/**
 * Extracts the raw path part of a URL, before the URL parser normalises it.
 *
 * The WHATWG URL parser silently removes `..` segments, so a traversal
 * attempt such as `s4://assets/../../etc/passwd` arrives at the handler
 * looking like `s4://assets/etc/passwd`. The parser's normalisation is not
 * a security boundary — it is a convenience — so the raw segments are
 * checked separately and a traversal is rejected outright.
 */
function rawPathSegments(url: string): string[] | null {
  const schemeEnd = url.indexOf('://');
  if (schemeEnd < 0) {
    return null;
  }

  const afterScheme = url.slice(schemeEnd + 3);
  const pathStart = afterScheme.indexOf('/');
  if (pathStart < 0) {
    return [];
  }

  const path = afterScheme.slice(pathStart).split(/[?#]/, 1)[0] ?? '';
  return path.split('/');
}

/**
 * Rejects a segment that escapes its directory, either literally (`..`) or
 * through a percent-escape (`%2e%2e`, `..%2f`, `%2e%2e%2f`).
 */
function isTraversalSegment(segment: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // A malformed percent-escape is a bad request, not a crash.
    return true;
  }

  if (decoded === '..' || decoded === '.') {
    return true;
  }

  // A decoded separator means the segment smuggles in extra path elements.
  return decoded.includes('/') || decoded.includes('\\');
}

/**
 * Maps a `s4://` request URL to an absolute file path, or returns `null`
 * when the request is malformed or escapes the asset root.
 */
export function resolveAssetPath(url: string, assetRoot: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== `${ASSET_SCHEME}:`) {
    return null;
  }

  const segments = rawPathSegments(url);
  if (segments === null || segments.some((segment) => isTraversalSegment(segment))) {
    return null;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(parsed.pathname);
  } catch {
    // A malformed percent-escape is a bad request, not a crash.
    return null;
  }

  const relative = normalize(decoded.replace(/^\/+/, ''));
  if (relative.length === 0 || relative === '.' || relative.startsWith('..') || isAbsolute(relative)) {
    return null;
  }

  const root = resolve(assetRoot);
  const target = resolve(join(root, relative));

  // Belt and braces: the normalised relative path already rejects `..`, but
  // the containment check makes the invariant explicit and survives a future
  // change to the normalisation step.
  if (target !== root && !target.startsWith(root + sep)) {
    return null;
  }

  return target;
}
