// scripts/verify-veritacheck-scan-evidence-ui.mjs
// Gate 3 receipt for BUG-135 (Michael 2026-11-09, Q246 = 1): what a lab sees on its scan now that a passing VeritaCheck study is linked
// as evidence and leaves the status to the lab. Run against a LOCAL production build on a scratch database, with made-up people (it
// registers people and writes to the scratch database, so it refuses any other host). Usage:
//   PW_BASE=http://localhost:5199 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-veritacheck-scan-evidence-ui.mjs
// In a real browser, light, dark and phone:
//   - an evidence row (the shape linkVeritaCheckEvidence writes) reads Not Assessed with a "VC evidence" badge and a study link;
//   - a coverage mark on item 29 (the shape syncCoverageScanMarks writes) reads Compliant with a "VC" badge and a coverage link;
//   - an old mark from a passing study on item 21 is counted by the dry run as veritacheck_passing, the write moves it to Not
//     Assessed, and the study stays linked as evidence;
//   - the demo page shows the badge, and the FAQ carries the new wording.
// The rows are seeded in the shapes the server writes; the integration test (tests/integration/veritacheck-scan-evidence.test.ts)
// covers the server writing them.
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5199", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required.");
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `scan-evidence-${name}.png`), fullPage: false, animations: "disabled" });
const call = async (method, p, body, token, headers = {}) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch { /* not JSON */ }
  return { s: r.status, j };
};
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };

// ── A made-up lab ─────────────────────────────────────────────────────────────
const stamp = Date.now();
const email = `scanevidence-${stamp}@example.test`;
const owner = (await call("POST", "/api/auth/register", { email, password: ["Scan", "evidence", "77!"].join("-"), name: "Made Up Director", hipaa_acknowledged: true })).j;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Evidence Lab", plan: "hospital" })).j.labId;
const scanId = (await call("POST", `/api/labs/${labId}/veritascan/scans`, { name: "Made-up Evidence Scan" }, owner.token, { "X-Active-Lab-Id": String(labId) })).j.id;
const OLD_AT = "2026-01-05T12:00:00.000Z";
const OLD_NOTE = "Auto-completed by VeritaCheck®: Made-up Sodium on 2026-01-05";
const EVIDENCE_NOTE = "Evidence from VeritaCheck®: a passing Made-up Sodium study on 2026-11-09";
const COVERAGE_NOTE = "Marked Compliant by VeritaCheck® Coverage on 2026-11-09: every test run on more than one instrument has a current signed, passing correlation (1 of 1).";
let studyId;
scratch((d) => {
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999995' WHERE id = ?").run(labId);
  const userId = d.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
  studyId = Number(d.prepare("INSERT INTO studies (test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at, user_id, lab_id) VALUES ('Made-up Sodium', 'A', 'Made Up', '2026-01-05', 'cal_ver', 4, '[]', '[]', 'pass', ?, ?, ?)").run(OLD_AT, userId, labId).lastInsertRowid);
  const seed = d.prepare("INSERT INTO veritascan_items (scan_id, item_id, status, notes, completion_source, completion_link, completion_note, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  seed.run(scanId, 21, "Compliant", OLD_NOTE, "veritacheck_auto", `/study/${studyId}/results`, OLD_NOTE, OLD_AT); // the old rule's mark
  seed.run(scanId, 30, "Not Assessed", null, "veritacheck_evidence", `/study/${studyId}/results`, EVIDENCE_NOTE, OLD_AT); // the new rule's evidence
  seed.run(scanId, 29, "Compliant", null, "veritacheck_auto", `/labs/${labId}/veritacheck/coverage`, COVERAGE_NOTE, OLD_AT); // a coverage mark
});
const itemsApi = async () => (await call("GET", `/api/labs/${labId}/veritascan/scans/${scanId}/items`, undefined, owner.token, { "X-Active-Lab-Id": String(labId) })).j;
const itemOf = (rows, id) => rows.find((r) => r.item_id === id) || {};

const browser = await chromium.launch();
const errors = [];
const open = async (opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 950 }, colorScheme: opts.colorScheme || "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/`);
  const me = (await call("GET", "/api/auth/me", undefined, owner.token)).j;
  await page.evaluate(([tk, u]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [owner.token, me]);
  return page;
};
const scanUrl = `${BASE}/labs/${labId}/veritascan-app/${scanId}`;
const QUESTIONS = { 21: /Calibration verification performed at least every 6 months/i, 29: /Correlation studies performed when multiple instruments/i, 30: /Precision verification \(EP15/i };
const rowOf = (page, id) => page.locator("div.rounded-lg.mb-1").filter({ hasText: QUESTIONS[id] }).first();
const openScan = async (page) => {
  await page.goto(scanUrl, { waitUntil: "networkidle" });
  await page.getByText("Made-up Evidence Scan").first().waitFor({ state: "attached", timeout: 20000 });
  const header = page.getByRole("button", { name: /Calibration/i }).first();
  if ((await header.count()) && !(await rowOf(page, 21).count())) await header.click();
  await rowOf(page, 21).waitFor({ timeout: 10000 });
};
const badgeText = async (page, id) => (await rowOf(page, id).locator("span.cursor-help").first().innerText().catch(() => "")).trim();
// Close any open tooltip first: a Radix tooltip stays open until the pointer leaves it and its exit animation ends.
const closeTips = async (page) => {
  await page.keyboard.press("Escape").catch(() => {});
  await page.mouse.move(1, 1);
  await page.getByRole("tooltip").first().waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
};
const tooltipOf = async (page, id) => {
  await closeTips(page);
  await rowOf(page, id).locator("span.cursor-help").first().hover();
  const tip = page.getByRole("tooltip").first();
  await tip.waitFor({ timeout: 5000 }).catch(() => {});
  const text = await tip.innerText().catch(() => "");
  const link = await page.locator("[data-radix-popper-content-wrapper] a").first().getAttribute("href").catch(() => null);
  return { text, link };
};

// ── Before the correction ─────────────────────────────────────────────────────
const page = await open();
await openScan(page);
check("evidence row reads Not Assessed", itemOf(await itemsApi(), 30).status === "Not Assessed");
check("evidence row shows the VC evidence badge", (await badgeText(page, 30)) === "VC evidence", await badgeText(page, 30));
const t30 = await tooltipOf(page, 30);
check("evidence tooltip says Evidence from VeritaCheck and holds the note", /Evidence from VeritaCheck®/.test(t30.text) && t30.text.includes(EVIDENCE_NOTE), t30.text);
check("evidence tooltip links the study", /Click to view study/.test(t30.text) && t30.link === `/study/${studyId}/results`, `${t30.text} | ${t30.link}`);
await shot(page, "1-evidence-tooltip");
await page.mouse.move(5, 5);
check("coverage mark shows the VC badge", (await badgeText(page, 29)) === "VC", await badgeText(page, 29));
const t29 = await tooltipOf(page, 29);
check("coverage tooltip links the coverage page", /Click to view coverage/.test(t29.text) && t29.link === `/labs/${labId}/veritacheck/coverage`, `${t29.text} | ${t29.link}`);
await shot(page, "2-coverage-tooltip");
await page.mouse.move(5, 5);
check("old mark on item 21 still reads Compliant with the VC badge", itemOf(await itemsApi(), 21).status === "Compliant" && (await badgeText(page, 21)) === "VC");

// ── The correction: dry run, then write ───────────────────────────────────────
const dry = await call("POST", "/api/admin/veritascan/correct-auto-marks", { dryRun: true }, null, { "x-admin-secret": ADMIN });
const mine = dry.j.by_lab?.find((l) => l.lab_id === labId);
check("dry run counts one passing-study mark in this lab", dry.s === 200 && mine?.veritacheck_passing === 1 && mine?.veritacheck === 0 && mine?.veritacomp === 0, JSON.stringify(mine));
check("dry run leaves the coverage mark out", dry.j.veritacheck_passing?.to_move >= 1 && itemOf(await itemsApi(), 29).status === "Compliant");
check("dry run answer holds no names or notes", !/Made|example\.test|Auto-completed|Evidence from/.test(JSON.stringify(dry.j)));
const wrote = await call("POST", "/api/admin/veritascan/correct-auto-marks", { dryRun: false, expectedTotal: dry.j.total_to_move }, null, { "x-admin-secret": ADMIN });
check("the write moves what the dry run counted", wrote.s === 200 && wrote.j.changed === dry.j.total_to_move && wrote.j.remaining === 0, JSON.stringify(wrote.j).slice(0, 200));
const after = itemOf(await itemsApi(), 21);
check("item 21 now reads Not Assessed, corrected, study still linked", after.status === "Not Assessed" && after.completion_source === "admin_correction" && after.completion_link === `/study/${studyId}/results`, JSON.stringify(after).slice(0, 240));
await openScan(page);
check("item 21 now shows the VC evidence badge", (await badgeText(page, 21)) === "VC evidence", await badgeText(page, 21));
const t21 = await tooltipOf(page, 21);
check("item 21 tooltip explains the move and keeps the study link", /one passing study, which doesn't answer this question for the whole lab\. The study stays linked as evidence\./.test(t21.text) && t21.link === `/study/${studyId}/results`, `${t21.text} | ${t21.link}`);
check("correction note has no em dash", !/—/.test(t21.text));
await shot(page, "3-corrected-item-21");
await page.mouse.move(5, 5);

// ── Dark and phone ────────────────────────────────────────────────────────────
const dark = await open({ colorScheme: "dark" });
await openScan(dark);
check("dark: the page is in dark mode", await dark.evaluate(() => document.documentElement.classList.contains("dark")));
check("dark: the VC evidence badge shows", (await badgeText(dark, 30)) === "VC evidence");
await tooltipOf(dark, 30);
await shot(dark, "4-evidence-dark");
const phone = await open({ viewport: { width: 390, height: 844 } });
await openScan(phone);
check("phone: the VC evidence badge shows", (await badgeText(phone, 21)) === "VC evidence");
check("phone: no sideways scroll", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await rowOf(phone, 21).scrollIntoViewIfNeeded();
await shot(phone, "5-phone");

// ── The demo page and the FAQ ─────────────────────────────────────────────────
const demoScan = scratch((d) => d.prepare("SELECT s.id FROM veritascan_scans s JOIN users u ON u.id = s.user_id WHERE u.email = 'demo@veritaslabservices.com' ORDER BY s.id LIMIT 1").get());
check("demo scan exists on the scratch database", !!demoScan);
if (demoScan) {
  scratch((d) => d.prepare("UPDATE veritascan_items SET status = 'Not Assessed', completion_source = 'veritacheck_evidence', completion_link = '/study/1/results', completion_note = ? WHERE scan_id = ? AND item_id = 22").run(EVIDENCE_NOTE, demoScan.id));
  const demo = await open();
  await demo.goto(`${BASE}/demo/compliance`, { waitUntil: "networkidle" });
  // The demo's module tabs are buttons; VeritaScan's opens a domain list, and a domain expands on click.
  await demo.getByRole("button", { name: /^VeritaScan/ }).first().click();
  const cal = demo.getByRole("button", { name: /Calibration/i }).first();
  await cal.waitFor({ timeout: 10000 }).catch(() => {});
  if (await cal.count()) await cal.click();
  const demoBadge = demo.getByText("VC evidence", { exact: true }).first();
  await demoBadge.waitFor({ timeout: 10000 }).catch(() => {});
  check("demo page shows the VC evidence badge", (await demoBadge.count()) === 1);
  if (await demoBadge.count()) { await demoBadge.scrollIntoViewIfNeeded(); await demoBadge.hover(); await demo.waitForTimeout(500); }
  await shot(demo, "6-demo");
}
const faq = await open();
await faq.goto(`${BASE}/faq`, { waitUntil: "networkidle" });
const faqText = await faq.evaluate(() => document.body.innerText + " " + Array.from(document.querySelectorAll("script[type='application/ld+json']")).map((s) => s.textContent).join(" "));
const q1 = faq.getByText("What is VeritaScan", { exact: false }).first();
if (await q1.count()) { await q1.click().catch(() => {}); await faq.waitForTimeout(400); }
const visible = await faq.evaluate(() => document.body.innerText);
check("FAQ: VeritaScan answer says the study attaches itself as evidence", /attaches itself as evidence on the matching VeritaScan® items, and the lab sets the answer/.test(visible + faqText));
check("FAQ: the old 'marks the matching VeritaScan items complete' wording is gone", !/marks the matching VeritaScan® items complete/.test(visible + faqText) && !/studies in VeritaCheck® mark matching VeritaScan® items complete/.test(visible + faqText));
await shot(faq, "7-faq");
check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 400));

await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
