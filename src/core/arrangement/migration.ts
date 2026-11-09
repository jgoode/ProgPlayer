/**
 * Format migration scaffold (P3.5, FR-IO-1).
 *
 * Every persisted document carries a `schemaVersion`. Loading runs the
 * document through the migration chain, which brings an older version up to
 * the current one before the schema validates it. A document from a *newer*
 * version is rejected with a clear message rather than guessed at
 * (testing.md §4.3: "unknown future `schemaVersion` is rejected with a clear
 * message; older versions migrate").
 *
 * The chain is a list of single-version steps. Each step takes the document
 * as it was in version `n` and returns it as version `n + 1`, so adding a
 * version means appending one function — no existing step is touched.
 */

/** The schema version this build writes. */
export const CURRENT_SCHEMA_VERSION = 1;

/** A migration from one schema version to the next. */
export interface MigrationStep {
  /** The version the step upgrades *from*. */
  readonly fromVersion: number;
  /** A short description of what the step changes. */
  readonly description: string;
  /** Upgrades the document by one version. */
  readonly migrate: (document: unknown) => unknown;
}

/**
 * The migration chain, oldest step first.
 *
 * Version 1 is the first released format, so there is no step for it yet.
 * The chain is a scaffold: a future version 2 appends
 * `{ fromVersion: 1, ... }` here.
 */
export const MIGRATIONS: readonly MigrationStep[] = [];

/** Raised when a document cannot be migrated to the current version. */
export class MigrationError extends Error {
  readonly fromVersion: number;

  constructor(fromVersion: number, reason: string) {
    super(`Cannot migrate document from schema version ${fromVersion}: ${reason}`);
    this.name = 'MigrationError';
    this.fromVersion = fromVersion;
  }
}

/**
 * Reads the `schemaVersion` of a document without validating it.
 *
 * Returns `null` when the document is not an object or has no usable
 * version, so the caller can report a precise error.
 */
export function readSchemaVersion(document: unknown): number | null {
  if (typeof document !== 'object' || document === null || !('schemaVersion' in document)) {
    return null;
  }
  const version: unknown = document.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return null;
  }
  return version;
}

/**
 * Migrates a document to the current schema version.
 *
 * - A document already at the current version is returned unchanged.
 * - An older document is upgraded one version at a time.
 * - A newer document is rejected: the app cannot know what a future version
 *   means.
 * - A document with no usable version is rejected.
 */
export function migrateDocument(document: unknown): unknown {
  const version = readSchemaVersion(document);
  if (version === null) {
    throw new MigrationError(0, 'the document has no valid schemaVersion');
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new MigrationError(
      version,
      `the document was written by a newer version of the app ` +
        `(current version is ${CURRENT_SCHEMA_VERSION})`,
    );
  }
  return runMigrationChain(document, version, MIGRATIONS, CURRENT_SCHEMA_VERSION);
}

/**
 * Runs a migration chain over a document.
 *
 * The chain is a parameter so the mechanism can be tested with a synthetic
 * chain: the shipped chain is empty until the format changes, so without
 * this the steps would never run.
 *
 * A step whose `fromVersion` is below the document's current version is
 * skipped, because it has already been applied. A step whose `fromVersion`
 * is above it means the chain has a gap, and is an error rather than a
 * silent skip.
 */
export function runMigrationChain(
  document: unknown,
  fromVersion: number,
  chain: readonly MigrationStep[],
  targetVersion: number,
): unknown {
  let current = document;
  let currentVersion = fromVersion;
  for (const step of chain) {
    if (step.fromVersion < currentVersion) {
      continue;
    }
    if (step.fromVersion !== currentVersion) {
      throw new MigrationError(
        currentVersion,
        `no migration step from version ${currentVersion} to ${step.fromVersion + 1}`,
      );
    }
    current = step.migrate(current);
    currentVersion += 1;
  }
  if (currentVersion !== targetVersion) {
    throw new MigrationError(
      currentVersion,
      `the migration chain ends at version ${currentVersion}, expected ${targetVersion}`,
    );
  }
  return current;
}
