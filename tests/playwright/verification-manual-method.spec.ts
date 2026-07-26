// tests/playwright/verification-manual-method.spec.ts
//
// Gate 3 for the manual-method attestation (2026-07-24, Longstreth): on a
// Performance Element, the director can attest it was completed by a manual
// method and passed, with a note + evidence URL, instead of running a computed
// study. Drives the real browser flow on a throwaway 1-analyte workbook, then
// deletes it. The PDF rendering is covered by scripts/verify-manual-method.mts.
//
// Needs creds: PW_TOKEN + PW_LAB_ID. Skips cleanly without them.
// Run: PW_TOKEN=... PW_LAB_ID=3 npx playwright test verification-manual-method

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";

test.describe("VeritaCheck verification: manual-method attestation", () => {
  test("attesting an element by manual method shows the attested PASS state", async ({ page, request }) => {
    test.skip(!TOKEN || !LAB_ID, "PW_TOKEN + PW_LAB_ID required");
    const auth = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

    const created = await request.post(`${BASE}/api/labs/${LAB_ID}/veritacheck/verifications`, {
      headers: auth,
      data: { instrument_name: "ZZ manual-method spec (delete me)", trigger_type: "new_instrument", elements: ["precision", "carryover"] },
    });
    expect(created.ok()).toBeTruthy();
    const vid = (await created.json()).id as number;

    try {
      const a = await request.post(`${BASE}/api/veritacheck/verifications/${vid}/analytes`, { headers: auth, data: { analyte_name: "MSpec" } });
      expect(a.ok()).toBeTruthy();

      await injectAuth(page, BASE, TOKEN);
      await page.goto(`${BASE}/labs/${LAB_ID}/dashboard/verifications?verification=${vid}`, { waitUntil: "networkidle" });

      const row = page.getByTestId("analyte-slot-precision-MSpec");
      await expect(row).toBeVisible({ timeout: 15000 });

      // Open the manual-method form, fill it, attest.
      await row.getByRole("button", { name: "Manual method" }).click();
      await row.getByPlaceholder(/Attestation note/i).fill("Verified against 20 concurrent manual diffs; within CLSI H20 limits.");
      await row.getByPlaceholder(/Evidence link/i).fill("https://example.com/evidence/manual-diff");
      await row.getByRole("button", { name: "Attest passed by manual method" }).click();

      // The row now shows the attested PASS state and the note.
      await expect(row.getByText("PASS (attested)")).toBeVisible({ timeout: 10000 });
      await expect(row.getByText(/within CLSI H20 limits/)).toBeVisible();

      // Server persisted it as a manual-method slot (not a computed study).
      const got = await request.get(`${BASE}/api/veritacheck/verifications/${vid}`, { headers: auth });
      const studies = (await got.json()).studies as any[];
      const slot = studies.find(s => s.element === "precision" && s.analyte === "MSpec");
      expect(slot?.manual_method).toBe(1);
      expect(slot?.study_id).toBeFalsy();
      expect(slot?.passed).toBe(1);
    } finally {
      await request.delete(`${BASE}/api/veritacheck/verifications/${vid}`, { headers: auth });
    }
  });
});
