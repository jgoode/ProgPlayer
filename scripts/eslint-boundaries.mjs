/**
 * Local ESLint rule enforcing the PracticePlayer import boundaries from
 * `docs/implementation.md` §2.2:
 *
 * - `src/core` imports nothing outside `src/core` (pure TypeScript).
 * - `src/audio` and `src/midi` import `src/core` only (plus their own layer).
 * - `src/renderer` imports `src/core`, `src/audio` and `src/midi` (plus itself).
 * - `src/main` imports `src/core` (plus itself) and Electron/Node built-ins.
 * - `src/preload` imports `src/core` (plus itself) and Electron.
 * - Only `src/preload` may reference `ipcRenderer`.
 *
 * The rule is deliberately self-contained so that the boundary check has no
 * runtime dependency and fails the ordinary `pnpm lint` command.
 *
 * Bare third-party packages are only allowed in `src/renderer`. Adding a
 * runtime dependency to another layer requires extending this rule together
 * with the licence register in `docs/gap-analysis.md` §4.
 */

const LAYERS = ['core', 'audio', 'midi', 'main', 'preload', 'renderer'];

const ALIAS_LAYERS = {
  '@core': 'core',
  '@audio': 'audio',
  '@midi': 'midi',
  '@main': 'main',
  '@preload': 'preload',
  '@renderer': 'renderer',
};

/** Layers each layer may import from (aliases and same-layer relatives). */
const ALLOWED_LAYERS = {
  core: ['core'],
  audio: ['core', 'audio'],
  midi: ['core', 'midi'],
  renderer: ['core', 'audio', 'midi', 'renderer'],
  main: ['core', 'main'],
  preload: ['core', 'preload'],
};

/** Bare modules each layer may import, besides the layer aliases. */
const ALLOWED_EXTERNALS = {
  // `zod` defines the session and preset file formats (P3.5). It is a pure
  // runtime library with no Node, DOM or Electron dependency, so the core
  // layer stays pure TypeScript. The licence is recorded in
  // `docs/gap-analysis.md` §4 (MIT).
  core: ['zod'],
  // `spessasynth_core` is the SoundFont engine chosen by ADR-0002. It is
  // imported only by the AudioWorklet, which runs in its own realm, and
  // its licence (Apache-2.0) is recorded in `docs/gap-analysis.md` §4.
  audio: ['spessasynth_core'],
  midi: [],
  renderer: ['*'],
  main: ['electron', 'node:'],
  preload: ['electron'],
};

function normalizePath(path) {
  const parts = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') {
      continue;
    }
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

function layerOfPath(path) {
  const match = /(?:^|\/)src\/([^/]+)(?:\/|$)/.exec(path);
  return match ? match[1] : null;
}

function layerOfFile(filePath) {
  return layerOfPath(filePath.replace(/\\/g, '/'));
}

function resolveRelative(fromFile, source) {
  const directory = fromFile.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
  return normalizePath(`${directory}/${source}`);
}

function layerOfSpecifier(source, fromFile) {
  if (source.startsWith('@')) {
    const alias = Object.keys(ALIAS_LAYERS).find(
      (prefix) => source === prefix || source.startsWith(`${prefix}/`),
    );
    return alias ? ALIAS_LAYERS[alias] : null;
  }

  if (source.startsWith('.')) {
    return layerOfPath(resolveRelative(fromFile, source));
  }

  return null;
}

const boundaryRules = {
  'import-layers': {
    meta: {
      type: 'problem',
      docs: {
        description:
          'Enforce the PracticePlayer layer boundaries and keep ipcRenderer inside src/preload.',
      },
      schema: [],
      messages: {
        forbiddenLayer:
          "Import from layer '{{target}}' is not allowed in '{{layer}}'. Allowed layers: {{allowed}}.",
        forbiddenExternal:
          "'{{source}}' is not allowed in '{{layer}}'. Allowed external modules: {{allowed}}.",
        ipcRendererOutsidePreload: 'Only files in src/preload may use ipcRenderer ({{file}}).',
      },
    },
    create(context) {
      const filename = (context.filename ?? context.getFilename()).replace(/\\/g, '/');
      const layer = layerOfFile(filename);
      const sourceCode = context.sourceCode ?? context.getSourceCode();

      const isTestFile = /\.(test|spec)\.[cm]?[jt]sx?$/.test(filename);

      /**
       * External modules that test files may always import.
       *
       * These are dev/test-only dependencies, registered in
       * `docs/gap-analysis.md` §4: `fast-check` drives the property-based
       * timeline tests, and `midi-file` is the independent reference parser
       * the SMF round-trip test checks the writer against. Neither is ever
       * imported by application code, so a test file using one does not
       * make the core layer impure.
       */
      const TEST_EXTERNALS = ['vitest', '@testing-library/', 'node:', 'fast-check', 'midi-file'];

      function reportIpcRenderer(node) {
        if (layer !== 'preload' && layer !== null) {
          context.report({
            node,
            messageId: 'ipcRendererOutsidePreload',
            data: { file: filename },
          });
        }
      }

      function checkImport(node, source) {
        if (!layer || !ALLOWED_LAYERS[layer]) {
          return;
        }

        const allowedLayers = ALLOWED_LAYERS[layer];
        const allowedExternals = ALLOWED_EXTERNALS[layer] ?? [];

        if (source === 'electron') {
          const importsIpcRenderer = node.specifiers?.some(
            (specifier) =>
              specifier.type === 'ImportSpecifier' && specifier.imported.name === 'ipcRenderer',
          );
          if (importsIpcRenderer) {
            reportIpcRenderer(node);
          }
        }

        if (source.startsWith('.')) {
          const targetLayer = layerOfSpecifier(source, filename);
          if (targetLayer && !allowedLayers.includes(targetLayer)) {
            context.report({
              node,
              messageId: 'forbiddenLayer',
              data: {
                target: targetLayer,
                layer,
                allowed: allowedLayers.join(', '),
              },
            });
          }
          return;
        }

        const targetLayer = layerOfSpecifier(source, filename);
        if (targetLayer) {
          if (!allowedLayers.includes(targetLayer)) {
            context.report({
              node,
              messageId: 'forbiddenLayer',
              data: {
                target: targetLayer,
                layer,
                allowed: allowedLayers.join(', '),
              },
            });
          }
          return;
        }

        const externalAllowed =
          allowedExternals.includes('*') ||
          allowedExternals.some(
            (prefix) =>
              source === prefix || source.startsWith(prefix.endsWith(':') ? prefix : `${prefix}/`),
          ) ||
          (isTestFile &&
            TEST_EXTERNALS.some(
              (prefix) =>
                source === prefix ||
                source.startsWith(prefix.endsWith(':') ? prefix : `${prefix}/`),
            ));

        if (!externalAllowed) {
          context.report({
            node,
            messageId: 'forbiddenExternal',
            data: {
              source,
              layer,
              allowed: allowedExternals.join(', ') || 'none',
            },
          });
        }
      }

      return {
        ImportDeclaration(node) {
          checkImport(node, node.source.value);
        },
        ExportNamedDeclaration(node) {
          if (node.source) {
            checkImport(node, node.source.value);
          }
        },
        ExportAllDeclaration(node) {
          checkImport(node, node.source.value);
        },
        MemberExpression(node) {
          if (
            node.object.type === 'Identifier' &&
            node.object.name === 'ipcRenderer' &&
            !sourceCode.getText(node.object).includes('.')
          ) {
            reportIpcRenderer(node);
          }
        },
      };
    },
  },
};

export { boundaryRules, LAYERS };
