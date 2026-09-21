// tests/playwright/pricing-md-reviewer-seat.spec.ts
//
// Gate 3 evidence for surfacing the free medical director / reviewer seat on the
// plans page. Legacy verification tools often bill the medical director as a
// paid seat; VeritaAssure includes reviewer seats (medical director or designee,
// technical consultant, technical supervisor) free. This asserts the plans page
// now states that, on the tier cards and in the seat note.
//
// PW_VA-gated so CI stays compile-only; run against a deployed build:
//   PW_VA=1 npx playwright test pricing-md-reviewer-seat

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Plans page — free medical director / reviewer seat", () => {
  test.beforeEach(() => {
    if (!process.env.PW_VA) test.skip(true, "Set PW_VA=1 to run against a deployed build.");
  });

  test("/pricing states reviewer seats are included free", async ({ page }) => {
    await page.goto(`${BASE}/pricing`, { waitUntil: "networkidle" });
    const body = (await page.textContent("body")) || "";
    // Tier-card bullet.
    expect(body).toContain("Medical director and reviewer seats included free");
    // Seat note wording.
    expect(/reviewer seats for the medical director or designee/i.test(body)).toBeTruthy();
  });
});
