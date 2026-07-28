import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: { baseURL, trace: 'retain-on-failure', testIdAttribute: 'data-testid' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Set E2E_SKIP_BUILD=1 to reuse an existing production build.
    command: process.env.E2E_SKIP_BUILD
      ? `pnpm start --port ${PORT}`
      : `pnpm build && pnpm start --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      APP_DATA_MODE: 'fixture',
      NODE_ENV: 'production',
      RATE_LIMIT_ENABLED: 'false',
      // Blank local style: the suite must not depend on a public tile service.
      NEXT_PUBLIC_MAP_STYLE_URL: 'offline',
    },
  },
});
