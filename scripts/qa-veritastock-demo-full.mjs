// scripts/qa-veritastock-demo-full.mjs
//
// Full physical browser QA of the VeritaStock demo. Drives every page, dialog,
// download, and the hero behaviors as the demo user, asserting the actual
// user-visible result (not just HTTP). Writes PASS/FAIL per feature and a
// screenshot for each.
//
//   PW_BASE=https://veritastock-production.up.railway.app node scripts/qa-veritastock-demo-full.mjs

import { chromium } from "@playwright/test";
import { mkdirSync } from "fs";

const BASE = process.env.PW_BASE || "https://veritastock-production.up.railway.app";
const OUT = "C:/Users/veril/Desktop/Verita Products/qa-run";
mkdirSync(OUT, { recursive: true });

const results = [];
let page, ctx, browser;

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (e) {
    results.push({ name, ok: false, note: e.message.split("\n")[0].slice(0, 140) });
    console.log(`FAIL  ${name}  ::  ${e.message.split("\n")[0].slice(0, 140)}`);
  }
  try { await page.screenshot({ path: `${OUT}/${name.replace(/[^a-z0-9]+/gi, "_")}.png`, fullPage: false }); } catch {}
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

async function goto(path) { await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 45000 }); await page.waitForTimeout(1500); }
async function bodyText() { return page.evaluate(() => document.body.innerText); }

async function main() {
  const login = await (await fetch(`${BASE}/api/demo/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json();
  assert(login.token, "demo login returned no token");
  const items = await (await fetch(`${BASE}/api/labs/2/inventory`, { headers: { Authorization: `Bearer ${login.token}` } })).json();
  const onOrder = items.find((i) => (i.on_order_qty || 0) > 0);
  const withQty = items.find((i) => (i.quantity_on_hand || 0) > 0);
  const first = items[0];

  browser = await chromium.launch();
  ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); }, [login.token, login.user]);

  // ---- Auth + shell, not read-only ----
  await check("01 auth shell + writable", async () => {
    await goto("/labs/2/veritastock");
    const addBtn = page.getByRole("button", { name: /add item/i }).first();
    await addBtn.waitFor({ state: "visible", timeout: 15000 });
    assert(await addBtn.isEnabled(), "Add Item disabled (read-only session)");
  });

  await check("02 inventory table populated", async () => {
    const t = await bodyText();
    assert(/Glucometer test strips/i.test(t) && /IV start kit/i.test(t), "expected demo items not in table");
  });

  await check("03 summary tiles", async () => {
    const t = await bodyText();
    assert(/Reorder Now/i.test(t) && /\$/.test(t), "Reorder Now / $ tiles missing");
  });

  // ---- All five locations render ----
  for (const [lab, label] of [[2, "Warehouse"], [3, "ED"], [5, "Bylas"], [7, "Inpatient"], [8, "Clinic"]]) {
    await check(`04 location ${label} (lab ${lab})`, async () => {
      await goto(`/labs/${lab}/veritastock`);
      const t = await bodyText();
      assert(t.replace(/\s+/g, "").length > 600, "location page looks empty");
      assert(/glove|strip|saline|EDTA|kit|tube|dressing|pad|cartridge|culture/i.test(t), "no inventory items on location page");
    });
  }

  // ---- Hero: expiry-driven reorder ----
  await check("05 expiry-driven reorder (Expiring lot)", async () => {
    await goto("/labs/2/veritastock");
    const row = page.locator("tr", { hasText: /Glucometer test strips/i }).first();
    await row.waitFor({ state: "visible", timeout: 15000 });
    assert(/Reorder Now/i.test(await row.innerText()) && /Expiring lot/i.test(await row.innerText()), "strips not flagged Reorder Now + Expiring lot");
  });

  // ---- Valuation Trends ----
  await check("06 Valuation Trends chart + KPIs", async () => {
    await goto("/labs/2/veritastock/trends");
    const t = await bodyText();
    assert(/\$\d/.test(t), "no dollar KPI on trends");
    assert(await page.locator("svg").count() > 0, "no chart svg on trends");
  });

  // ---- Enterprise roll-up (no dropped labs) ----
  await check("07 Enterprise roll-up, no dropped labs", async () => {
    await goto("/labs/2/veritastock/enterprise");
    const t = await bodyText();
    assert(t.replace(/\s+/g, "").length > 400, "enterprise empty");
    assert(!/Main Lab/i.test(t) && !/Pharmacy/i.test(t), "dropped Main Lab / Pharmacy still present");
  });

  // ---- Vendor Directory ----
  await check("08 Vendor Directory populated", async () => {
    await goto("/labs/2/veritastock/vendors");
    assert(/Medline/i.test(await bodyText()), "vendors not populated");
  });

  // ---- Snap Order ----
  await check("09 Snap Order page", async () => {
    await goto("/labs/2/veritastock/snap-order");
    const t = await bodyText();
    assert(/snap order/i.test(t), "snap order page did not render");
  });

  // ---- Receiving: open POs + receipt history + lead-time drift ----
  await check("10 Receiving: open POs, history, drift panel", async () => {
    await goto("/labs/2/veritastock/receiving");
    assert(await page.getByTestId("leadtime-drift-panel").isVisible(), "lead-time drift panel missing");
    const t = await bodyText();
    assert(/Receipt history/i.test(t), "receipt history missing");
    assert(/stockout risk/i.test(t) && /over-buffered/i.test(t), "both drift directions not shown");
    assert(/Blood culture bottle set/i.test(t), "open PO (blood culture) not listed");
  });

  // ---- Account Settings: Organization framing ----
  await check("11 Account Settings = Organization", async () => {
    await goto("/account/settings");
    const t = await bodyText();
    assert(/Organization/i.test(t), "Organization label missing");
    assert(!/\bLab Name\b/.test(t) && !/Lab Information/.test(t), "lab framing still present");
  });

  // ---- Dialogs (open + cancel, non-destructive) ----
  await check("12 Add Item dialog", async () => {
    await goto("/labs/2/veritastock");
    await page.getByRole("button", { name: /add item/i }).first().click();
    await page.waitForTimeout(700);
    assert(/Add Inventory Item/i.test(await bodyText()), "Add Item dialog did not open");
    await page.keyboard.press("Escape");
  });

  await check("13 Edit item dialog", async () => {
    await goto("/labs/2/veritastock");
    await page.getByTestId(`edit-name-${first.id}`).click();
    await page.waitForTimeout(700);
    assert(/Edit Item/i.test(await bodyText()), "Edit dialog did not open");
    await page.keyboard.press("Escape");
  });

  await check("14 Write-off dialog", async () => {
    await goto("/labs/2/veritastock");
    await page.getByTestId(`button-writeoff-${withQty.id}`).click();
    await page.waitForTimeout(700);
    assert(/write[- ]?off|expired|damaged|recalled/i.test(await bodyText()), "write-off dialog did not open");
    await page.keyboard.press("Escape");
  });

  await check("15 Receive dialog (on-order item)", async () => {
    await goto("/labs/2/veritastock");
    await page.getByTestId(`button-receive-${onOrder.id}`).click();
    await page.waitForTimeout(700);
    assert(/receive/i.test(await bodyText()), "receive dialog did not open");
    await page.keyboard.press("Escape");
  });

  await check("16 Barcode scanner modal", async () => {
    await goto("/labs/2/veritastock");
    await page.getByTestId("open-scanner-button").click();
    await page.waitForTimeout(1000);
    assert(await page.locator('[role="dialog"]').count() > 0, "scanner modal did not open");
    await page.keyboard.press("Escape");
  });

  // ---- Downloads (drive the UI button, assert generation) ----
  const dl = async (name, testid, urlRe) => check(name, async () => {
    await goto("/labs/2/veritastock");
    const [resp] = await Promise.all([
      page.waitForResponse((r) => urlRe.test(r.url()) && r.request().method() === "POST", { timeout: 30000 }),
      page.getByTestId(testid).click(),
    ]);
    assert(resp.status() === 200, `${name} responded ${resp.status()}`);
  });
  await dl("17 Order PDF", "generate-order-pdf-button", /reorder-list\/pdf/);
  await dl("18 Order XLSX", "generate-order-excel-button", /reorder-list\/excel/);
  await dl("19 Print Barcodes (Labels PDF)", "generate-labels-pdf-button", /labels\/pdf/);
  await dl("20 Count Sheet XLSX", "generate-count-sheet-button", /count-sheet\/excel/);

  await check("21 Export CSV", async () => {
    await goto("/labs/2/veritastock");
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }),
      page.getByTestId("button-stock-export-csv").click(),
    ]);
    assert(/\.csv$/i.test(download.suggestedFilename()), "CSV download did not start");
  });

  // ---- Full receive round trip on a throwaway item (non-destructive to demo) ----
  await check("22 Receive round trip (throwaway, cleaned up)", async () => {
    const auth = { Authorization: `Bearer ${login.token}`, "Content-Type": "application/json" };
    const placed = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    const made = await (await fetch(`${BASE}/api/labs/2/inventory`, { method: "POST", headers: auth, body: JSON.stringify({ item_name: "QA Receive Probe", category: "Supply", department: "Materials Management", quantity_on_hand: 0, usage_unit: "each", lead_time_days: 7, on_order_qty: 12, on_order_placed_date: placed }) })).json();
    try {
      await goto("/labs/2/veritastock/receiving");
      const btn = page.getByTestId(`receiving-receive-${made.id}`);
      await btn.waitFor({ state: "visible", timeout: 15000 });
      await btn.click();
      await page.waitForTimeout(2500);
      assert(await page.getByTestId(`receiving-row-${made.id}`).count() === 0, "received item still in open list");
      assert(/QA Receive Probe/i.test(await bodyText()), "receipt not in history");
    } finally {
      await fetch(`${BASE}/api/inventory/${made.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${login.token}` } });
    }
  });

  await browser.close();

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n===== QA SUMMARY: ${pass}/${results.length} passed =====`);
  for (const r of results.filter((r) => !r.ok)) console.log(`  FAIL ${r.name}: ${r.note}`);
  await fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${login.token}`, "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
main().catch((e) => { console.log("RUNNER ERROR", e.message); process.exit(1); });
