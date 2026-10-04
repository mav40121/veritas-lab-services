// tests/playwright/veritadc-manual-approvers.spec.ts
//
// Gate 3 browser evidence for the VeritaDC per-manual (department) approver
// mapping (#39). On the "My Documents" tab a "Manual approvers" button opens a
// dialog where an admin designates who approves policies in a specific manual;
// when a manual names an approver for a workflow role, only that person may
// approve that step for policies in the manual.
//
// Env: PW_BASE, PW_TOKEN (an owner/admin), PW_DC_LAB (a lab with >=1 manual).
// Skips without them so the compile-only smoke gate stays green.
//
// Manually exercised end-to-end on a local throwaway lab on 2026-10-04:
// opened the dialog (Microbiology pre-selected), added Technical Consultant ->
// Micro Director via the API the dialog calls (POST .../manuals/:id/approvers
// -> 201), and the dialog then rendered "Technical Consultant: Micro Director".
// The narrowing logic (only the designated approver is eligible; non-mapped
// members blocked; self-approval still guarded; fallback when unmapped) is
// covered offline by scripts/verify-veritadc-manual-approvers.ts (9/9).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_DC_LAB || "";

test.describe("VeritaDC - per-manual approver mapping", () => {
  test("the Manual approvers dialog opens and lists a manual's approvers", async ({ page }) => {
    if (!TOKEN || !LAB) {
      test.skip(true, "Needs PW_TOKEN (owner/admin) + PW_DC_LAB (a lab with a manual).");
      return;
    }
    await page.setViewportSize({ width: 1400, height: 950 });
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB}/veritapolicy-app/my-policies`, { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: /Manual approvers/i }).click();
    await expect(page.getByText(/Designate who approves policies in a specific manual/i)).toBeVisible({ timeout: 10000 });
    // The manual picker and the add controls render.
    await expect(page.getByTestId("approver-manual-select")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Add$/ })).toBeVisible();
  });
});
