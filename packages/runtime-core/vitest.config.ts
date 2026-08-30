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
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/index.ts'], // re-export barrel: no runtime logic
      thresholds: {
        // Global gates (plan 04 §6): 90 lines / 85 branches, adjusted for
        // the runtime.ts defense-in-depth exception documented there —
        // its guards cover states the invariants make unreachable.
        lines: 90,
        branches: 80,
        'src/runtime.ts': { lines: 87, branches: 69 },
      },
    },
  },
});
