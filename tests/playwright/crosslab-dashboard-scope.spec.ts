// tests/playwright/crosslab-dashboard-scope.spec.ts
//
// Regression for the 2026-08-24 cross-lab sweep. A logged-in user on the bare
// (un-prefixed) /dashboard must NOT fetch lab-less data: LegacyWorkspaceRedirect
// holds the render until memberships resolve, then redirects to /labs/:id, and
// authHeaders() carries a persisted X-Active-Lab-Id. Before this, a single-
// membership seat user (Lisa, a Milford seat under Michael) saw Michaels Lab
// studies on the bare dashboard because the request went out with no active lab
// and the server resolved it to the seat owner's lab.
//
// Auth-gated: set PW_TOKEN to a seat user's JWT to exercise the redirect. Without
// it the spec compiles and skips (it is the Gate 3 step 8 hook for the client
// render-gate + LabSwitcher chip changes in this PR).
import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN;

test.describe("Bare /dashboard resolves an active lab before fetching", () => {
  test.skip(!TOKEN, "PW_TOKEN not set, skipping authenticated dashboard scope check");

  test("bare /dashboard redirects to a lab-scoped URL, never stays lab-less", async ({ page, context }) => {
    await context.addInitScript((t) => {
      try { localStorage.setItem("veritas_token", String(t)); } catch {}
    }, TOKEN);
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    // The redirect resolves the active lab; the URL must become /labs/:id/...
    await page.waitForURL(/\/labs\/\d+\//, { timeout: 15000 });
    expect(page.url()).toMatch(/\/labs\/\d+\//);
    expect(page.url()).not.toContain("/login");
    const body = (await page.textContent("body")) || "";
    expect(body).not.toContain("404 Page Not Found");
  });
});
