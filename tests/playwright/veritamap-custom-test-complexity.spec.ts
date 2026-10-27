// tests/playwright/veritamap-custom-test-complexity.spec.ts
//
// Gate 3 step 8 for BUG-071 (2026-10-27): the VeritaMap "Add Custom Test" dialog no longer preselects MODERATE.
// Complexity is lab-stated only (CLAUDE.md VeritaMap rules), so the dialog opens with no complexity, Add stays disabled
// until the lab picks one, and the test is added with the chosen complexity.
//
// Seeds its own made-up account, lab, map and instrument through the API, so it runs ONLY against a local build on a
// throwaway database (never production): PW_BASE must be a localhost address and PW_ADMIN_SECRET the local server's test
// admin secret.
//
// Run: PW_BASE=http://localhost:5099 PW_ADMIN_SECRET=test-admin-secret npx playwright test veritamap-custom-test-complexity

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const ADMIN = process.env.PW_ADMIN_SECRET || "";
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE);

test("custom test complexity is never preselected", async ({ page, request }) => {
  test.skip(!ADMIN || !LOCAL, "seeds its own data: local build with PW_ADMIN_SECRET only");
  const email = `pw-cxty-${Date.now()}@example.com`;
  const password = ["Pw", "cx", "7x!"].join("-");
  const reg = await (await request.post(`${BASE}/api/auth/register`, { data: { email, password, name: "PW Complexity", hipaa_acknowledged: true } })).json();
  const prov = await (await request.post(`${BASE}/api/admin/provision-demo-lab`, { data: { secret: ADMIN, ownerEmail: email, labName: "Riverside Regional Medical Center", plan: "hospital" } })).json();
  const labId = Number(prov.labId);
  const token = reg.token as string;
  const auth = { Authorization: `Bearer ${token}`, "X-Active-Lab-Id": String(labId) };
  await request.post(`${BASE}/api/auth/complete-onboarding`, { headers: { Authorization: `Bearer ${token}` } });
  const map = await (await request.post(`${BASE}/api/labs/${labId}/veritamap/maps`, { headers: auth, data: { name: "PW Complexity Map" } })).json();
  const inst = await request.post(`${BASE}/api/labs/${labId}/veritamap/maps/${map.id}/instruments`, { headers: auth, data: { instrument_name: "Abbott ARCHITECT c4000", role: "Primary", category: "Chemistry" } });
  expect(inst.ok(), `instrument ${inst.status()}`).toBeTruthy();

  await page.setViewportSize({ width: 1280, height: 900 });
  await injectAuth(page, BASE, token);
  await page.goto(`${BASE}/labs/${labId}/veritamap-app/${map.id}/build`);
  await page.getByText("1 INSTRUMENT ADDED", { exact: false }).first().waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: /Next: Select Tests/ }).click(); // the test menu is step 2
  const addCustom = page.getByRole("button", { name: "Add Custom Test" }).first();
  if (!(await addCustom.isVisible())) await page.getByText("Abbott ARCHITECT c4000", { exact: true }).last().click();
  await page.getByRole("button", { name: "Add Custom Test" }).first().click();

  await page.getByPlaceholder(/SARS-CoV-2 EUA/).fill("PW Lab-developed Panel");
  const select = page.getByTestId("custom-test-complexity");
  await expect(select).toContainText("Select the complexity on your CLIA certificate");
  await expect(page.getByTestId("custom-test-add")).toBeDisabled();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/veritamap-custom-test-complexity-empty.png" });

  await select.click();
  await page.getByRole("option", { name: "HIGH", exact: true }).click();
  await expect(page.getByTestId("custom-test-add")).toBeEnabled();
  await page.getByTestId("custom-test-add").click();
  const added = page.getByText("PW Lab-developed Panel").first();
  await expect(added).toBeVisible();
  await expect(page.getByTestId("custom-test-add")).toHaveCount(0); // the dialog closed
  // The new row carries the chosen complexity, not a default.
  const row = added.locator("xpath=ancestor::*[.//*[normalize-space(text())='HIGH']][1]");
  await expect(row).toContainText("HIGH");
  await added.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "test-results/veritamap-custom-test-complexity-added.png" });
});
