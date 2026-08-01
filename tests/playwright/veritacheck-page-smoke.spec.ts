// tests/playwright/veritacheck-page-smoke.spec.ts
//
// Gate 3 step 8 receipt for the CLIA_REQUIRED_PLANS fix on VeritaCheckPage:
// the Clinic tier's real plan string is "waived" (server/stripe.ts), so it was
// added to the set that requires a CLIA number before checkout — otherwise a
// Clinic customer skipped the CLIA prompt. Public page, no auth needed; this
// is a render smoke test (the constant change has no new clickable element).

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("VeritaCheck page", () => {
  test("renders without a server error", async ({ page }) => {
    const res = await page.goto(`${BASE}/veritacheck`);
    expect(res?.status() ?? 0).toBeLessThan(500);
    await expect(page.getByText(/VeritaCheck/i).first()).toBeVisible();
  });
});
