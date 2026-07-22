// tests/playwright/clia-gate.spec.ts
//
// Gate 3 receipt for the lab-identity gate (2026-07-22): finalizing a VeritaCheck
// study under a lab that has no CLIA number is blocked, and the UI shows the
// "add your CLIA number" prompt instead of saving. Drafts stay allowed.
//
// Needs creds: PW_TOKEN + PW_NOCLIA_LAB_ID (a lab with NO clia_number that the
// token's user can write to). Skips cleanly without them, so the compile-only
// smoke gate stays green. It attempts a finalize and asserts the prompt; it does
// not leave a finalized study behind (the save is rejected by design).
//
// Run: PW_TOKEN=... PW_NOCLIA_LAB_ID=<labId> npx playwright test clia-gate

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_NOCLIA_LAB_ID || "";

test.describe("VeritaCheck lab-identity gate: no CLIA blocks finalize", () => {
  test("finalizing under a CLIA-less lab shows the add-CLIA prompt", async ({ page }) => {
    test.skip(!TOKEN || !LAB_ID, "PW_TOKEN + PW_NOCLIA_LAB_ID (a lab with no CLIA) required");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/study/new`, { waitUntil: "networkidle" });

    // Pick a simple study type and enter the minimum to allow a finalize attempt.
    await page.getByTestId("select-study-type").click();
    await page.getByRole("option", { name: /Precision Verification/i }).click();
    await page.getByLabel(/Test Name/i).first().fill("CLIA Gate Test");

    // Attempt to save/finalize. The server rejects with CLIA_REQUIRED; the UI
    // must surface the add-CLIA prompt (toast), not a generic error and not a
    // success. We assert on the prompt text.
    const saveBtn = page.getByRole("button", { name: /^Save Study$|^Save$|Calculate & Save/i }).first();
    if (await saveBtn.count()) await saveBtn.click();

    await expect(page.getByText(/CLIA number/i).first()).toBeVisible({ timeout: 15000 });
  });
});
