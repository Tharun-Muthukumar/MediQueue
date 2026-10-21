import { defineConfig, devices } from '@playwright/test';

/**
 * Cross-role browser test. Runs against a throwaway MySQL database (<your database>_e2e) with the
 * built frontend served by the API on port 4100, so it never touches your demo data.
 *   npx playwright install chromium   (first time only)
 *   npm run test:e2e
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/report' }]],
  use: {
    baseURL: 'http://localhost:4100',
    timezoneId: 'Asia/Kolkata',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: 'node e2e/server.mjs',
    url: 'http://localhost:4100/api/v1/health',
    timeout: 240_000,
    reuseExistingServer: false,
    stdout: 'pipe',
  },
});
