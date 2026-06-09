// tests/playwright/staff-portal-competencies.spec.ts
//
// Gate 3 step 8 for the Staff Portal competencies module (Wave K8,
// task #135, 2026-06-08). Confirms the three new endpoints reject
// unauthenticated calls, and that authenticated round-trip from list
// to detail works when a staff-portal token is supplied.
//
// Env:
//   PW_BASE                  - base URL (default: prod)
//   PW_STAFF_PORTAL_TOKEN    - staff-portal JWT (optional)
//   PW_STAFF_PORTAL_EMPLOYEE - employee id bridged to competency_employees

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const SP_TOKEN = process.env.PW_STAFF_PORTAL_TOKEN || "";
const SP_EMPLOYEE = process.env.PW_STAFF_PORTAL_EMPLOYEE || "";

test.describe("Staff Portal competencies module", () => {
  test("list endpoint requires staff-portal auth", async ({ request }) => {
    const r = await request.get(`${BASE}/api/staff-portal-session/competencies?employee_id=1`);
    expect([401, 403]).toContain(r.status());
  });

  test("detail endpoint requires staff-portal auth", async ({ request }) => {
    const r = await request.get(`${BASE}/api/staff-portal-session/competencies/1?employee_id=1`);
    expect([401, 403]).toContain(r.status());
  });

  test("sign endpoint requires staff-portal auth", async ({ request }) => {
    const r = await request.post(`${BASE}/api/staff-portal-session/competencies/1/sign`, {
      data: { employee_id: 1, typed_signature: "Test" },
    });
    expect([401, 403]).toContain(r.status());
  });

  test("authenticated list returns shape with bridge_status", async ({ request }) => {
    test.skip(!SP_TOKEN || !SP_EMPLOYEE, "PW_STAFF_PORTAL_TOKEN / PW_STAFF_PORTAL_EMPLOYEE not set");
    const r = await request.get(`${BASE}/api/staff-portal-session/competencies?employee_id=${SP_EMPLOYEE}`, {
      headers: { Authorization: `Bearer ${SP_TOKEN}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body.competencies)).toBe(true);
    expect(["ok", "no_competency_record"]).toContain(body.bridge_status);
    expect(body.employee?.id).toBe(parseInt(SP_EMPLOYEE, 10));
  });

  test("authenticated detail returns content_hash and acknowledged flag", async ({ request }) => {
    test.skip(!SP_TOKEN || !SP_EMPLOYEE, "PW_STAFF_PORTAL_TOKEN / PW_STAFF_PORTAL_EMPLOYEE not set");
    const listResp = await request.get(`${BASE}/api/staff-portal-session/competencies?employee_id=${SP_EMPLOYEE}`, {
      headers: { Authorization: `Bearer ${SP_TOKEN}` },
    });
    const list = await listResp.json();
    if (!list.competencies?.length) test.skip(true, "No competencies on file to exercise");

    const assessmentId = list.competencies[0].assessment_id;
    const detailResp = await request.get(`${BASE}/api/staff-portal-session/competencies/${assessmentId}?employee_id=${SP_EMPLOYEE}`, {
      headers: { Authorization: `Bearer ${SP_TOKEN}` },
    });
    expect(detailResp.status()).toBe(200);
    const detail = await detailResp.json();
    expect(typeof detail.content_hash).toBe("string");
    expect(typeof detail.already_acknowledged).toBe("boolean");
  });

  test("sign rejects missing typed_signature", async ({ request }) => {
    test.skip(!SP_TOKEN || !SP_EMPLOYEE, "PW_STAFF_PORTAL_TOKEN / PW_STAFF_PORTAL_EMPLOYEE not set");
    const r = await request.post(`${BASE}/api/staff-portal-session/competencies/1/sign`, {
      headers: { Authorization: `Bearer ${SP_TOKEN}`, "Content-Type": "application/json" },
      data: { employee_id: parseInt(SP_EMPLOYEE, 10) },
    });
    expect(r.status()).toBe(400);
  });
});
