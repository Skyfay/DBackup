import { defineConfig } from 'vitest/config';

// The tests against the dev lab, `pnpm test:lab`. They need the lab running (`pnpm lab:up`),
// bring their own database and run one after the other, since they share its servers.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['tests/lab/**/*.test.ts'],
    globalSetup: ['./tests/lab/support/global-setup.ts'],
    setupFiles: ['./tests/lab/support/setup.ts'],
    fileParallelism: false,
    testTimeout: 15 * 60_000,
    hookTimeout: 15 * 60_000,
  },
});
