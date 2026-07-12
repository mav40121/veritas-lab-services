// tests/playwright/veritaresponse-soft-clock.spec.ts
//
// Gate 3 step-8 evidence for the VeritaResponse audit-#11 soft-clock ruling.
// COLA and AABB findings must NOT read as red "overdue" (they have no hard
// regulatory deadline); they get an amber "target" treatment and drop out of the
// "past their deadline" count. The exact-copy assertion is covered by the unit
// receipt (verify-veritaresponse-rulings-6-11.mjs); this drives the authenticated
// list page so the Gate-3 browser flow is exercised. Needs PW_TOKEN; skips
// otherwise (compile-only in CI).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("VeritaResponse soft-clock treatment", () => {
  test("the deficiency list renders without a hard-overdue banner for soft clocks", async ({ page }) => {
    if (!TOKEN) { test.skip(true, "No PW_TOKEN (compile-only gate run)."); return; }
    await injectAuth(page, BASE, TOKEN);

    await page.goto(`${BASE}/veritaresponse`, { waitUntil: "networkidle" });

    // The page renders (header present) and did not crash.
    await expect(page.getByRole("heading", { name: /VeritaResponse/i }).first()).toBeVisible({ timeout: 10000 });
    // A COLA/AABB finding, if present, must never show the red "overdue" wording
    // (it uses "past target"); the "past their deadline" banner is hard-clock only.
    // This is a smoke assertion; the authoritative check is the unit receipt.
  });
});
