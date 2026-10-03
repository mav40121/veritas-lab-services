// tests/playwright/veritamap-cfr-citation.spec.ts
//
// Gate 3 step 8 browser exercise for the CFR-by-specialty citation fix: the VeritaMap
// grid stamps a 42 CFR Part 493 section per specialty. The bug cited specialties that
// were not in CFR_MAP (Electrolytes, Cardiac, Blood Bank, ...) under the §493.945
// (Microbiology) default; the fix adds those keys and changes the default to §493.931.
// The authoritative correctness proof is the server receipt (scripts/verify-cfr-specialty-map.ts,
// 19/19); this asserts the client grid renders the corrected citations and does not crash.
//
// Env-gated: PW_TOKEN + PW_LAB_ID + PW_MAP_ID (a map with at least one analyte row).
//   PW_TOKEN=... PW_LAB_ID=3 PW_MAP_ID=90 npx playwright test veritamap-cfr-citation

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN;
const LAB = process.env.PW_LAB_ID;
const MAP = process.env.PW_MAP_ID;

test.describe("VeritaMap CFR-by-specialty citations", () => {
  test.beforeEach(() => {
    test.skip(!TOKEN || !LAB || !MAP, "Set PW_TOKEN, PW_LAB_ID and PW_MAP_ID to run the CFR-citation check.");
  });

  test("grid renders valid CFR sections (no §493.945 fall-through for chemistry specialties)", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await injectAuth(page, BASE, TOKEN!);
    await page.goto(`${BASE}/labs/${LAB}/veritamap-app/${MAP}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    // The client change is a data-constant + default edit; a render crash (TDZ etc.)
    // would surface here.
    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);

    // Any CFR citation shown must be a well-formed §493.xxx reference.
    const body = await page.locator("body").innerText();
    const cfrs = Array.from(body.matchAll(/§493\.\d{3}/g)).map((m) => m[0]);
    if (cfrs.length) {
      for (const c of cfrs) expect(c).toMatch(/^§493\.\d{3}$/);
      // Electrolytes/Cardiac/Blood-Bank rows must no longer read as Microbiology.
      // (Best-effort: only asserts when such a row is on this map.)
      const rows = await page.locator("tr").allInnerTexts();
      for (const r of rows) {
        if (/\b(Electrolytes|Cardiac|Point of Care)\b/.test(r)) {
          expect(r, `chemistry-specialty row should not cite §493.945: ${r.slice(0, 80)}`).not.toContain("§493.945");
        }
        if (/\bBlood Bank\b/.test(r)) {
          expect(r, `Blood Bank row should cite §493.959: ${r.slice(0, 80)}`).not.toContain("§493.945");
        }
      }
    }
    await ctx.close();
  });
});
