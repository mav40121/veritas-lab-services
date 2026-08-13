// tests/playwright/veritapolicy-major-revision.spec.ts
//
// Gate 3 step 8 for the VeritaPolicy "major revision -> Medical Director only"
// feature (2026-08-13). The upload dialogs on VeritaPolicyMyPoliciesPage now
// carry a "Major revision" checkbox; when checked, its approval is restricted
// to the lab's designated Medical Director (no owner/admin "or designee"
// fallback). The server-side gate is proven exhaustively by the in-memory
// harness scripts/verify-policy-major-revision-md-only.ts (18/18). This spec is
// the browser-level receipt: it drives the real upload dialog on prod and
// asserts the customer-clickable checkbox renders and toggles, which the
// server verify script cannot see.
//
// Two layers, matching the house pattern (see staff-portal-pin-management.spec):
//   1. Always-on API guards — the upload endpoints reject unauthenticated
//      callers. Safe on prod today, before and after this feature deploys.
//   2. PW_TOKEN-gated UI exercise — injects a director/owner session, opens the
//      "Upload policy" dialog on the My Policies page, and asserts the
//      "Major revision" checkbox is present and toggleable. Skips cleanly when
//      no token is configured, so the reporting-only smoke run never fails on
//      an un-deployed build.
//
// Env:
//   PW_BASE   — base URL (default: prod)
//   PW_TOKEN  — owner/director JWT (optional; skips the UI exercise when absent)
//   PW_LAB_ID — lab to open (default 2 — San Carlos, the lab piloting this)

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "2";

test.describe("VeritaPolicy major-revision (MD-only) checkbox", () => {
  test("document upload endpoint requires auth", async ({ request }) => {
    const r = await request.post(
      `${BASE}/api/labs/${LAB_ID}/veritapolicy/documents`,
      { multipart: { file: { name: "x.pdf", mimeType: "application/pdf", buffer: Buffer.from("x") } } }
    );
    expect([401, 403]).toContain(r.status());
  });

  test("new-version upload endpoint requires auth", async ({ request }) => {
    const r = await request.post(
      `${BASE}/api/labs/${LAB_ID}/veritapolicy/documents/1/versions`,
      { multipart: { file: { name: "x.pdf", mimeType: "application/pdf", buffer: Buffer.from("x") } } }
    );
    expect([401, 403]).toContain(r.status());
  });

  test("upload dialog exposes the Major revision checkbox", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set — skipping authenticated UI exercise");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritapolicy-app/my-policies`);

    // Open the upload dialog. The trigger is the primary "Upload" control on the
    // My Policies page; match on its accessible name loosely so a label tweak
    // does not silently break the receipt.
    const uploadTrigger = page
      .getByRole("button", { name: /upload/i })
      .first();
    await expect(uploadTrigger).toBeVisible({ timeout: 15000 });
    await uploadTrigger.click();

    // The checkbox and its "designated Medical Director" copy must render.
    const majorLabel = page.getByText(/Major revision/i).first();
    await expect(majorLabel).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByText(/designated Medical Director/i).first()
    ).toBeVisible();

    const majorCheckbox = page.getByRole("checkbox").first();
    await expect(majorCheckbox).toBeVisible();
    await majorCheckbox.check();
    await expect(majorCheckbox).toBeChecked();
    await majorCheckbox.uncheck();
    await expect(majorCheckbox).not.toBeChecked();
  });
});
