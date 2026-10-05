// tests/playwright/veritadc-cfr-reference.spec.ts
//
// Gate 3 browser evidence for the VeritaDC "CFR Reference" read-only view (#30).
// A new tab in the VeritaPolicy module lists the verbatim CFR text behind the
// compliance crosswalk (CFR rows only, never accreditor paraphrase) and shows
// the operator-approved plain-language summary beside the sections that have one.
//
// Env: PW_BASE, PW_TOKEN, PW_DC_LAB. Skips without them so the compile-only
// smoke gate stays green.
//
// Manually exercised end-to-end on a local throwaway lab on 2026-10-04: the
// "CFR Reference" tab renders, groups by chapter, dedupes repeated sections
// (e.g. 493.2 shows once), surfaces "5 sections with a plain-language summary",
// renders the "IN PLAIN LANGUAGE" callout on 493.1252/1253/1235/1281/1289 above
// the verbatim text, search filters, and dark mode is clean.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_DC_LAB || "";

test.describe("VeritaDC - CFR Reference view", () => {
  test("the CFR Reference tab renders citations with plain-language summaries", async ({ page }) => {
    if (!TOKEN || !LAB) {
      test.skip(true, "Needs PW_TOKEN + PW_DC_LAB.");
      return;
    }
    await page.setViewportSize({ width: 1400, height: 950 });
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB}/veritapolicy-app/cfr-reference`, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "CFR Reference" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("cfr-sections")).toBeVisible();
    // Filter to a section that carries an approved summary and assert the callout.
    await page.getByTestId("cfr-search").fill("493.1253");
    await expect(page.getByText(/IN PLAIN LANGUAGE/i).first()).toBeVisible();
  });
});
