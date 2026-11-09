import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
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

/** Module specifiers that must never appear in the core layer. */
const FORBIDDEN_MODULES = ['electron', /^node:/];

/**
 * Browser globals that must never be *used* in the core layer.
 *
 * A property access on one of these (`document.body`, `navigator.userAgent`)
 * is a DOM dependency. Merely naming one — as a parameter name, say — is
 * not, so the check looks at how the identifier is used.
 */
const FORBIDDEN_MEMBER_BASES = ['document', 'window', 'navigator'];

/** Browser globals that must never be referenced at all in the core layer. */
const FORBIDDEN_IDENTIFIERS = ['AudioContext', 'WebMidi'];

/** True when the identifier is a reference rather than a declaration or key. */
function isReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (parent === undefined) {
    return true;
  }
  // A property name is not a reference to a global: `foo.document` and
  // `{ document: 1 }` name a property, not the DOM global.
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isPropertySignature(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    (ts.isFunctionDeclaration(parent) && parent.name === node)
  ) {
    return false;
  }
  return true;
}

/**
 * Finds the forbidden imports and globals in a TypeScript source file.
 *
 * The file is parsed and inspected as an AST rather than scanned as text, so
 * a word like "document" in a doc comment — or used as a parameter name — is
 * not a violation. Only real imports and real references are reported, and a
 * name that a local declaration shadows is not the global.
 */
function findViolations(filePath: string): readonly string[] {
  const source = ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.ESNext,
    true,
  );
  const violations: string[] = [];

  /** Names shadowed by a local declaration, so they are not the global. */
  const shadowed = new Set<string>();

  const collectShadowed = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      shadowed.add(node.name.text);
    }
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      shadowed.add(node.name.text);
    }
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      shadowed.add(node.name.text);
    }
    ts.forEachChild(node, collectShadowed);
  };
  collectShadowed(source);

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      for (const forbidden of FORBIDDEN_MODULES) {
        const matches =
          typeof forbidden === 'string' ? specifier === forbidden : forbidden.test(specifier);
        if (matches) {
          violations.push(`${filePath}: imports "${specifier}"`);
        }
      }
    }

    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      FORBIDDEN_MEMBER_BASES.includes(node.expression.text) &&
      !shadowed.has(node.expression.text)
    ) {
      violations.push(`${filePath}: uses "${node.expression.text}"`);
    }

    if (
      ts.isIdentifier(node) &&
      FORBIDDEN_IDENTIFIERS.includes(node.text) &&
      !shadowed.has(node.text) &&
      isReference(node)
    ) {
      violations.push(`${filePath}: references "${node.text}"`);
    }

    ts.forEachChild(node, visit);
  };
  visit(source);

  return violations;
}

describe('core purity', () => {
  it('contains no Electron, DOM, audio or Node imports', () => {
    const violations = collectTypeScriptFiles(coreDirectory).flatMap(findViolations);
    expect(violations).toEqual([]);
  });
});
