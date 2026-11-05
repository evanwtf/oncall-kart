import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
/** Software WebGL for Chromium: the CI container has no GPU. */
const SOFTWARE_GL = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // One browser at a time: software WebGL in CI is CPU-bound.
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Trace recording slows software WebGL enough to break the timing checks.
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      testMatch: ['smoke.spec.ts', 'shooter.spec.ts'],
      use: { ...devices['Desktop Chrome'], launchOptions: { args: SOFTWARE_GL } },
    },
    {
      name: 'webkit',
      testMatch: ['smoke.spec.ts', 'shooter.spec.ts'],
      use: { ...devices['Desktop Safari'] },
    },
    // Phones in landscape, with touch. The iPhone is 667 x 375, the smallest
    // screen the layout must fit.
    {
      name: 'mobile-webkit',
      testMatch: 'touch.spec.ts',
      use: { ...devices['iPhone SE (3rd gen) landscape'], hasTouch: true },
    },
    {
      name: 'mobile-chromium',
      testMatch: 'touch.spec.ts',
      use: {
        ...devices['Pixel 7 landscape'],
        hasTouch: true,
        launchOptions: { args: SOFTWARE_GL },
      },
    },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/oncall-kart/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
