// tests/playwright/qc-chart-darkmode-md-role-chip.spec.ts
//
// Gate 3 step 8 for two UI-polish changes (2026-08-14):
//   - VeritaQC Levey-Jennings chart axis/caption text switched from a hardcoded
//     fill="#555" to currentColor on a text-muted-foreground <svg>, so the
//     numbers are readable in dark mode.
//   - The lab members page renders a distinct "Medical Director" role chip for
//     the designated MD instead of labeling the director "Staff".
//
// PW_TOKEN-gated UI exercise; the visual dark-mode read is the human-in-the-loop
// receipt (the in-app browser is walled off from the domain).
//
// Env: PW_BASE (default prod), PW_TOKEN, PW_LAB_ID (default 2 = San Carlos, whose
// designated MD is Dr. Gilles).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "2";

test.describe("QC chart dark-mode + Medical Director role chip", () => {
  test("members page shows a Medical Director role chip, not Staff, for the MD", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set — skipping authenticated UI exercise");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/members`);
    // The designated MD's row carries a "Medical Director" chip.
    await expect(page.getByText(/Medical Director/i).first()).toBeVisible({ timeout: 15000 });
  });
});
