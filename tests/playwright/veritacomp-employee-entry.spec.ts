// tests/playwright/veritacomp-employee-entry.spec.ts
//
// Gate 3 step 8 for employee-centric data entry (Phase 2). From an employee's
// competency view, an owner/writer enters an element's data for a test system and
// saves it to that employee's single current-cycle record (items keyed by
// instrument). This drives the real form on prod: fill Element 1's specimen on a
// test system, save, and confirm it persisted via the API.
//
// Env-gated: PW_TOKEN (writer/LD) + PW_LAB_ID + PW_EMPLOYEE_ID (a staff employee
// with >=1 assigned instrument). Skips otherwise.
//
//   PW_TOKEN=... PW_LAB_ID=3 PW_EMPLOYEE_ID=25 npx playwright test veritacomp-employee-entry

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN;
const LAB = process.env.PW_LAB_ID;
const EMP = process.env.PW_EMPLOYEE_ID;

test.describe("VeritaComp: employee-centric per-test-system entry", () => {
  test.beforeEach(() => {
    test.skip(!TOKEN || !LAB || !EMP, "Set PW_TOKEN, PW_LAB_ID, PW_EMPLOYEE_ID to run the entry check.");
  });

  test("entering a specimen on a test system saves to the employee's record", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await injectAuth(page, BASE, TOKEN!);
    await page.goto(`${BASE}/labs/${LAB}/veritacomp-app/employee/${EMP}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);

    const tabs = page.locator('[data-testid="test-system-tab"]');
    const hasTs = (await tabs.count()) > 0;
    test.skip(!hasTs, "No assigned test systems for this employee.");
    await tabs.first().click();
    await page.waitForTimeout(800);

    const specimen = page.locator('[data-testid="element-1-specimenId"]').first();
    await expect(specimen).toBeVisible({ timeout: 8000 });
    const val = `EMP-${Date.now().toString().slice(-6)}`;
    await specimen.fill(val);
    await page.locator('[data-testid="save-test-system"]').click();
    await page.waitForTimeout(2000);

    // Confirm it persisted: reload and read the endpoint; some test system must
    // carry the specimen on its Element 1.
    const persisted = await page.evaluate(async ([base, lab, emp, sid]) => {
      const t = localStorage.getItem("veritas_token");
      const r = await fetch(`${base}/api/labs/${lab}/competency/employee/${emp}`, { headers: { Authorization: `Bearer ${t}` } });
      if (!r.ok) return false;
      const d = await r.json();
      for (const ts of (d.testSystems || [])) {
        for (const el of (ts.elements || [])) {
          if (el.num === 1 && el.specimenId === sid) return true;
        }
      }
      return false;
    }, [BASE, LAB, EMP, val] as const);
    expect(persisted, `specimen ${val} persisted to a test system`).toBeTruthy();

    expect(errors, `page errors after save: ${errors.join("; ")}`).toHaveLength(0);
    await ctx.close();
  });
});
