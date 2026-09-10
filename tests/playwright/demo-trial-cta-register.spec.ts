// tests/playwright/demo-trial-cta-register.spec.ts
//
// Close-motion guard (2026-09-10): the compliance demo's seven "Start Free
// Trial" CTAs pointed at /login, which lands a warm, self-qualified viewer on
// the Sign In tab (a login wall) and hides the "two free studies to start"
// trial copy. /register routes to the same page but opens the Create Account
// tab with the trial explainer. The operations demo dead-ended with no CTA at
// all; it now closes with a Start Free Trial -> /register block. This guard
// keeps demo trial CTAs pointing at signup, not sign-in.
//
// Public, no auth. Runs in the BLOCKING public gate against a fresh local build.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Demo -> trial handoff: Start Free Trial routes to /register", () => {
  test("compliance demo: every Start Free Trial CTA points to /register, none to /login", async ({ page }) => {
    await page.goto(`${BASE}/demo/compliance`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const ctas = page.locator('a:has-text("Start Free Trial")');
    const n = await ctas.count();
    expect(n, "compliance demo shows at least one Start Free Trial CTA").toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const href = await ctas.nth(i).getAttribute("href");
      expect(href, `CTA ${i} routes to signup, not a sign-in wall`).toContain("/register");
      expect(href, `CTA ${i} must not route to /login`).not.toContain("/login");
    }
  });

  test("operations demo: has a closing Start Free Trial CTA to /register", async ({ page }) => {
    await page.goto(`${BASE}/demo/operations`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const cta = page.getByTestId("ops-demo-start-trial");
    await expect(cta, "operations demo closes with a trial CTA (no longer a dead end)").toBeVisible();
    expect(await cta.getAttribute("href")).toContain("/register");
  });

  test("/register opens the Create Account tab with the free-trial copy", async ({ page }) => {
    await page.goto(`${BASE}/register`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    // The trial explainer renders only on the register variant of the auth page.
    await expect(page.getByText(/two free studies to start/i).first()).toBeVisible();
  });
});
