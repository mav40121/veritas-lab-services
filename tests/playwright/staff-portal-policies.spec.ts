// tests/playwright/staff-portal-policies.spec.ts
//
// Gate 3 step 8 for the Staff Portal policies module (Wave K5, task #132,
// 2026-06-08). Confirms the three new endpoints behind /staff-access:
//   GET  /api/staff-portal-session/policies?employee_id=...
//   GET  /api/staff-portal-session/policies/:id
//   POST /api/staff-portal-session/policies/:id/sign
// gate cleanly on the staff-portal JWT and reject calls without it. The
// list/detail/render shapes are sanity-checked when a token is available
// via PW_STAFF_PORTAL_TOKEN.
//
// Env:
//   PW_BASE                    — base URL (default: prod)
//   PW_STAFF_PORTAL_TOKEN      — staff-portal JWT (optional)
//   PW_STAFF_PORTAL_EMPLOYEE   — employee id to read policies for

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const SP_TOKEN = process.env.PW_STAFF_PORTAL_TOKEN || "";
const SP_EMPLOYEE = process.env.PW_STAFF_PORTAL_EMPLOYEE || "";

test.describe("Staff Portal policies module", () => {
  test("policies list endpoint requires staff-portal auth", async ({ request }) => {
    const r = await request.get(`${BASE}/api/staff-portal-session/policies?employee_id=1`);
    expect([401, 403]).toContain(r.status());
  });

  test("policy detail endpoint requires staff-portal auth", async ({ request }) => {
    const r = await request.get(`${BASE}/api/staff-portal-session/policies/1`);
    expect([401, 403]).toContain(r.status());
  });

  test("policy render endpoint requires staff-portal auth", async ({ request }) => {
    const r = await request.get(`${BASE}/api/staff-portal-session/policies/1/render`);
    expect([401, 403]).toContain(r.status());
  });

  test("sign endpoint requires staff-portal auth", async ({ request }) => {
    const r = await request.post(`${BASE}/api/staff-portal-session/policies/1/sign`, {
      data: { employee_id: 1, version_id: 1, typed_signature: "Test" },
    });
    expect([401, 403]).toContain(r.status());
  });

  test("authenticated list returns array shape", async ({ request }) => {
    test.skip(!SP_TOKEN || !SP_EMPLOYEE, "PW_STAFF_PORTAL_TOKEN / PW_STAFF_PORTAL_EMPLOYEE not set");
    const r = await request.get(`${BASE}/api/staff-portal-session/policies?employee_id=${SP_EMPLOYEE}`, {
      headers: { Authorization: `Bearer ${SP_TOKEN}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body.policies)).toBe(true);
    if (body.policies.length > 0) {
      const p = body.policies[0];
      expect(typeof p.document_id).toBe("number");
      expect(typeof p.title).toBe("string");
      expect(typeof p.signed).toBe("boolean");
    }
  });

  test("authenticated detail + render round-trips for the first listed policy", async ({ request }) => {
    test.skip(!SP_TOKEN || !SP_EMPLOYEE, "PW_STAFF_PORTAL_TOKEN / PW_STAFF_PORTAL_EMPLOYEE not set");
    const listResp = await request.get(`${BASE}/api/staff-portal-session/policies?employee_id=${SP_EMPLOYEE}`, {
      headers: { Authorization: `Bearer ${SP_TOKEN}` },
    });
    const list = await listResp.json();
    if (!list.policies?.length) test.skip(true, "No approved policies on this lab to exercise");

    const docId = list.policies[0].document_id;
    const metaResp = await request.get(`${BASE}/api/staff-portal-session/policies/${docId}`, {
      headers: { Authorization: `Bearer ${SP_TOKEN}` },
    });
    expect(metaResp.status()).toBe(200);
    const meta = await metaResp.json();
    expect(typeof meta.version_id).toBe("number");
    expect(typeof meta.file_hash).toBe("string");
    expect(["docx", "pdf", "html"]).toContain(meta.file_format);

    const renderResp = await request.get(`${BASE}/api/staff-portal-session/policies/${docId}/render`, {
      headers: { Authorization: `Bearer ${SP_TOKEN}` },
    });
    expect(renderResp.status()).toBe(200);
    const ct = renderResp.headers()["content-type"] || "";
    if (meta.file_format === "pdf") {
      expect(ct).toContain("application/pdf");
    } else {
      const data = await renderResp.json();
      expect(data.format).toBe("html");
      expect(typeof data.html).toBe("string");
    }
  });
});
