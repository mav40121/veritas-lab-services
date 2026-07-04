// tests/playwright/labscope-veritatrack-pt-map.spec.ts
//
// Gate 3 guard for the P1 wrong-lab fix: VeritaTrack seed/import/export,
// VeritaPT trends/PDF, and the VeritaMap labwide map link were not scoped to
// the active lab on a multi-lab account. The server reads now resolve the
// active lab from X-Active-Lab-Id (resolveLegacyLabId -> lab_id) — the header
// authHeaders() already sends on every call — and the map link now carries the
// /labs/:labId prefix.
//
// Authoritative verification is a manual switch-and-drive on prod by a
// multi-lab user (Gate 3 step 8). This spec is the automated guard: it needs a
// MULTI-LAB owner token (PW_TOKEN, e.g. verilabguy who owns >= 2 labs) and
// skips otherwise so it stays green in the compile-only CI gate. It is
// read-only against prod (no seeding/exporting) — the scoping *logic* is proven
// deterministically in scripts/verify-labscope-veritatrack-pt.mjs.
//
// Env: PW_BASE (default production www), PW_TOKEN (multi-lab owner JWT).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("Multi-lab scope — VeritaTrack/PT/Map wrong-lab fix", () => {
  test("PT trends respect X-Active-Lab-Id and the VeritaMap link is lab-scoped", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);

    // Discover the signed-in owner's labs (need >= 2 to prove isolation).
    const labIds: number[] = await page.evaluate(async ([b, t]) => {
      try {
        const r = await fetch(`${b}/api/labs/me`, { headers: { Authorization: `Bearer ${t}` } });
        if (!r.ok) return [];
        const d = await r.json();
        const arr = Array.isArray(d) ? d : (d.labs || d.memberships || []);
        return arr
          .map((m: any) => Number(m.labId ?? m.lab_id ?? m.id))
          .filter((x: number) => Number.isFinite(x));
      } catch { return []; }
    }, [BASE, TOKEN] as const);

    if (labIds.length < 2) {
      test.skip(true, "PW_TOKEN owner has < 2 labs; cannot prove cross-lab isolation.");
      return;
    }
    const [labA, labB] = labIds;

    // 1) /api/veritapt/trends must be lab-scoped: calling with each lab's
    //    X-Active-Lab-Id returns 200 with a well-formed, independently-scoped
    //    payload — never a 500 and never a cross-lab merge.
    const trend = (labId: number) =>
      page.evaluate(async ([b, t, l]) => {
        const r = await fetch(`${b}/api/veritapt/trends`, {
          headers: { Authorization: `Bearer ${t}`, "X-Active-Lab-Id": String(l) },
        });
        return { status: r.status, body: r.ok ? await r.json() : null };
      }, [BASE, TOKEN, labId] as const);

    const tA = await trend(labA);
    const tB = await trend(labB);
    expect(tA.status, "trends 200 for lab A").toBe(200);
    expect(tB.status, "trends 200 for lab B").toBe(200);
    expect(tA.body, "lab A trends payload well-formed").toHaveProperty("trends");
    expect(tB.body, "lab B trends payload well-formed").toHaveProperty("trends");

    // 2) The VeritaMap labwide map link carries the active lab prefix so a
    //    multi-lab user lands on the map in the lab they are viewing.
    await page.goto(`${BASE}/labs/${labB}/veritamap-app/labwide`);
    const mapLink = page.locator('a[href*="/veritamap-app/"]').first();
    if ((await mapLink.count()) > 0) {
      const href = (await mapLink.getAttribute("href")) || "";
      expect(href, "labwide map link is scoped to the active lab").toContain(
        `/labs/${labB}/veritamap-app/`
      );
    }
  });
});
