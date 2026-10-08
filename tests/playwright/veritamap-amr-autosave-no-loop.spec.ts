// tests/playwright/veritamap-amr-autosave-no-loop.spec.ts
//
// Gate 3 step 8 evidence for the VeritaMap AMR autosave loop fix (2026-10-07).
// Production incident (Milford, lab 4, map 61, 2026-10-06 evening): an open map
// tab re-PUT every row's AMR values about every 4 seconds, ~1,400 blank writes a
// minute, because the row autosave armed on every prop sync and every successful
// save re-rendered the parent, which rebuilt every row's amrValues object and
// re-synced every row. The same bug produced the load-time "AMR not saved" toast
// cascade while the writes were still failing.
//
// Map detail is auth-gated, so this is compile-only in CI and runs live when
// PW_TOKEN + PW_MAP_URL point at a map with at least one test on at least one
// instrument (PW_BASE may point at a local dev server). It counts every PUT to
// .../amr-values/... the page makes and asserts:
//   1. Loading the map and idling 6 s produces ZERO AMR PUTs.
//   2. Typing one AMR Low value produces exactly ONE PUT within the debounce.
//   3. Idling 8 s after that save produces NO further PUTs (no loop).
//   4. Typing the AMR High value produces exactly one more PUT.
// Against the pre-fix bundle, step 1 or step 3 fails. That is the point.
// NOTE: this spec WRITES two AMR values into the first row of the target map;
// point PW_MAP_URL only at a QA map, never at a customer lab.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const MAP_URL = process.env.PW_MAP_URL || ""; // e.g. /labs/4/veritamap-app/61

test.describe("VeritaMap: AMR autosave fires once per user edit and never loops", () => {
  test("no PUTs on load, one per edit, none afterwards", async ({ page }) => {
    if (!TOKEN || !MAP_URL) {
      test.skip(true, "PW_TOKEN + PW_MAP_URL not set (compile-only gate run).");
      return;
    }
    test.setTimeout(120_000);
    await injectAuth(page, BASE, TOKEN);

    const puts: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "PUT" && /\/amr-values\//.test(req.url())) puts.push(req.url());
    });

    await page.goto(`${BASE}${MAP_URL}`, { waitUntil: "networkidle" });
    const expand = page.getByTitle("Enter reference range, critical values, AMR").first();
    await expect(expand).toBeVisible({ timeout: 30_000 });

    // 1. Idle after load: hydration must not save anything.
    await page.waitForTimeout(6_000);
    expect(puts.length, `AMR PUTs fired without any user edit:\n${puts.join("\n")}`).toBe(0);

    // Expand the first row so its AMR inputs render, then idle again (expanding
    // hydrates the row's local state from props; that must not save either).
    await expand.click();
    const low = page.getByPlaceholder("Low").first();
    await expect(low).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(4_000);
    expect(puts.length, `AMR PUTs fired on expand (hydration):\n${puts.join("\n")}`).toBe(0);

    // 2. One user edit -> exactly one PUT (debounce is 1.5 s).
    const v1 = (Math.random() * 9 + 0.1).toFixed(2); // unique per run so the fill always changes the field
    await low.fill(v1);
    await expect.poll(() => puts.length, { timeout: 8_000 }).toBe(1);

    // 3. Idle after a successful save: the echo of the saved value must not
    //    re-arm the autosave (this is the loop).
    await page.waitForTimeout(8_000);
    expect(puts.length, `AMR autosave looped after one save:\n${puts.join("\n")}`).toBe(1);

    // 4. A second edit -> exactly one more PUT, and still no loop.
    const high = page.getByPlaceholder("High").first();
    const v2 = (30 + Math.random() * 60).toFixed(1);
    await high.fill(v2);
    await expect.poll(() => puts.length, { timeout: 8_000 }).toBe(2);
    await page.waitForTimeout(6_000);
    expect(puts.length, `AMR autosave looped after the second save:\n${puts.join("\n")}`).toBe(2);

    // The saved indicator shows and no failure is surfaced.
    await expect(page.getByText(/Save failed|not saved/i)).toHaveCount(0);

    // 5. Leave the sandbox as found (sandbox-receipts rule): clear both values
    //    and confirm the map holds no AMR values. A leftover value marks the
    //    Getting Started "reference ranges" step done, which broke
    //    module-howto-progress on every later CI run (2026-10-08).
    await low.fill("");
    await high.fill("");
    const m = MAP_URL.match(/\/labs\/(\d+)\/veritamap-app\/(\d+)/);
    if (m) {
      const [, labId, mapId] = m;
      await expect.poll(async () => page.evaluate(async ([b, l, id]) => {
        const t = localStorage.getItem("veritas_token") || "";
        const r = await fetch(`${b}/api/labs/${l}/veritamap/maps/${id}/amr-values`, { headers: { Authorization: `Bearer ${t}` } });
        const rows = r.ok ? await r.json() : [];
        const list = Array.isArray(rows) ? rows : (rows.items || rows.values || []);
        return list.filter((x: any) => (x.amr_low ?? "") !== "" || (x.amr_high ?? "") !== "").length;
      }, [BASE, labId, mapId]), { timeout: 10_000, message: "AMR values cleared after the test" }).toBe(0);
    }
  });
});
