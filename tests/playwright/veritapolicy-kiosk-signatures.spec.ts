// tests/playwright/veritapolicy-kiosk-signatures.spec.ts
//
// Gate 3 step 8 for LHF-1: bench staff sign policies at the Staff Portal kiosk,
// but no director-facing view read those signatures. This drives the VeritaPolicy
// compliance dashboard and asserts the new "Staff Portal signatures (kiosk)" card
// renders, so the director surface actually shows the kiosk signers.
//
// Env:
//   PW_BASE            base URL (default: prod)
//   PW_TOKEN           a logged-in veritas_token for a lab with VeritaPolicy
//   PW_COMPLIANCE_PATH path to the VeritaPolicy compliance page for that lab,
//                      e.g. /labs/3/veritapolicy/compliance
//
// Skips cleanly when creds/path are absent so the smoke runner stays green.

import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const COMPLIANCE_PATH = process.env.PW_COMPLIANCE_PATH || "";

async function auth(page: Page) {
  await page.goto(BASE);
  await page.evaluate((t: string) => localStorage.setItem("veritas_token", t), TOKEN);
}

test.describe("VeritaPolicy compliance: kiosk staff signatures surfaced (LHF-1)", () => {
  test("compliance dashboard shows the Staff Portal signatures card", async ({ page }) => {
    test.skip(!TOKEN || !COMPLIANCE_PATH, "PW_TOKEN + PW_COMPLIANCE_PATH required");

    await auth(page);
    await page.goto(`${BASE}${COMPLIANCE_PATH}`);

    // The kiosk-signatures panel is the LHF-1 addition. Its presence proves the
    // director surface now reads staff_portal_policy_signatures, not just
    // writer-account attestations.
    await expect(page.getByText("Staff Portal signatures (kiosk)")).toBeVisible({ timeout: 15000 });
  });
});
