// tests/playwright/staffportal-bell-pin-retire.spec.ts
//
// Gate 3 step 8 receipt for the NavBar bell + CLIA+PIN retirement
// (PR Option 1, 2026-06-09). Asserts the static / structural pieces;
// live count rendering needs Michael's browser-click after deploy
// with a real pending assignment on his account.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("Staff Portal auth-unification PR Option 1", () => {
  test("POST /api/staff-portal-login returns 410 Gone", async ({ request }) => {
    const r = await request.post(`${BASE}/api/staff-portal-login`, {
      data: { clia: "anything", pin: "111111" },
    });
    expect(r.status()).toBe(410);
    const body = await r.json();
    expect(body.replacement).toBe("/login");
  });

  test("GET /api/me/pending-staff-portal-items requires auth", async ({ request }) => {
    const r = await request.get(`${BASE}/api/me/pending-staff-portal-items`);
    expect([401, 403]).toContain(r.status());
  });

  test("GET /api/me/pending-staff-portal-items returns empty arrays for a non-roster account", async ({ request }) => {
    test.skip(!TOKEN, "PW_TOKEN not set");
    const r = await request.get(`${BASE}/api/me/pending-staff-portal-items`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    // Owner/director may or may not have staff_employees.user_id set;
    // the endpoint always returns 200 with arrays (possibly empty).
    expect(Array.isArray(body.quizzes)).toBe(true);
    expect(Array.isArray(body.policies)).toBe(true);
    expect(Array.isArray(body.competencies)).toBe(true);
  });

  test("/staff-access no longer renders the CLIA+PIN form", async ({ page }) => {
    await page.goto(`${BASE}/staff-access`);
    // The legacy data-testids should be gone. Either the bootstrap
    // resolves and renders the tile screen (authed path) OR the page
    // redirects to /login (unauth path). Neither path mounts the old
    // CLIA + PIN inputs.
    await expect(page.getByTestId("sp-login-clia")).toHaveCount(0);
    await expect(page.getByTestId("sp-login-pin")).toHaveCount(0);
    await expect(page.getByTestId("sp-login-submit")).toHaveCount(0);
  });

  test("NavBar bell mount: hidden when no auth, present (or absent) when authed without pending", async ({ page }) => {
    await page.goto(`${BASE}/`);
    // Unauthenticated: bell should NOT render.
    await expect(page.getByTestId("pending-staff-portal-bell")).toHaveCount(0);
  });
});
