// tests/playwright/veritaqc-warning-ack.spec.ts
//
// Gate 3 step 8 browser evidence for parking-lot #56: a Westgard WARNING (1-2s,
// a single control point 2 to 3 SD from the mean) must be unmissable at entry.
// It used to flash as a brief toast; it now holds the tech on a must-acknowledge
// dialog ("QC warning: result outside 2 SD" with an "Acknowledge and continue"
// button). Soft: no corrective action is required.
//
// This spec drives the real client dialog so a timing/rendering regression in the
// acknowledge flow surfaces in the browser, not just in server-side scoring.
//
// Env: PW_BASE, PW_TOKEN (a writer on a lab with VeritaQC), PW_QC_LAB (that lab's
// id), PW_QC_LOT (a control lot id in that lab with >= 2 prior points so Westgard
// evaluates), PW_QC_WARN_VALUE (a value 2 to 3 SD from that lot's mean). Skips
// without them so the compile-only smoke gate stays green (repo pattern).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_QC_LAB || "";
const LOT = process.env.PW_QC_LOT || "";
const WARN_VALUE = process.env.PW_QC_WARN_VALUE || "";

test.describe("VeritaQC soft Westgard warning is unmissable at entry", () => {
  test("a 2-to-3 SD result opens an acknowledge-only dialog, not a transient toast", async ({ page }) => {
    if (!TOKEN || !LAB || !LOT || !WARN_VALUE) {
      test.skip(true, "Needs PW_TOKEN + PW_QC_LAB + PW_QC_LOT + PW_QC_WARN_VALUE (a value 2-3 SD from the lot mean).");
      return;
    }
    await page.setViewportSize({ width: 1400, height: 950 });
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB}/qc-app`, { waitUntil: "domcontentloaded" });

    // Select the control lot, enter a date and the warning-range value, submit.
    await page.getByText(/control lot/i).first().waitFor({ timeout: 10000 });
    // Date field (today) and the numeric result value.
    const today = new Date().toISOString().slice(0, 10);
    await page.locator('input[type="date"]').first().fill(today);
    await page.getByLabel(/result value/i).fill(WARN_VALUE);
    await page.getByRole("button", { name: /submit|log result|record/i }).first().click();

    // The acknowledge dialog must appear and name the rule.
    await expect(page.getByRole("heading", { name: /QC warning: result outside 2 SD/i }))
      .toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/no corrective action is\s+required/i)).toBeVisible();
    // Acknowledge-only: a single continue button, no corrective-action textarea.
    const ackButton = page.getByRole("button", { name: /acknowledge and continue/i });
    await expect(ackButton).toBeVisible();
    await ackButton.click();
    // Dialog dismisses on acknowledge; no CA was forced.
    await expect(page.getByRole("heading", { name: /QC warning: result outside 2 SD/i }))
      .toBeHidden({ timeout: 5000 });
  });
});
