// scripts/qa-veritastock-financial.mjs
//
// Consolidated browser QA of the integrated VeritaStock financial / materials
// build on the live demo, after the on-order hero items were seeded. Verifies
// the new features render together and captures screenshots for the demo folder.
//
//   DEMO_PASSWORD=... node scripts/qa-veritastock-financial.mjs

import { chromium } from "@playwright/test";
import { mkdirSync } from "fs";

const BASE = process.env.VS_BASE || "https://veritastock-production.up.railway.app";
const EMAIL = process.env.DEMO_EMAIL || "info@veritaslabservices.com";
const PASSWORD = process.env.DEMO_PASSWORD || "";
const OUT = process.env.QA_OUT || "C:/Users/veril/Desktop/Verita Products/demo-run/financial";

const checks = [];
function record(name, pass, detail = "") {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

async function main() {
  if (!PASSWORD) { console.log("DEMO_PASSWORD required"); process.exit(1); }
  mkdirSync(OUT, { recursive: true });

  // Mint a token via the API for auth injection.
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const { token } = await loginRes.json();
  if (!token) { console.log("login failed"); process.exit(1); }
  const me = await (await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const user = me?.user || me;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([t, u]) => {
    localStorage.setItem("veritas_token", t);
    if (u) localStorage.setItem("veritas_user", JSON.stringify(u));
  }, [token, user]);

  // --- Warehouse (lab 2): financial tiles + ABC column ---
  await page.goto(`${BASE}/labs/2/veritastock`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(2500);
  const whText = await page.evaluate(() => document.body.innerText);
  record("Warehouse: $ on Hand tile", /on hand/i.test(whText));
  record("Warehouse: turns/yr line", /turns\/yr/i.test(whText));
  record("Warehouse: days on hand", /days on hand/i.test(whText));
  record("Warehouse: Stockout Risk tile", /stockout risk/i.test(whText));
  record("Warehouse: Expiring $ at risk", /at risk/i.test(whText));
  record("Warehouse: ABC column header", await page.evaluate(() => !!Array.from(document.querySelectorAll("th")).find(t => t.textContent.trim() === "ABC")));
  record("Warehouse: On Order column header", await page.evaluate(() => !!Array.from(document.querySelectorAll("th")).find(t => t.textContent.trim() === "On Order")));
  await page.screenshot({ path: `${OUT}/01-warehouse-tiles-columns.png`, fullPage: true });

  // ABC Class A filter narrows the table.
  // (best-effort: the status select is a custom component; just screenshot the grid)
  await page.screenshot({ path: `${OUT}/02-warehouse-grid.png` });

  // --- Main Lab (lab 4): on-order suppression + receive button ---
  await page.goto(`${BASE}/labs/4/veritastock`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(2500);
  record("Main Lab: Receive button present (item on order)", await page.evaluate(() => !!document.querySelector('[data-testid="button-receive-270"]')));
  // Verify via API that #284 is on order and not flagged reorder.
  const inv = await (await fetch(`${BASE}/api/labs/4/inventory`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const items = Array.isArray(inv) ? inv : inv.items;
  const i284 = items.find((x) => x.id === 284);
  record("Main Lab: #284 on order, reorder flag cleared", i284 && i284.on_order_qty > 0 && i284.needs_reorder === false,
    i284 ? `on_order=${i284.on_order_qty} position=${i284.inventory_position} needs_reorder=${i284.needs_reorder}` : "not found");
  await page.screenshot({ path: `${OUT}/03-mainlab-onorder-receive.png`, fullPage: true });

  // --- Add-item form: safety stock advisor + unit cost ---
  const addBtn = page.getByRole("button", { name: /add item/i }).first();
  await addBtn.click();
  await page.waitForTimeout(900);
  record("Form: Safety Stock Advisor", await page.evaluate(() => !!document.querySelector('[data-testid="safety-stock-advisor"]')));
  record("Form: Unit Cost input", await page.evaluate(() => !!document.querySelector('[data-testid="unit-cost-input"]')));
  record("Form: On Order qty input", await page.evaluate(() => !!document.querySelector('[data-testid="on-order-qty-input"]')));
  const suggested = await page.evaluate(() => { const e = document.querySelector('[data-testid="suggested-safety-days"]'); return e ? e.textContent.trim() : null; });
  record("Form: advisor suggests a value", Number(suggested) > 0, `suggested=${suggested}`);
  await page.screenshot({ path: `${OUT}/04-form-advisor-unitcost.png` });

  await browser.close();
  await fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" });

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed. Screenshots in ${OUT}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.log("error", e.message); process.exit(1); });
