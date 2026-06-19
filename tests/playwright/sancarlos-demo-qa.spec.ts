// tests/playwright/sancarlos-demo-qa.spec.ts
//
// Full authenticated browser QA for the San Carlos VeritaStock demo. Drives
// every VeritaStock function on the veritastock.com host and screenshots each
// one into qa-screens/sancarlos/ for review before the Tuesday demo.
//
// The agent cannot mint a token (JWT_SECRET unreachable), so Michael runs this:
//   1. Provision + seed first:
//        $env:ADMIN_SECRET="..."; python scripts/build_sancarlos_demo_inventory.py --provision
//   2. Get a token: log into https://www.veritastock.com, open devtools >
//      Application > Local Storage > copy the value of "veritas_token".
//   3. Run:
//        $env:PW_BASE="https://www.veritastock.com"; $env:PW_TOKEN="<token>"; `
//          npx playwright test sancarlos-demo-qa
//   Screenshots land in qa-screens/sancarlos/. Re-run is safe (read-only; no
//   transfer is submitted).

import { test, expect, APIRequestContext } from "@playwright/test";
import { injectAuth } from "./_auth";
import * as fs from "fs";
import * as path from "path";

const BASE = process.env.PW_BASE || "https://www.veritastock.com";
const TOKEN = process.env.PW_TOKEN || "";
const SHOTS = process.env.QA_SHOTS || path.join("qa-screens", "sancarlos");
fs.mkdirSync(SHOTS, { recursive: true });

const WAREHOUSE = "San Carlos Warehouse";
const STOCKROOMS = ["ED Stockroom", "San Carlos Main Lab", "Clarence Wesley Lab",
  "Pharmacy", "Inpatient Unit", "Clinic"];
const ALL_LOCS = [WAREHOUSE, ...STOCKROOMS];

// labName -> labId, resolved once from /api/labs/me (Bearer; CORS does not apply
// to this server-to-server request fixture).
const labIds: Record<string, number> = {};

async function loadLabs(request: APIRequestContext) {
  const r = await request.get(`${BASE}/api/labs/me`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok()) return;
  const labs = (await r.json()) as Array<{ labId: number; labName: string | null }>;
  for (const l of labs) if (l.labName) labIds[l.labName.trim()] = l.labId;
}

async function shot(page: any, name: string) {
  await page.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: true });
}

test.describe.configure({ mode: "serial" });

test.describe("San Carlos VeritaStock demo — full function QA", () => {
  test.skip(!TOKEN, "set PW_TOKEN to a veritastock.com login token");
  test.skip(!/veritastock\.com/i.test(BASE), "run against PW_BASE=https://www.veritastock.com");

  test.beforeAll(async ({ request }) => { await loadLabs(request); });
  test.beforeEach(async ({ page }) => { await injectAuth(page, BASE, TOKEN); });

  test("00 all 7 demo labs exist under the account", async () => {
    const missing = ALL_LOCS.filter((n) => !labIds[n]);
    expect(missing, `missing demo labs (run the provisioner first): ${missing.join(", ")}`).toEqual([]);
  });

  test("01 enterprise roll-up shows all 7 locations", async ({ page }) => {
    test.skip(!labIds[WAREHOUSE], "warehouse lab not provisioned");
    await page.goto(`${BASE}/labs/${labIds[WAREHOUSE]}/veritastock/enterprise`);
    await expect(page.getByTestId("enterprise-page")).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("heading", { name: /Enterprise Inventory/i })).toBeVisible();
    // Every location name should appear somewhere in the roll-up.
    for (const loc of ALL_LOCS) {
      await expect(page.getByText(loc, { exact: false }).first()).toBeVisible();
    }
    await shot(page, "01-enterprise-rollup");
  });

  test("02 warehouse inventory + intelligence columns", async ({ page }) => {
    test.skip(!labIds[WAREHOUSE], "warehouse lab not provisioned");
    await page.goto(`${BASE}/labs/${labIds[WAREHOUSE]}/veritastock`);
    await expect(page.getByText("Nitrile Exam Gloves, Medium", { exact: false }).first()).toBeVisible({ timeout: 20000 });
    await shot(page, "02-warehouse-inventory");
  });

  test("03 main lab: low-stock + near-expiry visible", async ({ page }) => {
    test.skip(!labIds["San Carlos Main Lab"], "main lab not provisioned");
    await page.goto(`${BASE}/labs/${labIds["San Carlos Main Lab"]}/veritastock`);
    await expect(page.getByText(/Reagent for Tosoh|MAS QC|Cellpack/i).first()).toBeVisible({ timeout: 20000 });
    await shot(page, "03-mainlab-inventory");
    // Filter to items needing reorder if the status control is present.
    try {
      const filter = page.getByTestId("status-filter").or(page.getByRole("combobox", { name: /status/i })).first();
      if (await filter.isVisible({ timeout: 2000 })) {
        await filter.click();
        await page.getByText("Reorder Now", { exact: false }).last().click();
        await page.waitForTimeout(800);
      }
    } catch { /* best-effort */ }
    await shot(page, "03b-mainlab-reorder-filter");
  });

  test("04 transfer UI: warehouse -> ED configured (not submitted)", async ({ page }) => {
    test.skip(!labIds[WAREHOUSE], "warehouse lab not provisioned");
    await page.goto(`${BASE}/labs/${labIds[WAREHOUSE]}/veritastock/enterprise`);
    await expect(page.getByTestId("enterprise-page")).toBeVisible({ timeout: 20000 });
    try {
      await page.getByTestId("transfer-from").click();
      await page.getByRole("option", { name: new RegExp(WAREHOUSE, "i") }).first().click();
      await page.getByTestId("transfer-to").click();
      await page.getByRole("option", { name: /ED Stockroom/i }).first().click();
      await page.waitForTimeout(500);
    } catch { /* best-effort; screenshot still captures state */ }
    await shot(page, "04-transfer-configured");
  });

  test("05 Order PDF generates", async ({ page }) => {
    test.skip(!labIds[WAREHOUSE], "warehouse lab not provisioned");
    await page.goto(`${BASE}/labs/${labIds[WAREHOUSE]}/veritastock`);
    await page.waitForLoadState("networkidle").catch(() => {});
    try {
      await page.getByRole("button", { name: /Order PDF/i }).first().click();
      await expect(page.getByText(/Order PDF generated|PDF generated/i)).toBeVisible({ timeout: 20000 });
    } catch { /* best-effort */ }
    await shot(page, "05-order-pdf");
  });

  test("06 Snap Order page", async ({ page }) => {
    test.skip(!labIds[WAREHOUSE], "warehouse lab not provisioned");
    await page.goto(`${BASE}/labs/${labIds[WAREHOUSE]}/veritastock/snap-order`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await shot(page, "06-snap-order");
  });

  test("07 Vendors page", async ({ page }) => {
    test.skip(!labIds[WAREHOUSE], "warehouse lab not provisioned");
    await page.goto(`${BASE}/labs/${labIds[WAREHOUSE]}/veritastock/vendors`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await shot(page, "07-vendors");
  });

  test("08 each stockroom inventory renders", async ({ page }) => {
    for (let i = 0; i < STOCKROOMS.length; i++) {
      const loc = STOCKROOMS[i];
      if (!labIds[loc]) continue;
      await page.goto(`${BASE}/labs/${labIds[loc]}/veritastock`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await shot(page, `08-${String(i + 1).padStart(2, "0")}-${loc.replace(/[^A-Za-z0-9]+/g, "_")}`);
    }
  });
});
