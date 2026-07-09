// tests/playwright/signup-no-price-fear.spec.ts
//
// Gate 3 step 8 evidence for the signup price-fear fix. A hospital lab director
// (Rachel, Troy Regional) emailed worried she had been billed because the signup
// plan-picker showed a dollar price on each plan button and a "$X/yr" summary,
// with no "no charge" reassurance. The fix strips the prices from the signup
// flow and adds a clear no-charge line (pricing lives on the Pricing page).
//
// Public register flow, no auth. Gated behind PW_SIGNUP_DRIVE so playwright-smoke
// stays compile-only in CI; runs for real locally / on prod.
//
// Env: PW_BASE (default production www), PW_SIGNUP_DRIVE (unset in CI).

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Signup: plan picker shows no price and reassures no charge", () => {
  test("self-select plan step has no $/yr and a no-charge line", async ({ page }) => {
    if (!process.env.PW_SIGNUP_DRIVE) {
      test.skip(true, "PW_SIGNUP_DRIVE not set (compile-only gate run).");
      return;
    }
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });

    // Switch to the Register tab.
    await page.getByRole("tab", { name: /register|sign up|create/i }).click().catch(() => {});
    // Pick a lab type that routes straight to manual plan self-selection.
    await page.getByText(/Independent \/ Reference Lab/i).click({ timeout: 10000 }).catch(() => {});

    // Reach the plan step: assert the no-charge reassurance is present and no yearly price is shown.
    await expect(page.getByText(/no charge and no card required/i)).toBeVisible({ timeout: 10000 });
    const body = await page.evaluate(() => document.body.innerText);
    // The plan-picker area must not advertise a yearly price anymore.
    expect(body).not.toMatch(/\$\d[\d,]*\s*\/\s*yr/i);
    // Seats are still shown so the buyer can size their workspace.
    await expect(page.getByText(/seats included/i).first()).toBeVisible();
  });
});
