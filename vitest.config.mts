import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const alias = {
  '@core': resolve('src/core'),
  '@audio': resolve('src/audio'),
  '@midi': resolve('src/midi'),
  '@main': resolve('src/main'),
  '@preload': resolve('src/preload'),
  '@renderer': resolve('src/renderer'),
};

const shared = {
  resolve: { alias },
  test: {
    globals: true,
    passWithNoTests: false,
    restoreMocks: true,
  },
};

export default defineConfig({
  test: {
    // Testing.md §10: the core layer is gated at 90% lines and 85% branches.
    // Only core sources are measured, so the gate tracks the theory core.
    coverage: {
      include: ['src/core/**/*.ts'],
      exclude: ['src/core/**/*.test.ts'],
      thresholds: {
        lines: 90,
        branches: 85,
        functions: 90,
        statements: 90,
      },
    },
    projects: [
      {
        ...shared,
        test: {
          ...shared.test,
          name: 'core',
          environment: 'node',
          include: ['src/core/**/*.test.ts'],
        },
      },
      {
        ...shared,
        test: {
          ...shared.test,
          name: 'audio',
          environment: 'node',
          include: ['src/audio/**/*.test.ts'],
        },
      },
      {
        ...shared,
        test: {
          ...shared.test,
          name: 'midi',
          environment: 'node',
          include: ['src/midi/**/*.test.ts'],
        },
      },
      {
        ...shared,
        test: {
          ...shared.test,
          name: 'main',
          environment: 'node',
          include: ['src/main/**/*.test.ts'],
        },
      },
      {
        ...shared,
        test: {
          ...shared.test,
          name: 'preload',
          environment: 'node',
          include: ['src/preload/**/*.test.ts'],
        },
      },
      {
        ...shared,
        plugins: [react()],
        test: {
          ...shared.test,
          name: 'renderer',
          environment: 'jsdom',
          include: ['src/renderer/**/*.test.{ts,tsx}'],
          setupFiles: ['src/renderer/src/test/setup.ts'],
        },
      },
      {
        ...shared,
        test: {
          ...shared.test,
          name: 'cross-layer',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
        },
      },
    ],
  },
});
