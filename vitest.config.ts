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
            exclude: ['src/index.ts'], // re-export barrel: no runtime logic
            // Gate G3 thresholds (plan 04 §6 as amended at P1): global
            // 90 lines / 80 branches, per-file exception for the runtime.ts
            // defense-in-depth guards. Mirrored in
            // packages/runtime-core/vitest.config.ts for package-local runs.
            thresholds: {
              lines: 90,
              branches: 80,
              'src/runtime.ts': { lines: 87, branches: 69 },
            },
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
