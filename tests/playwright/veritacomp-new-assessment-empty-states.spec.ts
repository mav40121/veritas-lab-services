// tests/playwright/veritacomp-new-assessment-empty-states.spec.ts
//
// Gate 3 step 8 evidence for the VeritaComp New-Assessment empty-state UX fix
// (scorecard sev1, 2026-07-10). The dialog is behind auth, so this is compile-only
// in CI and runs only when PW_TOKEN + a program URL in the relevant empty state are
// provided. It opens the New-Assessment dialog and asserts the guidance banner
// renders (and, for a zero-method-group technical program, that Save is disabled).
//
// Env: PW_BASE (default prod www), PW_TOKEN (lab-user JWT),
//      PW_EMPTY_PROGRAM_URL (a program page whose New-Assessment dialog is in an
//      empty state: a technical program with no method groups, or a lab with no
//      active employees).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const PROGRAM_URL = process.env.PW_EMPTY_PROGRAM_URL || "";

test.describe("VeritaComp: New-Assessment dialog guides the empty states", () => {
  test("the empty-state banner renders (no silent dead-end)", async ({ page }) => {
    if (!TOKEN || !PROGRAM_URL) {
      test.skip(true, "PW_TOKEN + PW_EMPTY_PROGRAM_URL not set (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}${PROGRAM_URL}`, { waitUntil: "networkidle" });

    await page.getByRole("button", { name: /New Assessment/i }).first().click();

    // One of the two guidance banners must be visible instead of a silent empty form.
    const banner = page.getByText(/No active employees in this lab|This program has no method groups/);
    await expect(banner).toBeVisible();

    // If it is the method-group case, Save must be disabled.
    if (await page.getByText("This program has no method groups").isVisible().catch(() => false)) {
      await expect(page.getByRole("button", { name: /Save Assessment/i })).toBeDisabled();
    }
  });
});
