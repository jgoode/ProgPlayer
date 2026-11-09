/**
 * The file-format documentation must match the implementation.
 *
 * `docs/file-formats.md` states the fields, the ranges and the rules of the
 * session and preset formats. A document that drifts from the code is worse
 * than no document, so the claims the document makes are checked here.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { sessionJsonSchema, presetJsonSchema } from '@core/arrangement/schema';
import { SUPPORTED_METERS } from '@core/arrangement/meter';

const documentation = readFileSync(join(process.cwd(), 'docs', 'file-formats.md'), 'utf8');

describe('the file-format documentation matches the implementation', () => {
  it('names every session field the schema requires', () => {
    const schema = sessionJsonSchema();
    const required = schema['required'];
    expect(Array.isArray(required)).toBe(true);
    if (!Array.isArray(required)) {
      throw new Error('the generated schema has no required list');
    }
    for (const field of required as readonly string[]) {
      expect(documentation).toContain(`\`${field}\``);
    }
  });

  it('names every preset field the schema requires', () => {
    const schema = presetJsonSchema();
    const required = schema['required'];
    expect(Array.isArray(required)).toBe(true);
    if (!Array.isArray(required)) {
      throw new Error('the generated schema has no required list');
    }
    for (const field of required as readonly string[]) {
      expect(documentation).toContain(`\`${field}\``);
    }
  });

  it('names every supported time signature', () => {
    for (const meter of SUPPORTED_METERS) {
      expect(documentation).toContain(meter.timeSignature);
    }
  });

  it('states the current schema version', () => {
    expect(documentation).toContain('Current schema version: **1**.');
  });

  it('states the tick resolution', () => {
    expect(documentation).toContain('480 ticks per quarter note');
  });

  it('states the tick count of a 4/4 bar, as the example requires', () => {
    // The example session in the document is a 4/4 session; a reader must
    // be able to check its numbers.
    expect(documentation).toContain('480');
  });

  it('names the modules that hold the format', () => {
    expect(documentation).toContain('src/core/arrangement/schema.ts');
    expect(documentation).toContain('src/core/arrangement/migration.ts');
    expect(documentation).toContain('src/core/compiler/compile.ts');
  });

  it('names the marker kinds the compiler emits', () => {
    for (const marker of ['bar', 'beat', 'chordChange', 'sectionStart']) {
      expect(documentation).toContain(marker);
    }
  });

  it('names the three accent strengths of a click', () => {
    expect(documentation).toContain('`bar`');
    expect(documentation).toContain('`group`');
    expect(documentation).toContain('`beat`');
  });
});
