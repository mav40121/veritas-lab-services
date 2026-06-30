// tests/playwright/veritashift-staffing-grid.spec.ts
//
// Phase 3 of the operations leverage chain: the VeritaShift Staffing Grid. The shift
// build (hours/shift x days/week + adjustment) produces the FTE need that feeds the
// VeritaPace forecast gap. The grid is lab-scoped: it sends ?labId on load/save so a
// System owner's labs hold isolated grids, and the forecast auto-uses the grid FTE.
//
// Asserts the grid request carries ?labId and the grid renders. Requires PW_TOKEN
// (owner JWT) and skips otherwise so it stays green in the compile-only CI gate.
//
// Env: PW_BASE (default production www), PW_TOKEN (owner JWT).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("VeritaShift: staffing grid is lab-scoped", () => {
  test("staffing-grid request carries ?labId and the grid renders", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-time gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/veritabench/staffing`);

    const req = await page.waitForRequest(
      (r) => r.url().includes("/api/staffing-grid") && /[?&]labId=\d+/.test(r.url()),
      { timeout: 20000 }
    );
    expect(req.url()).toMatch(/[?&]labId=\d+/);
    await expect(page.locator("body")).toContainText("Staffing Grid");
  });
});
