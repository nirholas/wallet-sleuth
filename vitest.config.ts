import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'test/**/*.test.ts'],
    // Live tests hit real public endpoints. They are opt-in so the default suite is deterministic
    // and runs offline.
    exclude: ['**/node_modules/**', '**/dist/**', ...(process.env.SLEUTH_LIVE ? [] : ['test/live/**'])],
    environment: 'node',
    testTimeout: process.env.SLEUTH_LIVE ? 300_000 : 15_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/**', 'apps/api/src/**'],
      reporter: ['text', 'html'],
    },
  },
});
