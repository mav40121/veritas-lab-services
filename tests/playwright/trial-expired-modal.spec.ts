// tests/playwright/trial-expired-modal.spec.ts
//
// Gate 3 step 8 (browser) evidence for the client half of the card-less trial
// hard-lock: when a lab-scoped request returns 403 TRIAL_EXPIRED, the app routes
// it through the shared subscription-error bus and the SubscriptionModal renders
// a "Trial Ended" dialog (not the read-only "Subscription Required" copy).
//
// Needs a token for a member of an EXPIRED trial lab to drive the real 403, so
// it skips unless PW_TOKEN + PW_TRIAL_LAB_ID are provided (compile-only in CI).
// Env: PW_BASE (default production www), PW_TOKEN, PW_TRIAL_LAB_ID.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const TRIAL_LAB_ID = process.env.PW_TRIAL_LAB_ID || "";

test.describe("Trial hard-lock — expired-trial modal", () => {
  test("an expired trial lab shows the Trial Ended dialog", async ({ page }) => {
    if (!TOKEN || !TRIAL_LAB_ID) {
      test.skip(true, "No PW_TOKEN / PW_TRIAL_LAB_ID (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${TRIAL_LAB_ID}/veritacheck/coverage`, { waitUntil: "domcontentloaded" });
    // The 403 TRIAL_EXPIRED fires the subscription-error bus -> SubscriptionModal.
    await expect(page.getByText("Trial Ended")).toBeVisible({ timeout: 20000 });
  });
});
