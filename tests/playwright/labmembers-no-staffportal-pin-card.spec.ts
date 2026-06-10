// tests/playwright/labmembers-no-staffportal-pin-card.spec.ts
//
// Gate 3 step 8 receipt for the LabMembersPage PIN card removal
// (follow-up to PR #689, 2026-06-09). The StaffPortalPinCard render
// went away; this spec asserts the test-id is no longer in the DOM.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "2";

test.describe("LabMembers PIN card retirement", () => {
  test("staff-portal-pin-card no longer renders on Lab Members page", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set");
    await page.goto(`${BASE}/`);
    await page.evaluate((t) => localStorage.setItem("auth_token", t), TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/members`);
    await expect(page.getByTestId("staff-portal-pin-card")).toHaveCount(0);
  });

  test("unauthenticated Lab Members route does not 500", async ({ page }) => {
    const response = await page.goto(`${BASE}/labs/${LAB_ID}/members`);
    // Either redirects to login (200 HTML) or returns the SPA shell.
    // Critical: no 5xx.
    expect(response?.status() ?? 0).toBeLessThan(500);
  });
});
