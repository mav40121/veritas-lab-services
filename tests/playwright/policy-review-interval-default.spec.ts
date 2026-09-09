// tests/playwright/policy-review-interval-default.spec.ts
//
// Gate 3 step 8 guard for the VeritaPolicy biennial-default + MA-annual change.
//  - Contract: /api/labs/me exposes defaultReviewIntervalMonths on every
//    membership, and it is one of the two allowed cadences (24 biennial floor,
//    12 annual exception). This is what the upload dialog seeds its picker from.
//  - UI: on the My Policies page, opening the Upload dialog shows the interval
//    picker defaulted to that lab's value (e.g. "24 months" for a non-MA lab),
//    not the old hardcoded 12.
//
// Authenticated path runs against prod with PW_TOKEN (+ optional PW_LAB_ID for
// the UI leg). Skips cleanly without a token so the compile-only smoke gate and
// no-secret runs stay green.
//
// Env: PW_BASE (default production www), PW_TOKEN (owner JWT), PW_LAB_ID.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";

test.describe("VeritaPolicy — review-interval default (biennial / MA-annual)", () => {
  test("/api/labs/me exposes a 12-or-24 defaultReviewIntervalMonths per lab", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    const labs: { labId: number; def: unknown }[] = await page.evaluate(async ([b, t]) => {
      const r = await fetch(`${b}/api/labs/me`, { headers: { Authorization: `Bearer ${t}` } });
      if (!r.ok) return [];
      const d = await r.json();
      const arr = Array.isArray(d) ? d : (d.labs || d.memberships || []);
      return arr.map((m: any) => ({ labId: Number(m.labId ?? m.lab_id), def: m.defaultReviewIntervalMonths }));
    }, [BASE, TOKEN] as const);

    expect(labs.length, "token exposes at least one lab").toBeGreaterThan(0);
    for (const l of labs) {
      expect(
        [12, 24],
        `lab ${l.labId} defaultReviewIntervalMonths is the biennial floor or the annual exception`
      ).toContain(l.def);
    }
  });

  test("upload dialog seeds the interval picker to the lab default (not hardcoded 12)", async ({ page }) => {
    if (!TOKEN || !LAB_ID) {
      test.skip(true, "No PW_TOKEN / PW_LAB_ID provided; skipping authenticated UI leg.");
      return;
    }
    await injectAuth(page, BASE, TOKEN);

    // The expected default for this lab, straight from the same API the UI reads.
    const expected: number | null = await page.evaluate(async ([b, t, id]) => {
      const r = await fetch(`${b}/api/labs/me`, { headers: { Authorization: `Bearer ${t}` } });
      if (!r.ok) return null;
      const d = await r.json();
      const arr = Array.isArray(d) ? d : (d.labs || d.memberships || []);
      const m = arr.find((x: any) => Number(x.labId ?? x.lab_id) === Number(id));
      return m ? Number(m.defaultReviewIntervalMonths ?? 24) : null;
    }, [BASE, TOKEN, LAB_ID] as const);
    expect(expected, "lab is visible to the token").not.toBeNull();

    await page.goto(`${BASE}/labs/${LAB_ID}/veritapolicy-app/my-policies`);
    // Open the Upload dialog (button label may vary slightly; match "Upload").
    const uploadBtn = page.getByRole("button", { name: /upload/i }).first();
    await uploadBtn.click({ timeout: 10000 }).catch(() => {});
    // The interval control sits under the "Review interval (months)" label; its
    // shadcn trigger renders the selected value as "<n> months".
    await expect(
      page.getByText(`${expected} months`, { exact: false }).first(),
      `interval picker defaults to ${expected} months`
    ).toBeVisible({ timeout: 8000 });
  });
});
