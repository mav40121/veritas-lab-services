// Authenticated browser QA of the seeded San Carlos demo on the live
// VeritaStock service. Drives the real UI (not just API): inventory grid +
// All-Locations enterprise rollup. Token passed via PW_TOKEN env.
import { chromium } from "@playwright/test";

const BASE = process.env.VS_BASE || "https://veritastock-production.up.railway.app";
const TOKEN = process.env.PW_TOKEN;
const SHOT = process.env.SHOT_DIR || "C:/Users/veril/Desktop/Verita Products";
if (!TOKEN) { console.error("PW_TOKEN not set"); process.exit(2); }

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
let fail = 0;
const ok = (c, m) => { console.log(`[${c ? "PASS" : "FAIL"}] ${m}`); if (!c) fail++; };

// inject auth (token + user), same as tests/playwright/_auth.ts
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
const me = await page.evaluate(async ([b, t]) => {
  try { const r = await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } }); return r.ok ? await r.json() : null; }
  catch { return null; }
}, [BASE, TOKEN]);
const user = me && (me.user || me);
ok(!!user, `auth/me resolved user (${user && user.email})`);
await page.evaluate(([t, u]) => {
  localStorage.setItem("veritas_token", t);
  if (u) localStorage.setItem("veritas_user", JSON.stringify(u));
}, [TOKEN, user]);

// 1. Inventory grid for the warehouse (lab 2)
await page.goto(`${BASE}/labs/2/veritastock`, { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(2500);
let body = await page.evaluate(() => document.body.innerText);
ok(/__STOCK_DEPLOYMENT__/.test(await page.content()) || await page.evaluate(() => window.__STOCK_DEPLOYMENT__ === true), "VeritaStock flag active");
ok(!/You spent years mastering the science/i.test(body), "no VeritaAssure hero");
// look for a seeded catalog number / item name and reorder signals
const invHasItems = /RGT-|CTRL-|SUP-|Reagent|Control|Tube|Glove|Pipette|Tosoh/i.test(body);
ok(invHasItems, "inventory grid shows seeded items");
const invMentionsWarehouse = /Warehouse|San Carlos/i.test(body);
ok(invMentionsWarehouse, "shows San Carlos / Warehouse context");
await page.screenshot({ path: `${SHOT}/QA_veritastock_inventory.png`, fullPage: true });

// 2. All-Locations enterprise rollup
await page.goto(`${BASE}/labs/2/veritastock/enterprise`, { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(2500);
body = await page.evaluate(() => document.body.innerText);
const rollupHasLocations = /ED Stockroom|Main Lab|Clarence Wesley|Pharmacy|Inpatient|Clinic/i.test(body);
ok(rollupHasLocations, "enterprise rollup lists multiple locations");
const rollupHasItems = /RGT-|Reagent|Tosoh|Control|Tube|Glove/i.test(body);
ok(rollupHasItems, "enterprise rollup shows items");
await page.screenshot({ path: `${SHOT}/QA_veritastock_all_locations.png`, fullPage: true });

await browser.close();
console.log(fail === 0 ? "ALL PASS" : `${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
