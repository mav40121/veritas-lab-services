// scripts/verify-numeric-inputs-and-stock-scope.mjs
// Gate 3 step 8 browser receipt (2026-10-08), two reports from the Sampson setup call:
//   1. VeritaStock "Units per Order Unit" kept its "1": clearing the box put the 1
//      straight back, so it could only be appended to (1 -> 13, never 2-9). Same
//      shape on 21 other number boxes; all now use DecimalInput (integer mode).
//   2. A user "Working in: Chemistry" could not see an item her owner could: the
//      item defaulted to Core Lab, the department filter rendered blank (Chemistry
//      had no items), and the empty list did not say anything was hidden.
// Also covers VeritaCheck's specimen-count box, which trims entered rows on
// change: retyping 40 as 45 must not pass through 4 (commit on blur).
// LOCAL server + scratch DB only. Usage:
//   PW_BASE=http://localhost:5133 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-numeric-inputs-and-stock-scope.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5133", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const stamp = Date.now();

// Setup: an owner whose saved VeritaStock scope is Chemistry, and one Core Lab item (Natalie's state).
const email = `numfix-${stamp}@example.com`;
const reg = await call("POST", "/api/auth/register", { email, password: "testpass123", name: "Scope Owner", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Scope Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
const uid = sdb.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(uid);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
await call("PATCH", "/api/account/ui-preferences", { veritastock_scope: "Chemistry" }, reg.token);
const seeded = await call("POST", `/api/labs/${labId}/inventory`, { item_name: `Core item ${stamp}`, department: "Core Lab", category: "Reagent", quantity_on_hand: 0 }, reg.token);
check("setup: Core Lab item exists, owner scope saved as Chemistry", !!(seeded.id ?? seeded.item?.id), `lab=${labId}`);
const me = await call("GET", "/api/auth/me", undefined, reg.token);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(`${BASE}/`);
await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); }, [reg.token, me.user ?? me]);

// ── 2. Working-in scope ──────────────────────────────────────────────────────
await page.goto(`${BASE}/labs/${labId}/veritastock`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
const deptText = (await page.getByTestId("filter-dept-select").innerText()).trim();
check("department filter shows the active filter, not blank", deptText === "Chemistry", `shows "${deptText}"`);
const emptyMsg = (await page.getByTestId("inventory-empty-message").innerText()).trim();
check("empty list says a filter is hiding the item", /department: Chemistry/.test(emptyMsg) && /1 item is hidden/.test(emptyMsg), emptyMsg);
await page.screenshot({ path: `${OUT}/stock_scope_empty.png` });
await page.getByTestId("inventory-show-all").click();
await page.waitForTimeout(400);
check("Show all items brings the Core Lab item back", await page.getByText(`Core item ${stamp}`).isVisible());

await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.getByRole("button", { name: "Add Item" }).first().click();
await page.waitForTimeout(500);
const dlgDept = (await page.getByTestId("item-department-select").innerText()).trim();
check("new item starts in the department being viewed", dlgDept === "Chemistry", `shows "${dlgDept}"`);

// ── 1. Number boxes ──────────────────────────────────────────────────────────
async function retype(testId, text) {
  const box = page.getByTestId(testId);
  await box.click();
  await box.press("Control+a");
  await box.press("Backspace");
  const cleared = await box.inputValue();
  await box.type(text);
  return { cleared, typed: await box.inputValue() };
}
const upou = await retype("units-per-order-unit-input", "6");
check("Units per Order Unit clears (the 1 does not come back)", upou.cleared === "", `after clear: "${upou.cleared}"`);
check("Units per Order Unit takes 6", upou.typed === "6", `value "${upou.typed}"`);
const pack = await retype("pack-size-input", "4");
check("Pack Size clears and takes 4", pack.cleared === "" && pack.typed === "4", `cleared "${pack.cleared}", value "${pack.typed}"`);
const lead = await retype("lead-time-input", "7");
check("Lead Time clears and takes 7", lead.cleared === "" && lead.typed === "7", `cleared "${lead.cleared}", value "${lead.typed}"`);
await page.screenshot({ path: `${OUT}/stock_units_typed.png` });
await page.getByPlaceholder("e.g. Troponin I Reagent Kit").fill(`Chem item ${stamp}`);
const [postResp] = await Promise.all([
  page.waitForResponse((r) => r.url().endsWith(`/api/labs/${labId}/inventory`) && r.request().method() === "POST"),
  page.getByRole("dialog").getByRole("button", { name: "Add Item" }).click(),
]);
check("Add Item request accepted", postResp.ok(), `HTTP ${postResp.status()}`);
await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
await page.waitForTimeout(800);
const list = await call("GET", `/api/labs/${labId}/inventory`, undefined, reg.token);
const saved = (Array.isArray(list) ? list : list.items || []).find((i) => i.item_name === `Chem item ${stamp}`);
check("saved item: Chemistry, 6 per order unit, pack of 4, lead time 7",
  !!saved && saved.department === "Chemistry" && Number(saved.units_per_order_unit) === 6 && Number(saved.units_per_count_unit) === 4 && Number(saved.lead_time_days) === 7,
  saved ? `dept=${saved.department} upou=${saved.units_per_order_unit} pack=${saved.units_per_count_unit} lead=${saved.lead_time_days}` : "not saved");
check("new item is visible in the Chemistry list it was added from", await page.getByText(`Chem item ${stamp}`).isVisible());
await page.screenshot({ path: `${OUT}/stock_added_visible.png` });

// ── VeritaCheck specimen count: no trimming mid-typing ───────────────────────
await page.goto(`${BASE}/labs/${labId}/veritacheck?studyType=ref_interval`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.getByRole("tab", { name: "Data Entry" }).click();
await page.waitForTimeout(600);
const rows = () => page.locator("table:has(th:has-text('Specimen ID')) tbody tr").count();
const count = page.getByTestId("ref-num-specimens-input");
await count.click(); await count.press("Control+a"); await count.type("40"); await count.press("Tab");
await page.waitForTimeout(300);
const at40 = await rows();
await count.click(); await count.press("Control+a"); await count.type("4");
await page.waitForTimeout(300);
const midType = await rows();
await count.type("5"); await count.press("Tab");
await page.waitForTimeout(300);
const at45 = await rows();
check("specimen count: 40 rows, still 40 while typing \"4\", then 45", at40 === 40 && midType === 40 && at45 === 45, `40->${at40}, mid-typing->${midType}, 45->${at45}`);
await count.click(); await count.press("Control+a"); await count.press("Backspace"); await count.press("Tab");
await page.waitForTimeout(300);
check("specimen count left empty keeps the current count", (await rows()) === 45 && (await count.inputValue()) === "45", `rows ${await rows()}, box "${await count.inputValue()}"`);
await page.screenshot({ path: `${OUT}/vc_ref_interval_45.png` });

await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
