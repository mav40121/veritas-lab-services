// tests/playwright/lead-capture-content-upgrade.spec.ts
//
// Gate 3 for the lead-capture content-upgrade experiment (handoff 2026-07-29):
// the two TEa resource pages now offer an email-gated "Download the 2026 CLIA
// TEa reference table (PDF)" that reuses /api/newsletter/subscribe with the
// source `upgrade-tea-table`, delivers the PDF, and fires a GA4 lead_capture.
//
// Opt-in (PW_LEADCAP=1) so it does not run against not-yet-deployed prod in CI
// and does not write throwaway subscribers on every smoke run. When enabled it
// drives the real submit and asserts the success state and that the PDF asset
// is reachable. If PW_ADMIN_SECRET is also set, it confirms the subscriber
// landed with the correct `source`.
// Run: PW_LEADCAP=1 [PW_ADMIN_SECRET=...] npx playwright test lead-capture-content-upgrade

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const ENABLED = process.env.PW_LEADCAP === "1";
const ADMIN = process.env.PW_ADMIN_SECRET || "";

const PAGES = [
  "/resources/clia-tea-lookup",
  "/resources/clia-tea-what-lab-directors-dont-know",
];

test.describe("Lead-capture content upgrade (TEa)", () => {
  test("the TEa reference-table PDF asset is served", async ({ request }) => {
    test.skip(!ENABLED, "PW_LEADCAP=1 required (feature must be deployed)");
    const res = await request.get(`${BASE}/clia-tea-reference-2026.pdf`);
    expect(res.ok(), `PDF status ${res.status()}`).toBeTruthy();
    expect((res.headers()["content-type"] || "")).toContain("pdf");
  });

  for (const path of PAGES) {
    test(`capture on ${path} submits, shows success, and records source`, async ({ page, request }) => {
      test.skip(!ENABLED, "PW_LEADCAP=1 required (feature must be deployed)");
      const email = `pw-leadcap-${Date.now()}@example.com`;
      await page.goto(`${BASE}${path}`);
      const box = page.getByTestId("content-upgrade-upgrade-tea-table");
      await expect(box).toBeVisible({ timeout: 15000 });
      await box.getByLabel("Work email").fill(email);
      await box.getByRole("button", { name: /get the free pdf|prefer|download/i }).click();
      await expect(page.getByTestId("content-upgrade-done")).toBeVisible({ timeout: 15000 });

      if (ADMIN) {
        const subs = await request.get(`${BASE}/api/admin/newsletter?secret=${encodeURIComponent(ADMIN)}`);
        expect(subs.ok()).toBeTruthy();
        const rows = await subs.json();
        const mine = (rows.subscribers || rows || []).find((r: any) => r.email === email);
        expect(mine, "subscriber recorded").toBeTruthy();
        expect(mine.source).toBe("upgrade-tea-table");
      }
    });
  }
});
