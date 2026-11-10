/**
 * Pure path resolution for the bundled-asset protocol (ADR-0005, P4.6).
 *
 * The protocol serves exactly one directory — the directory that holds the
 * bundled SoundFonts and the preset library — and every request must
 * resolve to a file inside it.
 *
 * The URL's shape is `app-asset://<host>/<path>`. The host is a fixed
 * label, not a directory, so only the path part names a file. The resolver
 * rejects a request whose path escapes the asset root, including a
 * percent-encoded traversal.
 *
 * This module is pure TypeScript with no Electron import, so the traversal
 * rules can be unit tested without an Electron runtime.
 */

import { isAbsolute, join, normalize, resolve, sep } from 'node:path';

/** The scheme the bundled assets are served under. */
export const ASSET_SCHEME = 'app-asset';

/**
 * Extracts the raw path segments of a URL, before the URL parser
 * normalises them.
 *
 * The WHATWG URL parser silently removes `..` segments, so a traversal
 * attempt such as `app-asset://bundle/../../etc/passwd` arrives at the
 * handler looking like `app-asset://bundle/etc/passwd`. The parser's
 * normalisation is not a security boundary — it is a convenience — so the
 * raw segments are checked separately and a traversal is rejected outright.
 */
function rawPathSegments(url: string): string[] | null {
  const schemeEnd = url.indexOf('://');
  if (schemeEnd < 0) {
    return null;
  }
  if (url.slice(0, schemeEnd).toLowerCase() !== ASSET_SCHEME) {
    return null;
  }

  const afterScheme = url.slice(schemeEnd + 3);

  // The authority runs up to the first `/`, `?` or `#`.
  const pathStart = afterScheme.search(/[/?#]/);
  if (pathStart < 0) {
    return [];
  }
  if (afterScheme[pathStart] !== '/') {
    // The URL has an authority but no path — e.g. `app-asset://bundle?x`.
    return [];
  }

  const path = afterScheme.slice(pathStart).split(/[?#]/, 1)[0] ?? '';
  return path.split('/');
}

/**
 * Rejects a segment that escapes the asset directory, either literally
 * (`..`) or through a percent-escape (`%2e%2e`, `..%2f`, `%2e%2e%2f`).
 */
function isTraversalSegment(segment: string): boolean {
  let decoded = segment.toLowerCase();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // A malformed escape is not a valid path segment either.
    return true;
  }
  if (decoded.includes('/') || decoded.includes('\\')) {
    return true;
  }
  return decoded === '..' || decoded === '.';
}

/**
 * Maps an `app-asset://` request URL to an absolute file path, or returns
 * `null` when the request is malformed or escapes the asset root.
 */
export function resolveAssetPath(url: string, assetRoot: string): string | null {
  const segments = rawPathSegments(url);
  if (segments === null) {
    return null;
  }

  const decoded: string[] = [];
  for (const segment of segments) {
    if (segment === '') {
      continue;
    }
    if (isTraversalSegment(segment)) {
      return null;
    }
    decoded.push(decodeURIComponent(segment));
  }

  const root = resolve(assetRoot);
  const relative = decoded.join(sep);
  if (isAbsolute(relative)) {
    return null;
  }

  const target = normalize(join(root, relative));

  // The resolved path must still be inside the root.
  if (target !== root && !target.startsWith(root + sep)) {
    return null;
  }
  return target;
}
