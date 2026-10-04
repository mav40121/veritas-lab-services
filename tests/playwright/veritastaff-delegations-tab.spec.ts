// tests/playwright/veritastaff-delegations-tab.spec.ts
//
// Gate 3 step 8 browser evidence: the Medical Director Letters of Delegation UI lives as a
// "Delegations" tab inside VeritaStaff. Loads the VeritaStaff page, switches to the
// Delegations tab, asserts the Letters of Delegation panel renders, and (for a medical
// director) opens the New letter dialog and confirms the position-filtered toggle catalog
// shows the two gated responsibilities.
//
// Env: PW_BASE, PW_TOKEN (the lab's designated medical director), PW_DELEGATION_LAB.
// Skips without them so the compile-only smoke gate stays green.
//
// Manually exercised end-to-end on 2026-10-04 (create draft 201 -> sign Active 200 ->
// PDF 200 -> revoke Revoked) against a local build with a seeded MD session.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_DELEGATION_LAB || "";

test.describe("VeritaStaff - Letters of Delegation tab", () => {
  test("the Delegations tab renders and the MD can open the New letter dialog", async ({ page }) => {
    if (!TOKEN || !LAB) {
      test.skip(true, "Needs PW_TOKEN (the lab's medical director) + PW_DELEGATION_LAB.");
      return;
    }
    await page.setViewportSize({ width: 1400, height: 950 });
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB}/veritastaff-app`, { waitUntil: "domcontentloaded" });

    // Switch to the Delegations tab.
    await page.getByRole("button", { name: /^Delegations$/i }).click();
    await expect(page.getByText(/Letters of Delegation/i)).toBeVisible({ timeout: 10000 });

    // A designated medical director sees the New letter control; open the create dialog.
    const newLetter = page.getByRole("button", { name: /New letter/i });
    await expect(newLetter).toBeVisible();
    await newLetter.click();

    await expect(page.getByText(/New letter of delegation/i)).toBeVisible();
    // The gated responsibilities (the two that control access) are present in the catalog.
    await expect(page.getByText(/Review and co-sign the monthly QC period review/i)).toBeVisible();
    await expect(page.getByText(/Review and close corrective actions and inspection findings/i)).toBeVisible();
    await expect(page.getByText(/controls access/i).first()).toBeVisible();
  });
});
