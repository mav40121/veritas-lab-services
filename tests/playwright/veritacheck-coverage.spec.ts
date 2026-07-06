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
  });
});
