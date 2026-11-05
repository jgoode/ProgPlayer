#!/usr/bin/env node
/**
 * Summarises the Spike S2 measurement reports.
 *
 * Reads every JSON report in `spikes/s2/results/` and prints a Markdown
 * table with the numbers the S2 decision needs: the dispatch lateness (the
 * path we control), the loopback error and the jitter (the path we do not
 * control), and the clock interval deviation.
 *
 * Usage:
 *   node spikes/s2/tools/summarize-results.mjs [results-directory]
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const resultsRoot = resolve(process.argv[2] ?? 'spikes/s2/results');

function readReports(directory) {
  const reports = [];
  for (const name of readdirSync(directory)) {
    if (!name.endsWith('.json')) {
      continue;
    }
    const path = join(directory, name);
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      continue;
    }
    reports.push({ name, parsed });
  }
  return reports;
}

function number(value, digits = 3) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—';
  }
  return value.toFixed(digits);
}

function rowsFor(entry) {
  const parsed = entry.parsed;
  // The Web MIDI driver wraps the measurement in an envelope; the native
  // harness writes the measurement directly.
  const measurement = parsed.report ?? parsed;
  const dispatch = measurement.dispatch?.lateness;
  const notes = measurement.notes?.error ?? measurement.capturedNotes?.error;
  const jitter = measurement.notes?.jitter ?? measurement.capturedNotes?.jitter;
  const clock = measurement.clock?.intervalDeviation;
  const platform = parsed.platform ?? measurement.platform ?? 'unknown';
  const kind =
    measurement.sinkMode === 'null' ? 'web-midi (no port)' : parsed.report ? 'web-midi' : 'native';

  return {
    file: entry.name,
    platform,
    kind,
    dispatchCount: measurement.dispatch?.count ?? 0,
    lateCount: measurement.dispatch?.lateCount ?? 0,
    lateFraction: number(measurement.dispatch?.lateFraction, 4),
    dispatchP50: number(dispatch?.p50),
    dispatchP99: number(dispatch?.p99),
    dispatchMax: number(dispatch?.max),
    noteP50: number(notes?.p50),
    noteP99: number(notes?.p99),
    noteMax: number(notes?.max),
    jitterP50: number(jitter?.p50),
    jitterP99: number(jitter?.p99),
    jitterMax: number(jitter?.max),
    clockDeviationP99: number(clock?.p99),
    clockDeviationMax: number(clock?.max),
    capture: measurement.captureAvailable ?? (measurement.capturedNotes?.count ?? 0) > 0,
    hotPlugProbed: measurement.hotPlug?.probed === true,
    hotPlugPortGone: measurement.hotPlug?.portDisappeared === true,
    hotPlugStateChanges: measurement.hotPlug?.stateChangeCountDuringRun ?? null,
    sendErrors: measurement.errors?.length ?? 0,
  };
}

const reports = readReports(resultsRoot);
if (reports.length === 0) {
  console.log(`No JSON reports found in ${resultsRoot}.`);
  process.exit(0);
}

const rows = reports.map(rowsFor);

console.log(
  '| Report | Platform | Path | Sends | Late sends | Dispatch p50 (ms) | Dispatch p99 (ms) | Dispatch max (ms) | Note error p50 (ms) | Note error p99 (ms) | Note error max (ms) | Jitter p50 (ms) | Jitter p99 (ms) | Jitter max (ms) | Clock dev p99 (ms) | Clock dev max (ms) | Loopback capture | Hot-plug probed | Port gone | State changes | Send errors |',
);
console.log(
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
);
for (const row of rows) {
  console.log(
    `| ${row.file} | ${row.platform} | ${row.kind} | ${row.dispatchCount} | ${row.lateCount} (${row.lateFraction}) | ${row.dispatchP50} | ${row.dispatchP99} | ${row.dispatchMax} | ${row.noteP50} | ${row.noteP99} | ${row.noteMax} | ${row.jitterP50} | ${row.jitterP99} | ${row.jitterMax} | ${row.clockDeviationP99} | ${row.clockDeviationMax} | ${row.capture ? 'yes' : 'no'} | ${row.hotPlugProbed ? 'yes' : 'no'} | ${row.hotPlugProbed ? (row.hotPlugPortGone ? 'yes' : 'no') : '—'} | ${row.hotPlugStateChanges ?? '—'} | ${row.sendErrors} |`,
  );
}
