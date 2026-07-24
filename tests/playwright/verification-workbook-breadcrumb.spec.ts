// tests/playwright/verification-workbook-breadcrumb.spec.ts
//
// Guard for the 2026-07-24 Longstreth navigation feedback: when the study-
// create page is opened from a verification workbook (Run button passes
// verificationId + element), it shows a persistent breadcrumb back to that
// workbook, and the workbook honors ?verification=<id> to deep-link straight
// to the right package. Without those, moving between building a study and the
// workbook meant browser-back and a lost place.
//
// Needs creds: PW_TOKEN + PW_LAB_ID (a lab the token can read; lab 3 has
// verification #20, the Sysmex XN-2000 workbook). Skips cleanly without them.
// Run: PW_TOKEN=... PW_LAB_ID=3 npx playwright test verification-workbook-breadcrumb

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";
const VID = process.env.PW_VERIFICATION_ID || "20"; // lab 3 Sysmex XN-2000 workbook

test.describe("VeritaCheck: verification workbook <-> study round-trip", () => {
  test("study page shows a breadcrumb back to the workbook it was launched from", async ({ page }) => {
    test.skip(!TOKEN || !LAB_ID, "PW_TOKEN + PW_LAB_ID required");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(
      `${BASE}/labs/${LAB_ID}/study/new?studyType=precision&verificationId=${VID}&element=precision&slotId=1`,
      { waitUntil: "networkidle" },
    );

    const crumb = page.getByTestId("back-to-verification-workbook");
    await expect(crumb).toBeVisible({ timeout: 15000 });
    // Links back to the exact workbook via the deep-link param.
    await expect(crumb).toHaveAttribute("href", new RegExp(`/dashboard/verifications\\?verification=${VID}`));
    // Names the element being built.
    await expect(crumb).toContainText(/building Precision/i);
  });

  test("the breadcrumb is absent on a standalone study (no verificationId)", async ({ page }) => {
    test.skip(!TOKEN || !LAB_ID, "PW_TOKEN + PW_LAB_ID required");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/study/new`, { waitUntil: "networkidle" });
    await expect(page.getByTestId("back-to-verification-workbook")).toHaveCount(0);
  });

  test("?verification=<id> deep-links straight to the workbook detail view", async ({ page }) => {
    test.skip(!TOKEN || !LAB_ID, "PW_TOKEN + PW_LAB_ID required");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/dashboard/verifications?verification=${VID}`, {
      waitUntil: "networkidle",
    });
    // The detail view renders the tab bar; the list view does not.
    await expect(page.getByTestId("tab-elements")).toBeVisible({ timeout: 15000 });
  });
});
