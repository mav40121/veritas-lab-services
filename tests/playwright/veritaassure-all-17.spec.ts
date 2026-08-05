// tests/playwright/veritaassure-all-17.spec.ts
//
// Gate 3 evidence for the operations fold: /veritaassure now lists all seventeen
// modules (11 compliance + 6 operations) under one suite page, and /operations
// 301-redirects into it. PW_VA-gated so CI stays compile-only; run against prod:
//   PW_VA=1 npx playwright test veritaassure-all-17

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const OPS = ["VeritaBench", "VeritaPace", "VeritaShift", "VeritaQA", "VeritaStock", "VeritaOps"];
const SOME_COMPLIANCE = ["VeritaCheck", "VeritaMap", "VeritaPolicy", "VeritaResponse"];

test.describe("Unified VeritaAssure suite page", () => {
  test.beforeEach(() => {
    if (!process.env.PW_VA) test.skip(true, "Set PW_VA=1 to run against a deployed build.");
  });

  test("/veritaassure lists all 17 modules including operations", async ({ page }) => {
    await page.goto(`${BASE}/veritaassure`, { waitUntil: "networkidle" });
    const main = page.getByRole("main");
    for (const name of [...SOME_COMPLIANCE, ...OPS]) {
      await expect(
        main.getByRole("link", { name: new RegExp(name) }).first(),
        `module card: ${name}`,
      ).toBeVisible();
    }
    // Both stream sub-headers render on the page.
    await expect(page.getByText("Compliance", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Operations", { exact: true }).first()).toBeVisible();
  });

  test("/operations 301-redirects to /veritaassure", async ({ page }) => {
    await page.goto(`${BASE}/operations`, { waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/veritaassure$/);
  });
});
