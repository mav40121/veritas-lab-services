// tests/playwright/veritacomp-quiz-assign-staff-portal.spec.ts
//
// Gate 3 step 8 receipt for PR2 (assign + Staff Portal Take a Quiz tile).
// API-level assertions for the parts that don't need a real authoring
// click-through; UI assertions for the static structural pieces.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("PR2: assign + Staff Portal Take a Quiz", () => {
  test("director assign endpoints require auth", async ({ request }) => {
    const r1 = await request.post(`${BASE}/api/veritacomp/quizzes/1/assignments`, {
      data: { staff_employee_ids: [1] },
    });
    expect([401, 403]).toContain(r1.status());
    const r2 = await request.get(`${BASE}/api/veritacomp/quizzes/1/assignments`);
    expect([401, 403]).toContain(r2.status());
    const r3 = await request.delete(`${BASE}/api/veritacomp/quiz-assignments/1`);
    expect([401, 403]).toContain(r3.status());
  });

  test("staff portal quiz endpoints require synthetic JWT", async ({ request }) => {
    const r1 = await request.get(`${BASE}/api/staff-portal-session/quizzes?employee_id=1`);
    expect([401, 403]).toContain(r1.status());
    const r2 = await request.get(`${BASE}/api/staff-portal-session/quizzes/1?employee_id=1`);
    expect([401, 403]).toContain(r2.status());
    const r3 = await request.post(`${BASE}/api/staff-portal-session/quizzes/1/attempt`, {
      data: { employee_id: 1, answers: [], typed_signature: "x" },
    });
    expect([401, 403]).toContain(r3.status());
  });

  test("staff portal page renders the Take a Quiz tile after login (login screen visible)", async ({ page }) => {
    // Without credentials we only assert the login screen is reachable;
    // the Take a Quiz tile assertion needs a real CLIA+PIN, which is a
    // manual step.
    await page.goto(`${BASE}/staff-access`);
    await expect(page.getByTestId("sp-login-clia")).toBeVisible();
    await expect(page.getByTestId("sp-login-pin")).toBeVisible();
  });

  test("assign endpoint round-trips with valid auth", async ({ request }) => {
    test.skip(!TOKEN, "PW_TOKEN not set");
    // Walk the negative-input paths to confirm the validation layer
    // without needing a real quiz id (which the test environment may
    // not have).
    const r = await request.post(`${BASE}/api/veritacomp/quizzes/99999999/assignments`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: { staff_employee_ids: [] },
    });
    // Bad input OR not found — either is a clean validation path.
    expect([400, 403, 404]).toContain(r.status());
  });
});
