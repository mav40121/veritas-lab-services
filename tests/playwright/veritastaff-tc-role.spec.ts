// tests/playwright/veritastaff-tc-role.spec.ts
//
// Gate 3 evidence: the VeritaStaff CLIA Role Assignments picker must offer
// Technical Consultant (TC) for HIGH-complexity labs, because a high-complexity
// certificate lab also performs moderate-complexity testing (which requires a
// TC). Previously the "high" role list omitted TC, so it was missing on
// high-complexity employees like Rachel Hermosilla.
//
// Fully gated (PW_TOKEN + PW_STAFF_URL point at a high-complexity employee
// detail page); compile-only in CI. The live human-in-the-loop click on the
// employee's Edit dialog is the primary receipt.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const STAFF_URL = process.env.PW_STAFF_URL || ""; // e.g. /labs/17/veritastaff-app/98

test.describe("VeritaStaff CLIA roles: TC available on high-complexity", () => {
  test("the Edit dialog role picker includes a TC toggle", async ({ page }) => {
    if (!TOKEN || !STAFF_URL) { test.skip(true, "Set PW_TOKEN + PW_STAFF_URL (a high-complexity employee)."); return; }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}${STAFF_URL}`, { waitUntil: "networkidle" });

    await page.getByRole("button", { name: /^Edit$/ }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("CLIA Role Assignments")).toBeVisible();
    // All six CLIA roles must be present regardless of lab complexity.
    for (const role of ["LD", "CC", "TC", "TS", "GS", "TP"]) {
      await expect(dialog.getByRole("button", { name: role, exact: true }), `role ${role}`).toBeVisible();
    }
  });
});
