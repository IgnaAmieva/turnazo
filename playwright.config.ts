import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3001",
    headless: true,
    // Fail on uncaught console errors
    // (checked manually per test with page.on('pageerror'))
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Do NOT auto-start webServer — dev server must already be running
  // (pnpm dev), or we start it here:
  webServer: {
    command: "pnpm dev --port 3001",
    url: "http://localhost:3001",
    reuseExistingServer: true,
    timeout: 90_000,
    env: {
      NODE_ENV: "development",
    },
  },
});
