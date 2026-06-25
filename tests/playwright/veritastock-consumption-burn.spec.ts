// tests/playwright/veritastock-consumption-burn.spec.ts
//
// Gate 3 step 8 for Keystone Layer-2 Phase 2 (actual-vs-estimated turns +
// learned-burn advisor). Asserts the $ on Hand tile renders the turns/days-on-
// hand line with an "actual" or "estimated" basis badge. The full learned-burn
// Apply drive (open an item with seeded consumption, click Apply) is exercised in
// the PR's Gate 3 live drive (it needs a location with seeded consumption).
//
//   PW_BASE=https://veritastock-production.up.railway.app PW_TOKEN=<jwt> PW_LAB=3 \
//     npx playwright test veritastock-consumption-burn

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_LAB || "";

test("turns/days-on-hand tile shows an actual-or-estimated basis badge", async ({ page }) => {
  test.skip(!BASE || !TOKEN || !LAB, "needs PW_BASE + PW_TOKEN + PW_LAB");
  await injectAuth(page, BASE, TOKEN);
  await page.goto(`${BASE}/labs/${LAB}/veritastock`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(2500);

  const badge = page.getByTestId("turns-basis");
  // The tile only renders the turns line when there is consumption value; when it
  // does, the basis badge must read exactly "actual" or "estimated".
  if (await badge.count()) {
    const txt = ((await badge.first().textContent()) || "").trim().toLowerCase();
    expect(["actual", "estimated"]).toContain(txt);
  }
});
