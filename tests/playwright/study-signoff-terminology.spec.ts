// tests/playwright/study-signoff-terminology.spec.ts
//
// Gate 3 receipt + regression guard for the 2026-06-15 "Finalize -> Sign Off"
// lab-facing terminology rename (VeritaCheck Sign-Off/Amendment/Archive Phase 1,
// PR 2). The internal lifecycle_state='finalized', the /finalize route, and the
// finalized_* columns were deliberately kept; only the words the lab reads were
// renamed to "Sign Off / Signed Off" (laboratory director or designee).
//
// The public Study Guide page describes the lifecycle, so it is the no-auth
// surface to assert the rename. The authenticated badge/dialog strings on the
// study results page are exercised in the archive-UI PR's full click-through.
//
// Run: npx playwright test study-signoff-terminology
//      PW_BASE=http://127.0.0.1:4173 npx playwright test study-signoff-terminology

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("VeritaCheck lifecycle reads as 'Sign Off', not 'Finalize'", () => {
  test("/study-guide describes the sign-off lifecycle and drops 'finalized'", async ({ page }) => {
    await page.goto(`${BASE}/study-guide`, { waitUntil: "networkidle" });
    const body = await page.locator("body").innerText();
    expect(body).toContain("Draft, sign off, amend lifecycle");
    expect(body).toContain("draft to signed off");
    expect(body).not.toContain("draft to finalized");
    expect(body).not.toContain("Finalized studies are locked");
  });
});
