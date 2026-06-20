// tests/playwright/veritastock-same-origin-api.spec.ts
//
// Regression guard for the cross-origin API bug: the client's API_BASE used to
// be hardcoded to https://www.veritaslabservices.com. On the SEPARATE
// VeritaStock deployment that made every lab/plan lookup a cross-origin call
// that CORS blocked, so the inventory app showed a "requires a suite
// subscription" upgrade wall instead of the seeded data. API_BASE is now
// same-origin (""), so each deployment talks to its own backend.
//
// Run authed against the VeritaStock service:
//   PW_BASE=https://veritastock-production.up.railway.app PW_TOKEN=<jwt> \
//     npx playwright test veritastock-same-origin-api

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("VeritaStock same-origin API", () => {
  test("inventory app loads seeded data with no cross-origin lab-domain calls", async ({ page }) => {
    test.skip(!BASE || !TOKEN, "needs PW_BASE + PW_TOKEN");
    const crossOrigin: string[] = [];
    page.on("request", (r) => {
      const u = r.url();
      if (/\/api\//.test(u) && /www\.veritaslabservices\.com/i.test(u)) crossOrigin.push(u);
    });

    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/2/veritastock`, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(2500);

    const body = await page.evaluate(() => document.body.innerText);
    // The plan-gate wall must NOT appear (it only fired because labs failed to load).
    expect(body).not.toMatch(/requires a suite subscription/i);
    // No API call should have gone cross-origin to the lab domain.
    expect(crossOrigin, `cross-origin lab-domain API calls: ${crossOrigin.join(", ")}`).toHaveLength(0);
  });
});
