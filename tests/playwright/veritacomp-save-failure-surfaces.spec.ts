// tests/playwright/veritacomp-save-failure-surfaces.spec.ts
//
// Gate 3 step 8 evidence for the VeritaComp silent-save fix (review 2026-07-09).
// deleteAssessment, deactivate (employee), and save (program rename) fired their
// DELETE/PUT, ignored the HTTP status, and invalidated the query as if it worked
// -- so a locked-assessment 409 or a foreign 404 looked successful. They now
// check res.ok and raise a destructive toast on failure.
//
// Drives the FAILURE path deterministically: intercept the competency mutation
// and return 409, then assert a destructive "failed" toast appears. Needs
// PW_TOKEN + PW_PROGRAM_URL to reach a program's Assessments tab; skips
// (compile-only) in CI otherwise.
//
// Env: PW_BASE (default prod www), PW_TOKEN (lab-user JWT), PW_PROGRAM_URL
// (path to a program detail view with at least one assessment).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const PROGRAM_URL = process.env.PW_PROGRAM_URL || "";

test.describe("VeritaComp: a rejected competency mutation surfaces, not silent success", () => {
  test("a 409 on delete assessment shows a destructive toast, not a silent removal", async ({ page }) => {
    if (!TOKEN || !PROGRAM_URL) {
      test.skip(true, "PW_TOKEN + PW_PROGRAM_URL not set (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);

    // Force every competency assessment DELETE to fail with a lock 409.
    await page.route("**/competency/assessments/**", (route) => {
      if (route.request().method() === "DELETE") {
        return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Assessment is locked" }) });
      }
      return route.continue();
    });

    await page.goto(`${BASE}${PROGRAM_URL}`, { waitUntil: "networkidle" });

    // Trigger a delete (button label may vary; match a delete/remove control).
    const del = page.getByRole("button", { name: /delete|remove/i }).first();
    await expect(del).toBeVisible({ timeout: 20000 });
    await del.click();
    // A confirm dialog may appear; confirm it if present.
    await page.getByRole("button", { name: /^(delete|remove|confirm|yes)$/i }).first().click().catch(() => {});

    // The failure must surface as a "Delete failed" message, not a silent success.
    await expect(page.getByText(/delete failed/i)).toBeVisible({ timeout: 8000 });
  });
});
