import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node', // Integration tests often just need Node, not JSDOM, unless testing UI against DB? Assuming API/Service level.
    globals: true,
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 60000, // Longer timeout for DB ops
  },
});
