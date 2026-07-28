// tests/playwright/veritastock-waste-report.spec.ts
//
// Gate 3 step 8 for the VeritaStock Wastage and Losses report (Pfizer item 6).
// The report and its PDF / Excel exports live behind the owner-scoped
// /api/labs/:labId/veritastock/waste-report endpoints. Unauthenticated callers
// are rejected; a director token returns the grouped-by-item payload and both
// export endpoints hand back a download token.
//
// Env:
//   PW_BASE   — base URL (default: prod)
//   PW_TOKEN  — director JWT (optional; skips the authenticated path when absent)
//   PW_LAB_ID — director's lab (default 3, Michaels Lab)

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "3";

test.describe("VeritaStock Wastage and Losses report", () => {
  test("waste-report JSON requires auth", async ({ request }) => {
    const r = await request.get(`${BASE}/api/labs/${LAB_ID}/veritastock/waste-report`);
    expect([401, 403]).toContain(r.status());
  });

  test("waste-report PDF requires auth", async ({ request }) => {
    const r = await request.post(`${BASE}/api/labs/${LAB_ID}/veritastock/waste-report/pdf`, { data: {} });
    expect([401, 403]).toContain(r.status());
  });

  test("waste-report xlsx requires auth", async ({ request }) => {
    const r = await request.post(`${BASE}/api/labs/${LAB_ID}/veritastock/waste-report/xlsx`, { data: {} });
    expect([401, 403]).toContain(r.status());
  });

  test("director gets grouped-by-item payload and both export tokens", async ({ request }) => {
    test.skip(!TOKEN, "PW_TOKEN not set: skipping authenticated path");
    const auth = { Authorization: `Bearer ${TOKEN}` };

    // JSON payload: summary + by_item, ranked by loss descending.
    const j = await request.get(`${BASE}/api/labs/${LAB_ID}/veritastock/waste-report`, { headers: auth });
    expect(j.status()).toBe(200);
    const body = await j.json();
    expect(body.summary).toBeTruthy();
    expect(typeof body.summary.total_loss).toBe("number");
    expect(Array.isArray(body.by_item)).toBe(true);
    // Ranked by dollars lost descending.
    const losses = body.by_item.map((g: any) => g.loss);
    for (let i = 1; i < losses.length; i++) expect(losses[i - 1]).toBeGreaterThanOrEqual(losses[i]);
    // Per-item share percentages are present and never above 100.
    for (const g of body.by_item) expect(g.share_pct).toBeLessThanOrEqual(100);

    // Reason filter is honored (all rows carry the requested reason).
    const filtered = await request.get(`${BASE}/api/labs/${LAB_ID}/veritastock/waste-report?reason=expired`, { headers: auth });
    expect(filtered.status()).toBe(200);
    const fbody = await filtered.json();
    for (const g of fbody.by_item) expect(g.reasons).toContain("Expired");

    // PDF export returns a claimable token.
    const pdf = await request.post(`${BASE}/api/labs/${LAB_ID}/veritastock/waste-report/pdf`, {
      headers: { ...auth, "Content-Type": "application/json" }, data: {},
    });
    expect(pdf.status()).toBe(200);
    expect((await pdf.json()).token).toBeTruthy();

    // Excel export returns a claimable token.
    const xlsx = await request.post(`${BASE}/api/labs/${LAB_ID}/veritastock/waste-report/xlsx`, {
      headers: { ...auth, "Content-Type": "application/json" }, data: {},
    });
    expect(xlsx.status()).toBe(200);
    expect((await xlsx.json()).token).toBeTruthy();
  });
});
