// tests/playwright/veritadc-brand-display.spec.ts
//
// Gate 3 step 8 evidence for PR #1468: the VeritaPolicy -> VeritaDC user-facing
// brand rename. The public compliance demo (/demo/compliance) describes the
// module; it must say VeritaDC and never "VeritaPolicy(TM) ships". The
// auth-gated surfaces (app-page heading, sign-in/upgrade gates, staff portal,
// surveyor view) share the same string edits and were rendered locally.
// Public, no auth: runs in the public gate against the PR's own build.
import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("VeritaDC brand: public demo describes the module as VeritaDC", () => {
  test("demo module blurb says VeritaDC, not VeritaPolicy", async ({ page }) => {
    await page.goto(`${BASE}/demo/compliance`, { waitUntil: "networkidle" });
    const text = await page.locator("body").innerText();
    expect(text).toMatch(/VeritaDC™ ships generic, CFR-anchored policy templates/);
    expect(text, "old brand must not describe the module").not.toMatch(/VeritaPolicy™ ships/);
  });
});
