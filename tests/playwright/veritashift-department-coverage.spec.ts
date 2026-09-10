// tests/playwright/veritashift-department-coverage.spec.ts
//
// Gate 3 step 8 guard for VeritaShift Phase 3 (department/bench-level coverage).
// The scheduler page carries a "Department (bench) coverage" toggle that is OFF
// by default; turning it on reveals the per-shift bench-requirements editor and
// switches the coverage math to per-department gaps. Off by default means the
// shipped shift-level grid is unchanged, which the existing
// veritashift-scheduler.spec.ts already covers.
//
// Authenticated path runs against prod with a suite-plan owner JWT (PW_TOKEN)
// and PW_LAB_ID. Skips cleanly without them so the compile-only smoke gate stays
// green. Env: PW_BASE (default production www), PW_TOKEN, PW_LAB_ID.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";

test.describe("VeritaShift Phase 3 — department (bench) coverage toggle", () => {
  test("toggling department coverage reveals the bench-requirements editor", async ({ page }) => {
    if (!TOKEN || !LAB_ID) {
      test.skip(true, "No PW_TOKEN / PW_LAB_ID provided (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritabench/scheduler`);

    // Suite-gated page. If this lab lacks VeritaShift access, note and skip.
    const toggle = page.getByTestId("dept-coverage-toggle").locator('input[type="checkbox"]');
    // The scheduler is a lazy chunk; wait for the toggle to render (isVisible() is
    // one-shot and returns false before the chunk loads, which silently skipped).
    let visible = false;
    try { await toggle.waitFor({ state: "visible", timeout: 15000 }); visible = true; } catch { /* not rendered */ }
    if (!visible) {
      test.info().annotations.push({ type: "note", text: "scheduler controls not shown (no suite access or no shifts); skipping" });
      test.skip(true, "Scheduler toggle not rendered for this lab.");
      return;
    }

    // Bench requirements are hidden until the toggle is on...
    const startChecked = await toggle.isChecked();
    if (startChecked) {
      // Leave the lab as we found it: this test drives the OFF -> ON transition,
      // so start from OFF.
      await toggle.uncheck();
      await page.waitForTimeout(600);
    }
    await expect(page.getByTestId("bench-requirements")).toHaveCount(0);

    // Turn it on. The bench-requirements editor renders only when the lab has at
    // least one shift to attach benches to; assert the editor when shifts exist,
    // else assert the toggle took effect so the guard is not lab-fragile.
    await toggle.check();
    await page.waitForTimeout(600);
    const hasShifts = (await page.locator('[data-testid^="shift-chip-"]').count()) > 0;
    if (hasShifts) {
      await expect(page.getByTestId("bench-requirements")).toBeVisible({ timeout: 8000 });
    } else {
      await expect(toggle).toBeChecked();
      test.info().annotations.push({ type: "note", text: "lab has no shifts; bench editor needs >=1 shift, asserted toggle state only" });
    }

    // Restore the lab's original setting so the test leaves no side effect.
    if (!startChecked) {
      await toggle.uncheck();
      await page.waitForTimeout(400);
    }
  });
});
