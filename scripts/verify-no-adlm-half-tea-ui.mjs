// scripts/verify-no-adlm-half-tea-ui.mjs
// Gate 3 receipt for Q210 = 1 (Michael 2026-11-06): the unsourced "ADLM recommends half of CLIA TEa" claim is gone from the results screen, the PDFs and the
// public pages. Run against a LOCAL server on a scratch database, with made-up studies (it registers an owner, provisions a lab and writes to SCRATCH_DB, so never
// point it at production). Usage:
//   PW_BASE=http://localhost:5199 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-no-adlm-half-tea-ui.mjs
// In a real browser: each study's narrative on the results page, every branch that used to carry the sentence, then Download PDF, which is saved to OUT. Signed out:
// each public page that made the claim, as a visitor sees it and as the server sends it, with its FAQ schema. Narratives go to OUT/narratives.json so old and new
// builds can be compared.
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5199", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const PW = ["Wording", "chk", "77!"].join("-");
const CLOSING = "Final approval and clinical determination must be made by the laboratory director or designee.";
const CLAIM = /ADLM|half[- ]TEa|half of (?:the )?CLIA|half of TEa|Quality Management Guidelines|adlm\.org|well above the adopted|enhanced quality assurance|internal (?:precision )?goal of/i;
const APPROVED = "CLIA sets no internal goal; the laboratory sets its own criterion. Some laboratories budget a fraction of allowable total error for a given study, and rules of thumb differ: Westgard uses one-third of TEa for bias on calibration verification, and Data Innovations recommends 25 to 50 percent for systematic error. The medical director or designee decides and should document why.";
const CMS = /CMS said in the preamble to CMS-3355-F[^.]*?PT limits were written to grade proficiency testing and (?:weren't|were not) intended as performance goals/;

const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const email = `wording-ui-${Date.now()}@example.com`;
const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "Made Up Owner", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Report Wording UI Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999999' WHERE id = ?").run(labId);

const A = "Made-up Analyzer A", B = "Made-up Analyzer B";
const LEVELS = [50, 100, 150, 200, 250], SODIUM = [118, 130, 142, 153, 165];
const INSIDE = [0.01, -0.012, 0.008, -0.01, 0.005], BETWEEN = [0.07, -0.06, 0.03, -0.02, 0.05], FAILING = [0.15, -0.02, 0.03, -0.02, 0.05];
const ABS_PASS = [1, -1, 0.5, -0.5, 0.2], ABS_FAIL = [9, -1, 0.5, -0.5, 0.2];
const calPoints = (names, pct, offs, assigned) => JSON.stringify(assigned.map((v, i) => ({ level: i + 1, expectedValue: v, instrumentValues: Object.fromEntries(names.map((n, k) => [n, +(pct ? v * (1 + offs[i] * (k === 0 ? 1 : 0.8)) : v + offs[i] * (k === 0 ? 1 : 0.8)).toFixed(3)])) })));
const precPoints = (spread) => JSON.stringify([50, 200].map((m, k) => ({ level: k + 1, levelName: `Level ${k + 1}`, values: Array.from({ length: 20 }, (_, i) => +(m * (1 + spread * (i % 2 ? 1 : -1))).toFixed(3)) })));
const insert = sdb.prepare(`INSERT INTO studies (user_id, created_by_user_id, lab_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at, tea_is_percentage, tea_unit, clia_absolute_floor, clia_absolute_unit, clia_preset_label, material)
  VALUES (@user, @user, @lab, @name, @instrument, 'Made-up Analyst', '2026-11-06', @type, @tea, @points, @instruments, @status, '2026-11-06T00:00:00Z', @isPct, @unit, NULL, NULL, @preset, @material)`);
const add = (c) => Number(insert.run({ user: reg.user.id, lab: labId, name: c.test, instrument: c.names.join(", "), type: c.type, tea: c.tea, points: c.points, instruments: JSON.stringify(c.names), status: c.pass ? "pass" : "fail", isPct: c.pct ? 1 : 0, unit: c.pct ? "%" : "mmol/L", preset: c.preset ?? null, material: c.type === "cal_ver_correlation" ? "Made-up linearity set" : null }).lastInsertRowid);

const pct = { test: "Albumin", tea: 0.08, pct: true, preset: "Albumin (±8%)" };
const abs = { test: "Sodium", tea: 4, pct: false, preset: "Sodium (±4 mmol/L)" };
const CASES = [
  { file: "calver-inside-half", type: "cal_ver", names: [A], ...pct, pass: true, points: calPoints([A], true, INSIDE, LEVELS), half: "4.0" },
  { file: "calver-between", type: "cal_ver", names: [A], ...pct, pass: true, points: calPoints([A], true, BETWEEN, LEVELS), half: "4.0" },
  { file: "calver-fail", type: "cal_ver", names: [A], ...pct, pass: false, points: calPoints([A], true, FAILING, LEVELS), half: "4.0" },
  { file: "calver-absolute-pass", type: "cal_ver", names: [A], ...abs, pass: true, points: calPoints([A], false, ABS_PASS, SODIUM), half: "200.0" },
  { file: "calver-absolute-fail", type: "cal_ver", names: [A], ...abs, pass: false, points: calPoints([A], false, ABS_FAIL, SODIUM), half: "200.0" },
  { file: "precision-inside-half", type: "precision", names: [A], ...pct, pass: true, points: precPoints(0.02), half: "4.0" },
  { file: "precision-between", type: "precision", names: [A], ...pct, pass: true, points: precPoints(0.07), half: "4.0" },
  { file: "precision-fail", type: "precision", names: [A], ...pct, pass: false, points: precPoints(0.15), half: "4.0" },
  { file: "calver-two-analyzers-inside-half", type: "cal_ver", names: [A, B], ...pct, pass: true, points: calPoints([A, B], true, INSIDE, LEVELS), half: "4.0" },
  { file: "calver-two-analyzers-fail", type: "cal_ver", names: [A, B], ...pct, pass: false, points: calPoints([A, B], true, FAILING, LEVELS), half: "4.0" },
  { file: "calver-correlation-between", type: "cal_ver_correlation", names: [A, B], ...pct, pass: true, points: calPoints([A, B], true, BETWEEN, LEVELS), half: "4.0" },
  { file: "calver-correlation-absolute", type: "cal_ver_correlation", names: [A, B], ...abs, pass: true, points: calPoints([A, B], false, ABS_PASS, SODIUM), half: "200.0" },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
await page.goto(`${BASE}/`);
await page.evaluate(([t, u]) => {
  localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1");
}, [reg.token, reg.user]);

const narratives = {};
for (const c of CASES) {
  const id = add(c);
  await page.goto(`${BASE}/labs/${labId}/study/${id}/results`, { waitUntil: "networkidle" });
  await page.getByTestId("button-download-pdf").first().waitFor({ timeout: 20000 });
  const heading = page.getByText("Study Narrative Summary", { exact: true }).first();
  await heading.waitFor({ timeout: 20000 });
  const box = heading.locator("xpath=ancestor::div[.//p][1]");
  const narrative = (await box.locator("p").first().innerText()).trim();
  narratives[c.file] = narrative;
  const body = await page.locator("body").innerText();
  const hit = body.match(CLAIM);
  check(`${c.file}: results screen shows a narrative`, narrative.length > 40);
  check(`${c.file}: nothing on the results screen makes the claim`, !hit, hit ? JSON.stringify(body.slice(Math.max(0, hit.index - 70), hit.index + 70)) : "");
  check(`${c.file}: half value ±${c.half}% is not in the narrative`, !narrative.includes(`±${c.half}%`));
  check(`${c.file}: reads cleanly where the sentence came out`, !/ {2,}|\s[.,;]|\.\./.test(narrative), narrative.slice(0, 80));
  if (c.type === "cal_ver_correlation") check(`${c.file}: closing sentence stays`, narrative.endsWith(CLOSING));
  await box.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/${c.file}.png` });
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 90000 }), page.getByTestId("button-download-pdf").first().click()]);
  await dl.saveAs(`${OUT}/${c.file}.pdf`);
  check(`${c.file}: Download PDF delivered ${dl.suggestedFilename()}`, dl.suggestedFilename().endsWith(".pdf"));
}
fs.writeFileSync(`${OUT}/narratives.json`, JSON.stringify(narratives, null, 2));

// ── Public pages, signed out ──
const visitor = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const pub = await visitor.newPage();
pub.on("pageerror", (e) => pageErrors.push(String(e)));
const PAGES = [
  { path: "/resources/clia-calibration-verification-method-comparison", file: "calver-article", shot: APPROVED, approved: true, gone: [/safety margin/] },
  { path: "/resources/clia-tea-what-lab-directors-dont-know", file: "tea-article", shot: "Setting an Internal Goal", approved: true, cms: true, has: ["Setting an Internal Goal", "Whether to adopt a fraction of TEa, a PT limit"], gone: [/±4% or ±3 mg\/dL/, /adopt that goal/] },
  { path: "/resources/clia-tea-lookup", file: "tea-lookup", shot: "Setting an internal goal", approved: true, cms: true, has: ["Setting an internal goal", "Does CLIA set an internal goal, such as a fraction of TEa?", "Your lab may adopt tighter internal criteria. Always verify"], faq: "Does CLIA set an internal goal, such as a fraction of TEa?" },
  { path: "/resources/precision-verification-report-interpretation-guide", file: "precision-guide", shot: "complementary acceptance criteria", approved: true, cms: true, has: ["fills in the published PT limit.", "regulatory determination citing the relevant CFR section, and a closing sentence"], gone: [/published recommendations/, /common convention/] },
  { path: "/resources/veritacheck-vs-ep-evaluator", file: "compare-ep", shot: "The report a surveyor reads", has: ["(493.927, 931, 933, 937, 941, 959), and carries a laboratory director or designee signature block"] },
  { path: "/resources/why-veritacheck-vs-legacy-verification", file: "why-veritacheck", has: ["The CFR citation is specialty-correct (Chemistry §493.931, Hematology §493.941, etc.)."] },
];
for (const p of PAGES) {
  await pub.goto(`${BASE}${p.path}`, { waitUntil: "networkidle" });
  await pub.locator("h1").first().waitFor({ timeout: 20000 });
  const text = (await pub.locator("body").innerText()).replace(/\s+/g, " ");
  const hit = text.match(CLAIM);
  check(`${p.path}: nothing a visitor reads makes the claim`, !hit, hit ? hit[0] : "");
  const links = await pub.locator('a[href*="adlm.org"]').count();
  check(`${p.path}: no adlm.org link`, links === 0, `${links} found`);
  if (p.approved) check(`${p.path}: carries the approved text word for word`, text.includes(APPROVED));
  if (p.cms) check(`${p.path}: keeps the CMS preamble sentence`, CMS.test(text));
  for (const h of p.has || []) check(`${p.path}: reads "${h.slice(0, 70)}"`, text.includes(h));
  for (const g of p.gone || []) check(`${p.path}: no longer reads ${g}`, !g.test(text));
  const raw = await (await fetch(BASE + p.path)).text();
  check(`${p.path}: the page the server sends (title, description, schema) makes no claim`, !CLAIM.test(raw), (raw.match(CLAIM) || [""])[0]);
  if (p.faq) {
    const blocks = [...raw.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const faqPage = blocks.map((b) => { try { return JSON.parse(b); } catch { return null; } }).flatMap((j) => (Array.isArray(j) ? j : j?.["@graph"] || [j])).find((n) => n && n["@type"] === "FAQPage");
    const q = faqPage?.mainEntity?.find((e) => e.name === p.faq);
    check(`${p.path}: FAQ schema carries the new question with the approved answer`, q?.acceptedAnswer?.text === APPROVED);
  }
  const shot = p.shot ? pub.getByText(p.shot, { exact: false }).first() : null;
  const hasShot = shot ? (await shot.count()) > 0 : false; // the old build has no such text, and still gets its checks counted
  if (hasShot) {
    await shot.scrollIntoViewIfNeeded();
    await pub.evaluate(() => window.scrollBy(0, -160));
    await pub.screenshot({ path: `${OUT}/${p.file}.png` });
  }
  if (p.file === "tea-lookup" && hasShot) {
    await pub.evaluate(() => document.documentElement.classList.add("dark"));
    await pub.waitForTimeout(150);
    await pub.screenshot({ path: `${OUT}/${p.file}-dark.png` });
    await pub.evaluate(() => document.documentElement.classList.remove("dark"));
    await pub.setViewportSize({ width: 390, height: 844 });
    await pub.waitForTimeout(150);
    await pub.getByText("Setting an internal goal", { exact: false }).first().scrollIntoViewIfNeeded();
    await pub.screenshot({ path: `${OUT}/${p.file}-phone.png` });
    await pub.setViewportSize({ width: 1280, height: 900 });
  }
}
// The marketing one-pager: the route hands back a token, as the page's download button does.
const { token: pdfToken } = await (await fetch(`${BASE}/api/why-veritacheck-pdf`)).json();
const pdf = await fetch(`${BASE}/api/pdf/${pdfToken}`);
const buf = Buffer.from(await pdf.arrayBuffer());
fs.writeFileSync(`${OUT}/why-veritacheck.pdf`, buf);
check("/api/why-veritacheck-pdf delivers a PDF", pdf.ok && buf.subarray(0, 4).toString() === "%PDF", `${pdf.status}, ${buf.length} bytes`);

check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
await browser.close();
sdb.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
