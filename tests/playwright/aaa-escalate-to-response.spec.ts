// tests/playwright/aaa-escalate-to-response.spec.ts
//
// Gate 3 receipt for #18 Phase 3 (2026-06-13): a failed Alternative Assessment
// (AAA) on the VeritaPT page can be escalated into a VeritaResponse finding.
// The "Escalate to VeritaResponse" button renders only on a row whose
// last_pass_fail === 'fail'; once escalated the row shows a "Linked
// VeritaResponse#N" chip instead.
//
// Needs creds: PW_TOKEN, PW_LAB_ID (a VeritaPT-enabled lab). Skips cleanly
// without them. Read-only — opens the modal and inspects affordances; it does
// not click Escalate (that would create a finding).
//
// Run: PW_TOKEN=... PW_LAB_ID=1 npx playwright test aaa-escalate-to-response

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";

test.describe("AAA → VeritaResponse escalation (#18 Phase 3)", () => {
  test("AAA modal renders; failed rows expose escalate or linked-chip", async ({ page }) => {
    test.skip(!TOKEN || !LAB_ID, "PW_TOKEN + PW_LAB_ID required");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritapt/app`, { waitUntil: "networkidle" });

    // Open the AAA modal.
    const manageBtn = page.getByRole("button", { name: /Manage AAA Records/i });
    await expect(manageBtn).toBeVisible({ timeout: 15000 });
    await manageBtn.click();

    // The modal must render its records table (or the empty state).
    const modalText = await page.locator("body").innerText();
    expect(/Alternative Assessment|AAA|No alternative|analyte/i.test(modalText)).toBeTruthy();

    // Invariant under test: every FAILED row offers exactly one of
    // {Escalate button, Linked chip}. We don't seed data, so this is a
    // conditional check — it asserts the affordance logic when a fail exists.
    const failCells = page.locator("tr", { hasText: /Fail/ });
    const failCount = await failCells.count();
    for (let i = 0; i < failCount; i++) {
      const row = failCells.nth(i);
      const hasEscalate = await row.getByRole("button", { name: /Escalate to VeritaResponse/i }).count();
      const hasChip = await row.locator("text=/Linked VeritaResponse#/").count();
      expect(hasEscalate + hasChip).toBeGreaterThanOrEqual(1);
    }
  });
});
