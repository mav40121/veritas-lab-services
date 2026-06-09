// tests/playwright/staff-portal-activity.spec.ts
//
// Gate 3 step 8 for the Staff Portal "My Activity" / audit-trail
// module (Wave K7, task #134, 2026-06-08). Confirms the new
// my-activity endpoint gates cleanly on the staff-portal JWT and
// returns the merged event shape when authenticated.
//
// Env:
//   PW_BASE                  - base URL (default: prod)
//   PW_STAFF_PORTAL_TOKEN    - staff-portal JWT (optional)
//   PW_STAFF_PORTAL_EMPLOYEE - employee id with can_view_audit=1

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const SP_TOKEN = process.env.PW_STAFF_PORTAL_TOKEN || "";
const SP_EMPLOYEE = process.env.PW_STAFF_PORTAL_EMPLOYEE || "";

test.describe("Staff Portal my-activity module", () => {
  test("my-activity requires staff-portal auth", async ({ request }) => {
    const r = await request.get(`${BASE}/api/staff-portal-session/my-activity?employee_id=1`);
    expect([401, 403]).toContain(r.status());
  });

  test("my-activity rejects missing employee_id", async ({ request }) => {
    test.skip(!SP_TOKEN, "PW_STAFF_PORTAL_TOKEN not set");
    const r = await request.get(`${BASE}/api/staff-portal-session/my-activity`, {
      headers: { Authorization: `Bearer ${SP_TOKEN}` },
    });
    expect(r.status()).toBe(400);
  });

  test("authenticated my-activity returns event shape", async ({ request }) => {
    test.skip(!SP_TOKEN || !SP_EMPLOYEE, "PW_STAFF_PORTAL_TOKEN / PW_STAFF_PORTAL_EMPLOYEE not set");
    const r = await request.get(`${BASE}/api/staff-portal-session/my-activity?employee_id=${SP_EMPLOYEE}`, {
      headers: { Authorization: `Bearer ${SP_TOKEN}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body.events)).toBe(true);
    expect(typeof body.total).toBe("number");
    expect(body.employee?.id).toBe(parseInt(SP_EMPLOYEE, 10));
    if (body.events.length > 0) {
      const e = body.events[0];
      expect(["policy_signature", "inventory_adjustment"]).toContain(e.kind);
      expect(typeof e.at).toBe("string");
      expect(typeof e.label).toBe("string");
    }
  });
});
