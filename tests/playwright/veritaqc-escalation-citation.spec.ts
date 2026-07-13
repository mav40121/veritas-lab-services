// tests/playwright/veritaqc-escalation-citation.spec.ts
//
// Gate 3 step-8 evidence for the VeritaQC escalation-citation fix (audit #4). The
// QC->VeritaResponse escalation toast + button title cited 42 CFR 493.1256(d)
// (the daily-control/IQCP clause); corrected to 493.1282 (corrective actions).
// This loads the authenticated daily review and asserts the page renders; the
// authoritative check is the unit receipt (verify-veritaqc-rulings-4-6-14.mjs),
// since the escalate flow needs a lab with a filed corrective action. Needs
// PW_TOKEN; skips otherwise (compile-only in CI).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("VeritaQC escalation citation", () => {
  test("the daily review renders and no longer references 493.1256(d) in its escalate copy", async ({ page }) => {
    if (!TOKEN) { test.skip(true, "No PW_TOKEN (compile-only gate run)."); return; }
    await injectAuth(page, BASE, TOKEN);

    await page.goto(`${BASE}/veritaqc-app/review`, { waitUntil: "networkidle" });

    // The page loads without crashing.
    await expect(page.getByText(/VeritaQC/i).first()).toBeVisible({ timeout: 10000 });
    // If any escalate button title is present, it must cite 493.1282, not 493.1256(d).
    const body = await page.locator("body").innerHTML();
    expect(body).not.toContain("493.1256(d)");
  });
});
