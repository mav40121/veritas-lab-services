// tests/playwright/study-archive-lifecycle.spec.ts
//
// Gate 3 step 8 receipt for the VeritaCheck Archive UI (Sign-Off / Amendment /
// Archive, Phase 1 PR 3). Exercises the real authenticated browser flow:
//   - Study Dashboard shows an Active / Archived view toggle.
//   - On a study results page, an Archive button opens a reason-required dialog.
//   - Archiving stamps an "Archived" badge, drops the study off the Active
//     dashboard list, and surfaces it under the Archived view.
//   - Restore from archive returns it to the Active list.
//
// The flow is self-cleaning: it archives the provided study, verifies, then
// restores it, so it can run repeatedly against the same demo-lab study.
//
// Env:
//   PW_BASE   default https://www.veritaslabservices.com
//   PW_TOKEN  bearer for a demo-lab user (seat or owner). Without it the
//             authenticated tests skip (matches the CI compile-only gate).
//   PW_STUDY_ID  a NON-archived study id in that lab to round-trip.
//
// Run: PW_BASE=... PW_TOKEN=... PW_STUDY_ID=... npx playwright test study-archive-lifecycle

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const STUDY_ID = process.env.PW_STUDY_ID || "";
// When the study lives in a specific lab (multi-lab accounts whose default
// active lab differs), drive the lab-scoped routes so the study resolves
// regardless of which lab the NavBar switcher defaults to.
const LAB_ID = process.env.PW_LAB_ID || "";
const studyResultsPath = (id: string) => (LAB_ID ? `/labs/${LAB_ID}/study/${id}/results` : `/study/${id}/results`);
const dashboardPath = () => (LAB_ID ? `/labs/${LAB_ID}/dashboard` : `/dashboard`);

test.describe("VeritaCheck Archive UI", () => {
  test("Study Dashboard exposes an Active / Archived view toggle", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN required for the authenticated dashboard");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}${dashboardPath()}`);
    await expect(page.getByTestId("toggle-active-studies")).toBeVisible({ timeout: 15000 });
    const archivedTab = page.getByTestId("toggle-archived-studies");
    await expect(archivedTab).toBeVisible();
    // Switching to Archived must not error: either archived cards render or the
    // empty-state ("No archived studies") shows. Both are acceptable.
    await archivedTab.click();
    await expect(
      page.getByTestId("back-to-active-empty").or(page.locator('[data-testid^="badge-archived-"]').first()),
    ).toBeVisible({ timeout: 15000 });
  });

  test("Archive a study (reason required), see the badge, then restore it", async ({ page }) => {
    test.skip(!TOKEN || !STUDY_ID, "PW_TOKEN + PW_STUDY_ID required for the round-trip");
    await injectAuth(page, BASE, TOKEN);

    // 1) Open the study results page; the Archive control must be present.
    await page.goto(`${BASE}${studyResultsPath(STUDY_ID)}`);
    await expect(page.getByTestId("lifecycle-panel")).toBeVisible({ timeout: 15000 });
    const archiveBtn = page.getByTestId("open-archive-button");
    const restoreBtn = page.getByTestId("open-unarchive-button");

    // If a prior run left it archived, restore first so this run starts clean.
    if (await restoreBtn.isVisible().catch(() => false)) {
      await restoreBtn.click();
      await page.getByTestId("study-unarchive-confirm").click();
      await expect(archiveBtn).toBeVisible({ timeout: 15000 });
    }

    // 2) Archive requires a reason: confirm is disabled until reason is typed.
    await archiveBtn.click();
    await expect(page.getByTestId("study-archive-dialog")).toBeVisible();
    const confirm = page.getByTestId("study-archive-confirm");
    await expect(confirm).toBeDisabled();
    await page.getByTestId("study-archive-reason").fill("Playwright archive lifecycle check");
    await expect(confirm).toBeEnabled();
    await confirm.click();

    // 3) The page reflects the archived state: badge + Restore control.
    await expect(page.getByTestId("badge-archived")).toBeVisible({ timeout: 15000 });
    await expect(restoreBtn).toBeVisible();

    // 4) It is gone from the Active dashboard and present under Archived.
    await page.goto(`${BASE}${dashboardPath()}`);
    await expect(page.getByTestId("toggle-active-studies")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId(`card-study-${STUDY_ID}`)).toHaveCount(0);
    await page.getByTestId("toggle-archived-studies").click();
    await expect(page.getByTestId(`badge-archived-${STUDY_ID}`)).toBeVisible({ timeout: 15000 });

    // 5) Restore (cleanup) and confirm it returns to the Active list.
    await page.goto(`${BASE}${studyResultsPath(STUDY_ID)}`);
    await page.getByTestId("open-unarchive-button").click();
    await page.getByTestId("study-unarchive-confirm").click();
    await expect(page.getByTestId("open-archive-button")).toBeVisible({ timeout: 15000 });
    await page.goto(`${BASE}${dashboardPath()}`);
    await expect(page.getByTestId(`card-study-${STUDY_ID}`)).toBeVisible({ timeout: 15000 });
  });
});
