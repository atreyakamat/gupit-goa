import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'shared', include: ['packages/shared/src/**/*.test.ts'] } },
      { test: { name: 'research-worker', include: ['services/research-worker/src/**/*.test.ts'] } },
      // Pure logic only. Screens and native modules are checked on device (see docs/runbook.md).
      { test: { name: 'mobile', include: ['apps/mobile/src/**/*.test.ts'] } },
      {
        test: {
          name: 'db',
          include: ['supabase/tests/**/*.test.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
