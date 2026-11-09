/**
 * Arrangement validation (FR-ARR-1..6, FR-TMP-3/4, G-06).
 *
 * The schema in `schema.ts` checks the *shape* of a document. This module
 * checks the *music*: that a chord quality exists, that a chord change lands
 * on a legal position in the meter, and that a section fills whole bars so
 * the global bar numbering (G-07) is well defined.
 *
 * Every failure names the offending field, so a corrupt file produces a
 * message a user can act on (NFR-REL-1).
 */

import { parseQuality } from '../theory/chords';
import { SCALE_INTERVALS } from '../theory/scales';
import { chordChangePositions, getMeter, groupingFor } from './meter';
import { ValidationError, type ValidationIssue } from './schema';
import type { ChordSlot, Session, Section } from './types';

/** Scale types the app supports (FR-KEY-2). */
export const SUPPORTED_SCALE_TYPES = Object.keys(SCALE_INTERVALS);

/** Issues found while validating an arrangement. */
export interface ArrangementIssue extends ValidationIssue {
  /** The section the issue belongs to, when it belongs to one. */
  readonly sectionIndex?: number | undefined;
}

/**
 * Checks that a chord slot's degree, alteration and quality are usable.
 *
 * The quality is checked against the theory core's parser, so the file
 * format and the chord vocabulary cannot disagree.
 */
export function validateChordSlot(slot: ChordSlot, path: string): readonly ArrangementIssue[] {
  const issues: ArrangementIssue[] = [];
  if (!Number.isInteger(slot.degree) || slot.degree < 1 || slot.degree > 7) {
    issues.push({
      path: `${path}.degree`,
      message: `degree must be an integer from 1 to 7, got ${String(slot.degree)}`,
    });
  }
  const alteration = slot.alteration ?? 0;
  if (!Number.isInteger(alteration) || alteration < -2 || alteration > 2) {
    issues.push({
      path: `${path}.alteration`,
      message: `alteration must be an integer from -2 to 2, got ${String(alteration)}`,
    });
  }
  if (parseQuality(slot.quality) === null) {
    issues.push({
      path: `${path}.quality`,
      message: `unknown chord quality "${slot.quality}"`,
    });
  }
  if (!Number.isFinite(slot.durationBeats) || slot.durationBeats <= 0) {
    issues.push({
      path: `${path}.durationBeats`,
      message: `durationBeats must be a positive number, got ${String(slot.durationBeats)}`,
    });
  }
  return issues;
}

/**
 * Checks one section against the meter.
 *
 * Two rules are enforced, both required for the timeline to be well defined:
 *
 * - every chord change lands on a legal position for the meter (G-06);
 * - the section fills a whole number of bars, so bar numbering can continue
 *   across sections (G-07).
 */
export function validateSection(
  section: Section,
  sectionIndex: number,
  timeSignature: string,
  beatGrouping?: string,
): readonly ArrangementIssue[] {
  const issues: ArrangementIssue[] = [];
  const meter = getMeter(timeSignature);
  const grouping = groupingFor(meter, beatGrouping);
  const legalPositions = chordChangePositions(meter, grouping);
  const ticksPerBar = meter.ticksPerBar;

  let tickInSection = 0;
  for (let chordIndex = 0; chordIndex < section.progression.chords.length; chordIndex += 1) {
    const slot = section.progression.chords[chordIndex] as ChordSlot;
    const path = `sections[${sectionIndex}].progression.chords[${chordIndex}]`;
    issues.push(...validateChordSlot(slot, path));

    const tickInBar = ((tickInSection % ticksPerBar) + ticksPerBar) % ticksPerBar;
    if (!legalPositions.includes(tickInBar)) {
      issues.push({
        path: `${path}.durationBeats`,
        message:
          `chord change at tick ${tickInBar} of the bar is not a legal split in ${timeSignature}; ` +
          `legal splits are at ticks ${legalPositions.join(', ')}`,
        sectionIndex,
      });
    }
    tickInSection += slot.durationBeats * 480;
  }

  const bars = tickInSection / ticksPerBar;
  if (!Number.isInteger(bars)) {
    issues.push({
      path: `sections[${sectionIndex}].progression.chords`,
      message: `section lasts ${bars} bars of ${timeSignature}; a section must fill a whole number of bars`,
      sectionIndex,
    });
  }
  return issues;
}

/**
 * Validates a whole session.
 *
 * Returns the issues found; the caller decides whether to throw.
 */
export function collectArrangementIssues(session: Session): readonly ArrangementIssue[] {
  const issues: ArrangementIssue[] = [];
  if (!SUPPORTED_SCALE_TYPES.includes(session.scaleType)) {
    issues.push({
      path: 'scaleType',
      message: `unknown scale type "${session.scaleType}"; expected one of ${SUPPORTED_SCALE_TYPES.join(', ')}`,
    });
  }
  if (session.sections.length === 0) {
    issues.push({ path: 'sections', message: 'a session needs at least one section' });
  }
  for (let index = 0; index < session.sections.length; index += 1) {
    const section = session.sections[index] as Section;
    issues.push(...validateSection(section, index, session.timeSignature, session.beatGrouping));
  }
  return issues;
}

/**
 * Validates a session and throws when it is not usable.
 *
 * Throws a `ValidationError` naming every offending field.
 */
export function validateSession(session: Session): Session {
  const issues = collectArrangementIssues(session);
  if (issues.length > 0) {
    throw new ValidationError('Session', issues);
  }
  return session;
}

/**
 * The number of bars a section occupies.
 *
 * The section length is the sum of its chord durations, expressed in bars of
 * the session's meter. A section that does not fill whole bars is invalid
 * (see `validateSection`), so this is an integer for a valid session.
 */
export function sectionBars(section: Section, timeSignature: string): number {
  const meter = getMeter(timeSignature);
  const beats = section.progression.chords.reduce((sum, slot) => sum + slot.durationBeats, 0);
  return beats / meter.beatsPerBar;
}
