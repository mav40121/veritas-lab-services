// tests/playwright/veritapolicy-lab-switch-reload.spec.ts
//
// Regression guard for the VeritaPolicy lab-switch stale-data bug (sibling of
// the VeritaQC bug, found in the 2026-09-10 bug-class sweep). VeritaPolicy's
// loadAll useCallback closed over policyApi (derived from activeLabId) but its
// dep array was [toast], so loadAll was never recreated on a lab switch and the
// driving effect ([isLoggedIn, hasPlanAccess, loadAll]) never re-fired. A
// multi-lab owner switching labs kept seeing the PREVIOUS lab's settings,
// summary, and master list. Fixed by adding policyApi to loadAll's deps so it
// is recreated on switch and the effect re-runs.
//
// Drives the real in-app switch through the top-bar switcher. Asserts that after
// the switch the master-list refetched under the NEW lab's id, not the old one.
//
// Env: PW_BASE, PW_TOKEN (multi-lab VeritaPolicy owner), PW_POLICY_LAB_A (start
// lab id), PW_POLICY_SWITCH_TO_NAME (substring of the lab to switch to). Skips
// without them so the compile-only smoke gate stays green.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_A = process.env.PW_POLICY_LAB_A || "";
const TO_NAME = process.env.PW_POLICY_SWITCH_TO_NAME || "";

test.describe("VeritaPolicy — lab switch reloads the new lab's data", () => {
  test("switching labs refetches the master list under the new lab id", async ({ page }) => {
    if (!TOKEN || !LAB_A || !TO_NAME) {
      test.skip(true, "Needs PW_TOKEN + PW_POLICY_LAB_A + PW_POLICY_SWITCH_TO_NAME.");
      return;
    }
    // Every lab-scoped master-list fetch, as /api/labs/<id>/veritapolicy/master-list.
    const listCalls: string[] = [];
    page.on("request", r => {
      const m = r.url().match(/\/api\/labs\/(\d+)\/veritapolicy\/master-list(?!\/summary)/);
      if (m) listCalls.push(m[1]);
    });

    await page.setViewportSize({ width: 1400, height: 950 });
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_A}/veritapolicy-app`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    // Lab A loaded its own master list.
    expect(listCalls, "lab A master-list fetched on load").toContain(LAB_A);

    // Clear history, then switch labs via the top-bar switcher (the real path).
    listCalls.length = 0;
    await page.getByTestId("lab-switcher").click();
    await page.getByRole("menuitem").filter({ hasText: new RegExp(TO_NAME, "i") }).first().click();
    await page.waitForTimeout(4000);

    // The switch must have triggered a master-list fetch under a DIFFERENT lab id.
    expect(page.url()).not.toContain(`/labs/${LAB_A}/`);
    const switchedToOther = listCalls.some(id => id !== LAB_A);
    expect(
      switchedToOther,
      `after switch, master list refetched under the new lab (saw calls: ${JSON.stringify(listCalls)})`
    ).toBeTruthy();
  });
});
