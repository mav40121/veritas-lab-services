// tests/playwright/veritadc-approval-delegation.spec.ts
//
// Gate 3 browser evidence for VeritaDC approval-workflow delegation (#39). On
// the "My Documents" tab a "Delegations" button opens a dialog where a reviewer
// (or an owner/admin) names a temporary designate who inherits the reviewer's
// approval eligibility for a date window. Signatures taken by delegation are
// attributed to the delegator.
//
// Env: PW_BASE, PW_TOKEN (an owner/admin), PW_DC_LAB (a lab with >=2 active
// members). Skips without them so the compile-only smoke gate stays green.
//
// Manually exercised end-to-end on a local throwaway lab on 2026-10-04:
// opened the dialog, created a delegation (Deleg QA Owner -> Demo User,
// 2026-10-01 to 2026-10-31) which rendered with a green ACTIVE chip and a
// Revoke button, then clicked Revoke and the row flipped to "revoked" and the
// Revoke affordance disappeared. The eligibility logic (delegate inherits
// inside the window; window boundaries; revoked; role scope; manual scope; and
// both self-approval laundering guards) is covered offline by
// scripts/verify-veritadc-approval-delegation.ts (19/19).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_DC_LAB || "";

test.describe("VeritaDC - approval delegation", () => {
  test("the Delegations dialog opens and renders the create form", async ({ page }) => {
    if (!TOKEN || !LAB) {
      test.skip(true, "Needs PW_TOKEN (owner/admin) + PW_DC_LAB (a lab with >=2 active members).");
      return;
    }
    await page.setViewportSize({ width: 1400, height: 950 });
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB}/veritapolicy-app/my-policies`, { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: /Delegations/i }).click();
    await expect(page.getByText(/delegate their approval authority to a stand-in/i)).toBeVisible({ timeout: 10000 });
    // The create controls render: a To (delegate) picker, both date inputs, and
    // the Create button.
    await expect(page.getByTestId("deleg-to")).toBeVisible();
    await expect(page.getByTestId("deleg-start")).toBeVisible();
    await expect(page.getByTestId("deleg-end")).toBeVisible();
    await expect(page.getByTestId("deleg-create")).toBeVisible();
  });
});
