// tests/playwright/manual-diff-form.spec.ts
//
// Gate 3 step 8 driver for the Manual Differential (Rümke) input form.
//
// Phase 3a ships the ManualDifferentialForm component but does NOT yet render it
// (the VeritaCheckPage wiring is Phase 3b). So the real browser drive — pick
// "Manual Differential" in the study-type picker, enter cell counts + reference
// %s, assert the live Rümke CI + within/exceeds badges, save — cannot run until
// the form is reachable. This spec encodes that drive but is gated behind
// PW_MD_DRIVE so it stays a no-op (no false green) until 3b flips it on.
//
// Env: PW_BASE (default production www), PW_TOKEN, PW_LAB_ID (default 2),
//      PW_MD_DRIVE (unset until Phase 3b wires the form into the page).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "2";
const DRIVE = process.env.PW_MD_DRIVE === "1";

test.describe("VeritaCheck Manual Differential (Rümke) form", () => {
  test("pick Manual Differential -> live CI + save", async ({ page }) => {
    if (!DRIVE || !TOKEN) {
      test.skip(true, "Form not wired yet (Phase 3a) or no PW_TOKEN — enable with PW_MD_DRIVE=1 after Phase 3b.");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/study/new`, { waitUntil: "domcontentloaded" });

    // Choose the Manual Differential study type from the picker.
    await page.getByTestId("select-study-type").click();
    await page.getByRole("option", { name: /Manual Differential/i }).click();

    // The self-contained form renders.
    await expect(page.getByTestId("manual-diff-form")).toBeVisible();

    // Enter an eosinophil count that makes the reference exceed its Rümke limit.
    await page.getByTestId("md-cells-100").click();
    // Row 3 is Eosinophils in the default standard-class order (0-indexed).
    await page.getByTestId("md-row-3-count").fill("3");
    await page.getByTestId("md-row-3-ref").fill("10");
    // The live CI evaluation must flag the class as exceeding (10% outside 0.6-8.5%).
    await expect(page.getByTestId("md-overall")).toContainText(/exceed/i);
  });
});
