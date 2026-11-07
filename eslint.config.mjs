import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

import { boundaryRules } from './scripts/eslint-boundaries.mjs';

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'dist/**',
      'release/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'node_modules/**',
      'docs/**',
      // The spike's build output and the vendored worklet bundle it produces.
      'spikes/**/dist/**',
      'spikes/**/public/vendor/**',
    ],
  },
  js.configs.recommended,
  {
    // Type-aware linting only applies to TypeScript sources.
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { arguments: false, attributes: false } },
      ],
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // The main process is the only layer that may write diagnostics to stdout.
    files: ['src/main/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Plain ESM tooling scripts are not part of a TypeScript project.
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        performance: 'readonly',
        Buffer: 'readonly',
        WebAssembly: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    rules: { ...tseslint.configs.disableTypeChecked.rules },
  },
  {
    // The spike's CommonJS Electron scripts run in the main process.
    files: ['spikes/**/electron/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        __dirname: 'readonly',
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Response: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: { ...tseslint.configs.disableTypeChecked.rules },
  },
  {
    // The Spike S4 packaging harness runs in the Electron main process and
    // reports its measurements on stdout.
    files: ['spikes/s4/app/electron/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
    },
  },
  {
    // The architecture boundary is enforced for every source and test file.
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}', 'scripts/**/*.mjs'],
    plugins: { boundaries: { rules: boundaryRules } },
    rules: {
      'boundaries/import-layers': 'error',
    },
  },
  prettier,
);
