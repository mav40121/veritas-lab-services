// tests/playwright/veritastaff-instrument-assign.spec.ts
//
// Authed smoke for the VeritaStaff instrument-centric (dual) assignment view
// (#48). "Assign by Instrument" opens a dialog: pick a test system or manual
// test, then check off which staff run it (transpose of the per-employee card).
// Same staff_employee_instruments join, viewed from the instrument side.
//
// Env-gated: set PW_TOKEN (a writer for PW_LAB_ID) and PW_LAB_ID (a lab with a map).
//
//   PW_TOKEN=... PW_LAB_ID=2 npx playwright test veritastaff-instrument-assign

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN;
const LAB = process.env.PW_LAB_ID;

test.describe("VeritaStaff instrument-centric assignment (dual view)", () => {
  test.beforeEach(() => {
    test.skip(!TOKEN || !LAB, "Set PW_TOKEN and PW_LAB_ID to run the authed dual-view check.");
  });

  test("Assign by Instrument opens, picks an instrument, and shows the staff checklist", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript((t) => { try { localStorage.setItem("veritas_token", t as string); } catch {} }, TOKEN);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/labs/${LAB}/veritastaff-app`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    const btn = page.getByTestId("button-assign-by-instrument");
    if (!(await btn.count())) {
      test.skip(true, "Assign-by-instrument button not present (no lab/plan access in this harness).");
    }
    await btn.click();
    await page.waitForTimeout(600);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("Assign by Instrument")).toBeVisible();
    const firstInstrument = page.locator('[data-testid^="instrument-pick-"]').first();
    if (await firstInstrument.count()) {
      await firstInstrument.click();
      await page.waitForTimeout(800);
      // Now on the staff checklist step.
      await expect(page.getByText(/Who runs/i)).toBeVisible();
      await expect(page.getByTestId("instrument-assign-save")).toBeVisible();
    } else {
      test.skip(true, "No instruments on this lab's map to pick.");
    }
    await ctx.close();
  });
});
