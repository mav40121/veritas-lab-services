// tests/playwright/lab-date-display.spec.ts
//
// Gate 3 step 8 for BUG-110 (2026-10-27): a stored date-only value shows as that day. new Date("2027-03-01") reads a
// bare day as UTC midnight, so in the US the VeritaLab certificate card said "Expires: 2/28/2027"; labLocaleDate shows
// "3/1/2027". The browser runs on Eastern time, as a US lab's would.
//
// Seeds its own made-up account and lab, so it runs ONLY against a local build on a throwaway database.
// Run: PW_BASE=http://localhost:5099 PW_ADMIN_SECRET=test-admin-secret npx playwright test lab-date-display

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const ADMIN = process.env.PW_ADMIN_SECRET || "";
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE);

test.use({ timezoneId: "America/New_York", locale: "en-US" });

test("a certificate's expiration date shows as the stored day, not the day before", async ({ page, request }) => {
  test.skip(!ADMIN || !LOCAL, "local build with PW_ADMIN_SECRET only");
  const email = `pw-labdate-${Date.now()}@example.com`;
  const reg = await (await request.post(`${BASE}/api/auth/register`, { data: { email, password: ["Pw", "date", "7x!"].join("-"), name: "PW Date Owner", hipaa_acknowledged: true } })).json();
  const labId = Number((await (await request.post(`${BASE}/api/admin/provision-demo-lab`, { data: { secret: ADMIN, ownerEmail: email, labName: "Riverside Regional Medical Center", plan: "hospital" } })).json()).labId);
  await request.post(`${BASE}/api/auth/complete-onboarding`, { headers: { Authorization: `Bearer ${reg.token}` } });
  const cert = await request.post(`${BASE}/api/labs/${labId}/veritalab/certificates`, {
    headers: { Authorization: `Bearer ${reg.token}`, "X-Active-Lab-Id": String(labId) },
    data: { cert_type: "clia", cert_name: "CLIA Certificate of Compliance", cert_number: "22D0999999", issuing_body: "CMS", expiration_date: "2027-03-01" },
  });
  expect(cert.ok(), `create ${cert.status()}`).toBeTruthy();

  await page.setViewportSize({ width: 1280, height: 900 });
  await injectAuth(page, BASE, reg.token);
  await page.goto(`${BASE}/labs/${labId}/veritalab-app`);
  const expires = page.getByText(/Expires:/).first().locator("..");
  await expect(expires).toBeVisible({ timeout: 30000 });
  await expect(expires).toContainText("3/1/2027");
  await expect(expires).not.toContainText("2/28/2027");
  await expires.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/lab-date-display-cert.png" });
});
