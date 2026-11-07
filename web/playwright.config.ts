import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['PW_PORT'] ?? 18731);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // A container with few cores times out axe and the first paint when every core runs a browser; PW_WORKERS limits them.
  workers: process.env['PW_WORKERS'] ? Number(process.env['PW_WORKERS']) : undefined,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'line' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'en-US',
    trace: 'retain-on-failure',
    serviceWorkers: 'allow',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile-360',
      use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 740 } },
    },
  ],
  webServer: {
    command: `node scripts/serve-csp.mjs dist/e2e`,
    url: `http://localhost:${PORT}/`,
    env: { PORT: String(PORT) },
    // Always a fresh server: a leftover one could serve an older dist/e2e.
    reuseExistingServer: false,
  },
});
