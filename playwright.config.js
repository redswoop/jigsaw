import { defineConfig, devices } from '@playwright/test';

// Tests run against the production server on a dedicated port so they don't
// fight `bun run dev` (5173 is frequently occupied by other projects like
// decklistgen). Override with TEST_PORT=NNNN if 5174 collides.
const TEST_PORT = Number(process.env.TEST_PORT) || 5174;
const TEST_DATA_DIR = '/tmp/jigsaw-playwright-data';
const TEST_BUGS_DIR = '/tmp/jigsaw-playwright-bugs';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: `http://localhost:${TEST_PORT}`,
  },
  webServer: {
    command: `PORT=${TEST_PORT} DATA_DIR=${TEST_DATA_DIR} BUGS_DIR=${TEST_BUGS_DIR} bun server.js`,
    port: TEST_PORT,
    reuseExistingServer: true,
    timeout: 15_000,
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-iphone',
      use: {
        ...devices['iPhone 14'],
        // Use Chromium instead of WebKit for CI compatibility
        browserName: 'chromium',
      },
    },
    {
      name: 'mobile-small',
      use: {
        viewport: { width: 375, height: 667 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'landscape-mobile',
      use: {
        viewport: { width: 667, height: 375 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
