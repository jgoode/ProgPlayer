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
