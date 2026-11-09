/**
 * Session and preset document schemas (P3.5, FR-IO-1, FR-LIB-5).
 *
 * The schemas are the single definition of the on-disk format: the loader
 * validates a document against them and reports the offending field, and the
 * JSON Schema for the file format is generated from the same definitions so
 * the two can never drift apart.
 *
 * The schema is deliberately strict about *structure* (types, ranges, required
 * fields, unknown keys) and leaves *musical* rules to the arrangement
 * validator in `validation.ts`: the meter-aware checks need the time
 * signature, and the schema describes the file, not the arrangement.
 */

import { z } from 'zod';

import { CHORD_QUALITIES } from '../theory/chords';
import { SCALE_INTERVALS } from '../theory/scales';
import { TIME_SIGNATURES } from './types';

/** The schema version written by this build of the app. */
export { CURRENT_SCHEMA_VERSION } from './migration';

/** Qualities accepted in a chord slot; the empty string is the plain triad. */
export const CHORD_QUALITY_VALUES = CHORD_QUALITIES;

/** Scale types accepted in a session. */
export const SCALE_TYPE_VALUES = Object.keys(SCALE_INTERVALS) as [
  keyof typeof SCALE_INTERVALS,
  ...(keyof typeof SCALE_INTERVALS)[],
];

/** A pitch class with an explicit spelling. */
export const pitchClassSchema = z.object({
  letter: z.enum(['C', 'D', 'E', 'F', 'G', 'A', 'B']),
  alteration: z.number().int().min(-2).max(2),
});

/** The session key. */
export const sessionKeySchema = z.object({
  tonic: pitchClassSchema,
  spelling: z.enum(['sharps', 'flats']),
});

/** One chord slot: a degree, an optional alteration, a quality and a duration. */
export const chordSlotSchema = z.object({
  degree: z.number().int().min(1).max(7),
  alteration: z.number().int().min(-2).max(2).optional(),
  quality: z.enum(CHORD_QUALITY_VALUES),
  durationBeats: z.number().positive(),
});

/** The progression carried by a section. */
export const progressionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(['rock', 'blues', 'jazz', 'modal']),
  builtIn: z.boolean(),
  chords: z.array(chordSlotSchema).min(1),
});

/** One section of the arrangement. */
export const sectionSchema = z.object({
  name: z.string().min(1),
  repeatCount: z.number().int().min(1).max(1000),
  progression: progressionSchema,
  presetId: z.string().min(1).optional(),
});

/** Per-part mixer and routing settings. */
export const partSettingsSchema = z.object({
  volume: z.number().min(0).max(1),
  muted: z.boolean(),
  channel: z.number().int().min(1).max(16),
});

/** The mixer settings for the three parts. */
export const mixSettingsSchema = z.object({
  chords: partSettingsSchema,
  bass: partSettingsSchema,
  click: partSettingsSchema,
});

/** A bar range in the expanded arrangement (G-07). */
export const barRangeSchema = z.object({
  startBar: z.number().int().min(1),
  endBar: z.number().int().min(1),
});

/** The playback settings. */
export const playbackSettingsSchema = z.object({
  countInBars: z.number().int().min(0).max(4),
  loopMode: z.enum(['off', 'whole', 'section', 'barRange']),
  loopBarRange: barRangeSchema.optional(),
});

/** A session document. */
export const sessionSchema = z
  .object({
    schemaVersion: z.number().int().min(1),
    name: z.string().min(1),
    key: sessionKeySchema,
    scaleType: z.enum(SCALE_TYPE_VALUES),
    tempoBpm: z.number().min(30).max(300),
    timeSignature: z.enum(TIME_SIGNATURES),
    beatGrouping: z.enum(['3+2', '2+3']).optional(),
    sections: z.array(sectionSchema).min(1),
    mix: mixSettingsSchema,
    playback: playbackSettingsSchema,
  })
  .strict();

/** A preset document (FR-LIB-5). */
export const presetDocumentSchema = z
  .object({
    schemaVersion: z.number().int().min(1),
    id: z.string().min(1),
    name: z.string().min(1),
    category: z.enum(['rock', 'blues', 'jazz', 'modal']),
    builtIn: z.boolean(),
    homeScaleTypes: z.array(z.string().min(1)).min(1),
    timeSignature: z.enum(TIME_SIGNATURES),
    chords: z.array(chordSlotSchema).min(1),
  })
  .strict();

/** The preset library manifest. */
export const presetIndexSchema = z
  .object({
    schemaVersion: z.number().int().min(1),
    presets: z
      .array(
        z
          .object({
            id: z.string().min(1),
            file: z.string().min(1),
            name: z.string().min(1),
            category: z.enum(['rock', 'blues', 'jazz', 'modal']),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type SessionDocument = z.infer<typeof sessionSchema>;
export type PresetDocumentShape = z.infer<typeof presetDocumentSchema>;
export type PresetIndex = z.infer<typeof presetIndexSchema>;

/**
 * A validation failure, with the path of the offending field.
 *
 * The path is a dotted list so a message can name the field precisely
 * (testing.md §4.3: "invalid files produce typed errors naming the field").
 */
export interface ValidationIssue {
  /** Path of the offending value, e.g. `sections[0].progression.chords[2].durationBeats`. */
  readonly path: string;
  /** Human-readable description of what is wrong. */
  readonly message: string;
}

/** A document that failed validation. */
export class ValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(subject: string, issues: readonly ValidationIssue[]) {
    const detail = issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
    super(`${subject} is invalid: ${detail}`);
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

/** Converts a zod path to the dotted form used in the issue paths. */
function formatPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) {
    return '(root)';
  }
  return path
    .map((segment) => {
      if (typeof segment === 'number') {
        return `[${segment}]`;
      }
      if (typeof segment === 'symbol') {
        return String(segment);
      }
      return segment.replaceAll('.', '\\.');
    })
    .reduce<string>((accumulator, segment) => {
      if (segment.startsWith('[')) {
        return `${accumulator}${segment}`;
      }
      return accumulator === '' ? segment : `${accumulator}.${segment}`;
    }, '');
}

/** Converts zod issues into the app's validation issues. */
function toValidationIssues(error: z.ZodError): readonly ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: formatPath(issue.path),
    message: issue.message,
  }));
}

/**
 * Validates a session document.
 *
 * Throws a `ValidationError` naming every offending field.
 */
export function validateSessionDocument(input: unknown): SessionDocument {
  const result = sessionSchema.safeParse(input);
  if (!result.success) {
    throw new ValidationError('Session document', toValidationIssues(result.error));
  }
  return result.data;
}

/**
 * Validates a preset document.
 *
 * Throws a `ValidationError` naming every offending field.
 */
export function validatePresetDocument(input: unknown): PresetDocumentShape {
  const result = presetDocumentSchema.safeParse(input);
  if (!result.success) {
    throw new ValidationError('Preset document', toValidationIssues(result.error));
  }
  return result.data;
}

/**
 * Validates the preset library manifest.
 *
 * Throws a `ValidationError` naming every offending field.
 */
export function validatePresetIndex(input: unknown): PresetIndex {
  const result = presetIndexSchema.safeParse(input);
  if (!result.success) {
    throw new ValidationError('Preset index', toValidationIssues(result.error));
  }
  return result.data;
}

/**
 * The JSON Schema of the session format.
 *
 * Generated from the zod schema so the published schema and the validator
 * cannot drift apart.
 */
export function sessionJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(sessionSchema, { target: 'draft-2020-12' });
}

/** The JSON Schema of the preset format. */
export function presetJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(presetDocumentSchema, { target: 'draft-2020-12' });
}
