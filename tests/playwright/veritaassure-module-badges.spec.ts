// tests/playwright/veritaassure-module-badges.spec.ts
//
// Gate 3 step 8 evidence for the module-badge promotion. The VeritaAssure
// overview page (/veritaassure, public, no auth) shows a status badge per
// module. This asserts the six promoted modules render and that no module is
// still labeled "In Progress", while VeritaQC remains "Phase 1 preview".
//
// Env: PW_BASE (defaults to prod). Runs against the public page, no token.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("VeritaAssure overview - module badges", () => {
  test("promoted modules render and no module is still 'In Progress'", async ({ page }) => {
    await page.goto(`${BASE}/veritaassure`, { waitUntil: "domcontentloaded" });

    // The six promoted module cards are present.
    for (const name of ["VeritaComp", "VeritaStaff", "VeritaLab", "VeritaDC", "VeritaTrack", "VeritaResponse"]) {
      await expect(page.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 10000 });
    }

    // No module badge still reads "In Progress" after the promotion.
    await expect(page.getByText("In Progress", { exact: true })).toHaveCount(0);

    // At least several "Live" badges render (the suite is now almost all Live).
    expect(await page.getByText("Live", { exact: true }).count()).toBeGreaterThan(5);

    // VeritaQC is intentionally held at its preview badge (parking-lot #40).
    await expect(page.getByText("Phase 1 preview", { exact: true }).first()).toBeVisible();
  });
});
