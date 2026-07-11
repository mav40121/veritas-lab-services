// tests/playwright/veritastaff-tile-error-state.spec.ts
//
// Gate 3 step-8 evidence for the VeritaStaff error-state fix (audit #6). The
// dashboard tiles used to VANISH on a failed stats fetch (return zeros -> total
// === 0 -> null), so a broken endpoint looked identical to "nobody overdue".
// This forces the competency dashboard-stats endpoint to 500 via route
// interception and asserts the tile shows a distinct "unavailable" message
// instead of disappearing.
//
// Needs PW_TOKEN for a user with a lab; skips otherwise (compile-only in CI).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("VeritaStaff dashboard tile error state", () => {
  test("a 500 on competency dashboard-stats shows 'unavailable', not a vanished tile", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);

    // Resolve a lab id, then force the competency dashboard-stats endpoint to 500.
    const labId: number | null = await page.evaluate(async (b) => {
      try {
        const r = await fetch(`${b}/api/labs/me`, { credentials: "include" });
        const m = await r.json();
        return Array.isArray(m) && m.length ? m[0].labId : null;
      } catch { return null; }
    }, BASE);
    if (!labId) { test.skip(true, "Could not resolve a lab id."); return; }

    await page.route("**/competency/dashboard-stats", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "forced" }) })
    );

    await page.goto(`${BASE}/labs/${labId}/veritastaff-app`, { waitUntil: "networkidle" });
    // The competency tile should surface the distinct error message (was: gone).
    await expect(page.getByText(/Competency status is unavailable/i)).toBeVisible({ timeout: 10000 });
  });
});
