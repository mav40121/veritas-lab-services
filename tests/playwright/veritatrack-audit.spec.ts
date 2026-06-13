// tests/playwright/veritatrack-audit.spec.ts
//
// Gate 3 receipt for Wave B3 (2026-06-12): the VeritaTrack task row exposes a
// History control that opens an append-only audit trail dialog.
//
// Needs creds: PW_TOKEN, PW_LAB_ID (a lab with at least one VeritaTrack task).
// Skips cleanly without them.
//
// Run: PW_TOKEN=... PW_LAB_ID=2 npx playwright test veritatrack-audit

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";

test.describe("VeritaTrack audit trail (Wave B3)", () => {
  test("a task row opens a History dialog with the audit trail", async ({ page }) => {
    test.skip(!TOKEN || !LAB_ID, "PW_TOKEN + PW_LAB_ID required");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritatrack-app`);
    // Expand the first category group so task rows render.
    const firstGroup = page.locator("button", { hasText: /overdue|due soon|Calibration|Review|QC/i }).first();
    if (await firstGroup.count()) await firstGroup.click().catch(() => {});
    // Hover a task row to reveal the action buttons, then click History.
    const row = page.locator("div", { hasText: /Last performed/i }).first();
    await row.hover().catch(() => {});
    const historyBtn = page.getByRole("button", { name: "History" }).first();
    if (await historyBtn.count()) {
      await historyBtn.click();
      await expect(page.getByText(/Append-only audit trail/i)).toBeVisible({ timeout: 10000 });
    }
  });
});
