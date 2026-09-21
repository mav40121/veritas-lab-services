// tests/playwright/seat-model-consistency.spec.ts
//
// Gate 3 evidence for the seat-model consistency copy pass. The three-seat-type
// model is: active seats (writers), ONE free medical director seat per lab (the
// lab's named director, excluded from the active count), and Staff Portal bands
// for read-and-sign staff. Reviewers other than the director (technical
// consultant, technical supervisor) use active seats.
//
// Before this pass the VeritaCheck article and its PDF claimed "reviewer seats
// ... are unlimited and free on every paid plan," which contradicts the model.
// This asserts that claim is gone and the corrected wording is present.
//
// PW_VA-gated so CI stays compile-only; run against a deployed build:
//   PW_VA=1 npx playwright test seat-model-consistency

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Seat-model copy consistency", () => {
  test.beforeEach(() => {
    if (!process.env.PW_VA) test.skip(true, "Set PW_VA=1 to run against a deployed build.");
  });

  test("VeritaCheck article states one free medical director seat, not unlimited reviewer seats", async ({ page }) => {
    await page.goto(`${BASE}/resources/why-veritacheck-vs-legacy-verification`, { waitUntil: "networkidle" });
    const body = (await page.textContent("body")) || "";
    // Retired claim must be gone.
    expect(body).not.toContain("unlimited and free on every paid plan");
    // Corrected wording present.
    expect(/one free medical director seat/i.test(body)).toBeTruthy();
  });
});
