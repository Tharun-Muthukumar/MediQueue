import { defineConfig } from 'vitest/config';
import { siblingDatabaseUrl } from './src/shared/dbUrl';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/globalSetup.ts'],
    // All integration tests share one MySQL test database, so run test files one at a time.
    fileParallelism: false,
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: siblingDatabaseUrl('test'),
      SESSION_SECRET: 'test-secret-test-secret-test-secret-0123',
      ENABLE_JOBS: 'false',
    },
  },
});
