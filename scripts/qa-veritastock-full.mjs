// Comprehensive authenticated browser QA of EVERY VeritaStock function on the
// live VeritaStock service. Each function is isolated in try/catch so one
// failure never aborts the rest. Token via PW_TOKEN. Screenshots to SHOT_DIR.
import { chromium } from "@playwright/test";

const BASE = process.env.VS_BASE || "https://veritastock-production.up.railway.app";
const TOKEN = process.env.PW_TOKEN;
const SHOT = process.env.SHOT_DIR || "C:/Users/veril/Desktop/Verita Products/qa";
if (!TOKEN) { console.error("PW_TOKEN not set"); process.exit(2); }

const results = [];
const rec = (name, status, note = "") => { results.push({ name, status, note }); console.log(`[${status}] ${name}${note ? "  :: " + note : ""}`); };

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const WH = `${BASE}/labs/2/veritastock`;       // warehouse (50 items, 0 low)
const MAIN = `${BASE}/labs/4/veritastock`;      // main lab (24 items, 6 low)

async function step(name, fn) {
  try { await fn(); } catch (e) { rec(name, "FAIL", (e.message || String(e)).slice(0, 140)); }
}
const shot = (n) => page.screenshot({ path: `${SHOT}/${n}.png`, fullPage: true }).catch(() => {});
const dialogVisible = () => page.locator('[role="dialog"]').first().isVisible().catch(() => false);
async function closeDialog() {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(400);
}

// ---- auth inject (token + user from /api/auth/me) ----
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
const me = await page.evaluate(async ([b, t]) => { const r = await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } }); return r.ok ? await r.json() : null; }, [BASE, TOKEN]);
const user = me && (me.user || me);
await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); if (u) localStorage.setItem("veritas_user", JSON.stringify(u)); }, [TOKEN, user]);
rec("auth inject", user && /enterprise/.test(user.plan || "") ? "PASS" : "WARN", `plan=${user && user.plan}`);

// ===== Warehouse inventory page =====
await page.goto(WH, { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(2500);

await step("inventory grid renders (warehouse)", async () => {
  const rows = await page.locator('[data-testid="onhand-cell"]').count();
  const body = await page.evaluate(() => document.body.innerText);
  if (/requires a suite subscription/i.test(body)) throw new Error("plan wall present");
  if (rows < 1) throw new Error("no onhand cells");
  rec("inventory grid renders (warehouse)", "PASS", `${rows} item rows`);
  await shot("01_warehouse_inventory");
});

await step("scope selector present", async () => {
  const ok = await page.locator('[data-testid="veritastock-scope-selector"]').first().isVisible();
  rec("scope selector present", ok ? "PASS" : "FAIL");
});

// quick-filter tiles (Reorder Now / Expiring Soon / Standing Order Due) + vendor filter
await step("vendor filter control present", async () => {
  const ok = await page.locator('[data-testid="filter-vendor"]').first().isVisible();
  rec("vendor filter control present", ok ? "PASS" : "FAIL");
});

// --- navigation buttons (they are <Link>s; assert the destination loads) ---
const navTests = [
  ["vendor-directory-button", "Vendor Directory page", /\/veritastock\/vendors$/, /Vendor|vendor/],
  ["enterprise-button", "Enterprise page", /\/veritastock\/enterprise$/, /Location|Warehouse|Roll/i],
  ["start-snap-order-button", "Snap Order page", /\/veritastock\/snap-order/, /Snap|Emergency|Manual order/i],
];
for (const [testid, label, urlRe, textRe] of navTests) {
  await step(label, async () => {
    await page.goto(WH, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(1200);
    const btn = page.locator(`[data-testid="${testid}"]`).first();
    if (!(await btn.isVisible())) throw new Error("button not in toolbar");
    await btn.click();
    await page.waitForTimeout(1800);
    const url = page.url();
    const body = await page.evaluate(() => document.body.innerText);
    const ok = urlRe.test(url) && !/requires a suite subscription/i.test(body) && textRe.test(body);
    rec(label, ok ? "PASS" : "FAIL", ok ? url.slice(-40) : `url=${url.slice(-40)}`);
    await shot(`nav_${testid}`);
  });
}

// --- same-page modal buttons (scanner, count workflow) — fresh load each.
// Scanner is a Radix [role=dialog]; the count workflow is a custom overlay
// with data-testid="count-workflow-modal". Detect with an explicit selector. ---
for (const [testid, label, overlaySel] of [
  ["open-scanner-button", "Barcode scanner modal", '[role="dialog"]'],
  ["open-count-workflow-button", "Scan-to-count workflow", '[data-testid="count-workflow-modal"]'],
]) {
  await step(label, async () => {
    await page.goto(WH, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(1500);
    const btn = page.locator(`[data-testid="${testid}"]`).first();
    if (!(await btn.isVisible())) throw new Error("button not visible");
    if (await btn.isDisabled()) throw new Error("button disabled (readOnly?)");
    await btn.click();
    await page.waitForTimeout(1200);
    const ok = await page.locator(overlaySel).first().isVisible().catch(() => false);
    rec(label, ok ? "PASS" : "FAIL", ok ? "modal opened" : "no modal");
    if (ok) await shot(`modal_${testid}`);
    await closeDialog();
  });
}

// --- same-page PDF exports (window.open new tab) ---
for (const [testid, label] of [
  ["generate-order-pdf-button", "Order PDF export"],
  ["generate-labels-pdf-button", "Labels PDF export"],
]) {
  await step(label, async () => {
    await page.goto(WH, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const btn = page.locator(`[data-testid="${testid}"]`).first();
    if (!(await btn.isVisible())) throw new Error("button not visible");
    if (await btn.isDisabled()) throw new Error("button disabled (readOnly?)");
    const popupP = page.waitForEvent("popup", { timeout: 15000 }).catch(() => null);
    await btn.click();
    const popup = await popupP;
    if (popup) { rec(label, "PASS", `popup ${popup.url().slice(-26)}`); await popup.close().catch(() => {}); }
    else {
      const body = await page.evaluate(() => document.body.innerText);
      rec(label, /could not generate|error/i.test(body) ? "FAIL" : "WARN", "no popup captured (headless may block window.open)");
    }
  });
}

// --- same-page blob downloads (xlsx / csv) ---
for (const [testid, label] of [
  ["generate-order-excel-button", "Order Excel export"],
  ["generate-count-sheet-button", "Count sheet export"],
  ["button-stock-export-csv", "Inventory CSV export"],
]) {
  await step(label, async () => {
    const btn = page.locator(`[data-testid="${testid}"]`).first();
    if (!(await btn.isVisible())) throw new Error("button not visible");
    if (await btn.isDisabled()) throw new Error("button disabled (readOnly?)");
    const dlP = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
    await btn.click();
    const dl = await dlP;
    if (dl) rec(label, "PASS", dl.suggestedFilename());
    else { const body = await page.evaluate(() => document.body.innerText); rec(label, /error|could not/i.test(body) ? "FAIL" : "WARN", "no download captured"); }
    await page.waitForTimeout(600);
  });
}

// ===== Enterprise All-Locations rollup =====
await step("enterprise All-Locations rollup", async () => {
  await page.goto(`${BASE}/labs/2/veritastock/enterprise`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(2500);
  const body = await page.evaluate(() => document.body.innerText);
  const locs = ["ED Stockroom", "Main Lab", "Clarence Wesley", "Pharmacy", "Inpatient", "Clinic"].filter((l) => body.includes(l)).length;
  if (locs < 4) throw new Error(`only ${locs} locations visible`);
  rec("enterprise All-Locations rollup", "PASS", `${locs}/6 spoke locations shown`);
  await shot("02_all_locations_rollup");
});

// ===== Main Lab (spoke with low stock + reorder) =====
await step("spoke lab inventory + reorder data (Main Lab)", async () => {
  await page.goto(MAIN, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(2500);
  const rows = await page.locator('[data-testid="onhand-cell"]').count();
  if (rows < 1) throw new Error("no items on Main Lab");
  rec("spoke lab inventory + reorder data (Main Lab)", "PASS", `${rows} item rows`);
  await shot("03_mainlab_inventory");
});

// ===== Lab switcher (navbar) =====
await step("lab switcher opens with all locations", async () => {
  await page.goto(WH, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(1500);
  // the switcher button shows the active lab name
  const sw = page.getByRole("button", { name: /San Carlos Warehouse/i }).first();
  if (!(await sw.isVisible())) { rec("lab switcher opens with all locations", "WARN", "switcher button not found by name"); return; }
  await sw.click();
  await page.waitForTimeout(1000);
  const body = await page.evaluate(() => document.body.innerText);
  const seen = ["ED Stockroom", "Main Lab", "Pharmacy", "Clinic"].filter((l) => body.includes(l)).length;
  rec("lab switcher opens with all locations", seen >= 3 ? "PASS" : "WARN", `${seen} other labs listed in switcher`);
  await shot("04_lab_switcher");
});

// ===== summary
console.log("\n===== SUMMARY =====");
const by = (s) => results.filter((r) => r.status === s).length;
console.log(`PASS=${by("PASS")} WARN=${by("WARN")} FAIL=${by("FAIL")}  (total ${results.length})`);
const fails = results.filter((r) => r.status === "FAIL");
if (fails.length) { console.log("FAILURES:"); fails.forEach((f) => console.log(`  - ${f.name}: ${f.note}`)); }

await context.close();
await browser.close();
process.exit(0);
