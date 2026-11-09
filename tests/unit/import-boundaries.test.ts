import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { afterEach, describe, expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
// The probe lives inside `src/core` so that the TypeScript project service can
// parse it; it is removed after every test and excluded from the purity scan.
const probeDirectory = join(projectRoot, 'src', 'core', '__boundary_probe__');

const probeFiles: string[] = [];

afterEach(() => {
  for (const file of probeFiles.splice(0)) {
    rmSync(file, { force: true });
  }
  rmSync(probeDirectory, { recursive: true, force: true });
});

/**
 * Writes a temporary source file that deliberately breaks an architecture
 * rule and lints it. The file is removed afterwards, so the repository never
 * contains a violation.
 */
async function lintViolation(fileName: string, source: string): Promise<string[]> {
  mkdirSync(probeDirectory, { recursive: true });
  const filePath = join(probeDirectory, fileName);
  writeFileSync(filePath, source, 'utf8');
  probeFiles.push(filePath);

  const eslint = new ESLint({ cwd: projectRoot });
  const results = await eslint.lintFiles([filePath]);

  return results.flatMap((result) => result.messages.map((message) => message.message));
}

// Each case runs ESLint with the type-aware project service over the whole
// repository, which takes several seconds on a cold TypeScript program.
const LINT_TIMEOUT_MS = 60_000;

describe('import boundary rules', () => {
  it(
    'rejects a core module that imports from the renderer layer',
    async () => {
      const messages = await lintViolation(
        'core-imports-renderer.ts',
        "import { App } from '@renderer/src/App'\n\nexport const value = App\n",
      );

      expect(
        messages.some((message) =>
          message.startsWith("Import from layer 'renderer' is not allowed in 'core'."),
        ),
      ).toBe(true);
    },
    LINT_TIMEOUT_MS,
  );

  it(
    'rejects a core module that imports Electron',
    async () => {
      const messages = await lintViolation(
        'core-imports-electron.ts',
        "import { app } from 'electron'\n\nexport const name = app.getName()\n",
      );

      // The rule lists the modules a layer may import, and that list changes
      // as the project adopts dependencies, so the assertion checks that
      // Electron is rejected rather than pinning the whole list.
      expect(
        messages.some((message) => message.includes("'electron' is not allowed in 'core'")),
      ).toBe(true);
    },
    LINT_TIMEOUT_MS,
  );

  it(
    'rejects a core module that references ipcRenderer',
    async () => {
      const messages = await lintViolation(
        'core-uses-ipc-renderer.ts',
        "export const invoke = () => ipcRenderer.invoke('app:get-info')\n",
      );

      expect(
        messages.some((message) =>
          message.startsWith('Only files in src/preload may use ipcRenderer'),
        ),
      ).toBe(true);
    },
    LINT_TIMEOUT_MS,
  );

  it(
    'accepts a core module that imports another core module',
    async () => {
      const messages = await lintViolation(
        'core-imports-core.ts',
        "import { IPC_CHANNELS } from '@core/contracts/api'\n\nexport const channel = IPC_CHANNELS.getAppInfo\n",
      );

      expect(messages).toEqual([]);
    },
    LINT_TIMEOUT_MS,
  );

  it(
    'rejects a core module that imports an external module the core layer does not allow',
    async () => {
      // The core layer allow-lists its runtime dependencies (currently
      // `zod`, see docs/gap-analysis.md §4). A dependency that is not on the
      // list must still be rejected, so the allow-list cannot silently grow.
      const messages = await lintViolation(
        'core-imports-unapproved-external.ts',
        "import { readFileSync } from 'node:fs'\n\nexport const read = readFileSync\n",
      );

      expect(
        messages.some((message) => message.includes("'node:fs' is not allowed in 'core'")),
      ).toBe(true);
    },
    LINT_TIMEOUT_MS,
  );

  it(
    'accepts a core module that imports an allow-listed external module',
    async () => {
      const messages = await lintViolation(
        'core-imports-approved-external.ts',
        "import { z } from 'zod'\n\nexport const schema = z.object({})\n",
      );

      expect(messages).toEqual([]);
    },
    LINT_TIMEOUT_MS,
  );
});
