// tests/playwright/veritatrack-copy-truth.spec.ts
//
// Gate 3 step-8 evidence for the VeritaTrack copy fix (audit #8). The suite page
// claimed VeritaTrack "auto-imports schedules from VeritaMap" (implying
// event-driven sync), but import is a manual one-click button. This loads the
// PUBLIC /veritaassure page and asserts the corrected one-click copy renders and
// the old "auto-imports" claim is gone.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("VeritaTrack auto-import copy truth", () => {
  test("the VeritaAssure suite page states one-click import, not 'auto-imports'", async ({ page }) => {
    await page.goto(`${BASE}/veritaassure`, { waitUntil: "networkidle" });
    const body = await page.locator("body").innerText();

    expect(body).toContain("One-click import of your VeritaMap");
    // The overstated auto-sync claim must be gone.
    expect(body).not.toContain("Auto-imports schedules from VeritaMap");
  });
});
