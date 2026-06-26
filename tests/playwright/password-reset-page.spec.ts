// tests/playwright/password-reset-page.spec.ts
//
// Gate 3 step 8 receipt for the password-reset reliability work
// (client/src/pages/ResetPasswordPage.tsx + the admin reset-link tool).
// Public page, no auth. Confirms the request form renders and the post-submit
// "check your email" state shows the new delivery-expectation copy (it can take
// a few minutes, may land in spam/quarantine). Uses a non-existent email, so the
// anti-enumeration flow returns ok and renders the confirmation without creating
// any real reset token.
//
// Run: PW_BASE=https://www.veritaslabservices.com npx playwright test password-reset-page

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Password reset request page", () => {
  test("request form renders and shows delivery-expectation copy after submit", async ({ page }) => {
    await page.goto(`${BASE}/reset-password`);
    await expect(page.getByRole("heading", { name: /Forgot password/i })).toBeVisible({ timeout: 15000 });

    await page.getByPlaceholder(/you@example\.com/i).fill("nobody.delivery-check@example.com");
    await page.getByRole("button", { name: /Send Reset Link/i }).click();

    await expect(page.getByText(/Check your email/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/can take a few minutes/i)).toBeVisible();
    await expect(page.getByText(/good for 4 hours/i)).toBeVisible();
  });
});
