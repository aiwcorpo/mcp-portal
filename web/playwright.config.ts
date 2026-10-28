import { defineConfig, devices } from '@playwright/test';

const PORT = 18731;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'line' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'pl-PL',
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
