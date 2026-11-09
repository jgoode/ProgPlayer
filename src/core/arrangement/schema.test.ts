/**
 * Session and preset document format tests (P3.7, FR-IO-1).
 *
 * The schema is the on-disk contract: it decides which files are accepted,
 * which fields are rejected and what the published JSON Schema says. These
 * tests pin that contract, including the error paths a user sees when a file
 * is corrupt, and the migration rules for `schemaVersion`.
 */

import { describe, expect, it } from 'vitest';

import type { ChordSlot, Session } from './types';
import {
  CURRENT_SCHEMA_VERSION,
  MigrationError,
  MIGRATIONS,
  migrateDocument,
  readSchemaVersion,
  runMigrationChain,
} from './migration';
import {
  ValidationError,
  presetJsonSchema,
  sessionJsonSchema,
  validatePresetDocument,
  validateSessionDocument,
} from './schema';
import { validateSession } from './validation';
import { barChord, section, session } from '../../../tests/fixtures/sessions';

/** A session document built from the shared fixtures. */
function validSessionDocument(): Session {
  return session([section('Verse', [barChord(1), barChord(4)])]);
}

/** The paths of the issues of a rejected document. */
function issuePaths(error: unknown): readonly string[] {
  if (!(error instanceof ValidationError)) {
    throw new Error(`expected a ValidationError, got ${String(error)}`);
  }
  return error.issues.map((issue) => issue.path);
}

describe('session document schema', () => {
  it('accepts a valid session document and returns the parsed document', () => {
    const document = validSessionDocument();

    const parsed = validateSessionDocument(document);

    expect(parsed).toEqual(document);
    expect(parsed.name).toBe('Test session');
    expect(parsed.sections).toHaveLength(1);
  });

  it('rejects a document without sections and names the field', () => {
    const document = { ...validSessionDocument() } as Record<string, unknown>;
    delete document['sections'];

    expect(() => validateSessionDocument(document)).toThrow(ValidationError);
    try {
      validateSessionDocument(document);
    } catch (error) {
      expect(issuePaths(error)).toContain('sections');
    }
  });

  it('rejects a tempo outside the supported range and names the field', () => {
    const document = { ...validSessionDocument(), tempoBpm: 500 };

    expect(() => validateSessionDocument(document)).toThrow(ValidationError);
    try {
      validateSessionDocument(document);
    } catch (error) {
      expect(issuePaths(error)).toContain('tempoBpm');
    }
  });

  it('rejects a chord degree outside the scale and names the chord slot', () => {
    const document = validSessionDocument();
    const badChord: ChordSlot = { degree: 9, quality: '', durationBeats: 4 };
    const invalid = {
      ...document,
      sections: [section('Verse', [badChord])],
    };

    expect(() => validateSessionDocument(invalid)).toThrow(ValidationError);
    try {
      validateSessionDocument(invalid);
    } catch (error) {
      const paths = issuePaths(error);
      expect(paths.some((path) => path.includes('chords[0].degree'))).toBe(true);
    }
  });

  it('rejects an unknown chord quality and names the field', () => {
    const document = validSessionDocument();
    // The quality is deliberately not a `ChordQuality`: the point of the
    // test is that the schema rejects a file the types would not allow.
    const badChord = { degree: 1, quality: 'not-a-quality', durationBeats: 4 };
    const invalid = {
      ...document,
      sections: [
        {
          name: 'Verse',
          repeatCount: 1,
          progression: {
            id: 'test-progression',
            name: 'Test progression',
            category: 'jazz',
            builtIn: false,
            chords: [badChord],
          },
        },
      ],
    };

    expect(() => validateSessionDocument(invalid)).toThrow(ValidationError);
    try {
      validateSessionDocument(invalid);
    } catch (error) {
      const paths = issuePaths(error);
      expect(paths.some((path) => path.includes('quality'))).toBe(true);
    }
  });

  it('rejects an unknown key in the document', () => {
    const document = { ...validSessionDocument(), unexpected: 'value' };

    expect(() => validateSessionDocument(document)).toThrow(ValidationError);
  });

  it('rejects a document that is not an object at all', () => {
    expect(() => validateSessionDocument('not a document')).toThrow(ValidationError);
    expect(() => validateSessionDocument(null)).toThrow(ValidationError);
  });

  it('reports every offending field in the error issues', () => {
    const document = { ...validSessionDocument(), tempoBpm: 500, name: '' };

    try {
      validateSessionDocument(document);
      throw new Error('the document should have been rejected');
    } catch (error) {
      const paths = issuePaths(error);
      expect(paths).toContain('tempoBpm');
      expect(paths).toContain('name');
    }
  });
});

describe('preset document schema', () => {
  it('accepts a valid preset document', () => {
    const document = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: 'test-preset',
      name: 'Test preset',
      category: 'jazz',
      builtIn: false,
      homeScaleTypes: ['major', 'dorian'],
      timeSignature: '4/4',
      chords: [barChord(1), barChord(4)],
    };

    const parsed = validatePresetDocument(document);

    expect(parsed).toEqual(document);
    expect(parsed.chords).toHaveLength(2);
  });

  it('rejects a preset document with an unknown key', () => {
    const document = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: 'test-preset',
      name: 'Test preset',
      category: 'jazz',
      builtIn: false,
      homeScaleTypes: ['major'],
      timeSignature: '4/4',
      chords: [barChord(1)],
      surprise: true,
    };

    expect(() => validatePresetDocument(document)).toThrow(ValidationError);
  });
});

describe('published JSON Schema', () => {
  it('describes the session document as an object with a schema version', () => {
    const schema = sessionJsonSchema();

    expect(schema['type']).toBe('object');
    const properties = schema['properties'];
    expect(properties).toBeTypeOf('object');
    expect(properties).not.toBeNull();
    expect(Object.keys(properties ?? {})).toContain('schemaVersion');
  });

  it('describes the preset document as an object with a schema version', () => {
    const schema = presetJsonSchema();

    expect(schema['type']).toBe('object');
    const properties = schema['properties'];
    expect(properties).toBeTypeOf('object');
    expect(properties).not.toBeNull();
    expect(Object.keys(properties ?? {})).toContain('schemaVersion');
  });
});

describe('schema migration', () => {
  it('returns a document at the current version unchanged', () => {
    const document = validSessionDocument();

    const migrated = migrateDocument(document);

    expect(migrated).toBe(document);
    expect(migrated).toEqual(document);
  });

  it('rejects a document from a future version and names the version', () => {
    const document = { ...validSessionDocument(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 };

    expect(() => migrateDocument(document)).toThrow(MigrationError);
    try {
      migrateDocument(document);
      throw new Error('the document should have been rejected');
    } catch (error) {
      if (!(error instanceof MigrationError)) {
        throw error;
      }
      expect(error.fromVersion).toBe(CURRENT_SCHEMA_VERSION + 1);
      expect(error.message).toContain(String(CURRENT_SCHEMA_VERSION + 1));
    }
  });

  it('rejects a document without a schema version', () => {
    const document = { ...validSessionDocument() } as Record<string, unknown>;
    delete document['schemaVersion'];

    expect(() => migrateDocument(document)).toThrow(MigrationError);
  });

  it('has an empty migration chain while the current version is the first one', () => {
    expect(MIGRATIONS).toEqual([]);
  });

  it('reads the schema version of a document', () => {
    expect(readSchemaVersion({ schemaVersion: 3 })).toBe(3);
    expect(readSchemaVersion({ schemaVersion: CURRENT_SCHEMA_VERSION })).toBe(
      CURRENT_SCHEMA_VERSION,
    );
  });

  it('reads no version from a document that has none', () => {
    expect(readSchemaVersion('not a document')).toBeNull();
    expect(readSchemaVersion(null)).toBeNull();
    expect(readSchemaVersion(undefined)).toBeNull();
    expect(readSchemaVersion({})).toBeNull();
    expect(readSchemaVersion({ schemaVersion: 'one' })).toBeNull();
    expect(readSchemaVersion({ schemaVersion: 1.5 })).toBeNull();
    expect(readSchemaVersion({ schemaVersion: 0 })).toBeNull();
  });
});

describe('the migration mechanism', () => {
  // The shipped chain is empty until the format changes, so the mechanism
  // itself is exercised with synthetic chains. Without this, a migration
  // step would ship completely untested.

  it('runs a step and hands its result on', () => {
    const chain = [
      {
        fromVersion: 1,
        description: 'Rename the tempo field.',
        migrate: (document: unknown) => {
          const source = document as Record<string, unknown>;
          return { ...source, tempoBpm: source['tempo'] };
        },
      },
    ];
    const migrated = runMigrationChain({ schemaVersion: 1, tempo: 120 }, 1, chain, 2);
    expect(migrated).toMatchObject({ tempoBpm: 120 });
  });

  it('runs several steps in order', () => {
    const chain = [
      {
        fromVersion: 1,
        description: 'First.',
        migrate: (document: unknown) => ({ ...(document as object), first: true }),
      },
      {
        fromVersion: 2,
        description: 'Second.',
        migrate: (document: unknown) => ({ ...(document as object), second: true }),
      },
    ];
    const migrated = runMigrationChain({ schemaVersion: 1 }, 1, chain, 3);
    expect(migrated).toEqual({ schemaVersion: 1, first: true, second: true });
  });

  it('skips a step that has already been applied', () => {
    let applied = 0;
    const chain = [
      {
        fromVersion: 1,
        description: 'Already applied.',
        migrate: (document: unknown) => {
          applied += 1;
          return document;
        },
      },
    ];
    runMigrationChain({ schemaVersion: 1 }, 2, chain, 2);
    expect(applied).toBe(0);
  });

  it('reports a gap in the chain rather than skipping it', () => {
    const chain = [
      {
        fromVersion: 2,
        description: 'Starts too late.',
        migrate: (document: unknown) => document,
      },
    ];
    expect(() => runMigrationChain({ schemaVersion: 1 }, 1, chain, 3)).toThrow(MigrationError);
  });

  it('reports a chain that does not reach the target version', () => {
    const chain = [
      {
        fromVersion: 1,
        description: 'Only one step.',
        migrate: (document: unknown) => document,
      },
    ];
    expect(() => runMigrationChain({ schemaVersion: 1 }, 1, chain, 3)).toThrow(MigrationError);
  });
});

describe('musical validation', () => {
  it('accepts a valid session', () => {
    const document = validSessionDocument();

    expect(validateSession(document)).toBe(document);
  });

  it('rejects a chord change that is not a legal split in the meter', () => {
    const first: ChordSlot = { degree: 1, quality: '', durationBeats: 1.5 };
    const second: ChordSlot = { degree: 4, quality: '', durationBeats: 2.5 };
    const document = session([section('Verse', [first, second])]);

    expect(() => validateSession(document)).toThrow(ValidationError);
    try {
      validateSession(document);
      throw new Error('the session should have been rejected');
    } catch (error) {
      const paths = issuePaths(error);
      expect(paths.some((path) => path.includes('chords[1]'))).toBe(true);
    }
  });
});
