// scripts/verify-unreadable-study-ui.mjs
// Browser receipt for BUG-084 (Michael Q65 = 1, 2026-10-28): a study saved in a shape the results page cannot read shows
// "This study can't be displayed" with the study number and My Studies, instead of the app-wide "Something went wrong";
// a normal study still renders. Made-up studies on a scratch DB only, written the way the two production cases were
// stored (a PT/INR type holding a correlation layout; an analyzer list saved as plain text). Usage:
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-unreadable-study-ui.mjs
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

const email = `unreadable-ui-${Date.now()}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Unreadable Study UI", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Unreadable UI Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
const uid = sdb.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
sdb.prepare("UPDATE users SET has_completed_onboarding = 1 WHERE id = ?").run(uid);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
const ins = sdb.prepare(`INSERT INTO studies (user_id, lab_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, tea_is_percentage, tea_unit, data_points, instruments, status, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, '%', ?, ?, ?, ?)`);
const now = new Date().toISOString();
const ptLayout = JSON.stringify([1, 2, 3].map((level) => ({ level, expectedValue: null, instrumentValues: { "Analyzer A": null, "Analyzer B": null } })));
const ptId = Number(ins.run(uid, labId, "PT (made-up)", "Analyzer A", "Test", "2026-03-24", "pt_coag", 0.2, ptLayout, JSON.stringify(["Analyzer A", "Analyzer B"]), "fail", now).lastInsertRowid);
const textId = Number(ins.run(uid, labId, "Sodium (made-up)", "Analyzer A", "Test", "2026-03-29", "method_comparison", 0.04, JSON.stringify([{ x: 132, y: 133 }, { x: 138, y: 139 }]), "Analyzer A vs Analyzer B", "fail", now).lastInsertRowid);
const goodLayout = JSON.stringify([{ level: 1, expectedValue: 100, instrumentValues: { "Analyzer A": 101 } }, { level: 2, expectedValue: 200, instrumentValues: { "Analyzer A": 198 } }, { level: 3, expectedValue: 300, instrumentValues: { "Analyzer A": 303 } }]);
const goodId = Number(ins.run(uid, labId, "Glucose (made-up)", "Analyzer A", "Test", "2026-10-28", "cal_ver", 0.1, goodLayout, JSON.stringify(["Analyzer A"]), "pass", now).lastInsertRowid);
sdb.close();

const browser = await chromium.launch();
const open = async (id, scheme = "light") => {
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 }, colorScheme: scheme });
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [owner.token, owner.user]);
  await page.goto(`${BASE}/labs/${labId}/study/${id}/results`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  return page;
};
for (const [label, id] of [["a PT/INR study holding a correlation layout", ptId], ["an analyzer list saved as plain text", textId]]) {
  const page = await open(id);
  const msg = page.locator('[data-testid="study-unreadable"]');
  const body = await page.locator("body").innerText();
  check(`${label}: shows the plain message with the study number and My Studies`, (await msg.count()) === 1 && body.includes(`Study #${id}`) && (await page.getByRole("link", { name: "My Studies" }).count()) === 1, body.slice(0, 160).replace(/\s+/g, " "));
  check(`${label}: not the app-wide "Something went wrong" screen`, !/Something went wrong/.test(body));
  await page.screenshot({ path: path.join(OUT, `unreadable-${id}.png`), fullPage: false });
  await page.close();
}
const good = await open(goodId);
const goodBody = await good.locator("body").innerText();
check("a normal study still renders its results", (await good.locator('[data-testid="study-unreadable"]').count()) === 0 && /Glucose/.test(goodBody) && !/Something went wrong/.test(goodBody), goodBody.slice(0, 120).replace(/\s+/g, " "));
await good.close();
const dark = await open(ptId, "dark");
check("dark mode renders the message", await dark.evaluate(() => document.documentElement.classList.contains("dark")) && (await dark.locator('[data-testid="study-unreadable"]').count()) === 1);
await dark.screenshot({ path: path.join(OUT, "unreadable-dark.png"), fullPage: false });
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
