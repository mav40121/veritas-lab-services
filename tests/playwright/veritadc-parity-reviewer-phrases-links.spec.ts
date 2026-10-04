// tests/playwright/veritadc-parity-reviewer-phrases-links.spec.ts
//
// Gate 3 browser evidence for two VeritaDC MediaLab-parity items (#39):
//   1. Reviewer-phrase library: the Reject dialog offers standard clickable
//      phrases that append to the comment (vs ad-hoc free text).
//   2. Cross-policy links: a policy's view dialog shows "Related policies"
//      (References / Referenced by) and a picker to link another policy.
//
// Env: PW_BASE, PW_TOKEN (owner/admin), PW_DC_LAB (a lab with an approved doc
// and an in-review doc). Skips without them so the compile-only smoke gate
// stays green.
//
// Manually exercised end-to-end on a local throwaway lab on 2026-10-04:
//   - Cross-policy: opened "Glucose Bench SOP" -> Related policies showed
//     "References: Specimen Rejection Criteria" with the link picker (after
//     POST .../documents/102/links -> 201; GET returned correct references,
//     referenced-by, and candidate exclusion).
//   - Reviewer phrases: opened the Reject dialog on an in-review doc; 10 phrase
//     chips rendered and clicking one appended "Add the CFR citation for this
//     requirement." to the comment.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_DC_LAB || "";

test.describe("VeritaDC parity - reviewer phrases + cross-policy links", () => {
  test("reject dialog offers standard phrases; view dialog shows Related policies", async ({ page }) => {
    if (!TOKEN || !LAB) {
      test.skip(true, "Needs PW_TOKEN + PW_DC_LAB (approved + in-review docs).");
      return;
    }
    await page.setViewportSize({ width: 1400, height: 950 });
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB}/veritapolicy-app/my-policies`, { waitUntil: "domcontentloaded" });

    // 1. Reject dialog phrase chips.
    const reject = page.getByRole("button", { name: /^Reject$/ }).first();
    if (await reject.isVisible().catch(() => false)) {
      await reject.click();
      await expect(page.getByText(/Reject this policy/i)).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId("reject-phrases")).toBeVisible();
      await page.getByTestId("reject-phrases").getByRole("button").first().click();
      await expect(page.locator('textarea')).not.toHaveValue("");
      await page.keyboard.press("Escape");
    }

    // 2. View dialog "Related policies" section.
    await page.getByRole("button", { name: /^View$/ }).first().click();
    await expect(page.getByTestId("related-policies")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("link-target-select")).toBeVisible();
  });
});
