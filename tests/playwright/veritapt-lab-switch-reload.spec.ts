// tests/playwright/veritapt-lab-switch-reload.spec.ts
//
// Regression guard for the VeritaPT lab-switch stale-data bug (sibling of the
// VeritaQC bug, found in the 2026-09-10 bug-class sweep). VeritaPT's load
// effect was keyed on [hasPlanAccess] only, so switching labs from inside the
// PT app never re-ran fetchData: coverage, enrollments, and AA-records stayed
// on the PREVIOUS lab even though ptApi recomputed for the new lab. A multi-lab
// owner (MedStar, SCAHC, COPC) would switch labs and keep seeing the old lab's
// PT picture. Fixed by keying the effect on activeLabId so a switch reloads the
// new lab's data (and clearing the create-event enrollment selection).
//
// Drives the real in-app switch through the top-bar switcher (the bug only
// reproduces through wouter navigation, not a full reload). Asserts that after
// the switch a coverage fetch fired under the NEW lab's id, not the old one.
//
// Env: PW_BASE, PW_TOKEN (multi-lab PT owner), PW_PT_LAB_A (start lab id),
// PW_PT_SWITCH_TO_NAME (substring of the lab to switch to). Skips without them
// so the compile-only smoke gate stays green.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_A = process.env.PW_PT_LAB_A || "";
const TO_NAME = process.env.PW_PT_SWITCH_TO_NAME || "";

test.describe("VeritaPT — lab switch reloads the new lab's data", () => {
  test("switching labs refetches PT coverage under the new lab id", async ({ page }) => {
    if (!TOKEN || !LAB_A || !TO_NAME) {
      test.skip(true, "Needs PW_TOKEN + PW_PT_LAB_A + PW_PT_SWITCH_TO_NAME.");
      return;
    }
    // Every lab-scoped PT coverage fetch, as /api/labs/<id>/pt/coverage.
    const coverageCalls: string[] = [];
    page.on("request", r => {
      const m = r.url().match(/\/api\/labs\/(\d+)\/pt\/coverage/);
      if (m) coverageCalls.push(m[1]);
    });

    await page.setViewportSize({ width: 1400, height: 950 });
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_A}/veritapt/app`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    // Lab A loaded its own coverage.
    expect(coverageCalls, "lab A coverage fetched on load").toContain(LAB_A);

    // Clear history, then switch labs via the top-bar switcher (the real path).
    coverageCalls.length = 0;
    await page.getByTestId("lab-switcher").click();
    await page.getByRole("menuitem").filter({ hasText: new RegExp(TO_NAME, "i") }).first().click();
    await page.waitForTimeout(4000);

    // The switch must have triggered a coverage fetch under a DIFFERENT lab id.
    expect(page.url()).not.toContain(`/labs/${LAB_A}/`);
    const switchedToOther = coverageCalls.some(id => id !== LAB_A);
    expect(
      switchedToOther,
      `after switch, PT coverage refetched under the new lab (saw calls: ${JSON.stringify(coverageCalls)})`
    ).toBeTruthy();
  });
});
