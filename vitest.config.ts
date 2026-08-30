// Test projects: docs/implement_plan/04-test-plan.md §1.
// Vitest 4 defines projects in the root config under test.projects (the
// vitest 3 vitest.workspace.ts file was removed upstream). Package-level
// vitest.config.ts files remain the entry point for running a single
// package locally; example and demo projects are appended by their ledger
// items (P2, P3).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          root: 'packages/runtime-core',
          environment: 'node',
          globals: true,
          include: ['test/**/*.test.ts'],
          exclude: ['test/property/**', 'test/stress/**'],
          coverage: {
            provider: 'v8',
            include: ['src/**'],
            // Gate G3 thresholds (plan 04 §6): core 90% lines / 85% branches.
            // Per-file 100% for scope.ts and internal/async.ts is enforced
            // from P1, when those files exist (glob-keyed thresholds land
            // with them).
            thresholds: { lines: 90, branches: 85 },
          },
        },
      },
      {
        test: {
          name: 'property',
          root: 'packages/runtime-core',
          environment: 'node',
          globals: true,
          include: ['test/property/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'stress',
          root: 'packages/runtime-core',
          environment: 'node',
          globals: true,
          include: ['test/stress/**/*.test.ts'],
        },
      },
    ],
  },
});
