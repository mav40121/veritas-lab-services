// tests/playwright/veritabench-lab-scoping.spec.ts
//
// Phase 1 of the operations leverage chain: VeritaBench/Pace (productivity_months)
// and VeritaShift (staffing_studies) now scope their data by the active lab.
// /veritabench has no /labs/:id URL prefix, so each page resolves the active lab
// from the primary-lab membership and sends it as ?labId on the productivity and
// staffing requests. The server dual-writes lab_id and scopes reads to that lab
// (with an account-only fallback when no labId is sent).
//
// This spec asserts the outgoing productivity request carries ?labId. It requires
// PW_TOKEN (an owner JWT; a multi-lab owner makes the scoping meaningful) and skips
// otherwise so it stays green in the compile-only CI gate.
//
// Env: PW_BASE (default production www), PW_TOKEN (owner JWT).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("VeritaBench: operations data is lab-scoped", () => {
  test("productivity request carries ?labId for the active lab", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-time gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);

    await page.goto(`${BASE}/veritabench`);

    // The page may fire an initial account-scoped load before memberships resolve,
    // then a lab-scoped load once the active lab is known. Wait for the scoped one.
    const scopedReq = await page.waitForRequest(
      (r) => r.url().includes("/api/productivity") && /[?&]labId=\d+/.test(r.url()),
      { timeout: 20000 }
    );
    expect(scopedReq.url()).toMatch(/[?&]labId=\d+/);
  });
});
