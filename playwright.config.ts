import { defineConfig, devices } from "@playwright/test";

// Cross-cutting (2026-06-12): the repo accrued 55+ authored Playwright specs
// (one per Gate 3 step 8 wave) that were never executed in CI. They import
// @playwright/test, target production behind PW_TOKEN/PW_LAB_ID env guards,
// and skip cleanly when those are absent. This config + the playwright-smoke
// CI job give them a home so that, at minimum, every spec COMPILES and its
// skip-guards are exercised on every PR; when PW_TOKEN is provided as a repo
// secret, the authenticated paths run against prod.
//
// tests/playwright is intentionally outside the app tsconfig (client/src,
// shared, server), so these specs are transpiled by Playwright, not the main
// tsc gate. This runner is the only thing that type-validates them.
export default defineConfig({
  testDir: "./tests/playwright",
  testMatch: "**/*.spec.ts",
  // Specs hit the live site; never run a local web server.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.PW_BASE || "https://www.veritaslabservices.com",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
