// tests/playwright/veritacomp-sign-labscope.spec.ts
//
// Gate 3 step 8 evidence for the lab-scoped competency sign fix (review
// 2026-07-09). signComplete posted to the legacy user_id-scoped
// /api/competency/assessments/:id/sign; it now posts to the lab-scoped
// /api/labs/:labId/competency/assessments/:id/sign when a lab is active, so a
// multi-lab owner signs within the ACTIVE lab.
//
// Drives the real Sign & Complete flow and asserts the sign request targets the
// lab-scoped path. Needs PW_TOKEN + PW_PROGRAM_URL (a program with an UNSIGNED
// assessment). Skips (compile-only) in CI otherwise.
//
// Env: PW_BASE (default prod www), PW_TOKEN (lab-user JWT), PW_PROGRAM_URL.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const PROGRAM_URL = process.env.PW_PROGRAM_URL || "";

test.describe("VeritaComp: Sign & Complete targets the lab-scoped route", () => {
  test("the sign request goes to /api/labs/:labId/.../sign, not the user_id route", async ({ page }) => {
    if (!TOKEN || !PROGRAM_URL) {
      test.skip(true, "PW_TOKEN + PW_PROGRAM_URL not set (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}${PROGRAM_URL}`, { waitUntil: "networkidle" });

    // Capture the URL of the sign POST when it fires.
    const signReq = page.waitForRequest(
      (r) => r.method() === "POST" && /competency\/assessments\/\d+\/sign$/.test(r.url()),
      { timeout: 15000 },
    );

    // Open the sign flow and confirm (labels may vary; match sign/complete).
    await page.getByRole("button", { name: /sign\s*&?\s*complete|sign and complete|sign/i }).first().click();
    await page.getByRole("button", { name: /^(sign|complete|confirm|yes)$/i }).first().click().catch(() => {});

    const req = await signReq;
    expect(req.url(), "sign must post to the lab-scoped route").toContain("/api/labs/");
  });
});
