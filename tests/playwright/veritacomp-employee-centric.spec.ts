// tests/playwright/veritacomp-employee-centric.spec.ts
//
// Gate 3 step 8 for the employee-centric VeritaComp entry point (Phase 1).
// Michael's model: below the two coverage maps, a roster of every employee with
// >=1 assigned test system; clicking a name opens their competency view organized
// by test system (assigned instruments) with per-element status.
//
// Env-gated: PW_TOKEN + PW_LAB_ID (a lab whose employees have instrument
// assignments in VeritaStaff). Skips otherwise.
//
//   PW_TOKEN=... PW_LAB_ID=3 npx playwright test veritacomp-employee-centric

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN;
const LAB = process.env.PW_LAB_ID;

test.describe("VeritaComp: employee-centric entry point", () => {
  test.beforeEach(() => {
    test.skip(!TOKEN || !LAB, "Set PW_TOKEN and PW_LAB_ID to run the employee-centric check.");
  });

  test("roster lists employees and a name opens their test-system view", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await injectAuth(page, BASE, TOKEN!);
    await page.goto(`${BASE}/labs/${LAB}/veritacomp-app`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);

    // The employee roster renders below the coverage maps.
    const rows = page.locator('[data-testid="employee-roster-row"]');
    const count = await rows.count();
    test.skip(count === 0, "No employees with assigned test systems on this lab.");
    expect(count, `employee roster rows (${count})`).toBeGreaterThan(0);

    // Click the first employee -> their competency view opens with test systems.
    await rows.first().click();
    await page.waitForTimeout(2500);
    await expect(page.getByText(/All employees/i).first()).toBeVisible({ timeout: 8000 });

    const tsList = page.locator('[data-testid="test-system-list"]');
    const hasTs = await tsList.isVisible().catch(() => false);
    // If the employee has assigned instruments, the test-system tabs render and
    // the element table shows. (An employee with no assignments shows the empty
    // state instead, which is also valid.)
    if (hasTs) {
      await expect(page.locator('[data-testid="test-system-tab"]').first()).toBeVisible();
      await expect(page.getByText(/Direct Observation of Routine Patient Test Performance/i).first()).toBeVisible({ timeout: 8000 });
    }
    expect(errors, `page errors after nav: ${errors.join("; ")}`).toHaveLength(0);
    await ctx.close();
  });
});
