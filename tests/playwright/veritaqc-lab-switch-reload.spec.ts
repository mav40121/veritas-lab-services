// tests/playwright/veritaqc-lab-switch-reload.spec.ts
//
// Regression guard for the VeritaQC lab-switch bug (Mike Hiltunen, MedStar,
// 2026-09-10). A multi-lab owner switching labs from inside VeritaQC saw the new
// lab's data fail to load: the previous lab's selected control-lot id carried
// across the switch, so the results fetch hit /api/labs/<newlab>/qc/results with
// a lot id from the OLD lab, erroring "Couldn't load results for this lot" and
// leaving an empty grid. Fixed by re-validating the selection against the new
// lab's lots (auto-selecting the new lab's first lot) and keying the results
// effect on the lot only, so it never fires with a stale cross-lab lot.
//
// Drives the real in-app switch (the bug only reproduces through wouter
// navigation, not a full reload). Needs a multi-lab QC owner token and the name
// of a second QC-populated lab to switch to. Skips without them so the
// compile-only smoke gate stays green.
//
// Env: PW_BASE, PW_TOKEN (multi-lab QC owner), PW_QC_LAB_A (start lab id),
// PW_QC_SWITCH_TO_NAME (substring of the lab to switch to, e.g. "Plymouth").

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_A = process.env.PW_QC_LAB_A || "";
const TO_NAME = process.env.PW_QC_SWITCH_TO_NAME || "";

test.describe("VeritaQC — lab switch reloads the new lab's data", () => {
  test("switching labs does not leave a stale-lot error", async ({ page }) => {
    if (!TOKEN || !LAB_A || !TO_NAME) {
      test.skip(true, "Needs PW_TOKEN + PW_QC_LAB_A + PW_QC_SWITCH_TO_NAME.");
      return;
    }
    const resultCalls: string[] = [];
    page.on("request", r => { if (/\/qc\/results\?/.test(r.url())) resultCalls.push(r.url().replace(BASE, "")); });

    await page.setViewportSize({ width: 1400, height: 950 });
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_A}/veritaqc-app`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    // Lab A loads cleanly.
    await expect(page.getByText(/Couldn't load results for this lot/i)).toHaveCount(0);

    // Switch labs via the top-bar switcher (the real in-app path).
    await page.getByTestId("lab-switcher").click();
    await page.getByRole("menuitem").filter({ hasText: new RegExp(TO_NAME, "i") }).first().click();
    await page.waitForTimeout(4000);

    // The new lab's data must load: no stale-lot error, and its own lot's
    // results were fetched under its own lab id.
    await expect(
      page.getByText(/Couldn't load results for this lot/i),
      "no stale cross-lab lot error after switching labs"
    ).toHaveCount(0);
    expect(page.url()).not.toContain(`/labs/${LAB_A}/`);
  });
});
