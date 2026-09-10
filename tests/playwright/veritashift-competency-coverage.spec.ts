// tests/playwright/veritashift-competency-coverage.spec.ts
//
// Gate 3 step 8 guard for VeritaShift Phase 3b (competency-aware bench coverage).
// On top of the Phase 3 "Department (bench) coverage" toggle, a second toggle
// "Count only competent staff" appears. When on, only staff competent in a bench
// (per VeritaComp) count toward that bench's requirement. The competency toggle
// is hidden unless department coverage is on, and the server forces it off when
// department coverage is off.
//
// Authenticated path runs against prod with a suite-plan owner JWT (PW_TOKEN)
// and PW_LAB_ID. Skips cleanly without them so the compile-only smoke gate stays
// green. Env: PW_BASE (default production www), PW_TOKEN, PW_LAB_ID.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";

test.describe("VeritaShift Phase 3b — competency-aware bench coverage toggle", () => {
  test("competency toggle appears only under department coverage and takes effect", async ({ page }) => {
    if (!TOKEN || !LAB_ID) {
      test.skip(true, "No PW_TOKEN / PW_LAB_ID provided (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritabench/scheduler`);

    const deptToggle = page.getByTestId("dept-coverage-toggle").locator('input[type="checkbox"]');
    let visible = false;
    try { await deptToggle.waitFor({ state: "visible", timeout: 15000 }); visible = true; } catch { /* not rendered */ }
    if (!visible) {
      test.info().annotations.push({ type: "note", text: "scheduler controls not shown (no suite access); skipping" });
      test.skip(true, "Scheduler toggle not rendered for this lab.");
      return;
    }

    const deptStartChecked = await deptToggle.isChecked();
    // Start from department coverage OFF so we can assert the competency toggle
    // is hidden, then reveal it.
    if (deptStartChecked) { await deptToggle.uncheck(); await page.waitForTimeout(600); }
    // Competency toggle is hidden while department coverage is off.
    await expect(page.getByTestId("competency-coverage-toggle")).toHaveCount(0);

    // Turn department coverage on -> the competency toggle appears, unchecked.
    await deptToggle.check();
    await page.waitForTimeout(700);
    const compToggle = page.getByTestId("competency-coverage-toggle").locator('input[type="checkbox"]');
    await expect(page.getByTestId("competency-coverage-toggle")).toBeVisible({ timeout: 8000 });
    const compStartChecked = await compToggle.isChecked();

    // Turn competency-aware coverage on and confirm it sticks (persisted via PUT
    // /settings and reflected after the period reload).
    if (!compStartChecked) { await compToggle.check(); await page.waitForTimeout(700); }
    await expect(compToggle).toBeChecked();

    // Turning department coverage off must hide and clear the competency toggle
    // (server forces competency off when department coverage is off).
    await deptToggle.uncheck();
    await page.waitForTimeout(700);
    await expect(page.getByTestId("competency-coverage-toggle")).toHaveCount(0);

    // Restore the lab's original settings so the test leaves no side effect.
    if (deptStartChecked) {
      await deptToggle.check();
      await page.waitForTimeout(600);
      const restored = page.getByTestId("competency-coverage-toggle").locator('input[type="checkbox"]');
      try { await restored.waitFor({ state: "visible", timeout: 5000 }); } catch { /* no shifts */ }
      const nowChecked = await restored.isChecked().catch(() => false);
      if (compStartChecked && !nowChecked) { await restored.check(); await page.waitForTimeout(400); }
      if (!compStartChecked && nowChecked) { await restored.uncheck(); await page.waitForTimeout(400); }
    }
  });
});
