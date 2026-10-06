// tests/playwright/veritapolicy-custom-entry.spec.ts
//
// Gate 3 step 8 for VeritaPolicy custom policy entries (added 2026-10-06 after
// Lisa needed a CAP-required Chemical Hygiene Plan that was not on the built-in
// master list). A lab can add a custom policy entry line, it renders alongside
// the built-in catalog with a "Custom" badge, and it can be removed.
// Authed in-app flow, so env-gated (PW_TOKEN); CI stays compile-only. Run live:
//   PW_TOKEN=... PW_LAB_ID=5 npx playwright test tests/playwright/veritapolicy-custom-entry.spec.ts
import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "5";

test.describe("VeritaPolicy custom policy entry", () => {
  test("add a custom policy, see it in the list, then remove it", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set — skipping authenticated UI exercise");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritapolicy-app`, { waitUntil: "networkidle" });

    const name = `PW Custom Policy ${Date.now()}`;
    await page.getByTestId("add-custom-policy").click();
    await page.getByTestId("custom-policy-name").fill(name);
    await page.getByTestId("save-custom-policy").click();

    // The new entry renders as a row with a Custom badge.
    const row = page.getByRole("row", { name: new RegExp(name) });
    await expect(row, "custom policy row is present").toBeVisible();
    await expect(row.getByText("Custom", { exact: true }), "Custom badge").toBeVisible();

    // Remove it (confirm dialog auto-accepted) and it disappears.
    page.once("dialog", (d) => d.accept());
    await row.getByRole("button", { name: "Remove custom policy" }).click();
    await expect(page.getByRole("row", { name: new RegExp(name) })).toHaveCount(0);
  });
});
