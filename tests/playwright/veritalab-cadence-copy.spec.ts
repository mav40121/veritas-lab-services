// tests/playwright/veritalab-cadence-copy.spec.ts
//
// Gate 3 step-8 evidence for the VeritaLab reminder-cadence copy fix (audit #5).
// The app card, the demo, and the /veritaassure suite page said reminders fire
// at "90, 60, and 30 days"; the real scheduler fires at 9 months, 6 months, 3
// months, 30 days, and at expiration (which the public VeritaLabPage already
// states). This spec loads the PUBLIC /veritaassure suite page (no auth needed)
// and asserts the corrected cadence renders and the wrong one does not.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("VeritaLab reminder-cadence copy", () => {
  test("the VeritaAssure suite page states the real cadence, not '90, 60, and 30 days'", async ({ page }) => {
    await page.goto(`${BASE}/veritaassure`, { waitUntil: "networkidle" });
    const body = await page.locator("body").innerText();

    // The corrected cadence must be present...
    expect(body).toContain("9 months, 6 months, 3 months, 30 days, and at expiration");
    // ...and the wrong "90, 60, and 30 days" phrasing must be gone.
    expect(body).not.toContain("90, 60, and 30 days");
  });
});
