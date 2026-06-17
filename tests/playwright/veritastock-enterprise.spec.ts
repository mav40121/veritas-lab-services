// tests/playwright/veritastock-enterprise.spec.ts
//
// Gate 3 step 8 receipt for the VeritaStock Enterprise (multi-location) view
// (client/src/pages/VeritaStockEnterprisePage.tsx, route
// /labs/:labId/veritastock/enterprise). Authenticated page, so it injects the
// PW_TOKEN user per _auth.ts (token-only injection hits the plan wall) and
// confirms the cross-location roll-up grid and the transfer panel render.
//
// Run: PW_BASE=https://www.veritaslabservices.com PW_TOKEN=... PW_LAB=2 \
//        npx playwright test veritastock-enterprise

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_LAB || "";

test.describe("VeritaStock Enterprise view", () => {
  test("renders the cross-location roll-up and transfer panel", async ({ page }) => {
    test.skip(!TOKEN || !LAB, "PW_TOKEN and PW_LAB required for the authenticated enterprise view");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB}/veritastock/enterprise`);
    await expect(page.getByRole("heading", { name: /Enterprise Inventory/i })).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("rollup-table")).toBeVisible();
    // With 2+ locations the transfer panel renders; with one, the hint does.
    const panel = page.getByTestId("transfer-submit");
    const hint = page.getByText(/need at least two locations/i);
    await expect(panel.or(hint)).toBeVisible();
  });
});
