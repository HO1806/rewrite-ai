import { defineConfig } from '@playwright/test';

/**
 * End-to-end config for the browser smoke test.
 *
 * Deliberately separate from the unit suite and excluded from `pnpm verify`: it
 * needs a real Chromium and a production build, which the unit tests do not.
 * It exists because jsdom performs no layout and no paint, so an entire class of
 * defect — a card that renders behind the page, a content script that is not
 * listening yet — passed 366 unit tests while the extension did not work at all.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // Extensions need a persistent context, which cannot be shared safely.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
});
