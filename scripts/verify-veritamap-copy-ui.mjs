// scripts/verify-veritamap-copy-ui.mjs
// Browser receipt for two VeritaMap wording fixes (Redington PATHFAST, 2026-11-04): the public page cites 42 CFR 493.1281(a) for correlation, not the calibration verification rule,
// and a map with one test reads "1 test". Two instruments naming troponin differently read as a correlation requirement. Made-up lab and map on a scratch DB only.
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-veritamap-copy-ui.mjs
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5197", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const sql = (q, ...a) => { const d = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? d.prepare(q).get(...a) : d.prepare(q).run(...a); } finally { d.close(); } };

const email = `mapcopy-ui-${Date.now()}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Map Copy", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Map Copy Lab", plan: "hospital" })).labId;
const L = `/api/labs/${labId}`;
const uid = sql("SELECT id FROM users WHERE email = ?", email).id;
sql("UPDATE users SET has_completed_onboarding = 1 WHERE id = ?", uid);
sql("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?", labId);

const addMap = async (name, instrument, analyte) => {
  const map = await call("POST", `${L}/veritamap/maps`, { name }, owner.token);
  await call("POST", `${L}/veritamap/maps/${map.id}/instruments`, { instrument_name: instrument, role: "Primary", category: "Chemistry", serial_number: `${name}-1` }, owner.token);
  const inst = sql("SELECT id FROM veritamap_instruments WHERE map_id = ?", map.id).id;
  const t = await call("PUT", `${L}/veritamap/maps/${map.id}/instruments/${inst}/tests`, { tests: [{ analyte, specialty: "General Chemistry", complexity: "MODERATE", active: 1 }] }, owner.token);
  return { map, inst, status: t };
};
const a = await addMap("Made-up POC", "Made-up POC analyzer", "Troponin I");
const b = await addMap("Made-up Chemistry", "Made-up chemistry analyzer", "Troponin-I (cardiac)");
const rows = await call("GET", `${L}/veritamap/maps/${a.map.id}`, undefined, owner.token);
const row = (rows.tests || []).find((t) => /troponin/i.test(t.analyte));
check("setup: a one-test map with a troponin row", !!row, JSON.stringify(a.status).slice(0, 120));
check("the other map's spelling counts as the same test", row?.correlation_instrument_count === 2 && (row?.correlation_peer_instruments || []).length >= 1, JSON.stringify({ count: row?.correlation_instrument_count, peers: row?.correlation_peers }));

const browser = await chromium.launch();
const pub = await browser.newPage({ viewport: { width: 1300, height: 900 } });
await pub.goto(`${BASE}/veritamap`, { waitUntil: "networkidle" });
const text = await pub.locator("body").innerText();
check("the public page cites 493.1281(a) for correlation", /Correlation Required\?[\s\S]{0,80}493\.1281\(a\)/.test(text));
check("it no longer cites the calibration verification rule for correlation", !/Correlation Required\?[\s\S]{0,80}493\.1255/.test(text));
const cite = pub.getByText("42 CFR §493.1281(a)").first();
await cite.scrollIntoViewIfNeeded().catch(() => {});
await pub.screenshot({ path: path.join(OUT, "veritamap-correlation-citation.png") });
await pub.close();

const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
await page.goto(`${BASE}/`);
await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [owner.token, owner.user]);
await page.goto(`${BASE}/labs/${labId}/veritamap-app`, { waitUntil: "networkidle" });
await page.getByText("Made-up POC").first().waitFor({ timeout: 15000 });
const list = await page.locator("body").innerText();
check("a map with one test reads 1 test", /\b1 test\b/.test(list) && !/\b1 tests\b/.test(list));
await page.getByText("Made-up POC").first().scrollIntoViewIfNeeded();
await page.screenshot({ path: path.join(OUT, "veritamap-one-test.png") });
await page.close();

await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
