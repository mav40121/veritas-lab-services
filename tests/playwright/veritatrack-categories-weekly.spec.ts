// tests/playwright/veritatrack-categories-weekly.spec.ts
//
// Gate 3 step 8 receipt for VeritaTrack per-lab categories (#110) and the Weekly frequency (#111), Michael 2026-10-26.
// Drives the VeritaTrack page: the owner opens Categories, adds a lab category, renames it, retires and restores it;
// then adds a Weekly task in that category from the Add Task form. A sign-off dated 6 days ago makes the weekly task
// due tomorrow, so the list shows it as due soon.
//
// Seeds its own made-up account and lab through the API, so it runs ONLY against a local build on a throwaway
// database (never production): PW_BASE must be a localhost address and PW_ADMIN_SECRET the local server's test admin
// secret.
//
// Run: PW_BASE=http://localhost:5099 PW_ADMIN_SECRET=test-admin-secret npx playwright test veritatrack-categories-weekly

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const ADMIN = process.env.PW_ADMIN_SECRET || "";
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE);

function isoDay(offsetDays: number): string {
  // The lab is Eastern (no CLIA state on a demo lab), so count from the Eastern day.
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

test("a lab adds its own category and a weekly task", async ({ page, request }) => {
  test.skip(!ADMIN || !LOCAL, "seeds its own data: local build with PW_ADMIN_SECRET only");
  const email = `pw-vtcat-${Date.now()}@example.com`;
  const password = ["Pw", "vt", "7x!"].join("-");
  const reg = await (await request.post(`${BASE}/api/auth/register`, { data: { email, password, name: "PW VT Owner", hipaa_acknowledged: true } })).json();
  const prov = await (await request.post(`${BASE}/api/admin/provision-demo-lab`, { data: { secret: ADMIN, ownerEmail: email, labName: "Riverside Regional Medical Center", plan: "hospital" } })).json();
  const labId = Number(prov.labId);
  const token = reg.token as string;
  const auth = { Authorization: `Bearer ${token}`, "X-Active-Lab-Id": String(labId) };
  await request.post(`${BASE}/api/auth/complete-onboarding`, { headers: { Authorization: `Bearer ${token}` } });

  await page.setViewportSize({ width: 1280, height: 900 });
  await injectAuth(page, BASE, token);
  await page.goto(`${BASE}/veritatrack-app`);

  // Categories: add, rename, retire, restore.
  await page.getByTestId("track-categories-button").click({ timeout: 20000 });
  await page.getByTestId("track-category-new").fill("Safety Inspections");
  await page.getByTestId("track-category-add").click();
  const row = page.locator("[data-testid^='track-category-row-']").filter({ hasText: "Safety Inspections" });
  await expect(row).toBeVisible();
  await page.getByTestId("track-category-new").fill("qc review");
  await page.getByTestId("track-category-add").click();
  await expect(page.getByTestId("track-category-error")).toContainText("already a built-in category");
  await row.getByTestId("track-category-rename").click();
  await page.getByTestId("track-category-rename-input").fill("Safety Rounds");
  await page.getByTestId("track-category-rename-save").click();
  const renamed = page.locator("[data-testid^='track-category-row-']").filter({ hasText: "Safety Rounds" });
  await expect(renamed).toBeVisible();
  await renamed.getByTestId("track-category-retire").click();
  await expect(renamed).toContainText("retired");
  await page.waitForTimeout(400); // let the dialog finish fading in
  await page.screenshot({ path: "test-results/veritatrack-categories-retired.png" });
  await renamed.getByTestId("track-category-restore").click();
  await expect(renamed.getByTestId("track-category-retire")).toBeVisible();
  await page.waitForTimeout(400); // let the dialog finish fading in
  await page.screenshot({ path: "test-results/veritatrack-categories.png" });
  await page.keyboard.press("Escape");

  // A Weekly task in the lab's category, from the Add Task form.
  await page.getByTestId("add-task-button").first().click();
  await page.getByPlaceholder("e.g. Calibration Verification - Sodium").fill("Eyewash station flush");
  await page.getByTestId("task-category").click();
  await page.getByRole("option", { name: "Safety Rounds", exact: true }).click();
  await page.getByTestId("task-frequency").click();
  await page.getByRole("option", { name: "Weekly", exact: true }).click();
  const [created] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === `/api/labs/${labId}/veritatrack/tasks` && r.request().method() === "POST"),
    page.getByRole("button", { name: "Add Task", exact: true }).last().click(),
  ]);
  expect(created.ok(), `create ${created.status()}`).toBeTruthy();
  const task = await created.json();
  expect(task.frequency).toBe("Weekly");
  expect(task.frequency_days).toBe(7);
  expect(task.category).toBe("Safety Rounds");

  // Signed 6 days ago: due tomorrow, so due soon.
  const so = await request.post(`${BASE}/api/veritatrack/tasks/${task.id}/signoff`, { headers: auth, data: { completed_date: isoDay(-6), initials: "PW" } });
  expect(so.ok(), `signoff ${so.status()}`).toBeTruthy();
  await page.reload();
  const group = page.getByRole("button").filter({ hasText: "Safety Rounds" });
  await expect(group).toContainText("1 due soon", { timeout: 20000 });
  // A group with a due-soon task opens on its own; open it only if it is closed.
  if (!(await page.getByText("Eyewash station flush").isVisible())) await group.click();
  await expect(page.getByText("Eyewash station flush")).toBeVisible();
  const tasks = await (await request.get(`${BASE}/api/labs/${labId}/veritatrack/tasks`, { headers: auth })).json();
  const t = tasks.find((x: any) => x.id === task.id);
  expect(t.next_due).toBe(isoDay(1));
  expect(t.status).toBe("due_soon");
  await page.getByText("Eyewash station flush").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/veritatrack-weekly-task.png" });

  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await page.getByTestId("track-categories-button").click({ timeout: 20000 });
  await expect(page.locator("[data-testid^='track-category-row-']").filter({ hasText: "Safety Rounds" })).toBeVisible();
  await page.waitForTimeout(400); // let the dialog finish fading in
  await page.screenshot({ path: "test-results/veritatrack-categories-dark.png" });
});
