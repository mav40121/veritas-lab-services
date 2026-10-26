// tests/playwright/study-notes.spec.ts
//
// Gate 3 step 8 receipt for VeritaCheck study notes (2026-10-26). Drives the real browser flow on a study results
// page: the Notes card shows, a typed note is added and survives a reload, and removing it leaves "note removed".
//
// Seeds its own made-up account, lab and study through the API, so it runs ONLY against a local build on a
// throwaway database (never production): PW_BASE must be a localhost address and PW_ADMIN_SECRET the local
// server's test admin secret.
//
// Run: PW_BASE=http://localhost:5099 PW_ADMIN_SECRET=test-admin-secret npx playwright test study-notes

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const ADMIN = process.env.PW_ADMIN_SECRET || "";
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE);

test("a study's Notes card adds a note, keeps it after reload, and removes it", async ({ page, request }) => {
  test.skip(!ADMIN || !LOCAL, "seeds its own data: local build with PW_ADMIN_SECRET only");
  const email = `pw-notes-${Date.now()}@example.com`;
  const password = ["Pw", "notes", "7x!"].join("-");
  const reg = await (await request.post(`${BASE}/api/auth/register`, { data: { email, password, name: "PW Notes Owner", hipaa_acknowledged: true } })).json();
  const labId = Number((await (await request.post(`${BASE}/api/admin/provision-demo-lab`, { data: { secret: ADMIN, ownerEmail: email, labName: "PW Notes Lab", plan: "hospital" } })).json()).labId);
  const token = reg.token as string; // the registration's own session (a second sign-in would meet the one-session rule)
  // A brand-new account opens on the first-run welcome; finish it so it does not cover the page.
  await request.post(`${BASE}/api/auth/complete-onboarding`, { headers: { Authorization: `Bearer ${token}` } });
  const dataPoints = [50, 100, 200, 300, 400].map((v, i) => ({ level: i + 1, expectedValue: v, instrumentValues: { "Analyzer A": v * 1.01 } }));
  const study = await (await request.post(`${BASE}/api/labs/${labId}/studies`, {
    headers: { Authorization: `Bearer ${token}`, "X-Active-Lab-Id": String(labId) },
    data: {
      testName: "PW Glucose", instrument: "Analyzer A", analyst: "PW Analyst", date: "2026-10-26", studyType: "cal_ver",
      cliaAllowableError: 0.1, dataPoints: JSON.stringify(dataPoints), instruments: JSON.stringify(["Analyzer A"]),
      status: "completed", teaIsPercentage: 1, teaUnit: "%", createdAt: new Date().toISOString(),
    },
  })).json();
  expect(labId > 0 && Number(study.id) > 0, JSON.stringify({ labId, study })).toBeTruthy();

  await injectAuth(page, BASE, token);
  await page.goto(`${BASE}/labs/${labId}/study/${study.id}/results`);
  const card = page.getByTestId("study-notes");
  await expect(card).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("study-notes-empty")).toBeVisible();
  await expect(card).toContainText("not printed on the report");

  const text = "Reran level 3 after recalibration. Lot 4471 on the shelf.";
  await page.getByTestId("study-note-input").fill(text);
  await page.getByTestId("study-note-add").click();
  await expect(page.getByTestId("study-notes-list")).toContainText(text, { timeout: 15000 });
  await expect(page.getByTestId("study-notes-list")).toContainText("PW Notes Owner");
  await expect(page.getByTestId("study-note-input")).toHaveValue("");

  await page.reload();
  await expect(page.getByTestId("study-notes-list")).toContainText(text, { timeout: 20000 });

  page.once("dialog", (d) => d.accept());
  await page.locator('[data-testid^="study-note-delete-"]').first().click();
  await expect(page.getByTestId("study-notes-list")).toContainText("note removed", { timeout: 15000 });
  await expect(page.getByTestId("study-notes-list")).not.toContainText(text);
});
