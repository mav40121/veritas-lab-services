// tests/playwright/veritastock-enterprise.spec.ts
//
// Gate 3 step 8 receipt for the VeritaStock Enterprise (multi-location) view
// (client/src/pages/VeritaStockEnterprisePage.tsx, route
// /labs/:labId/veritastock/enterprise). Authenticated page, so it injects the
// PW_TOKEN user per _auth.ts (token-only injection hits the plan wall) and
// confirms the cross-location roll-up grid + transfer panel render, and that
// the location columns order From (source) leftmost, To (destination) next.
//
// Run: PW_BASE=https://www.veritaslabservices.com PW_TOKEN=... PW_LAB=8 \
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
    // Multi-item transfer setup: the From selector renders with 2+ locations,
    // otherwise the single-location note does.
    const fromSel = page.getByTestId("transfer-from");
    const fewLocs = page.getByText(/need at least two locations/i);
    await expect(fromSel.or(fewLocs)).toBeVisible();
  });

  test("location columns order From (source) leftmost, To (destination) next", async ({ page }) => {
    test.skip(!TOKEN || !LAB, "PW_TOKEN and PW_LAB required for the authenticated enterprise view");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB}/veritastock/enterprise`);
    await expect(page.getByTestId("rollup-table")).toBeVisible({ timeout: 15000 });

    const fromTrigger = page.getByTestId("transfer-from");
    test.skip(!(await fromTrigger.isVisible().catch(() => false)), "needs an enterprise with 2+ locations");

    // Pick a source. Radix Select renders options in a portal as role=option.
    await fromTrigger.click();
    await page.getByRole("option").first().waitFor({ state: "visible" });
    await page.getByRole("option").first().click();
    const fromName = ((await fromTrigger.textContent()) || "").trim();
    expect(fromName.length).toBeGreaterThan(0);

    // Pick a destination (the list excludes the chosen source).
    const toTrigger = page.getByTestId("transfer-to");
    await toTrigger.click();
    await page.getByRole("option").first().waitFor({ state: "visible" });
    await page.getByRole("option").first().click();
    const toName = ((await toTrigger.textContent()) || "").trim();
    expect(toName.length).toBeGreaterThan(0);

    // Header cells: [Item, <loc cols...>, Total, Transfer]. The first location
    // column must be the source, the second the destination.
    const headerCells = page.locator('[data-testid="rollup-table"] thead th');
    await expect(headerCells.nth(1)).toContainText(fromName);
    await expect(headerCells.nth(2)).toContainText(toName);
  });
});
