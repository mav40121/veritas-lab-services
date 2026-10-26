// tests/playwright/veritaresponse-intro-card.spec.ts
//
// Gate 3 step 8 receipt for the VeritaResponse intro card and copy corrections (Michael 2026-10-26, option 1).
// Drives the real pages: the intro card names all four entry types and the real clocks; an internal event (NCE)
// opens titled "Internal Event", without the "Due date recomputes on save" note, with the medical director or
// designee sign-off wording. Screenshots: the module page (light and dark) and the NCE page.
//
// Seeds its own made-up account and lab through the API, so it runs ONLY against a local build on a throwaway
// database (never production): PW_BASE must be a localhost address and PW_ADMIN_SECRET the local server's test
// admin secret.
//
// Run: PW_BASE=http://localhost:5099 PW_ADMIN_SECRET=test-admin-secret npx playwright test veritaresponse-intro-card

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const ADMIN = process.env.PW_ADMIN_SECRET || "";
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE);

test("VeritaResponse intro card covers every entry type, and an internal event reads as one", async ({ page, request }) => {
  test.skip(!ADMIN || !LOCAL, "seeds its own data: local build with PW_ADMIN_SECRET only");
  const email = `pw-vrcard-${Date.now()}@example.com`;
  const password = ["Pw", "vrcard", "7x!"].join("-");
  const reg = await (await request.post(`${BASE}/api/auth/register`, { data: { email, password, name: "PW Response Owner", hipaa_acknowledged: true } })).json();
  const labId = Number((await (await request.post(`${BASE}/api/admin/provision-demo-lab`, { data: { secret: ADMIN, ownerEmail: email, labName: "Riverside Regional Medical Center", plan: "hospital" } })).json()).labId);
  const token = reg.token as string; // the registration's own session (a second sign-in would meet the one-session rule)
  await request.post(`${BASE}/api/auth/complete-onboarding`, { headers: { Authorization: `Bearer ${token}` } });
  const headers = { Authorization: `Bearer ${token}`, "X-Active-Lab-Id": String(labId) };

  await page.setViewportSize({ width: 1280, height: 900 });
  await injectAuth(page, BASE, token);
  await page.goto(`${BASE}/labs/${labId}/veritaresponse`);
  await expect(page.getByText("Corrective actions from surveys, PT, internal events and FDA deviations, tracked to closure")).toBeVisible({ timeout: 20000 });
  const card = page.getByText(/carries every corrective action to closure/).first();
  await expect(card).toBeVisible({ timeout: 20000 });
  for (const t of ["internal event (NCE)", "FDA product deviation", "COLA (30)", "AABB (45)", "ISO 15189", "CMS-2567-compatible"]) {
    await expect(page.getByText(t, { exact: false }).first()).toBeVisible();
  }
  await page.screenshot({ path: "test-results/veritaresponse-card.png", fullPage: true });

  const nce = await (await request.post(`${BASE}/api/labs/${labId}/findings`, {
    headers, data: { source_type: "internal_nce", description: "Specimen received unlabeled from 4 West", event_date: "2026-10-20", discovered_by: "Receiving tech", status: "open" },
  })).json();
  expect(Number(nce.id) > 0, JSON.stringify(nce)).toBeTruthy();
  await page.goto(`${BASE}/labs/${labId}/veritaresponse/${nce.id}`);
  await expect(page.getByRole("heading", { name: new RegExp(`^Internal Event #${nce.id}$`) })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("Internal non-conforming event").first()).toBeVisible();
  await expect(page.getByText("Due date recomputes on save.")).toHaveCount(0);
  await expect(page.getByTestId("nce-signoff-btn")).toHaveText("Sign off (medical director or designee)");
  await expect(page.getByText(/uses the "Other" accreditor/)).toHaveCount(0);
  await page.screenshot({ path: "test-results/veritaresponse-nce.png" });

  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${BASE}/labs/${labId}/veritaresponse`);
  await expect(page.getByText(/carries every corrective action to closure/).first()).toBeVisible({ timeout: 20000 });
  await page.screenshot({ path: "test-results/veritaresponse-card-dark.png" });
});
