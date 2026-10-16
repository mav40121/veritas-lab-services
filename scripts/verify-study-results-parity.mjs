// scripts/verify-study-results-parity.mjs
//
// Browser receipt for export-all version 2 (2026-10-16). The study results math moved from StudyResultsPage into
// client/src/lib/studyResults.ts so the server can build study PDFs for "Download all records". This proves the page
// still works and that browser and server compute the same results. LOCAL production build + scratch DB only.
//   1. one real study of each type is copied from a production copy (SOURCE_DB, read-only) into the scratch DB's QA lab
//   2. for each: the results page renders, Download PDF posts {study, results} and the PDF downloads (200, application/pdf)
//   3. the results the browser posted are written to OUT/browser-results.json; scripts/verify-study-results-parity-compare.ts
//      then computes the same studies on the server and requires identical JSON
// Run: PW_BASE=http://localhost:5197 SCRATCH_DB=<db> SOURCE_DB=<prod copy> OUT=<dir> node scripts/verify-study-results-parity.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT;
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); try { return { status: r.status, body: await r.json() }; } catch { return { status: r.status, body: {} }; } };

const email = `parity-${Date.now()}@example.com`;
const reg = await call("POST", "/api/auth/register", { email, password: ["Zq", "parity", "7x!"].join("-"), name: "Jordan Ellis", hipaa_acknowledged: true });
const lab = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Riverside Regional Medical Center (Parity QA)", plan: "hospital" })).body?.labId;
check("0. QA owner and lab", !!lab);

// One study of each type from the production copy (newest of each type), copied into the scratch lab.
const src = new Database(process.env.SOURCE_DB, { readonly: true });
// SOURCE_IDS=1,2,3 copies those exact studies instead of the newest of each type.
const pickIds = String(process.env.SOURCE_IDS || "").split(",").map((x) => Number(x.trim())).filter((x) => x > 0);
const types = pickIds.length ? pickIds : src.prepare("SELECT DISTINCT study_type FROM studies ORDER BY study_type").all().map((r) => r.study_type);
const dst = new Database(process.env.SCRATCH_DB);
dst.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(reg.body?.user?.id);
dst.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(lab);
const dstCols = new Set(dst.prepare("PRAGMA table_info(studies)").all().map((c) => c.name));
const copied = [];
for (const t of types) {
  const row = pickIds.length ? src.prepare("SELECT * FROM studies WHERE id = ?").get(t) : src.prepare("SELECT * FROM studies WHERE study_type = ? ORDER BY id DESC LIMIT 1").get(t);
  const cols = Object.keys(row).filter((c) => c !== "id" && dstCols.has(c) && !/^(signoff_group_id|amends_study_id|finalized_by_user_id|archived_by_user_id|verdict_override_by_user_id|created_by_user_id)$/.test(c));
  const vals = cols.map((c) => (c === "lab_id" ? lab : c === "user_id" ? reg.body.user.id : row[c]));
  const id = Number(dst.prepare(`INSERT INTO studies (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...vals).lastInsertRowid);
  copied.push({ id, type: row.study_type, sourceId: row.id });
}
dst.close();
src.close();
check(pickIds.length ? "1. the chosen studies copied" : "1. one study of each type copied", copied.length === types.length && (pickIds.length > 0 || copied.length >= 5), copied.map((c) => `${c.type} #${c.sourceId}`).join(", "));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const csp = [];
page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
await page.goto(`${BASE}/`);
await page.evaluate(([t, u, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify({ ...u, hasCompletedOnboarding: true, onboardingSeen: true })); localStorage.setItem("veritas_active_lab_id", String(l)); }, [reg.body.token, reg.body.user, lab]);
const posted = {};
for (const c of copied) {
  await page.goto(`${BASE}/labs/${lab}/study/${c.id}/results`, { waitUntil: "networkidle" });
  const btn = page.locator('[data-testid="button-download-pdf"], [data-testid="button-download-pdf-sensitivity"]').first();
  const shown = await btn.waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  if (!shown) { check(`2. ${c.type}: results page renders with Download PDF`, false, `study ${c.id}`); continue; }
  const reqP = page.waitForRequest((r) => r.url().endsWith("/api/generate-pdf") && r.method() === "POST", { timeout: 30000 });
  // The page downloads the PDF by following a one-time link, which Playwright reports as a download, not a response.
  const dlP = page.waitForEvent("download", { timeout: 60000 }).catch(() => null);
  await btn.click();
  const req = await reqP.catch(() => null);
  const dl = await dlP;
  const body = req ? JSON.parse(req.postData() || "{}") : {};
  posted[c.id] = { type: c.type, sourceId: c.sourceId, results: body.results ?? null };
  const file = dl ? await dl.path().catch(() => null) : null;
  const head = file ? fs.readFileSync(file).subarray(0, 5).toString() : "";
  const size = file ? fs.statSync(file).size : 0;
  check(`2. ${c.type}: page renders, Download PDF posts results and the PDF downloads`, !!body.results && head === "%PDF-" && size > 10000, `study ${c.id}: ${dl ? dl.suggestedFilename() + " " + size + " bytes" : "no download"}`);
  if (c.type === "cal_ver" || c.type === "method_comparison") await page.screenshot({ path: `${OUT}/study-results-${c.type}.png` });
}
check("3. no Content-Security-Policy violations", csp.length === 0, csp.slice(0, 2).join(" | "));
fs.writeFileSync(`${OUT}/browser-results.json`, JSON.stringify({ scratchDb: process.env.SCRATCH_DB, studies: posted }, null, 1));
await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
