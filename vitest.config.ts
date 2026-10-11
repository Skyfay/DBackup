import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Resolves the `@/*` alias from tsconfig.json. Native since Vite 8, which
  // replaces the vite-tsconfig-paths plugin.
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/lib/testing/setup.ts'],
    include: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    // The tests against the dev lab run on their own, `pnpm test:lab`.
    exclude: ['tests/lab/**', '**/node_modules/**', '**/dist/**', '**/cypress/**', '**/.{idea,git,cache,output,temp}/**', '**/.next/**', '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*'],
    coverage: {
      provider: 'v8',
      reporter: ['lcov', 'text'],
      include: [
        'src/lib/**/*.ts',
        'src/services/**/*.ts',
      ],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/lib/testing/**',
        'src/lib/adapters/definitions.ts',
        'src/lib/auth/index.ts',
        'src/lib/auth/client.ts',
        'src/lib/prisma.ts',
        'src/lib/adapters/database/common/types.ts',
      ],
    },
  },
});