// tests/playwright/veritacheck-save-failure-surfaces.spec.ts
//
// Gate 3 step 8 evidence for the "silent save shows green Saved" reliability fix
// (review finding 2026-07-09). VeritaCheckVerificationPage previously fired PATCH
// writes, ignored the HTTP status, and unconditionally flashed a green "Saved"
// while clearing the unsaved indicator. A cross-lab 404 (from the IDOR guard), a
// plan-gate 403, or a 500 all looked like a successful save.
//
// This drives the FAILURE path deterministically by intercepting the study/
// verification PATCH and returning 404, then asserts the toast is the red
// "Save failed" variant (not green "Saved"). Needs PW_TOKEN + PW_VERIF_ID to
// load a real verification; skips (compile-only) in CI without them.
//
// Env: PW_BASE (default prod www), PW_TOKEN (lab-user JWT), PW_VERIF_ID.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const VERIF_ID = process.env.PW_VERIF_ID || "";

test.describe("VeritaCheck verification: failed save surfaces, not silent green", () => {
  test("a rejected PATCH shows a red 'Save failed' toast", async ({ page }) => {
    if (!TOKEN || !VERIF_ID) {
      test.skip(true, "PW_TOKEN + PW_VERIF_ID not set (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);

    // Force every verification PATCH (study slot or verification) to fail.
    await page.route("**/api/veritacheck/verifications/**", (route) => {
      if (route.request().method() === "PATCH") {
        return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not found" }) });
      }
      return route.continue();
    });

    await page.goto(`${BASE}/veritacheck/verifications/${VERIF_ID}`, { waitUntil: "networkidle" });

    // Edit the director approval name and try to save (this hits patchVerification).
    const nameInput = page.getByLabel(/Printed Name/i).first();
    await expect(nameInput).toBeVisible({ timeout: 20000 });
    await nameInput.fill("Gate3 Failure Probe");
    await page.getByRole("button", { name: /Save Approval Info/i }).click();

    // The toast must say the save FAILED. It must NOT say a bare "Saved".
    const failToast = page.getByText(/Save failed/i);
    await expect(failToast).toBeVisible({ timeout: 8000 });
    // And the red variant class is present (not the emerald success toast).
    await expect(page.locator(".bg-rose-600")).toBeVisible();
    await expect(page.locator(".bg-emerald-600")).toHaveCount(0);
  });
});
