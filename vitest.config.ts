import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts', 'tests/lint/**/*.test.ts'],
      exclude: [...configDefaults.exclude, 'spikes/**', 'prototype/**', 'tests/e2e/**'],
    },
  }),
);
