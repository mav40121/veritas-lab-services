// tests/playwright/veritacheck-coverage.spec.ts
//
// Gate 3 smoke for the VeritaCheck Coverage page (PR B). Non-mutating: confirms
// the dashboard entry point and the Coverage page render for an authenticated
// lab user. The exemption-toggle mutation is covered server-side by
// scripts/verify-veritacheck-coverage.mts. Needs PW_TOKEN; skips otherwise so it
// stays green in the compile-only CI gate.
//
// Env: PW_BASE (default production www), PW_TOKEN (a lab user with VeritaCheck).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("VeritaCheck Coverage", () => {
  test("dashboard entry point + coverage page render", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);

    const labIds: number[] = await page.evaluate(async ([b, t]) => {
      try {
        const r = await fetch(`${b}/api/labs/me`, { headers: { Authorization: `Bearer ${t}` } });
        if (!r.ok) return [];
        const d = await r.json();
        const arr = Array.isArray(d) ? d : (d.labs || d.memberships || []);
        return arr.map((m: any) => Number(m.labId ?? m.lab_id ?? m.id)).filter((x: number) => Number.isFinite(x));
      } catch { return []; }
    }, [BASE, TOKEN] as const);

    if (labIds.length === 0) {
      test.skip(true, "PW_TOKEN user has no labs.");
      return;
    }
    const labId = labIds[0];

    await page.goto(`${BASE}/labs/${labId}/dashboard`);
    await expect(page.getByRole("link", { name: /Coverage/i }).first()).toBeVisible();

    await page.goto(`${BASE}/labs/${labId}/veritacheck/coverage`);
    await expect(page.getByRole("heading", { name: /Coverage/i })).toBeVisible();
    // Refinements PR: the downloadable report button is present.
    await expect(page.getByRole("button", { name: /Download report/i })).toBeVisible();

    // Sort PR: the Cal Ver / Linearity table can be sorted by Instrument (and
    // Analyte / Status). The sortable header renders and clicking it re-orders
    // without error (first data-cell text may change).
    const sortInstrument = page.getByTestId("cov-sort-instrument");
    await expect(sortInstrument).toBeVisible();
    await sortInstrument.click();
    await expect(page.getByTestId("cov-sort-analyte")).toBeVisible();

    // Badge-distinction PR: "Missing" (no study) and "Failed"/"FAIL" (study on
    // file, verdict FAIL) must not render as the same chip. Missing is a hollow
    // red OUTLINE; a documented failure is a SOLID red (destructive) chip. When
    // both states are present, assert they carry different background treatments.
    const missingBadge = page.locator('div', { hasText: /^Missing$/ }).last();
    const failBadge = page.locator('div').filter({ hasText: /\bFAIL(ED)?\b/ }).last();
    if ((await missingBadge.count()) > 0 && (await failBadge.count()) > 0) {
      const missingBg = await missingBadge.evaluate((el) => getComputedStyle(el).backgroundColor);
      const failBg = await failBadge.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(missingBg).not.toBe(failBg); // solid destructive vs transparent outline
    }
  });
});
