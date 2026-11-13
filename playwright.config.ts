import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  retries: 0,
  // Single worker: serialises all tests against the dev server so it never
  // gets overloaded and login timeouts become a non-issue.
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3001",
    headless: true,
  },
  projects: [
    // ── 1. Auth setup (runs first, once) ──────────────────────────────────
    {
      name: "setup",
      testMatch: /setup\/auth\.setup\.ts/,
    },
    // ── 2. Main test suite (depends on setup, inherits auth cookie) ────────
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "tests/e2e/setup/.auth.json",
      },
      dependencies: ["setup"],
    },
  ],
  // Do NOT auto-start webServer — dev server must already be running (pnpm dev)
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
