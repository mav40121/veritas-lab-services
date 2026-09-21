// tests/playwright/veritaassure-eighteen-modules.spec.ts
//
// Gate 3 evidence for adding VeritaMaintain as the 18th module. The suite page
// /veritaassure now presents eighteen modules (twelve compliance + six
// operations); VeritaMaintain (the rebranded Equipment Maintenance module) is
// the twelfth compliance card. PW_VA-gated so CI stays compile-only; run
// against a deployed build:
//   PW_VA=1 npx playwright test veritaassure-eighteen-modules

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("VeritaAssure suite = eighteen modules", () => {
  test.beforeEach(() => {
    if (!process.env.PW_VA) test.skip(true, "Set PW_VA=1 to run against a deployed build.");
  });

  test("/veritaassure lists VeritaMaintain and states eighteen modules", async ({ page }) => {
    await page.goto(`${BASE}/veritaassure`, { waitUntil: "networkidle" });
    const main = page.getByRole("main");
    // The new module card is present as a link into the module.
    await expect(main.getByRole("link", { name: /VeritaMaintain/ }).first()).toBeVisible();
    // The count copy reads eighteen (case-insensitive), not seventeen.
    const body = (await page.textContent("body")) || "";
    expect(/eighteen modules/i.test(body)).toBeTruthy();
    expect(/seventeen modules/i.test(body)).toBeFalsy();
  });
});
