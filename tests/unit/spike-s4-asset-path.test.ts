import { join, resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ASSET_SCHEME, resolveAssetPath } from '../../spikes/s4/app/electron/asset-path';

const root = resolve('/tmp/practiceplayer-s4-assets');

describe('S4 custom protocol path resolution', () => {
  it('maps a well-formed asset URL to a path inside the asset root', () => {
    const resolved = resolveAssetPath(`${ASSET_SCHEME}://assets/sample.bin`, root);

    expect(resolved).toBe(join(root, 'sample.bin'));
  });

  it('decodes percent-escaped file names', () => {
    const resolved = resolveAssetPath(`${ASSET_SCHEME}://assets/large%20font.sf3`, root);

    expect(resolved).toBe(join(root, 'large font.sf3'));
  });

  it('rejects a different scheme', () => {
    expect(resolveAssetPath('https://example.com/sample.bin', root)).toBeNull();
  });

  it('rejects traversal out of the asset root', () => {
    expect(resolveAssetPath(`${ASSET_SCHEME}://assets/../../etc/passwd`, root)).toBeNull();
    expect(resolveAssetPath(`${ASSET_SCHEME}://assets/..%2f..%2fetc/passwd`, root)).toBeNull();
    expect(resolveAssetPath(`${ASSET_SCHEME}://assets/%2e%2e/%2e%2e/etc/passwd`, root)).toBeNull();
  });

  it('rejects an empty path and a malformed URL', () => {
    expect(resolveAssetPath(`${ASSET_SCHEME}://assets/`, root)).toBeNull();
    expect(resolveAssetPath('not a url', root)).toBeNull();
  });

  it('never resolves outside the asset root', () => {
    for (const candidate of [
      `${ASSET_SCHEME}://assets/sample.bin`,
      `${ASSET_SCHEME}://assets/nested/sample.bin`,
      `${ASSET_SCHEME}://assets/../sample.bin`,
    ]) {
      const resolved = resolveAssetPath(candidate, root);
      if (resolved === null) {
        continue;
      }
      expect(resolved === root || resolved.startsWith(root + sep)).toBe(true);
    }
  });
});
