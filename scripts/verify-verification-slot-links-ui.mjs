// scripts/verify-verification-slot-links-ui.mjs
//
// Browser receipt for BUG-200 (2026-11-24): a verification slot links only its own laboratory's records. On a local production build
// with a scratch DB, made-up people and made-up studies:
//   S1. a package whose slot holds a study of another laboratory: the element says "Linked study not available", no result and no name
//   S2. the same on an analyte's row
//   S3. its own study reads as before
//   S4. Unlink clears it; linking one of its own names it, with no result carried over
//   S5. a study that can't be linked to a package says so on its results page
//   S6. the packages list counts only its own; at phone width the row fits
// Screenshots slot_links_light.png, slot_links_dark.png, slot_links_phone.png. Nothing leaves the machine: requests to any other
// host are refused, and the results page's link call (its built-in address) is answered by the local server.
// Run: PW_BASE=http://localhost:5199 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-verification-slot-links-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a); } finally { db.close(); } };
const pw = ["Slot", "Links", "77!"].join("-");
const stamp = Date.now(), now = new Date().toISOString();
const account = async (tag, lab) => {
  const email = `slui-${tag}-${stamp}@example.com`;
  const token = (await call("POST", "/api/auth/register", { email, password: pw, name: `Made Up ${tag}`, hipaa_acknowledged: true })).body.token;
  const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: lab, plan: "hospital" })).body.labId;
  sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
  sql("UPDATE labs SET is_demo = 0 WHERE id = ?", labId);
  return { token, labId, id: sql("SELECT owner_user_id AS o FROM labs WHERE id = ?", labId).o };
};
const me = await account("owner", "Slot Links Lab"), other = await account("other", "Another Made-up Lab");
const study = (a, name) => Number(sql("INSERT INTO studies (user_id, lab_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at) VALUES (?, ?, ?, 'Unit 1', 'Ann Alyst', '2026-10-15', 'precision', 0.1, ?, '[\"Unit 1\"]', 'pass', ?)",
  a.id, a.labId, name, JSON.stringify([{ level: 1, levelName: "Level 1", values: [1, 1.01, 1.02] }]), now).lastInsertRowid);
const mine = study(me, "Sodium of this lab"), theirs = study(other, "Sodium of another lab");
const pack = (a, name) => Number(sql("INSERT INTO veritacheck_verifications (user_id, lab_id, instrument_name, trigger_type, elements, created_at, updated_at) VALUES (?, ?, ?, 'new_instrument', '[\"precision\",\"carryover\"]', ?, ?)", a.id, a.labId, name, now, now).lastInsertRowid);
const slot = (v, element, studyId, passed, analyteId = null) => Number(sql("INSERT INTO veritacheck_verification_studies (verification_id, element, study_id, passed, result_summary, analyte_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'a result', ?, ?, ?)", v, element, studyId, passed, analyteId, now, now).lastInsertRowid);
const v1 = pack(me, "Package one"), v2 = pack(me, "Package two");
const s1 = slot(v1, "precision", theirs, 1), s1b = slot(v1, "carryover", null, null);
const an = (v, name) => Number(sql("INSERT INTO veritacheck_verification_analytes (verification_id, analyte_name, created_at, updated_at) VALUES (?, ?, ?, ?)", v, name, now, now).lastInsertRowid);
const a1 = an(v2, "Sodium"), a2 = an(v2, "Potassium");
const s2 = slot(v2, "precision", theirs, 1, a1), s2own = slot(v2, "precision", mine, null, a2);

const browser = await chromium.launch();
const openAs = async (p, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1200, height: 900 }, colorScheme: opts.dark ? "dark" : "light", bypassCSP: true });
  const page = await ctx.newPage();
  await page.route((url) => url.origin !== new URL(BASE).origin, async (route) => {
    const u = new URL(route.request().url());
    if (!/^\/api\/veritacheck\/verifications\//.test(u.pathname)) return route.abort();
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" } });
    const r = await fetch(BASE + u.pathname, { method: route.request().method(), headers: { "Content-Type": "application/json", Authorization: route.request().headers().authorization || "" }, body: route.request().postData() || undefined });
    return route.fulfill({ status: r.status, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }, body: await r.text() });
  });
  await page.goto(`${BASE}/`);
  const who = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, me.token]);
  await page.evaluate(([t, u, l, dark]) => {
    localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(l));
    if (dark) localStorage.setItem("theme", "dark");
  }, [me.token, who, me.labId, !!opts.dark]);
  await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
  return page;
};
const PACK = (v) => `/labs/${me.labId}/dashboard/verifications?verification=${v}`;

try {
  const page = await openAs(PACK(v1));
  await page.getByTestId(`study-unavailable-${s1}`).waitFor({ timeout: 15000 });
  let text = await page.locator("main, body").first().innerText();
  check("S1. the element says the study isn't available, with no result and no name", (await page.getByTestId(`study-unavailable-${s1}`).innerText()).includes("Linked study not available") && !/another lab|\bPASS\b|a result/.test(text), text.slice(0, 200));
  await page.screenshot({ path: `${OUT}/slot_links_light.png`, fullPage: true });
  const dark = await openAs(PACK(v1), { dark: true });
  await dark.getByTestId(`study-unavailable-${s1}`).waitFor({ timeout: 15000 });
  await dark.screenshot({ path: `${OUT}/slot_links_dark.png`, fullPage: true });
  const phone = await openAs(PACK(v2), { viewport: { width: 390, height: 844 } });
  await phone.getByTestId(`study-unavailable-${s2}`).waitFor({ timeout: 15000 });
  check("S6. at phone width the row fits", await phone.getByTestId("analyte-slot-precision-Sodium").evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().right <= window.innerWidth));
  await phone.screenshot({ path: `${OUT}/slot_links_phone.png`, fullPage: true });

  const two = await openAs(PACK(v2));
  const row = two.getByTestId("analyte-slot-precision-Sodium"), ownRow = two.getByTestId("analyte-slot-precision-Potassium");
  await row.waitFor({ timeout: 15000 });
  text = await row.innerText();
  check("S2. an analyte's row says the same, and offers Run and Link", /Linked study not available/.test(text) && /Run/.test(text) && /Link Existing Study/.test(text) && !/PASS|another lab/.test(text), text);
  check("S3. its own study reads as before", /Linked: Sodium of this lab/.test(await ownRow.innerText()), await ownRow.innerText());

  await row.getByRole("button", { name: "Unlink" }).click();
  await two.getByTestId(`study-unavailable-${s2}`).waitFor({ state: "detached", timeout: 8000 });
  const cleared = sql("SELECT study_id, passed, result_summary FROM veritacheck_verification_studies WHERE id = ?", s2);
  check("S4. Unlink clears it and its result", cleared.study_id === null && cleared.passed === null && cleared.result_summary === null, JSON.stringify(cleared));
  await page.getByRole("button", { name: "Link Existing Study" }).first().click();
  await page.getByText("Select a completed study to link").click();
  await page.getByRole("option", { name: /Sodium of this lab/ }).click();
  await page.getByText("Linked: Sodium of this lab").waitFor({ timeout: 8000 });
  const linked = sql("SELECT study_id, passed FROM veritacheck_verification_studies WHERE id = ?", s1);
  check("S4. linking one of its own names it, with no result carried over", linked.study_id === mine && linked.passed === null && !/\bPASS\b/.test(await page.locator("main, body").first().innerText()), JSON.stringify(linked));

  // S5: a package of the other lab, named by the results page's address
  const vTheirs = pack(other, "Their package"), sTheirs = slot(vTheirs, "precision", null, null), sOk = s1b;
  const bad = await openAs(`/labs/${me.labId}/study/${mine}/results?verificationId=${vTheirs}&element=precision&slotId=${sTheirs}&studyPassed=1`);
  const status = bad.getByTestId("verification-link-status");
  await status.waitFor({ timeout: 15000 });
  await bad.waitForFunction(() => /could not be linked/.test(document.querySelector('[data-testid="verification-link-status"]')?.textContent || ""), null, { timeout: 8000 }).catch(() => {});
  check("S5. a study that can't be linked says so", /could not be linked to your Instrument Verification Package/.test(await status.innerText()) && sql("SELECT study_id FROM veritacheck_verification_studies WHERE id = ?", sTheirs).study_id === null, await status.innerText());
  const good = await openAs(`/labs/${me.labId}/study/${mine}/results?verificationId=${v1}&element=carryover&slotId=${sOk}&studyPassed=1`);
  await good.getByTestId("verification-link-status").waitFor({ timeout: 15000 });
  await good.waitForTimeout(1500);
  check("S5. and one that can reads as before", /^Study linked to your Instrument Verification Package$/.test(await good.getByTestId("verification-link-status").innerText()) && sql("SELECT study_id, passed FROM veritacheck_verification_studies WHERE id = ?", sOk).study_id === mine);

  sql("UPDATE veritacheck_verification_studies SET study_id = ?, passed = 0 WHERE id = ?", theirs, s2own);
  const list = (await call("GET", `/api/labs/${me.labId}/veritacheck/verifications`, undefined, me.token)).body;
  check("S6. the list counts only its own", list.find((v) => v.id === v2).failed_count === 0 && list.find((v) => v.id === v1).passed_count === 1, JSON.stringify(list.map((v) => [v.id, v.passed_count, v.failed_count])));
} catch (e) { check("ran to the end", false, String(e?.stack || e).slice(0, 600)); }
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
