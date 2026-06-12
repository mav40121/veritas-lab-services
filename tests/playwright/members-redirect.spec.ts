// tests/playwright/members-redirect.spec.ts
//
// Gate 3 receipt for the bare /members redirect (2026-06-12).
//
// Michael typed veritaslabservices.com/members and hit the 404 — the only
// real route is /labs/:labId/members. The fix adds a /members route wrapped
// in LegacyWorkspaceRedirect, which forwards to the primary lab's members
// page once memberships load.
//
// Skips without PW_TOKEN (the redirect requires memberships to resolve).
//
// Run: PW_TOKEN=... npx playwright test members-redirect

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("Bare /members redirects to the primary lab's members page", () => {
  test("logged-in /members lands on /labs/:labId/members (no 404)", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN required");
    await page.goto(`${BASE}/`);
    await page.evaluate((t: string) => localStorage.setItem("veritas_token", t), TOKEN);
    await page.goto(`${BASE}/members`);
    await page.waitForURL(/\/labs\/\d+\/members/, { timeout: 20000 });
    await expect(page.getByText(/404|Page Not Found/i)).toHaveCount(0);
  });
});
