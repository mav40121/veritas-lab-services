// tests/playwright/veritabench-staffing-grid-no-adj.spec.ts
//
// Gate 3 step 8 for removing the over/under "Adj" column from the VeritaShift
// Staffing Grid (2026-08-20). Weekly hours are now Hr/shift x Days/wk with no
// adjustment term, so a 5-day, 8-hour row reads 40 hr (not 40 + adj). This
// asserts the Adj column header is gone and the core grid controls still render.
//
// PW_TOKEN-gated UI exercise (skips cleanly in the reporting-only smoke run).
// Read-only: asserts the page mounts and the column set is correct (no writes).
//
// Env: PW_BASE (default prod), PW_TOKEN (owner JWT).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("VeritaShift Staffing Grid: Adj column removed", () => {
  test("staffing grid renders without the over/under Adj column", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set - skipping authenticated UI exercise");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/veritabench/staffing`);

    // The Staffing Grid card mounts.
    await expect(page.getByText("Staffing Grid", { exact: true })).toBeVisible({ timeout: 15000 });

    // The retired Adj column header must be gone; Hr/shift, Days/wk, Weekly remain.
    await expect(page.getByRole("columnheader", { name: "Adj", exact: true })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Weekly", exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Days/wk", exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Hr/shift", exact: true })).toBeVisible();
  });
});
