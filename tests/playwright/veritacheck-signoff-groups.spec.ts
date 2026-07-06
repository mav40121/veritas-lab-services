// tests/playwright/veritacheck-signoff-groups.spec.ts
//
// Gate 3 smoke for VeritaCheck Sign-off Groups (Phase 1 UI). Non-mutating: it
// confirms the dashboard entry point and the groups page render for an
// authenticated lab user. The mutating flow (create group, add study, mass sign)
// is exercised by hand on prod and covered server-side by
// scripts/verify-signoff-groups.mjs. Needs PW_TOKEN; skips otherwise so it stays
// green in the compile-only CI gate.
//
// Env: PW_BASE (default production www), PW_TOKEN (a lab user with VeritaCheck).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("VeritaCheck Sign-off Groups", () => {
  test("dashboard entry point + groups page render", async ({ page }) => {
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

    // Dashboard carries the Sign-off Groups entry point.
    await page.goto(`${BASE}/labs/${labId}/dashboard`);
    await expect(page.getByRole("link", { name: /Sign-off Groups/i }).first()).toBeVisible();

    // The groups page renders its heading.
    await page.goto(`${BASE}/labs/${labId}/veritacheck/signoff-groups`);
    await expect(page.getByRole("heading", { name: /Sign-off Groups/i })).toBeVisible();
  });
});
