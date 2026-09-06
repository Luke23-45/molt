import { defineConfig } from 'vitest/config';

// Stryker runs this config instead of vitest.config.ts (P2-4): the coverage
// thresholds there fail the vitest process on uncovered mutants, which would
// corrupt mutant exit codes. Include/exclude mirrors the unit project and
// must be kept identical to it (plan 02 §5).
export default defineConfig({
  test: {
    name: 'unit',
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.ts'],
    exclude: ['test/property/**', 'test/stress/**'],
  },
});
