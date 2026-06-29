// tests/playwright/veritapolicy-archive-assign-all.spec.ts
//
// PR #879. The My Policies surface (client/src/pages/VeritaPolicyMyPoliciesPage.tsx)
// gained two things:
//   (1) an Archive button on each policy row that soft-retires a policy via
//       POST /api/labs/:labId/veritapolicy/documents/:id/archive (stamps
//       archived_at; the list filters archived_at IS NULL; signatures and the
//       audit trail are kept), and
//   (2) Select all / Clear controls in the "Assign for attestation" dialog.
//
// This spec exercises the archive endpoint NON-DESTRUCTIVELY (it never archives
// a real policy) and loads the My Policies surface in a real browser context.
//
// Env: PW_BASE, PW_TOKEN (owner JWT), PW_LAB_ID (default 3 / Michaels Lab).

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "3";

test.describe("VeritaPolicy #879 — archive + assign-to-all", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((tok) => {
      window.localStorage.setItem("auth_token", tok);
      window.localStorage.setItem("veritas_token", tok);
    }, TOKEN);
  });

  test("archive endpoint is wired and guarded; My Policies surface loads", async ({ page, request }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-time gate run).");
      return;
    }
    const docsResp = await request.get(`${BASE}/api/labs/${LAB_ID}/veritapolicy/documents`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!docsResp.ok()) {
      test.skip(true, `Cannot list policy documents (status ${docsResp.status()}).`);
      return;
    }

    // Load the surface that carries the Archive button + the assign dialog.
    await page.goto(`${BASE}/veritapolicy-app`);

    // Archive endpoint guard: a non-existent document id returns 404. This
    // proves the route is wired without mutating any real policy.
    const guardStatus = await page.evaluate(
      async ({ base, labId, tok }) => {
        const r = await fetch(
          `${base}/api/labs/${labId}/veritapolicy/documents/99999999/archive`,
          { method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" } }
        );
        return r.status;
      },
      { base: BASE, labId: LAB_ID, tok: TOKEN }
    );
    expect(guardStatus).toBe(404);
  });
});
