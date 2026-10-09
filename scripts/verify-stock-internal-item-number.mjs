// scripts/verify-stock-internal-item-number.mjs
// Gate 3 receipt for bug 1 (2026-10-09: "Add additional block for Internal Item
// Number" on Add Inventory Item). Run against a LOCAL server on a scratch
// database (it registers an owner and provisions a lab, so never point it at
// production). Usage:
//   PW_BASE=http://localhost:5146 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-stock-internal-item-number.mjs
// In a real browser: the Add Inventory Item form has an Internal Item Number
// field; saving stores it; the list shows "Item # ..."; an API edit that does not
// send the field keeps it; a blank string clears it; the CSV export has the column.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5146", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token, labId) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {}
  return { status: r.status, j };
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const email = `stock-item-${Date.now()}@example.com`;
const token = (await call("POST", "/api/auth/register", { email, password: "testpass123", name: "Stock Owner", hipaa_acknowledged: true })).j.token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Stock Item Lab", plan: "hospital" })).j.labId;
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
await page.goto(`${BASE}/`);
const me = await page.evaluate(async ([b, t]) => { const r = await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } }); return r.ok ? r.json() : null; }, [BASE, token]);
await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); if (u) localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("theme", "light"); const id = (u && (u.user || u).id); if (id) localStorage.setItem(`onboarding_dismissed_${id}`, "1"); }, [token, me]);
await page.goto(`${BASE}/labs/${labId}/veritastock`, { waitUntil: "networkidle" });

// Open Add Inventory Item and fill it.
await page.getByRole("button", { name: /add item|add inventory item/i }).first().click();
const field = page.getByTestId("item-internal-number");
await field.waitFor({ timeout: 15000 });
check("Add Inventory Item form has an Internal Item Number field", await field.isVisible());
await page.locator("input[placeholder*='Troponin']").first().fill("Troponin I Reagent Kit");
await field.fill("MM-104233");
const dialog = page.getByRole("dialog");
await dialog.screenshot({ path: `${OUT}/stock_internal_number_form_light.png` });
await dialog.getByRole("button", { name: /^(save|add item|create|save item)/i }).last().click();
await page.waitForTimeout(1500);
const row = sdb.prepare("SELECT id, internal_item_number, catalog_number FROM inventory_items WHERE lab_id = ? AND item_name = ?").get(labId, "Troponin I Reagent Kit");
check("saving stores the internal item number", row && row.internal_item_number === "MM-104233", JSON.stringify(row));
await page.goto(`${BASE}/labs/${labId}/veritastock`, { waitUntil: "networkidle" });
const shown = page.getByTestId(`internal-item-number-${row.id}`);
await shown.waitFor({ timeout: 15000 });
check("the list shows Item # under the item name", /Item # MM-104233/.test(await shown.innerText()), await shown.innerText());

// API edit that does not send the field keeps it; blank clears it.
const full = { item_name: "Troponin I Reagent Kit", catalog_number: "CAT-1", lot_number: null, department: "Core Lab", category: "Reagent", quantity_on_hand: 3, unit: "each" };
const e1 = await call("PUT", `/api/inventory/${row.id}`, full, token, labId);
const after1 = sdb.prepare("SELECT internal_item_number, catalog_number FROM inventory_items WHERE id = ?").get(row.id);
check("an edit that omits the field keeps it", e1.status === 200 && after1.internal_item_number === "MM-104233" && after1.catalog_number === "CAT-1", `status=${e1.status} ${JSON.stringify(after1)}`);

// CSV export has the column and the value.
const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.getByRole("button", { name: /export csv|csv/i }).first().click()]);
const csv = require("node:fs").readFileSync(await dl.path(), "utf8");
check("CSV export has an Internal Item Number column with the value", /Internal Item Number/.test(csv.split("\n")[0]) && csv.includes("MM-104233"), csv.split("\n")[0].slice(0, 160));

const e2 = await call("PUT", `/api/inventory/${row.id}`, { ...full, internal_item_number: "" }, token, labId);
const after2 = sdb.prepare("SELECT internal_item_number FROM inventory_items WHERE id = ?").get(row.id);
check("a blank string clears it", e2.status === 200 && after2.internal_item_number === null, `status=${e2.status} ${JSON.stringify(after2)}`);

await page.evaluate(() => document.documentElement.classList.add("dark"));
await browser.close();
sdb.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
