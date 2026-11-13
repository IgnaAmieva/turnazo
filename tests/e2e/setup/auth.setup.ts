/**
 * Global auth setup: logs in once as the test owner and saves the session
 * to tests/e2e/setup/.auth.json.  All test projects depend on this and
 * inherit the storageState so each test starts already authenticated.
 */
import { test as setup } from "@playwright/test";
import { OWNER_EMAIL, OWNER_PASSWORD } from "../helpers";
import path from "path";

export const AUTH_FILE = path.join(__dirname, ".auth.json");

setup("authenticate as owner", async ({ page }) => {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.fill('[name="email"]', OWNER_EMAIL);
  await page.fill('[name="password"]', OWNER_PASSWORD);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  // Persist cookies + localStorage so subsequent tests skip the login form
  await page.context().storageState({ path: AUTH_FILE });
});
