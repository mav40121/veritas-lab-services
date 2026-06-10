// tests/playwright/staffportal-token-key-fix.spec.ts
//
// Gate 3 step 8 receipt for the localStorage token-key fix
// (PR follow-up to #689). Asserts the static contracts; the live
// "no redirect to /login when authed" assertion needs Michael's
// browser-click after deploy.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Staff Portal /staff-access bootstrap", () => {
  test("unauthenticated /staff-access redirects to /login with dest", async ({ page }) => {
    await page.goto(`${BASE}/staff-access`);
    // After the bootstrap fires the no-auth branch, we hard-navigate
    // to /login?dest=/staff-access.
    await page.waitForURL(/\/login\?dest=%2Fstaff-access|\/login\?dest=\/staff-access/, { timeout: 5000 });
    expect(page.url()).toContain("/login");
    expect(page.url()).toContain("dest=");
  });
});
