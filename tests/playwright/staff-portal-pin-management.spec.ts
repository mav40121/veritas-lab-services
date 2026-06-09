// tests/playwright/staff-portal-pin-management.spec.ts
//
// Gate 3 step 8 for the Staff Portal PIN management surface (task #131,
// 2026-06-08). Wave K1-equivalent for the staff portal: the director's
// rotate / status endpoints have to gate cleanly on auth and lab
// membership. A director with a valid token can rotate and get back a
// 6-digit PIN; unauthenticated callers can't.
//
// The card itself (StaffPortalPinCard in LabMembersPage.tsx) is mounted
// behind canManage on the Members page. We verify it exists on the page
// when an authenticated director loads /members; otherwise the API-level
// checks are the durable receipt.
//
// Env:
//   PW_BASE   — base URL (default: prod)
//   PW_TOKEN  — director JWT (optional; skips UI exercise when absent)
//   PW_LAB_ID — director's lab (default 2)

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "2";

test.describe("Staff Portal PIN management", () => {
  test("status endpoint requires auth", async ({ request }) => {
    const r = await request.get(`${BASE}/api/labs/${LAB_ID}/staff-portal-pin/status`);
    expect([401, 403]).toContain(r.status());
  });

  test("regenerate endpoint requires auth", async ({ request }) => {
    const r = await request.post(`${BASE}/api/labs/${LAB_ID}/staff-portal-pin/regenerate`, {
      data: {},
    });
    expect([401, 403]).toContain(r.status());
  });

  test("director can rotate and the new PIN works at /api/staff-portal-login", async ({ request }) => {
    test.skip(!TOKEN, "PW_TOKEN not set — skipping authenticated path");

    // Read the lab to grab the CLIA for the round-trip login probe
    const labResp = await request.get(`${BASE}/api/labs/${LAB_ID}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(labResp.status()).toBe(200);
    const labBody = await labResp.json();
    const clia: string = labBody.clia_number || labBody.lab?.clia_number;
    expect(clia).toBeTruthy();

    // Rotate
    const rot = await request.post(`${BASE}/api/labs/${LAB_ID}/staff-portal-pin/regenerate`, {
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      data: {},
    });
    expect(rot.status()).toBe(200);
    const rotBody = await rot.json();
    expect(rotBody.pin).toMatch(/^\d{6}$/);

    // Status reflects rotation
    const stat = await request.get(`${BASE}/api/labs/${LAB_ID}/staff-portal-pin/status`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(stat.status()).toBe(200);
    const statBody = await stat.json();
    expect(statBody.has_pin).toBeTruthy();

    // New PIN works at /api/staff-portal-login
    const login = await request.post(`${BASE}/api/staff-portal-login`, {
      headers: { "Content-Type": "application/json" },
      data: { clia, pin: rotBody.pin },
    });
    expect(login.status()).toBe(200);
    const loginBody = await login.json();
    expect(loginBody.token).toBeTruthy();
  });

  test("PIN card visible to director on /members", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set — skipping UI exercise");

    // Bootstrap the auth_token so the SPA treats this as a signed-in director
    await page.goto(`${BASE}/`);
    await page.evaluate((t) => localStorage.setItem("auth_token", t), TOKEN);

    await page.goto(`${BASE}/members`);
    await expect(page.getByTestId("staff-portal-pin-card")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("staff-portal-pin-rotate-button")).toBeVisible();
  });
});
