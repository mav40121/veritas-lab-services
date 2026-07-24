// tests/playwright/verification-per-analyte.spec.ts
//
// Guard for per-analyte study linking (2026-07-24, Longstreth): the Performance
// Elements tab renders one Run/Link row PER ANALYTE under each element, while
// carryover stays a single instrument-wide row. Creates a throwaway workbook
// with two analytes, asserts the rows, and deletes it.
//
// Needs creds: PW_TOKEN + PW_LAB_ID (a lab the token can write to). Skips cleanly.
// Run: PW_TOKEN=... PW_LAB_ID=3 npx playwright test verification-per-analyte

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";

test.describe("VeritaCheck verification: per-analyte study rows", () => {
  test("each element shows a row per analyte; carryover stays instrument-wide", async ({ page, request }) => {
    test.skip(!TOKEN || !LAB_ID, "PW_TOKEN + PW_LAB_ID required");
    const auth = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

    // Throwaway workbook with a per-analyte element (precision) + carryover.
    const created = await request.post(`${BASE}/api/labs/${LAB_ID}/veritacheck/verifications`, {
      headers: auth,
      data: { instrument_name: "ZZ per-analyte spec (delete me)", trigger_type: "new_instrument", elements: ["precision", "carryover"] },
    });
    expect(created.ok()).toBeTruthy();
    const vid = (await created.json()).id as number;

    try {
      // Two analytes -> server seeds a precision slot for each.
      for (const name of ["SpecA", "SpecB"]) {
        const r = await request.post(`${BASE}/api/veritacheck/verifications/${vid}/analytes`, { headers: auth, data: { analyte_name: name } });
        expect(r.ok()).toBeTruthy();
      }

      await injectAuth(page, BASE, TOKEN);
      await page.goto(`${BASE}/labs/${LAB_ID}/dashboard/verifications?verification=${vid}`, { waitUntil: "networkidle" });

      // Performance Elements tab (default): precision shows one row per analyte.
      await expect(page.getByTestId("analyte-slot-precision-SpecA")).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId("analyte-slot-precision-SpecB")).toBeVisible();
      // Each per-analyte row has its own Run button.
      await expect(page.getByTestId("analyte-run-precision-SpecA")).toBeVisible();
      await expect(page.getByTestId("analyte-run-precision-SpecB")).toBeVisible();
      // Carryover is instrument-wide: it does NOT get per-analyte rows.
      await expect(page.getByTestId("analyte-slot-carryover-SpecA")).toHaveCount(0);
    } finally {
      await request.delete(`${BASE}/api/veritacheck/verifications/${vid}`, { headers: auth });
    }
  });
});
