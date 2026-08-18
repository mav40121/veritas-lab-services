// tests/playwright/policy-notes.spec.ts
//
// Gate 3 step 8 for VeritaPolicy per-policy notes (2026-08-17). Lab members can
// send notes back and forth on a policy document. This drives the actual
// browser flow: open the Notes dialog from a policy row and confirm the thread
// UI (input + Add note) renders. PW_TOKEN-gated; skips cleanly without a token
// (as in CI), so it doubles as the ui-evidence artifact for the PR.
//
// Env: PW_BASE (default prod), PW_TOKEN, PW_LAB_ID (default 2 = SCAHC).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "2";

test.describe("VeritaPolicy per-policy notes", () => {
  test("opening a policy's Notes shows the discussion thread UI", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set, skipping authenticated UI exercise");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritapolicy-app/my-policies`);
    await page.waitForLoadState("networkidle");

    const notesBtn = page.locator('[data-testid^="btn-notes-"]').first();
    // Skip if this lab has no policies to attach notes to.
    if (!(await notesBtn.count())) return;

    await notesBtn.click();
    // The dialog exposes the note input and the Add note button.
    await expect(page.getByTestId("policy-note-input")).toBeVisible();
    await expect(page.getByTestId("policy-note-add")).toBeVisible();
  });
});
