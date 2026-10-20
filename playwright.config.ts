import { defineConfig, devices } from '@playwright/test';

/**
 * Serve the export the way Pages does. When BASE_PATH is set (CI), the build's
 * asset URLs carry that prefix, so stage out/ under it rather than at the root.
 * Serving at the root would 404 every script and hide any path that skips the
 * prefix. Specs navigate relative to baseURL ('./'), so they work either way.
 */
const basePath = process.env.BASE_PATH ?? '';
const baseURL = `http://127.0.0.1:3000${basePath}/`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL, trace: 'on-first-retry' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: basePath
      ? `rm -rf .e2e-site && mkdir -p .e2e-site${basePath} && cp -R out/. .e2e-site${basePath}/ && npx --yes serve .e2e-site -l 3000`
      : 'npx --yes serve out -l 3000',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
