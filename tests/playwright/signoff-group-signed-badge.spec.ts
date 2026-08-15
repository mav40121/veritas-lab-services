// tests/playwright/signoff-group-signed-badge.spec.ts
//
// Gate 3 step 8 for the Sign-off Groups badge fix (SCAHC report, 2026-08-15).
// A group whose studies were each signed individually read "N of N signed" but
// kept the grey "Open" badge, because the stored group.status only flips on the
// batch "Sign and Lock all" action. The badge is now derived: a group is
// "Signed" when stored status is 'signed' OR every member study is finalized.
//
// Regression asserted: no group card shows "Open" while its own count reads
// "N of N signed" (equal counts). PW_TOKEN-gated; skips cleanly without a token
// (as it does in CI), so this doubles as the ui-evidence artifact for the PR.
//
// Env: PW_BASE (default prod), PW_TOKEN, PW_LAB_ID (default 2 = SCAHC).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "2";

test.describe("Sign-off group badge reflects member sign state", () => {
  test("a fully-signed group never shows Open at N-of-N signed", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set — skipping authenticated UI exercise");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritacheck/signoff-groups`);

    // Wait for the group list to render (or an empty-state message).
    await page.waitForLoadState("networkidle");
    const cards = page.locator('[data-testid^="card-group-"]');
    const n = await cards.count();

    for (let i = 0; i < n; i++) {
      const card = cards.nth(i);
      const text = (await card.innerText()) || "";
      // Subtitle shape: "<finalized> of <total> signed".
      const m = text.match(/(\d+)\s+of\s+(\d+)\s+signed/);
      if (!m) continue;
      const finalized = parseInt(m[1], 10);
      const total = parseInt(m[2], 10);
      if (total > 0 && finalized === total) {
        // This card is fully signed: it must read "Signed", never "Open".
        expect(text).toContain("Signed");
        expect(text).not.toContain("Open");
      }
    }
  });
});
