// tests/playwright/labmembers-medical-director-badge.spec.ts
//
// Gate 3 step 8 receipt for the Medical Director badge on the Lab Members
// page. When a lab has a designated medical director (labs.medical_director_
// email, surfaced on the members payload), the matching member — or the
// matching pending invite — renders a teal badge with
// data-testid="medical-director-badge". San Carlos (lab 2) has Dr. Chris
// Gilles designated while his invite is still pending, so the badge shows as
// "Medical Director (invite pending)" on his row.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "2";

test.describe("LabMembers Medical Director badge", () => {
  test("badge renders for the designated director on lab 2", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set");
    await page.goto(`${BASE}/`);
    await page.evaluate((t) => localStorage.setItem("auth_token", t), TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/members`);
    // The badge is specific (data-testid), so this cannot be satisfied by the
    // static "Medical director or designee" seat-card copy elsewhere on the
    // page. A lab with a designated director must render at least one.
    const badge = page.getByTestId("medical-director-badge").first();
    await expect(badge).toBeVisible();
    await expect(badge).toContainText(/Medical Director/i);
  });

  test("unauthenticated Lab Members route does not 500", async ({ page }) => {
    const response = await page.goto(`${BASE}/labs/${LAB_ID}/members`);
    expect(response?.status() ?? 0).toBeLessThan(500);
  });
});
