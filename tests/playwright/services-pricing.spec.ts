// tests/playwright/services-pricing.spec.ts
//
// Gate 3 step 8 browser evidence for the /services consulting-rate change, and a
// standing guard afterward. /services renders its prices client-side (React), so
// a Googlebot curl cannot see them; only a real browser load can. This asserts:
//   1. the coaching standing rate and the 2-to-4-day mock duration actually render,
//   2. the retired placeholder ($400 to $600 / $4,000) is gone (catches a stale
//      bundle serving old prices), and
//   3. the operator's NEGOTIATION FLOOR ($300/hr, $2,500/block) never appears on
//      the public page. That floor is internal; publishing it would make it the
//      ceiling. This assertion is the reason to keep the test standing.
//
// Gated behind PW_SERVICES_PRICING so CI stays compile-only; run against prod
// after deploy. Env: PW_BASE (default production www).

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("/services shows the current consulting rates, not the placeholder or the floor", () => {
  test.beforeEach(() => {
    if (!process.env.PW_SERVICES_PRICING) test.skip(true, "Set PW_SERVICES_PRICING=1 to run against a deployed build.");
  });

  test("coaching standing rate and 2-to-4-day mock duration render", async ({ page }) => {
    await page.goto(`${BASE}/services`, { waitUntil: "networkidle" });
    const body = await page.evaluate(() => document.body.innerText);

    expect(body, "coaching standing rate").toContain("$400 per hour, or $3,000 for a block of 10");
    expect(body, "mock inspection duration").toContain("2 to 4 days on-site");

    // Retired placeholder must be gone (a stale bundle would still show it).
    expect(body, "old coaching placeholder removed").not.toContain("$400 to $600 per session");
    expect(body, "old block price removed").not.toContain("$4,000");
  });

  test("the internal negotiation floor is never published", async ({ page }) => {
    await page.goto(`${BASE}/services`, { waitUntil: "networkidle" });
    const body = await page.evaluate(() => document.body.innerText);
    // $300/hr and $2,500/block are the operator's private floor. They must not
    // appear anywhere a prospect can read them.
    expect(body, "floor per-hour not published").not.toContain("$300");
    expect(body, "floor block price not published").not.toContain("$2,500");
  });
});
