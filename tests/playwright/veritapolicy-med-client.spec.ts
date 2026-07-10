// tests/playwright/veritapolicy-med-client.spec.ts
//
// Gate 3 browser evidence for the VeritaPolicy client MED batch (audit #4/#5/#6):
//   #5 the "58 CFR-anchored policies" count (was a false "96") on the PUBLIC demo
//      compliance page -- asserted with no auth, so it runs anywhere.
//   #4 the My Policies search box actually filters (was a stale-memo no-op) -- an
//      authenticated check, PW_TOKEN-gated + skipped when there are no policy docs.
//
// Env: PW_BASE (default production www), PW_TOKEN (owner JWT, optional).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("VeritaPolicy MED client batch", () => {
  test("public demo compliance page shows 58 policies, not the false 96", async ({ page }) => {
    await page.goto(`${BASE}/demo/compliance`, { waitUntil: "networkidle" });
    const body = await page.locator("body").innerText();
    expect(body).toContain("58 CFR-anchored laboratory policies");
    expect(body).not.toContain("96 CFR-anchored");
    expect(body).not.toContain("96 generic policy templates");
  });

  test("My Policies search box filters the list", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    // Resolve a lab id, then open its My Policies page.
    const labId: number | null = await page.evaluate(async (b) => {
      try {
        const r = await fetch(`${b}/api/labs/me`, { credentials: "include" });
        const m = await r.json();
        return Array.isArray(m) && m.length ? m[0].labId : null;
      } catch { return null; }
    }, BASE);
    if (!labId) { test.skip(true, "Could not resolve a lab id."); return; }

    await page.goto(`${BASE}/labs/${labId}/veritapolicy-app/my-policies`, { waitUntil: "networkidle" });
    const search = page.getByPlaceholder("Search policies by title, description, or manual...");
    if (!(await search.count())) {
      test.skip(true, "No policy documents on this lab (search box hidden).");
      return;
    }
    // Count table rows before, type a query unlikely to match everything, count after.
    const rowsBefore = await page.locator("table tbody tr").count();
    await search.fill("zzzznotarealpolicyname");
    await page.waitForTimeout(300);
    const rowsAfter = await page.locator("table tbody tr").count();
    // With the stale-memo bug, rowsAfter === rowsBefore (filter never applied).
    // Fixed: an unmatchable query collapses the grouped table.
    expect(rowsAfter).toBeLessThan(rowsBefore);
  });
});
