// tests/playwright/staffportal-auth-unification.spec.ts
//
// Gate 3 step 8 receipt for the Staff Portal auth unification (PR1).
// Asserts the static / structural pieces; the live invite flow needs
// Michael's browser-click after deploy because it ends in an email
// inbox.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "2";

test.describe("Staff Portal auth unification", () => {
  test("invite endpoint requires auth", async ({ request }) => {
    const r = await request.post(`${BASE}/api/labs/${LAB_ID}/staff-portal-invites`, {
      data: { staff_employee_id: 1, email: "test@example.com" },
    });
    expect([401, 403]).toContain(r.status());
  });

  test("invite list endpoint requires auth", async ({ request }) => {
    const r = await request.get(`${BASE}/api/labs/${LAB_ID}/staff-portal-invites`);
    expect([401, 403]).toContain(r.status());
  });

  test("identity endpoint requires auth", async ({ request }) => {
    const r = await request.get(`${BASE}/api/me/staff-portal-employee`);
    expect([401, 403]).toContain(r.status());
  });

  test("identity endpoint returns 404 for a non-staff-portal account", async ({ request }) => {
    test.skip(!TOKEN, "PW_TOKEN not set");
    // The director token is NOT a staff_portal seat, so identity should
    // 404. The endpoint deliberately scopes by user_seats.seat_type.
    const r = await request.get(`${BASE}/api/me/staff-portal-employee`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status()).toBe(404);
  });

  test("staff-access page still renders the legacy login form", async ({ page }) => {
    // Backward-compat: the CLIA + PIN entry remains as a fallback path
    // until PR2 retires the synthetic-JWT code path. Asserts the
    // entry surface still mounts so directors who haven't invited
    // anyone yet aren't blocked.
    await page.goto(`${BASE}/staff-access`);
    await expect(page.getByTestId("sp-login-clia")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("sp-login-pin")).toBeVisible();
  });

  test("VeritaStaff edit dialog exposes the Staff Portal Access section", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set");
    await page.goto(`${BASE}/`);
    await page.evaluate((t) => localStorage.setItem("auth_token", t), TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritastaff`);
    // Wait for the roster to render, click the first employee row's edit
    // affordance, then assert the invite section is in the dialog.
    // (Exact selectors depend on the existing VeritaStaff UI; we use a
    // forgiving check here and rely on the test runner to fail loudly
    // when the section is missing.)
    const editTrigger = page.locator('button:has-text("Edit")').first();
    await expect(editTrigger).toBeVisible({ timeout: 10000 });
    await editTrigger.click();
    await expect(page.getByText("Staff Portal Access")).toBeVisible();
    await expect(page.getByTestId("staff-portal-invite-email")).toBeVisible();
    await expect(page.getByTestId("staff-portal-invite-send")).toBeVisible();
  });
});
