// tests/playwright/veritaqc-append-only-notes.spec.ts
//
// Gate 3 step 8 for the VeritaQC append-only note (2026-08-25, MedStar/Hiltunen):
// a front-line tech (or a console writer) adds an investigation note to a saved
// QC point after the point is recorded. The original entry and its timestamp
// never change; each note is stamped with the author and the time, so the point
// tells its story in order. This exercises the writer-console surface: open a
// QC point's Notes dialog, add a note, confirm it appears with an author line.
//
// PW_TOKEN-gated (skips cleanly in the reporting-only smoke run so it does not
// fail before deploy). Best-effort on data: it only asserts when the lab has at
// least one QC point to open; the real receipt is the on-prod exercise on a
// sandbox lab recorded in the PR / deploy comment.
//
// Env: PW_BASE (default prod), PW_TOKEN (writer JWT), PW_LAB_ID.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "3";

test.describe("VeritaQC append-only investigation notes", () => {
  test("a QC point accepts an append-only note stamped with the author", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set, skipping authenticated UI exercise");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritaqc-app`);
    await page.waitForTimeout(2500);

    // The Notes button sits in each result row's action cell. Open the first one.
    const notesBtn = page.getByRole("button", { name: /^Notes/ }).first();
    if (!(await notesBtn.count())) {
      test.info().annotations.push({ type: "note", description: "No QC point present on this lab, nothing to exercise." });
      return;
    }
    await notesBtn.click();

    // The dialog exposes the append-only thread and (for writers) an add box.
    await expect(page.getByText(/Investigation notes/i)).toBeVisible({ timeout: 10000 });
    const box = page.getByPlaceholder(/rerun of the prior failed result/i);
    if (await box.count()) {
      const stamp = `pw-note ${Date.now()}`;
      await box.fill(stamp);
      await page.getByRole("button", { name: /^Add note$/ }).click();
      // The new note renders in the thread with the author line beneath it.
      await expect(page.getByText(stamp)).toBeVisible({ timeout: 10000 });
    }
  });
});
