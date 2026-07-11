// tests/playwright/staffportal-signout-clears-token.spec.ts
//
// Gate 3 step-8 evidence for the Staff Portal sign-out security fix (VeritaStaff
// audit HIGH #1). Before: signOut() removed 'auth_token' (a non-existent key), so
// the real 'veritas_token' survived and the next person on a shared device was
// silently signed in as the prior user. After: signOut() calls clearAuth(), which
// removes the real token.
//
// Needs a PW_TOKEN whose user resolves to a Staff Portal roster employee (so the
// portal reaches the "ready" state and renders a Sign out control). Skips
// otherwise, so it stays green as the compile-only CI gate.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("Staff Portal sign-out clears the real token", () => {
  test("clicking Sign out removes veritas_token from localStorage", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/staff-access`, { waitUntil: "networkidle" });

    // Precondition: the real token is present before sign-out.
    const before = await page.evaluate(() => localStorage.getItem("veritas_token"));
    expect(before, "veritas_token should be set before sign-out").toBeTruthy();

    const signOut = page.getByRole("button", { name: /sign out/i }).first();
    if (!(await signOut.count())) {
      test.skip(true, "PW_TOKEN user is not on a Staff Portal roster (no Sign out control).");
      return;
    }
    await signOut.click();
    await page.waitForTimeout(500);

    // The fix: the real token is gone (was untouched by the old 'auth_token' removal).
    const after = await page.evaluate(() => localStorage.getItem("veritas_token"));
    expect(after, "veritas_token must be cleared after Sign out").toBeFalsy();
  });
});
