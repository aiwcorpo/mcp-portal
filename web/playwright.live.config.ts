import { defineConfig, devices } from '@playwright/test';

// Live scenario against the M2 stack behind the proxy; no MSW, no local web server.
// LIVE_ALICE_PASSWORD comes from `make users` in the dev stack.
export default defineConfig({
  testDir: './e2e-live',
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  timeout: 120_000,
  use: {
    baseURL: process.env['LIVE_BASE_URL'] ?? 'http://localhost:18740',
    locale: 'pl-PL',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 900 },
  },
});
