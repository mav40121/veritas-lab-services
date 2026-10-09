// scripts/verify-unit-label.mjs
// Receipt (2026-10-08): unit wording on VeritaStock / inventory screens and the
// vendor order document. Every screen appended a bare "s", so Sampson Regional's
// 64 chemistry items counted in boxes read "0 boxs", and "each" read "eachs".
// Michael Q17 "1": fix every instance with one shared rule (shared/units.ts).
//
// Part 1 (always): the rule itself. Part 2 (when PW_BASE is set): VeritaStock in a
// browser on a LOCAL production build + scratch DB.
// Usage:
//   node --import tsx scripts/verify-unit-label.mjs
//   PW_BASE=http://localhost:5142 SCRATCH_DB=<scratch db> OUT=<dir> node --import tsx scripts/verify-unit-label.mjs
import { unitLabel } from "../shared/units.ts";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const eq = (unit, qty, want) => { const got = qty === undefined ? unitLabel(unit) : unitLabel(unit, qty); check(`unitLabel(${JSON.stringify(unit)}${qty === undefined ? "" : ", " + qty}) = "${want}"`, got === want, `got "${got}"`); };

// ── Part 1: the rule ──
eq("box", 0, "boxes");          // Natalie's "0 boxs"
eq("box", 1, "box");
eq("box", 2, "boxes");
eq("box", undefined, "boxes");  // column labels: "On Order (boxes)"
eq("each", 3, "each");          // was "eachs"
eq("each", undefined, "each");
eq("ea", 5, "ea");
eq("test", 100, "tests");
eq("test", 1, "test");
eq("kit", 4, "kits");
eq("vial", 0, "vials");
eq("case", 2, "cases");
eq("pouch", 2, "pouches");
eq("battery", 2, "batteries");
eq("tray", 2, "trays");          // vowel + y
eq("glass", 2, "glasses");
eq("tests", 2, "tests");        // already plural, left alone
eq("pcs", 9, "pcs");
eq("mL", 250, "mL");            // abbreviations never change
eq("uL", 10, "uL");
eq("reagent pack", 3, "reagent packs");
eq("BOX", 2, "BOXES");
eq("Box", 2, "Boxes");
eq("", 2, "units");
eq(null, 1, "unit");
eq("box", -1, "box");           // a delta of -1
eq("box", 0.5, "boxes");

// ── Part 2: the page ──
if (process.env.PW_BASE) {
  const { chromium } = require("@playwright/test");
  const BASE = process.env.PW_BASE, ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
  const call = async (method, path, body, token) => {
    const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j = {}; try { j = await r.json(); } catch {}
    return { status: r.status, body: j };
  };
  const stamp = Date.now();
  const email = `units-${stamp}@example.com`;
  const token = (await call("POST", "/api/auth/register", { email, password: "testpass123", name: "Una Units", hipaa_acknowledged: true })).body.token;
  const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Units Lab", plan: "hospital" })).body.labId;
  if (process.env.SCRATCH_DB) {
    // Skip the first-sign-in welcome so the screenshot shows the inventory table.
    const sdb = new (require("better-sqlite3"))(process.env.SCRATCH_DB);
    sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
    sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
    sdb.close();
  }
  const items = [
    { item_name: "Gluc", order_unit: "box", count_unit: "box", usage_unit: "test", units_per_order_unit: 100, units_per_count_unit: 100, quantity_on_hand: 0 },
    { item_name: "ACTM", order_unit: "box", count_unit: "box", usage_unit: "test", units_per_order_unit: 50, units_per_count_unit: 50, quantity_on_hand: 50 },
    { item_name: "Gauze", order_unit: "each", count_unit: "each", usage_unit: "each", units_per_order_unit: 1, units_per_count_unit: 1, quantity_on_hand: 3 },
    { item_name: "Meter cells", order_unit: "battery", count_unit: "battery", usage_unit: "battery", units_per_order_unit: 1, units_per_count_unit: 1, quantity_on_hand: 2 },
  ];
  for (const it of items) {
    const r = await call("POST", `/api/labs/${labId}/inventory`, { ...it, category: "Reagent", reorder_point: 1 }, token);
    check(`created ${it.item_name}`, r.status === 200 || r.status === 201, `HTTP ${r.status} ${r.body.error || ""}`);
  }
  const me = (await call("GET", "/api/auth/me", undefined, token)).body;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, x]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(x)); }, [token, me.user ?? me]);
  await page.goto(`${BASE}/labs/${labId}/veritastock`, { waitUntil: "networkidle" });
  await page.getByText("Gluc", { exact: true }).first().waitFor({ timeout: 15000 });
  const rowText = async (name) => (await page.locator("tr", { has: page.getByText(name, { exact: true }) }).first().innerText()).replace(/\s+/g, " ");
  const gluc = await rowText("Gluc"), actm = await rowText("ACTM"), gauze = await rowText("Gauze"), cells = await rowText("Meter cells");
  check("Gluc (0 on hand, counted in boxes) reads '0 boxes' and '0 tests'", /\b0 boxes\b/.test(gluc) && /\(0 tests\)/.test(gluc), gluc.slice(0, 160));
  check("ACTM (one box of 50) reads '1 box' and '50 tests'", /\b1 box\b/.test(actm) && /\(50 tests\)/.test(actm), actm.slice(0, 160));
  check("Gauze reads '3 each', not 'eachs'", /\b3 each\b/.test(gauze) && !/eachs/.test(gauze), gauze.slice(0, 160));
  check("Meter cells reads '2 batteries'", /\b2 batteries\b/.test(cells), cells.slice(0, 160));
  const body = await page.locator("body").innerText();
  check("no 'boxs' or 'eachs' anywhere on the page", !/boxs|eachs|batterys/i.test(body));
  await page.screenshot({ path: `${OUT}/units_veritastock.png`, fullPage: false });
  const dark = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
  await dark.goto(`${BASE}/`);
  await dark.evaluate(([t, x]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(x)); }, [token, me.user ?? me]);
  await dark.goto(`${BASE}/labs/${labId}/veritastock`, { waitUntil: "networkidle" });
  await dark.getByText("Gluc", { exact: true }).first().waitFor({ timeout: 15000 });
  await dark.screenshot({ path: `${OUT}/units_veritastock_dark.png`, fullPage: false });
  await browser.close();
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
