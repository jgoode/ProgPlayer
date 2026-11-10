/**
 * The bundled-asset path resolution (P4.6, ADR-0005).
 *
 * The protocol serves exactly one directory, so the traversal rules are
 * the security boundary. They are tested here rather than in an Electron
 * integration test, because the resolution is pure.
 */

import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveAssetPath } from './asset-path';

const ROOT = resolve('/app/resources');

describe('asset path resolution', () => {
  it('resolves a file inside the asset root', () => {
    expect(resolveAssetPath('app-asset://bundle/soundfonts/UprightPianoKW.sf3', ROOT)).toBe(
      join(ROOT, 'soundfonts', 'UprightPianoKW.sf3'),
    );
  });

  it('resolves a file directly under the asset root', () => {
    expect(resolveAssetPath('app-asset://bundle/presets/r1.json', ROOT)).toBe(
      join(ROOT, 'presets', 'r1.json'),
    );
  });

  it('rejects a literal parent-directory segment', () => {
    expect(resolveAssetPath('app-asset://bundle/../../etc/passwd', ROOT)).toBeNull();
    expect(resolveAssetPath('app-asset://bundle/../secrets', ROOT)).toBeNull();
  });

  it('rejects a percent-encoded parent-directory segment', () => {
    expect(resolveAssetPath('app-asset://bundle/%2e%2e/%2e%2e/etc/passwd', ROOT)).toBeNull();
    expect(resolveAssetPath('app-asset://bundle/..%2f..%2fetc/passwd', ROOT)).toBeNull();
    expect(resolveAssetPath('app-asset://bundle/%2E%2E/secrets', ROOT)).toBeNull();
  });

  it('rejects a segment that decodes to a path separator', () => {
    expect(resolveAssetPath('app-asset://bundle/..%5c..%5cetc/passwd', ROOT)).toBeNull();
    expect(resolveAssetPath('app-asset://bundle/%2fetc/passwd', ROOT)).toBeNull();
  });

  it('rejects a malformed percent escape', () => {
    expect(resolveAssetPath('app-asset://bundle/%zz', ROOT)).toBeNull();
  });

  it('rejects a URL that does not carry the scheme', () => {
    expect(resolveAssetPath('https://example.com/font.sf3', ROOT)).toBeNull();
    expect(resolveAssetPath('/etc/passwd', ROOT)).toBeNull();
  });

  it('ignores a query string and a fragment', () => {
    expect(resolveAssetPath('app-asset://bundle/presets/r1.json?cache=1', ROOT)).toBe(
      join(ROOT, 'presets', 'r1.json'),
    );
    expect(resolveAssetPath('app-asset://bundle/presets/r1.json#top', ROOT)).toBe(
      join(ROOT, 'presets', 'r1.json'),
    );
  });

  it('resolves the asset root itself', () => {
    expect(resolveAssetPath('app-asset://bundle/', ROOT)).toBe(ROOT);
    expect(resolveAssetPath('app-asset://bundle', ROOT)).toBe(ROOT);
  });
});
