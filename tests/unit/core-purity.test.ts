import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const coreDirectory = fileURLToPath(new URL('../../src/core/', import.meta.url));

function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    // Temporary lint probes are not part of the core source tree.
    if (entry.startsWith('__')) {
      return [];
    }
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      return collectTypeScriptFiles(path);
    }
    return entry.endsWith('.ts') ? [path] : [];
  });
}

describe('core purity', () => {
  it('contains no Electron, DOM, audio or Node imports', () => {
    const forbidden = [
      /from\s+['"]electron['"]/,
      /from\s+['"]node:/,
      /require\(['"]node:/,
      /\bdocument\./,
      /\bwindow\./,
      /\bAudioContext\b/,
      /\bnavigator\./,
      /\bWebMidi\b/,
    ];

    const violations = collectTypeScriptFiles(coreDirectory).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return forbidden
        .filter((pattern) => pattern.test(source))
        .map((pattern) => `${file}: ${pattern.source}`);
    });

    expect(violations).toEqual([]);
  });
});
