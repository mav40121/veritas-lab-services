// tests/playwright/readiness-dashboard.spec.ts
//
// Gate 3 step 8 for MLC-3 (cross-module inspection-readiness dashboard,
// ReadinessDashboardPage). One pane shows an overall status plus a readiness
// card per module (equipment, PT deadlines, QC, certificates, competency), and a
// multi-lab rollup for accounts with more than one lab.
//
// Gated on PW_TOKEN + PW_READINESS_URL (e.g. /labs/19/readiness). Compile-only in
// CI; the live click is the human-in-the-loop receipt.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const URL = process.env.PW_READINESS_URL || "";

test.describe("Inspection readiness dashboard", () => {
  test("renders the overall readiness banner and per-module cards", async ({ page }) => {
    if (!TOKEN || !URL) { test.skip(true, "Set PW_TOKEN + PW_READINESS_URL."); return; }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}${URL}`, { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { name: "Inspection Readiness" })).toBeVisible();
    await expect(page.getByText(/modules on track/)).toBeVisible();
    await expect(page.getByText("Equipment maintenance")).toBeVisible();
  });
});
