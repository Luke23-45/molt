import { defineConfig } from 'vitest/config';

// Package-local entry point (used when running inside packages/runtime-core).
// The root vitest.workspace.ts defines the unit/property/stress projects for
// workspace-wide runs and owns the coverage thresholds (plan 04 §1).
export default defineConfig({
  test: {
    name: 'unit',
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.ts'],
    exclude: ['test/property/**', 'test/stress/**'],
  },
});
