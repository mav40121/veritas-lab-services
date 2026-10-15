// scripts/verify-duty-change-close-ui.mjs
// Gate 3 browser receipt for BUG-024 (Michael Q72/Q74 = 1, 2026-10-11): on the lab dashboard the Duty-Change
// Reassessments tile offers owners and admins "Not a change" per person, the dialog requires a reason, closing drops
// the open count, and "Show all" lists everyone past the first five. Run against a LOCAL server on a scratch database
// (it registers an owner, provisions a lab, adds staff and test systems; never point it at production). Usage:
//   PW_BASE=http://localhost:5152 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-duty-change-close-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5152", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const email = `dcui-${Date.now()}@example.com`;
const token = (await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Duty Owner", hipaa_acknowledged: true })).token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Duty Change Lab", plan: "hospital" })).labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Duty Change Lab", cliaNumber: "11D7654321", accreditationBody: "CLIA_ONLY", complexity: "high" }, token);
const map = await call("POST", `${L}/veritamap/maps`, { name: "Core" }, token);
const inst = [];
for (const n of ["Chemistry Analyzer A", "Chemistry Analyzer B"]) inst.push((await call("POST", `${L}/veritamap/maps/${map.id}/instruments`, { instrument_name: n, role: "Primary", category: "Chemistry" }, token)).id);
const names = ["Avery", "Blake", "Casey", "Devon", "Emery", "Finley", "Gray"];
const emps = [];
for (const f of names) emps.push((await call("POST", `${L}/staff/employees`, { lastName: "Tech", firstName: f, highestComplexity: "high", performsTesting: true, hireDate: "2018-05-01" }, token)).id);
// Setup session: each person gets Analyzer A (no event). Back-date their baselines 3 days, then add Analyzer B (a real addition -> event).
let setupEvents = 0;
for (const e of emps) setupEvents += (await call("PUT", `${L}/staff/employees/${e}/instruments`, { instrumentIds: [inst[0]] }, token)).dutyChangeEventsCreated ?? 0;
const sdb = new Database(process.env.SCRATCH_DB);
const old = new Date(Date.now() - 3 * 86400000).toISOString();
sdb.prepare(`UPDATE staff_employees SET duties_baseline_at = ? WHERE id IN (${emps.map(() => "?").join(",")})`).run(old, ...emps);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
sdb.close();
let laterEvents = 0;
for (const e of emps) laterEvents += (await call("PUT", `${L}/staff/employees/${e}/instruments`, { instrumentIds: [inst[0], inst[1]] }, token)).dutyChangeEventsCreated ?? 0;
check("fixture: setup assignments raised 0 events; the later addition raised 1 per person (7)", setupEvents === 0 && laterEvents === 7, `setup=${setupEvents} later=${laterEvents}`);

const browser = await chromium.launch();
const open = async (dark = false) => {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, tk]) => { const r = await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${tk}` } }); return r.ok ? r.json() : null; }, [BASE, token]);
  await page.evaluate(([tk, u, lab]) => { localStorage.setItem("veritas_token", tk); if (u) localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(lab)); localStorage.setItem("theme", "light"); }, [token, me, labId]);
  await page.goto(`${BASE}/labs/${labId}/dashboard`, { waitUntil: "networkidle" });
  if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));
  return page;
};
const shot = async (page, file) => { const t = page.getByTestId("duty-change-tile"); await t.scrollIntoViewIfNeeded(); const b = await t.boundingBox(); await page.screenshot({ path: `${OUT}/${file}`, clip: { x: 0, y: Math.max(0, (b?.y ?? 0) - 20), width: 1400, height: Math.min(560, (b?.height ?? 300) + 60) } }); };

let page = await open();
const tile = page.getByTestId("duty-change-tile");
await tile.waitFor({ timeout: 30000 });
const count0 = (await page.getByTestId("duty-change-open-count").innerText()).trim();
const rows0 = await page.getByTestId("duty-change-row").count();
check("tile shows 7 open and the first 5 people, each with 'Not a change' for the owner", count0 === "7 open" && rows0 === 5 && (await page.getByTestId("duty-change-close-open").count()) === 5, `${count0}, rows ${rows0}`);
await page.getByTestId("duty-change-show-all").click();
check("'Show all' lists all 7 people", (await page.getByTestId("duty-change-row").count()) === 7);
await shot(page, "dcui_tile_all_light.png");
await page.getByTestId("duty-change-close-open").first().click();
const dlg = page.getByTestId("duty-change-close-dialog");
await dlg.waitFor({ timeout: 10000 });
const dlgText = (await dlg.innerText()).replace(/\s+/g, " ");
check("dialog names the person and test system, explains the rule, offers reasons", /Chemistry Analyzer B/.test(dlgText) && /reports patient results/.test(dlgText) && /Recorded at setup: existing duty/.test(dlgText), dlgText.slice(0, 220));
await page.getByTestId("duty-change-close-reason-2").check();
check("'Other' with no text keeps Close disabled", await page.getByTestId("duty-change-close-save").isDisabled());
await page.getByTestId("duty-change-close-other").fill("Cross-trained before go-live; competency on file in the binder");
await page.screenshot({ path: `${OUT}/dcui_dialog_light.png` });
await page.getByTestId("duty-change-close-save").click();
await page.waitForTimeout(1500);
const count1 = (await page.getByTestId("duty-change-open-count").innerText()).trim();
check("after closing one person, the tile reads 6 open", count1 === "6 open", count1);
await page.close();

page = await open(true);
await page.getByTestId("duty-change-tile").waitFor({ timeout: 30000 });
check("reload (dark): still 6 open (saved on the server)", (await page.getByTestId("duty-change-open-count").innerText()).trim() === "6 open");
await shot(page, "dcui_tile_dark.png");
await page.close();
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
