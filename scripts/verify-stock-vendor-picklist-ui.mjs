// scripts/verify-stock-vendor-picklist-ui.mjs
// Gate 3 receipt for REQ-137 (Heywood, Victor Zota 2026-11-09: "Can you link vendor directory to the vendor item details
// (drop down)"). Run against a LOCAL production build on a scratch database with a made-up lab (it registers a person and
// provisions a lab, so it refuses any other host). Usage:
//   PW_BASE=http://localhost:5199 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-stock-vendor-picklist-ui.mjs
// In a real browser: the item form's Vendor field offers the lab's active vendor directory as its list, an item saved with a
// directory vendor stores that name, an older item whose vendor isn't in the directory keeps it on edit, and a lab with no
// directory still takes a typed vendor. Light, dark and phone.
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5199", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required.");
const PW = ["Vendor", "pick", "made", "up", "77!"].join("-");
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch { /* not JSON */ }
  return { s: r.status, j };
};
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };
const shots = [];
const shot = async (page, name) => { const file = path.join(OUT, `stock-vendor-picklist-${name}.png`); await page.screenshot({ path: file, animations: "disabled" }); shots.push(file); };

// ── Two made-up labs: one with a vendor directory, one without ───────────────
const stamp = Date.now();
const mkLab = async (tag, labName) => {
  const email = `vendor-pick-${tag}-${stamp}@example.test`;
  const u = (await call("POST", "/api/auth/register", { email, password: PW, name: "Made Up Buyer", hipaa_acknowledged: true })).j;
  const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName, plan: "hospital" })).j.labId;
  scratch((d) => {
    d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
    d.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
  });
  return { token: u.token, labId };
};
const A = await mkLab("dir", "Made-up Vendor Lab");
const B = await mkLab("nodir", "Made-up Lab With No Directory");
const V = `/api/labs/${A.labId}/veritastock/vendors`;
const v1 = await call("POST", V, { name: "Made-up Reagent Supply" }, A.token);
const v2 = await call("POST", V, { name: "Made-up Diagnostics Inc" }, A.token);
const v3 = await call("POST", V, { name: "Made-up Old Vendor" }, A.token);
const arch = await call("PUT", `${V}/${v3.j.id}`, { ...v3.j, status: "archived" }, A.token);
check("directory: two active made-up vendors and one archived", [v1.s, v2.s, v3.s].every((s) => s === 200 || s === 201) && (arch.s === 200 || arch.s === 201), JSON.stringify([v1.s, v2.s, v3.s, arch.s]));
const legacy = await call("POST", `/api/labs/${A.labId}/inventory`, { item_name: "Made-up Older Item", vendor: "Typed Vendor Not In Directory", quantity_on_hand: 0, category: "Reagent", department: "Core Lab" }, A.token);
check("an older item whose vendor isn't in the directory", legacy.s === 200 || legacy.s === 201, `HTTP ${legacy.s}`);

const browser = await chromium.launch();
const errors = [];
const open = async (who, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 950 }, colorScheme: opts.colorScheme || "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/`);
  const me = (await call("GET", "/api/auth/me", undefined, who.token)).j;
  await page.evaluate(([tk, u, scheme]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); localStorage.setItem("theme", scheme); }, [who.token, me, opts.colorScheme || "light"]);
  await page.goto(`${BASE}/labs/${who.labId}/veritastock`, { waitUntil: "networkidle" });
  return page;
};
const openAdd = async (page) => {
  await page.getByRole("button", { name: "Add Item" }).first().click();
  await page.getByTestId("item-vendor").waitFor({ timeout: 15000 });
};
const listValues = (page) => page.evaluate(() => [...document.querySelectorAll("#item-vendor-list option")].map((o) => o.value));
const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// ── Add an item from the directory ───────────────────────────────────────────
const page = await open(A);
await openAdd(page);
await page.waitForFunction(() => document.querySelectorAll("#item-vendor-list option").length > 0, null, { timeout: 10000 }).catch(() => {});
const opts = await listValues(page);
check("the Vendor field is tied to the list", (await page.getByTestId("item-vendor").getAttribute("list")) === "item-vendor-list");
check("the list is the lab's active directory, by name", JSON.stringify(opts) === JSON.stringify(["Made-up Diagnostics Inc", "Made-up Reagent Supply"]), JSON.stringify(opts));
check("the archived vendor is not offered", !opts.includes("Made-up Old Vendor"));
check("the field says where its list comes from", (await page.getByTestId("item-vendor").getAttribute("placeholder")) === "Pick from your vendor directory or type");
await shot(page, "add-item");
await page.getByPlaceholder("e.g. Troponin I Reagent Kit").fill("Made-up Troponin Kit");
await page.getByTestId("item-vendor").fill("Made-up Reagent Supply");
await page.getByRole("button", { name: "Add Item" }).last().click();
await page.getByText("Item added").first().waitFor({ timeout: 10000 }).catch(() => {});
const saved = scratch((d) => d.prepare("SELECT vendor FROM inventory_items WHERE item_name = ? ORDER BY id DESC").get("Made-up Troponin Kit"));
check("the saved item holds the directory vendor's name", saved?.vendor === "Made-up Reagent Supply", JSON.stringify(saved));

// ── An older item keeps its typed vendor on edit ─────────────────────────────
await page.reload({ waitUntil: "networkidle" });
await page.getByText("Made-up Older Item").first().click();
await page.getByTestId("item-vendor").waitFor({ timeout: 15000 });
check("editing an older item shows its typed vendor unchanged", (await page.getByTestId("item-vendor").inputValue()) === "Typed Vendor Not In Directory");
await page.keyboard.press("Escape");

// ── A lab with no directory still takes a typed vendor ───────────────────────
const pb = await open(B);
await openAdd(pb);
await pb.waitForTimeout(800);
check("no directory: the list is empty and the field has no list prompt", (await listValues(pb)).length === 0 && (await pb.getByTestId("item-vendor").getAttribute("placeholder")) === null);
await pb.getByPlaceholder("e.g. Troponin I Reagent Kit").fill("Made-up Plain Item");
await pb.getByTestId("item-vendor").fill("Typed Only Vendor");
await pb.getByRole("button", { name: "Add Item" }).last().click();
await pb.getByText("Item added").first().waitFor({ timeout: 10000 }).catch(() => {});
const savedB = scratch((d) => d.prepare("SELECT vendor FROM inventory_items WHERE item_name = ? ORDER BY id DESC").get("Made-up Plain Item"));
check("no directory: the typed vendor is saved", savedB?.vendor === "Typed Only Vendor", JSON.stringify(savedB));

// ── Dark and phone ───────────────────────────────────────────────────────────
const dark = await open(A, { colorScheme: "dark" });
await openAdd(dark);
check("dark: the page is dark", await dark.evaluate(() => document.documentElement.classList.contains("dark")));
await shot(dark, "add-item-dark");
const phone = await open(A, { viewport: { width: 390, height: 844 } });
await openAdd(phone);
await phone.getByTestId("item-vendor").scrollIntoViewIfNeeded();
check("phone: the form fits with no sideways scroll", await noSideways(phone));
await shot(phone, "add-item-phone");

check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 400));
await browser.close();
console.log(`screenshots: ${shots.length}`);
for (const s of shots) console.log(`  ${s}`);
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
