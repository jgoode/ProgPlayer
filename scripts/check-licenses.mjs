#!/usr/bin/env node
/**
 * Licence audit for the PracticePlayer dependency tree.
 *
 * Every dependency and bundled asset must be compatible with the project's MIT
 * licence (CON-4, `docs/gap-analysis.md` §4). This script walks the installed
 * pnpm dependency tree, collects every declared licence and fails when a
 * package uses a licence that is neither permissive nor registered with the
 * required attribution.
 *
 * Two licence tiers are accepted:
 *
 * 1. Permissive, MIT-compatible licences (MIT, Apache-2.0, BSD, ISC, …).
 * 2. Attribution-required licences (for example CC-BY-4.0) that are recorded
 *    in `scripts/license-attribution.json` together with their attribution
 *    text and whether the package reaches the shipped bundle.
 *
 * Copyleft and source-available licences are rejected.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ALLOWED_LICENSES = new Set([
  'MIT',
  'MIT-0',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'Zlib',
  'CC0-1.0',
  'Unlicense',
  '0BSD',
  'Python-2.0',
  'BlueOak-1.0.0',
  'PostgreSQL',
  // WTFPL-2.0 is a permissive, non-copyleft licence: it grants the right to
  // use, copy, modify and redistribute without conditions and carries no
  // attribution requirement, so it is compatible with MIT distribution
  // (SPDX: OSI approved "No", FSF free "Yes"; FSF counts it as GPL-compatible).
  // It reaches the tree only as a build-time transitive dependency of
  // electron-builder (`sanitize-filename` -> `truncate-utf8-bytes`) and is
  // never part of the shipped application bundle. See docs/gap-analysis.md §4.
  'WTFPL',
]);

const attributionRegister = JSON.parse(
  readFileSync(join(projectRoot, 'scripts', 'license-attribution.json'), 'utf8'),
);

function normalizeLicense(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const cleaned = value.replace(/^\(|\)$/g, '').trim();
  if (cleaned.includes(' OR ')) {
    return cleaned
      .split(' OR ')
      .map((part) => part.replace(/\(.*?\)/g, '').trim())
      .filter((part) => ALLOWED_LICENSES.has(part))
      .join(' OR ');
  }
  return cleaned;
}

function licenseOf(packageJsonPath) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  } catch {
    return { license: null, reason: 'unreadable manifest' };
  }

  const license = manifest.license;
  if (typeof license === 'string') {
    return { license: normalizeLicense(license), reason: null };
  }
  if (license && typeof license.type === 'string') {
    return { license: normalizeLicense(license.type), reason: null };
  }
  if (Array.isArray(manifest.licenses) && manifest.licenses.length > 0) {
    const types = manifest.licenses.map((entry) =>
      typeof entry === 'string' ? entry : entry?.type,
    );
    const normalized = types.map(normalizeLicense).filter(Boolean);
    if (normalized.some((entry) => ALLOWED_LICENSES.has(entry))) {
      return { license: normalized.join(' OR '), reason: null };
    }
    return { license: normalized.join(' OR ') || null, reason: 'legacy licences field' };
  }
  return { license: null, reason: 'no licence field' };
}

function readDirectory(path) {
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => entry.name);
}

function collectPackageDirectories(nodeModulesPath, seen = new Set()) {
  if (!nodeModulesPath || seen.has(nodeModulesPath)) {
    return [];
  }
  seen.add(nodeModulesPath);

  let entries;
  try {
    entries = readDirectory(nodeModulesPath);
  } catch {
    return [];
  }

  const directories = [];
  for (const entry of entries) {
    if (entry.startsWith('@')) {
      directories.push(...collectPackageDirectories(join(nodeModulesPath, entry), seen));
      continue;
    }
    const packagePath = join(nodeModulesPath, entry);
    directories.push(packagePath);
    directories.push(...collectPackageDirectories(join(packagePath, 'node_modules'), seen));
  }
  return directories;
}

const packageDirectories = collectPackageDirectories(join(projectRoot, 'node_modules'));

const violations = [];
const unknown = [];
const attributed = [];
let checked = 0;

for (const packageDirectory of packageDirectories) {
  const manifestPath = join(packageDirectory, 'package.json');
  let name;
  try {
    name = JSON.parse(readFileSync(manifestPath, 'utf8')).name ?? packageDirectory;
  } catch {
    continue;
  }
  checked += 1;

  const { license, reason } = licenseOf(manifestPath);
  if (!license) {
    unknown.push(`${name}: ${reason ?? 'unknown licence'}`);
    continue;
  }

  const options = license.split(' OR ').filter(Boolean);
  if (options.some((option) => ALLOWED_LICENSES.has(option))) {
    continue;
  }

  const registered = attributionRegister[name];
  if (registered && options.includes(registered.license)) {
    attributed.push(`${name}: ${registered.license}`);
    continue;
  }

  violations.push(`${name}: ${license}`);
}

if (unknown.length > 0) {
  console.error('Packages without a recognised licence declaration:');
  for (const entry of unknown) {
    console.error(`  - ${entry}`);
  }
}

if (violations.length > 0) {
  console.error('Dependencies with a licence that is not MIT-compatible:');
  for (const entry of violations) {
    console.error(`  - ${entry}`);
  }
  console.error(`\nLicence audit failed: ${violations.length} incompatible package(s).`);
  process.exit(1);
}

console.log(
  `Licence audit passed: ${checked} package(s) checked, 0 incompatible, ${attributed.length} registered with attribution.`,
);
for (const entry of attributed) {
  console.log(`  - attributed: ${entry}`);
}
if (unknown.length > 0) {
  console.log(`${unknown.length} package(s) had no recognisable licence declaration.`);
}
