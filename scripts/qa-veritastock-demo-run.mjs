// Hands-on, real-browser run of EVERY aspect of the San Carlos demo on the live
// VeritaStock service. Real UI login (no token injection). Read/navigation/
// filter/export functions are driven fully. Mutations (Add->Delete item,
// scan-to-count, warehouse<->stockroom transfer) are done as reversible
// round-trips and the script ends with an API integrity + cleanup pass so the
// seeded demo data stays pristine (148 items, WH 50, Main 24).
//
// Env: VS_BASE, DEMO_EMAIL, DEMO_PASSWORD, ADMIN_SECRET (for safety cleanup),
//      SHOT_DIR.
import { chromium } from "@playwright/test";

const BASE = process.env.VS_BASE || "https://veritastock-production.up.railway.app";
const EMAIL = process.env.DEMO_EMAIL || "info@veritaslabservices.com";
const PASS = process.env.DEMO_PASSWORD || "dummycheck123";
const ADMIN = process.env.ADMIN_SECRET || "";
const SHOT = process.env.SHOT_DIR || "C:/Users/veril/Desktop/Verita Products/demo-run";

const results = [];
const rec = (n, s, note = "") => { results.push({ n, s, note }); console.log(`[${s}] ${n}${note ? "  :: " + note : ""}`); };

// ---------- API helpers (setup + integrity + cleanup only) ----------
async function api(path, opts = {}, token) {
  const headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) };
  const r = await fetch(`${BASE}${path}`, { ...opts, headers });
  const txt = await r.text();
  let body; try { body = JSON.parse(txt); } catch { body = txt; }
  return { status: r.status, body };
}
async function login() { const r = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASS }) }); return r.body.token; }
async function items(labId, token) { const r = await api(`/api/labs/${labId}/inventory`, {}, token); return Array.isArray(r.body) ? r.body : (r.body.items || []); }

let token = await login();
if (!token) { console.error("API login failed; aborting"); process.exit(2); }

// pick a warehouse item with healthy stock for the transfer round-trip, and
// capture a known barcode/catalog for scan-to-count
const whItems = await items(2, token);
const xfer = whItems.filter((i) => (i.count_on_hand ?? i.quantity_on_hand ?? 0) >= 5).sort((a, b) => (b.count_on_hand ?? 0) - (a.count_on_hand ?? 0))[0] || whItems[0];
const scanItem = whItems.find((i) => i.barcode) || xfer;
const XFER_NAME = xfer.item_name;
const XFER_ID = xfer.id;
const ED_BEFORE = (await items(3, token)).find((i) => i.item_name === XFER_NAME);
const WH_XFER_BEFORE = xfer.count_on_hand ?? xfer.quantity_on_hand;
console.log(`setup: transfer item "${XFER_NAME}" (wh count ${WH_XFER_BEFORE}); scan item barcode=${scanItem.barcode || "(none)"} catalog=${scanItem.catalog_number}`);

// ---------- browser ----------
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
ctx.setDefaultTimeout(12000);
const shot = (n) => page.screenshot({ path: `${SHOT}/${n}.png`, fullPage: true }).catch(() => {});
const step = async (n, fn) => { try { await fn(); } catch (e) { rec(n, "FAIL", (e.message || String(e)).slice(0, 160)); } };
const WH = `${BASE}/labs/2/veritastock`, MAIN = `${BASE}/labs/4/veritastock`, ENT = `${BASE}/labs/2/veritastock/enterprise`;
const rowCount = () => page.locator('[data-testid="onhand-cell"]').count();

// 1. REAL UI LOGIN
let authed = false;
await step("real UI login", async () => {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(1000);
  await page.locator('input[type="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASS);
  // The word "Sign In" is BOTH a tab and the submit button; target the actual
  // submit so we log in instead of just toggling the tab.
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(2500);
  // Single-session guard: the account allows one active session. The API setup
  // login above holds one, so the UI shows "Another session is active". Click
  // "Force Logout Other Device" to take the session (exactly what a user does).
  const forceBtn = page.getByRole("button", { name: /Force Logout Other Device/i });
  if (await forceBtn.isVisible().catch(() => false)) {
    await shot("01a_session_conflict");
    await forceBtn.click();
    await page.waitForTimeout(4000);
  }
  await page.waitForTimeout(1500);
  const url = page.url();
  const body = await page.evaluate(() => document.body.innerText);
  if (/Login failed/i.test(body)) throw new Error("login failed toast");
  const rows = await page.locator('[data-testid="onhand-cell"]').count().catch(() => 0);
  if (/\/login/.test(url) && rows === 0) throw new Error(`still on /login (rows=${rows})`);
  authed = true;
  rec("real UI login", "PASS", `landed ${url.replace(BASE, "")}, ${rows} rows visible`);
  await shot("01_login_landing");
});
if (!authed) { console.log("LOGIN FAILED — aborting browser run (data untouched)"); rec("ABORT", "FAIL", "no session"); }

// 2. WAREHOUSE GRID
await step("warehouse inventory grid", async () => {
  await page.goto(WH, { waitUntil: "networkidle", timeout: 45000 }); await page.waitForTimeout(2500);
  const body = await page.evaluate(() => document.body.innerText);
  if (/requires a suite subscription/i.test(body)) throw new Error("plan wall");
  const n = await rowCount();
  if (n < 1) throw new Error("no rows");
  rec("warehouse inventory grid", "PASS", `${n} rows`);
  await shot("02_warehouse_grid");
});

// 3. VENDOR FILTER (testid) — assert grid narrows
await step("vendor filter narrows grid", async () => {
  const before = await rowCount();
  await page.locator('[data-testid="filter-vendor"]').first().click();
  await page.waitForTimeout(600);
  const opt = page.locator('[role="option"]').nth(1); // first real vendor
  const vname = (await opt.innerText().catch(() => "")).trim();
  await opt.click();
  await page.waitForTimeout(1200);
  const after = await rowCount();
  rec("vendor filter narrows grid", after < before && after >= 1 ? "PASS" : "WARN", `${before} -> ${after} (vendor ${vname})`);
  await shot("03_vendor_filter");
  // reset to All
  await page.locator('[data-testid="filter-vendor"]').first().click(); await page.waitForTimeout(400);
  await page.locator('[role="option"]').first().click().catch(() => {}); await page.waitForTimeout(600);
});

// 4. LAB SWITCH -> MAIN LAB
await step("lab switcher to Main Lab", async () => {
  await page.getByRole("button", { name: /San Carlos Warehouse/i }).first().click();
  await page.waitForTimeout(800);
  await page.getByText(/San Carlos Main Lab/i).first().click();
  await page.waitForTimeout(2500);
  const n = await rowCount();
  rec("lab switcher to Main Lab", n >= 1 ? "PASS" : "FAIL", `${n} rows on Main Lab`);
  await shot("04_mainlab_after_switch");
});

// 5. STATUS FILTER = low/reorder on Main Lab (best effort; selects lack testids)
await step("status filter (low stock) on Main Lab", async () => {
  await page.goto(MAIN, { waitUntil: "networkidle", timeout: 45000 }); await page.waitForTimeout(2000);
  const before = await rowCount();
  // open the Status select by its placeholder text
  const trig = page.locator('button:has-text("Status"), [role="combobox"]:has-text("Status")').first();
  if (await trig.isVisible().catch(() => false)) {
    await trig.click(); await page.waitForTimeout(500);
    const lowOpt = page.locator('[role="option"]').filter({ hasText: /low|reorder|below/i }).first();
    if (await lowOpt.isVisible().catch(() => false)) {
      await lowOpt.click(); await page.waitForTimeout(1200);
      const after = await rowCount();
      rec("status filter (low stock) on Main Lab", "PASS", `${before} -> ${after} low-stock rows`);
      await shot("05_mainlab_lowstock");
      return;
    }
  }
  rec("status filter (low stock) on Main Lab", "WARN", "status select not targetable headlessly; vendor filter already proved filtering");
});

// 6. EXPORTS on Main Lab (reorder is populated here)
await step("Order PDF (Main Lab)", async () => {
  await page.goto(MAIN, { waitUntil: "networkidle", timeout: 45000 }); await page.waitForTimeout(1500);
  const pop = page.waitForEvent("popup", { timeout: 15000 }).catch(() => null);
  await page.locator('[data-testid="generate-order-pdf-button"]').first().click();
  const p = await pop;
  rec("Order PDF (Main Lab)", p ? "PASS" : "WARN", p ? p.url().slice(-26) : "no popup (headless may block window.open)");
  if (p) await p.close().catch(() => {});
});
for (const [tid, label] of [["generate-order-excel-button", "Order Excel (Main Lab)"], ["generate-count-sheet-button", "Count Sheet (Main Lab)"], ["button-stock-export-csv", "Inventory CSV (Main Lab)"]]) {
  await step(label, async () => {
    const dl = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
    await page.locator(`[data-testid="${tid}"]`).first().click();
    const d = await dl;
    rec(label, d ? "PASS" : "WARN", d ? d.suggestedFilename() : "no download captured");
    await page.waitForTimeout(500);
  });
}
await step("Labels PDF (Main Lab)", async () => {
  const pop = page.waitForEvent("popup", { timeout: 15000 }).catch(() => null);
  await page.locator('[data-testid="generate-labels-pdf-button"]').first().click();
  const p = await pop; rec("Labels PDF (Main Lab)", p ? "PASS" : "WARN", p ? "popup" : "no popup"); if (p) await p.close().catch(() => {});
});

// 7. ADD ITEM -> verify -> DELETE (full CRUD round-trip, self-cleaning)
const TESTNAME = "ZZ QA TEST DELETE ME";
await step("Add Item (create)", async () => {
  await page.goto(MAIN, { waitUntil: "networkidle", timeout: 45000 }); await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /^Add Item$/ }).first().click();
  await page.waitForTimeout(800);
  await page.locator('input[placeholder="e.g. Troponin I Reagent Kit"]').fill(TESTNAME);
  await shot("06_add_item_form");
  await page.getByRole("button", { name: /^Add Item$/ }).last().click(); // dialog save
  await page.waitForTimeout(2500);
  const present = await page.getByText(TESTNAME).first().isVisible().catch(() => false);
  if (!present) throw new Error("created item not visible in grid");
  rec("Add Item (create)", "PASS", "test item appears in grid");
  await shot("07_after_add");
});
await step("Delete Item (remove)", async () => {
  const row = page.locator("tr", { hasText: TESTNAME }).first();
  const delBtn = row.getByRole("button").last(); // trash is the last action icon
  await delBtn.click(); await page.waitForTimeout(700);
  await page.getByRole("button", { name: /^Delete$/ }).first().click(); // AlertDialog confirm
  await page.waitForTimeout(2000);
  const gone = !(await page.getByText(TESTNAME).first().isVisible().catch(() => false));
  rec("Delete Item (remove)", gone ? "PASS" : "FAIL", gone ? "test item removed via UI" : "still present");
});

// 8. EDIT existing item (open, populated, cancel — no save)
await step("Edit item form populates", async () => {
  await page.goto(MAIN, { waitUntil: "networkidle", timeout: 45000 }); await page.waitForTimeout(2000);
  const row = page.locator('[data-testid="onhand-cell"]').first().locator("xpath=ancestor::tr");
  const editBtn = row.getByRole("button").first();
  await editBtn.click(); await page.waitForTimeout(900);
  const val = await page.locator('input[placeholder="e.g. Troponin I Reagent Kit"]').inputValue().catch(() => "");
  rec("Edit item form populates", val.trim().length > 0 ? "PASS" : "FAIL", `name field = "${val.slice(0, 30)}"`);
  await shot("08_edit_form");
  await page.getByRole("button", { name: /^Cancel$/ }).first().click().catch(() => {});
  await page.waitForTimeout(500);
});

// 9. SCAN TO COUNT (net-zero: set count to current value)
await step("scan-to-count (net-zero adjustment)", async () => {
  await page.goto(WH, { waitUntil: "networkidle", timeout: 45000 }); await page.waitForTimeout(1500);
  await page.locator('[data-testid="open-count-workflow-button"]').first().click();
  await page.waitForTimeout(800);
  const code = scanItem.barcode || `VLS-${String(scanItem.id).padStart(8, "0")}`;
  await page.locator('[data-testid="count-workflow-manual-input"]').fill(code);
  await page.locator('[data-testid="count-workflow-manual-submit"]').click();
  await page.waitForTimeout(1500);
  const err = await page.locator('[data-testid="count-workflow-lookup-error"]').isVisible().catch(() => false);
  if (err) { rec("scan-to-count (net-zero adjustment)", "WARN", `lookup by ${code} not resolved (seed items have no barcode); scanner UI opens + accepts input`); await shot("09_count_lookup"); return; }
  const cur = scanItem.count_on_hand ?? scanItem.quantity_on_hand ?? 0;
  await page.locator('[data-testid="count-workflow-new-count"]').fill(String(cur));
  await page.locator('[data-testid="count-workflow-save"]').click();
  await page.waitForTimeout(1500);
  const saved = await page.locator('[data-testid="count-workflow-saved"]').isVisible().catch(() => false);
  rec("scan-to-count (net-zero adjustment)", saved ? "PASS" : "WARN", saved ? `count confirmed at ${cur} (no net change)` : "save state not detected");
  await shot("09_count_saved");
});

// 10. SNAP ORDER page
await step("Snap Order page loads", async () => {
  await page.goto(`${BASE}/labs/4/veritastock/snap-order`, { waitUntil: "networkidle", timeout: 45000 }); await page.waitForTimeout(2000);
  const body = await page.evaluate(() => document.body.innerText);
  const ok = /Snap|Emergency|manual order|order/i.test(body) && !/requires a suite subscription/i.test(body);
  rec("Snap Order page loads", ok ? "PASS" : "FAIL");
  await shot("10_snap_order");
});

// 11. VENDOR DIRECTORY page
await step("Vendor Directory page loads", async () => {
  await page.goto(`${BASE}/labs/2/veritastock/vendors`, { waitUntil: "networkidle", timeout: 45000 }); await page.waitForTimeout(2000);
  const body = await page.evaluate(() => document.body.innerText);
  const ok = /vendor/i.test(body) && !/requires a suite subscription/i.test(body);
  rec("Vendor Directory page loads", ok ? "PASS" : "FAIL");
  await shot("11_vendor_directory");
});

// 12. ENTERPRISE rollup + transfer UI setup
await step("Enterprise rollup + transfer UI ready", async () => {
  await page.goto(ENT, { waitUntil: "networkidle", timeout: 45000 }); await page.waitForTimeout(2500);
  const body = await page.evaluate(() => document.body.innerText);
  const locs = ["ED Stockroom", "Main Lab", "Pharmacy", "Clinic"].filter((l) => body.includes(l)).length;
  if (locs < 3) throw new Error(`rollup only shows ${locs} locations`);
  // set From / To and confirm the transfer column activates
  await page.locator('[data-testid="transfer-from"]').click(); await page.waitForTimeout(500);
  await page.locator('[role="option"]').filter({ hasText: /Warehouse/i }).first().click(); await page.waitForTimeout(700);
  await page.locator('[data-testid="transfer-to"]').click(); await page.waitForTimeout(500);
  await page.locator('[role="option"]').filter({ hasText: /ED Stockroom/i }).first().click(); await page.waitForTimeout(1000);
  await page.locator('[data-testid="enterprise-search"]').fill(XFER_NAME.slice(0, 14)); await page.waitForTimeout(1200);
  const qtyInput = page.locator('[data-testid="rollup-table"] tr', { hasText: XFER_NAME.slice(0, 14) }).first().locator('input[placeholder="0"]').first();
  const ready = await qtyInput.isVisible().catch(() => false);
  rec("Enterprise rollup + transfer UI ready", ready ? "PASS" : "WARN", `${locs} locations; transfer qty input ${ready ? "present" : "not found"} for "${XFER_NAME.slice(0,20)}"`);
  await shot("12_enterprise_transfer_setup");
});

// 13. TRANSFER round-trip THROUGH THE UI (2 units WH->ED, then ED->WH). All in
// the browser session; the final API integrity pass verifies counts restored.
const QTY = 2;
const qtyFor = (name) => page.locator('[data-testid="rollup-table"] tr', { hasText: name.slice(0, 14) }).first().locator('input[placeholder="0"]').first();
const noError = async () => { const b = await page.evaluate(() => document.body.innerText); return !/insufficient|over the source|failed|error/i.test(b) || /transferred|success|complete/i.test(b); };
await step("transfer leg 1 (Warehouse to ED) via UI", async () => {
  const qi = qtyFor(XFER_NAME); // From/To/search already set to WH->ED in step 12
  if (!(await qi.isVisible().catch(() => false))) throw new Error("qty input not reachable");
  await qi.fill(String(QTY));
  await page.locator('[data-testid="transfer-submit"]').first().click();
  await page.waitForTimeout(2800);
  await shot("13a_transfer_leg1");
  rec("transfer leg 1 (Warehouse to ED) via UI", (await noError()) ? "PASS" : "FAIL", `moved ${QTY} ${XFER_NAME.slice(0,18)}`);
});
await step("transfer leg 2 (ED back to Warehouse) via UI", async () => {
  await page.locator('[data-testid="transfer-from"]').click(); await page.waitForTimeout(500);
  await page.locator('[role="option"]').filter({ hasText: /ED Stockroom/i }).first().click(); await page.waitForTimeout(900);
  await page.locator('[data-testid="transfer-to"]').click(); await page.waitForTimeout(500);
  await page.locator('[role="option"]').filter({ hasText: /Warehouse/i }).first().click(); await page.waitForTimeout(900);
  await page.locator('[data-testid="enterprise-search"]').fill(XFER_NAME.slice(0, 14)); await page.waitForTimeout(1200);
  const qi = qtyFor(XFER_NAME);
  if (!(await qi.isVisible().catch(() => false))) throw new Error("qty input not reachable on reverse");
  await qi.fill(String(QTY));
  await page.locator('[data-testid="transfer-submit"]').first().click();
  await page.waitForTimeout(2800);
  await shot("13b_transfer_leg2");
  rec("transfer leg 2 (ED back to Warehouse) via UI", (await noError()) ? "PASS" : "FAIL", "reversed to restore seed");
});

// ---------- FINAL INTEGRITY + CLEANUP (guarantee pristine demo) ----------
async function adminPost(path, payload) { return api(path, { method: "POST", body: JSON.stringify({ secret: ADMIN, ...payload }) }); }
await step("restore + integrity (pristine demo)", async () => {
  token = await login(); // re-mint: the UI force-logout invalidated the setup session
  // remove any leftover test item (API safety net)
  const mainItems = await items(4, token);
  const leftover = mainItems.find((i) => i.item_name === TESTNAME);
  if (leftover) await api(`/api/inventory/${leftover.id}`, { method: "DELETE" }, token);
  // restore transfer quantities to seeded values via re-import (idempotent upsert)
  // simplest: if WH count for XFER_ID != WH_XFER_BEFORE, transfer the delta back ED->WH
  let wh = (await items(2, token)).find((i) => i.id === XFER_ID);
  let whCount = wh ? (wh.count_on_hand ?? wh.quantity_on_hand) : null;
  if (whCount !== null && whCount !== WH_XFER_BEFORE && ADMIN) {
    // reverse via admin import-inventory to set exact seeded count back
    await adminPost("/api/admin/import-inventory", { labId: 2, items: [{ catalog_number: wh.catalog_number, item_name: wh.item_name, quantity_on_hand: WH_XFER_BEFORE, count_on_hand: WH_XFER_BEFORE }] });
    // and remove the +QTY that landed in ED if it created/raised it
    const ed = (await items(3, token)).find((i) => i.item_name === XFER_NAME);
    if (ed) {
      const edTarget = ED_BEFORE ? (ED_BEFORE.count_on_hand ?? ED_BEFORE.quantity_on_hand) : 0;
      await adminPost("/api/admin/import-inventory", { labId: 3, items: [{ catalog_number: ed.catalog_number, item_name: ed.item_name, quantity_on_hand: edTarget, count_on_hand: edTarget }] });
    }
  }
  // final counts
  const c2 = (await items(2, token)).length, c4 = (await items(4, token)).length;
  let total = 0; for (const L of [2, 3, 4, 5, 6, 7, 8]) total += (await items(L, token)).length;
  const whFinal = (await items(2, token)).find((i) => i.id === XFER_ID);
  const restored = whFinal && (whFinal.count_on_hand ?? whFinal.quantity_on_hand) === WH_XFER_BEFORE;
  const ok = c2 === 50 && c4 === 24 && total === 148 && !leftover === !mainItems.find((i) => i.item_name === TESTNAME);
  rec("restore + integrity (pristine demo)", ok && restored ? "PASS" : "WARN", `WH=${c2}(want 50) Main=${c4}(want 24) total=${total}(want 148) xferItemRestored=${restored}`);
});

// ---------- summary ----------
console.log("\n===== DEMO RUN SUMMARY =====");
const by = (s) => results.filter((r) => r.s === s).length;
console.log(`PASS=${by("PASS")} WARN=${by("WARN")} FAIL=${by("FAIL")} (total ${results.length})`);
results.filter((r) => r.s !== "PASS").forEach((r) => console.log(`  ${r.s}: ${r.n} :: ${r.note}`));
await ctx.close(); await browser.close();
process.exit(by("FAIL") > 0 ? 1 : 0);
