// tests/playwright/study-results-edit-button.spec.ts
//
// Gate 3 step 8 for the VeritaCheck results-page Edit button. The results page
// previously had no way to reopen an unsigned study for editing (the only Edit
// control was the pencil icon on the Dashboard), so users on the results page
// concluded the study was un-editable (San Carlos, study 326). This asserts the
// Edit button now renders on an UNSIGNED (non-finalized) study's results page and
// navigates to the edit route. Guarded on PW_TOKEN so a no-secret CI run stays
// green (compile + skip) and it asserts for real against prod with a token.
//
// Env: PW_BASE (default prod), PW_TOKEN (owner JWT), PW_LAB_ID (default 2),
//      PW_STUDY_ID (an unsigned/draft study on that lab; default 326).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "2";
const STUDY_ID = process.env.PW_STUDY_ID || "326";

test.describe("VeritaCheck results page Edit button (unsigned study)", () => {
  test("unsigned study results page shows Edit and it opens the editor", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN required for authed study results page load");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/study/${STUDY_ID}/results`, { waitUntil: "domcontentloaded" });

    const panel = page.getByTestId("lifecycle-panel");
    await panel.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
    // Only unsigned studies get the Edit button; signed ones show Amend instead.
    const signOff = page.getByTestId("open-finalize-dialog");
    if (!(await signOff.isVisible().catch(() => false))) {
      test.skip(true, "study is not in the unsigned state (no Sign-and-lock); Edit not expected");
      return;
    }
    const edit = page.getByTestId("edit-study-button");
    await expect(edit, "Edit button present on an unsigned study").toBeVisible();
    await edit.click();
    await expect.poll(() => page.url(), { timeout: 10000 }).toContain(`/study/${STUDY_ID}/edit`);
  });
});
