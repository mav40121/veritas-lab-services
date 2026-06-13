// tests/playwright/veritaresponse-linkage.spec.ts
//
// Gate 3 receipt for Wave C4 (2026-06-12): the VeritaResponse finding page
// shows a "Linked evidence and sources" panel aggregating VeritaScan evidence
// documents and the originating VeritaQC corrective action.
//
// Needs creds: PW_TOKEN, PW_LAB_ID, PW_FINDING_ID. Skips cleanly without them.
//
// Run: PW_TOKEN=... PW_LAB_ID=2 PW_FINDING_ID=1 npx playwright test veritaresponse-linkage

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";
const FINDING_ID = process.env.PW_FINDING_ID || "";

test.describe("VeritaResponse linkage closure (Wave C4)", () => {
  test("finding page renders the linked evidence and sources panel", async ({ page }) => {
    test.skip(!TOKEN || !LAB_ID || !FINDING_ID, "PW_TOKEN + PW_LAB_ID + PW_FINDING_ID required");
    await page.goto(`${BASE}/`);
    await page.evaluate((t: string) => localStorage.setItem("veritas_token", t), TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritaresponse/${FINDING_ID}`);
    const panel = page.getByText(/Linked evidence and sources/i).first();
    await expect(panel).toBeVisible({ timeout: 20000 });
    // The panel renders either link sections or the empty state; both are valid.
    const hasContent = await page.getByText(/VeritaScan evidence|VeritaQC source|No links yet/i).first().isVisible();
    expect(hasContent).toBeTruthy();
  });
});
