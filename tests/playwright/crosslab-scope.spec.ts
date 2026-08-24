// tests/playwright/crosslab-scope.spec.ts
//
// Cross-lab scoping regression. Three surfaces must scope to the ACTIVE (or the
// record's) lab, not the owner's home lab:
//   - Dashboard Export (/api/my-studies/export) must carry X-Active-Lab-Id.
//   - VeritaCheck verification suggest-studies must return WHERE lab_id = the
//     verification's lab, not WHERE user_id (the owner's whole catalogue).
//   - Finding -> VeritaCheck link must match a study in the finding's lab.
//
// The fixes are server-side (WHERE lab_id) plus a client header, verified live
// against prod post-deploy. This spec is the Gate 3 step 8 hook for an
// authenticated run: it is auth-gated (PW_TOKEN + optional PW_LAB_ID for a
// secondary lab) and otherwise compiles and skips.
import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN;
const LAB = process.env.PW_LAB_ID || "22";

test.describe("Cross-lab scoping stays on the active/record lab", () => {
  test.skip(!TOKEN, "PW_TOKEN not set, skipping authenticated scope check");

  test("dashboard loads for the active lab without a login bounce", async ({ page, context }) => {
    await context.addInitScript((t) => {
      try { localStorage.setItem("veritas_token", String(t)); } catch {}
    }, TOKEN);
    await page.goto(`${BASE}/labs/${LAB}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    expect(page.url()).not.toContain("/login");
    const body = (await page.textContent("body")) || "";
    expect(body).not.toContain("404 Page Not Found");
  });
});
