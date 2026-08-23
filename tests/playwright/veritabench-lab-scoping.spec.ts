// tests/playwright/veritabench-lab-scoping.spec.ts
//
// Gate 3 step 8 (browser) evidence for the VeritaBench lab-scoping fix.
// /veritabench and its tabs (staffing, scheduler, pi) were NOT in
// LAB_SCOPABLE_PATHS and had no /labs/:labId/* variants (except scheduler), so
// on those routes useActiveLabId() was null and the page fell back to the user's
// PRIMARY lab -- a multi-lab owner viewing a secondary lab saw the wrong lab's
// operations data (caught in the tutorial-video QA: /veritabench showed
// "Michaels Lab" instead of the active sandbox). This adds the /veritabench entry
// to LAB_SCOPABLE_PATHS + the lab-scoped routes; this spec asserts the new
// /labs/:labId/veritabench route resolves (not a 404) so useActiveLabId() reads
// the lab from the URL.
//
// Read-only, non-mutating. Needs PW_TOKEN; skips otherwise.
// Env: PW_BASE (default production www), PW_TOKEN, PW_MAP_LAB_ID (default 22).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_MAP_LAB_ID || "22";

test.describe("VeritaBench is lab-scoped by URL", () => {
  test("/labs/:labId/veritabench resolves and renders (not a 404)", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritabench`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);

    const body = (await page.textContent("body")) || "";
    // The new lab-scoped route must resolve to the VeritaBench/VeritaPace page,
    // not the client 404 fallback.
    expect(body).not.toContain("404 Page Not Found");
    expect(/VeritaBench|VeritaPace|Productivity|Forecast from Goal/i.test(body)).toBeTruthy();
    // The URL must keep the lab prefix so useActiveLabId() reads it.
    await expect(page).toHaveURL(new RegExp(`/labs/${LAB_ID}/veritabench`));
  });
});
