// scripts/verify-digest-pdf-notice-ui.mjs
//
// Browser receipt (Gate 3 step 8) for the compliance digest's issue PDF and notice email (Michael 2026-11-11, Q281 = 1 and
// Q284 = 1; PR 5 of 5; the approved PDF mock of 2026-11-11). Local production build and a scratch DB only (PW_BASE must be
// localhost), with a made-up owner, medical director, Staff login, lab, findings and certificate, written through the app's own
// routes or the scratch DB. The server runs with no RESEND_API_KEY, so the notice's mailer refuses every send; the receipt
// checks that from the audit row ("0 sent"). It checks:
//   O1. the owner drafts last month, turns the review box on, writes a note and publishes, all on screen
//   O2. a published issue's header carries Download PDF at its top right (the screen mock); a draft's doesn't
//   O3. Download PDF downloads a PDF: the lab's name, CLIA, the period, the leadership version, the note, the change words,
//       the review box, the footer with Page 1 of 1, one page, no em dash; page 1 is rendered to PNG (PyMuPDF, python -E)
//   O4. a second issue drafted with the review box turned on and then off again: its PDF has no review box
//   N1. the Notice email card shows the count before sending; Send notice opens a confirm naming that count
//   N2. confirming sends it: the card shows the sent date and count, the issue row records them, the audit row says the mailer
//       sent nothing (no key on this local server)
//   N3. a second send is refused: a page that opened its confirm before the first send gets "already went out" when it
//       confirms, and a direct POST gets 409 NOTICE_SENT
//   R1. the medical director (a reader, not an admin) gets Download PDF and the same PDF, and no Notice email card
//   D1. dark mode: the button and the sent state read at 4.5:1 or better; P1. phone width: no sideways scroll
// Screenshots and the PDFs go to OUT and are copied to docs/receipts/digest-pdf/.
// Run: PW_BASE=http://localhost:5213 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-digest-pdf-notice-ui.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "", ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) { console.error(`PW_BASE must be a localhost URL, not "${BASE}"`); process.exit(2); }
if (!process.env.SCRATCH_DB) { console.error("SCRATCH_DB is required"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a).lastInsertRowid; } finally { db.close(); } };
const pdfPages = (file) => JSON.parse(execFileSync("python", ["-E", "-c",
  "import sys, json, fitz\nsys.stdout.reconfigure(encoding='utf-8')\nprint(json.dumps([p.get_text() for p in fitz.open(sys.argv[1])]))", file]).toString("utf-8"));
const renderPage1 = (file, png) => execFileSync("python", ["-E", "-c",
  "import sys, fitz\nfitz.open(sys.argv[1])[0].get_pixmap(dpi=110).save(sys.argv[2])", file, png]);
const squash = (s) => String(s || "").replace(/\s+/g, " ").trim();
const EM_DASH = String.fromCharCode(0x2014);
const pw = ["Digest", "Pdf", "77!"].join("-");
const stamp = Date.now();
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthTitle = (d) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const monthBefore = (start) => { let y = Number(start.slice(0, 4)), m = Number(start.slice(5, 7)) - 1; if (m < 1) { m = 12; y--; } return `${y}-${String(m).padStart(2, "0")}-01`; };
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// ── A made-up owner, lab and people on the scratch DB ─────────────────────────────────────────────────────────────
const NAMES = { owner: "Made-up Owner Brackenridge", md: "Made-up Director Coldharbour", staff: "Made-up Staff Dunwoody" };
const register = async (tag, name) => {
  const email = `digest-pdf-ui-${tag}-${stamp}@example.com`;
  const r = await call("POST", "/api/auth/register", { email, password: pw, name, hipaa_acknowledged: true });
  return { email, name, token: r.body.token, id: Number(sql("SELECT id FROM users WHERE email = ?", email)?.id) };
};
const OWNER = await register("owner", NAMES.owner);
const MD = await register("md", NAMES.md);
const STAFF = await register("staff", NAMES.staff);
const LAB_NAME = "Made-up Digest PDF Receipt Lab", CLIA = "22D7790033";
const LAB = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: OWNER.email, labName: LAB_NAME, plan: "hospital" })).body.labId;
for (const u of [OWNER, MD, STAFF]) sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?", u.id);
sql("UPDATE labs SET has_completed_onboarding = 1, lab_name = ?, clia_number = ?, time_zone = 'America/New_York', medical_director_email = ? WHERE id = ?", LAB_NAME, CLIA, MD.email, LAB);
const now = new Date().toISOString();
const member = (userId, role = "staff") => sql("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, ?, '{}', 'active', 0, ?, ?, ?)", LAB, userId, role, now, now, now);
member(MD.id);
const staffLab = sql("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", OWNER.id, LAB_NAME, CLIA, LAB, now, now);
const emp = sql("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, title, status, created_at, updated_at) VALUES (?, ?, ?, 'Dunwoody', 'Made-up', 'Made-up Tech', 'active', ?, ?)", staffLab, LAB, OWNER.id, now, now);
member(STAFF.id);
sql("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, staff_employee_id, permissions, invited_at, accepted_at) VALUES (?, ?, ?, 'active', 'staff_portal', ?, ?, '{\"mode\":\"view_all\"}', ?, ?)", OWNER.id, STAFF.email, STAFF.id, LAB, emp, now, now);

const D = `/api/labs/${LAB}/digest`;
const s0 = (await call("GET", `${D}/settings`, undefined, OWNER.token)).body;
const LAST = s0.default_period;
const PRIOR = { start: monthBefore(LAST.start), end: addDays(LAST.start, -1) };
const EARLIER = monthBefore(PRIOR.start);
const PRIOR_SHORT = ["Jan.", "Feb.", "March", "April", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."][Number(PRIOR.start.slice(5, 7)) - 1];
check("setup: a made-up lab, its medical director and a Staff login; the review box off by default; the last finished month",
  LAB > 0 && !!OWNER.token && !!MD.token && s0.review_box === false && /^\d{4}-\d{2}-01$/.test(LAST?.start || ""), JSON.stringify({ LAB, LAST, rb: s0.review_box }));
// A made-up test menu built long ago, with two tests switched on last month (one with a study on file), for the PDF's new tests list.
const mapId = (await call("POST", `/api/labs/${LAB}/veritamap/maps`, { name: "Made-up Chemistry Menu" }, OWNER.token)).body.id;
const instId = (await call("POST", `/api/labs/${LAB}/veritamap/maps/${mapId}/instruments`, { instrument_name: "Made-up Alphamatic 500", role: "Primary", category: "Chemistry" }, OWNER.token)).body.id;
const menu = await call("PUT", `/api/labs/${LAB}/veritamap/maps/${mapId}/instruments/${instId}/tests`, { tests: ["Troponin I", "BNP", "Sodium"].map((analyte) => ({ analyte, specialty: "General Chemistry", complexity: "MODERATE", active: 1 })) }, OWNER.token);
sql("UPDATE veritamap_maps SET created_at = ? WHERE id = ?", `${addDays(LAST.start, -300)}T15:00:00.000Z`, mapId);
sql("UPDATE veritamap_instrument_tests SET active_since = NULL WHERE instrument_id = ?", instId);
sql("UPDATE veritamap_instrument_tests SET active_since = ? WHERE instrument_id = ? AND analyte IN ('Troponin I', 'BNP')", `${addDays(LAST.start, 9)}T16:00:00.000Z`, instId);
sql(`INSERT INTO studies (user_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at, lab_id, lifecycle_state)
  VALUES (?, 'Troponin I', 'Made-up Alphamatic 500', 'MU', ?, 'cal_ver', 0.1, '[]', '[]', 'pass', ?, ?, 'draft')`, OWNER.id, addDays(LAST.start, 12), now, LAB);
check("setup: a made-up test menu with two tests switched on last month", mapId > 0 && instId > 0 && menu.status === 200, JSON.stringify({ mapId, instId, s: menu.status }));
// The prior issue (the month before last), published through the app's routes while 3 made-up findings are open.
for (let i = 0; i < 3; i++) sql("INSERT INTO findings (user_id, lab_id, accreditor, status, due_date, description) VALUES (?, ?, 'CAP', 'open', ?, 'Made-up finding for the PDF receipt')", OWNER.id, LAB, addDays(LAST.end, 90));
const priorId = Number((await call("POST", `${D}/issues`, { periodStart: PRIOR.start }, OWNER.token)).body.id);
const priorPub = await call("POST", `${D}/issues/${priorId}/publish`, {}, OWNER.token);
check("setup: the prior issue is published with 3 open findings in its frozen counts", priorPub.status === 200 && priorPub.body.counts?.findings?.open === 3, JSON.stringify(priorPub.body.counts?.findings));
sql("UPDATE findings SET status = 'closed' WHERE id IN (SELECT id FROM findings WHERE lab_id = ? ORDER BY id LIMIT 2)", LAB);
sql("INSERT INTO lab_certificates (user_id, lab_id, cert_type, cert_name, expiration_date, is_active, created_at, updated_at) VALUES (?, ?, 'other', 'Made-up permit', ?, 1, ?, ?)", OWNER.id, LAB, addDays(priorPub.body.counts.asOf, 30), now, now);

// ── Browser ─────────────────────────────────────────────────────────────────────────────────────────────────────────
let browser;
try { browser = await chromium.launch(); } catch (e) { console.log(`INFO  bundled Chromium didn't start (${String(e.message || e).split("\n")[0]}); using channel chrome`); browser = await chromium.launch({ channel: "chrome" }); }
const go = async (page, url, opts) => { try { return await page.goto(url, opts); } catch (e) { if (!/ERR_NETWORK_CHANGED|ERR_CONNECTION_RESET/.test(String(e?.message))) throw e; console.log("INFO  navigation retried after a network blip"); return page.goto(url, opts); } };
const openAs = async (u, p, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1100, height: 950 }, colorScheme: opts.colorScheme || "light", acceptDownloads: true });
  const page = await ctx.newPage();
  await go(page, `${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, u.token]);
  await page.evaluate(([t, usr, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(usr.user || usr)); localStorage.setItem("veritas_active_lab_id", String(l)); }, [u.token, me, LAB]);
  await go(page, `${BASE}${p}`, { waitUntil: "networkidle" });
  return page;
};
const text = async (page, testId) => squash(await page.getByTestId(testId).first().textContent().catch(() => ""));
const visible = (page, testId) => page.getByTestId(testId).first().isVisible().catch(() => false);
const contrast = (page, testId, bgTestId) => page.evaluate(([t, b]) => {
  const parse = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const lum = ([r, g, b2]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b2); };
  const el = document.querySelector(`[data-testid="${t}"]`), bg = document.querySelector(`[data-testid="${b}"]`);
  if (!el || !bg) return { ratio: 0 };
  // The first ancestor (or the element itself) with a painted background.
  let back = null;
  for (let n = el; n && n !== document.documentElement; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) { back = c; break; } }
  back = back || getComputedStyle(bg).backgroundColor;
  const fg = parse(getComputedStyle(el).color), bk = parse(back);
  const [hi, lo] = [lum(fg), lum(bk)].sort((x, y) => y - x);
  return { ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100, fg, back: bk };
}, [testId, bgTestId]);
const download = async (page, file) => {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByTestId("digest-download-pdf").click()]);
  const to = path.join(OUT, file);
  await dl.saveAs(to);
  return { to, name: dl.suggestedFilename() };
};

// O1. Draft last month on screen, the review box on, a note, publish.
const owner = await openAs(OWNER, `/labs/${LAB}/digest`);
await owner.getByTestId("draft-create").waitFor({ timeout: 20000 });
await owner.getByTestId("draft-create").click();
await owner.getByTestId("draft-editor").waitFor({ timeout: 20000 }).catch(() => {});
const MAIN_ID = Number((owner.url().match(/\/digest\/(\d+)$/) || [])[1]);
check("O2a. a draft's header has no Download PDF", MAIN_ID > 0 && !(await visible(owner, "digest-download-pdf")) && !(await visible(owner, "digest-notice")), owner.url());
check("O1a. the draft took the lab's setting: review box off", (await owner.getByTestId("draft-review-box").getAttribute("data-state")) === "unchecked");
await owner.getByTestId("draft-review-box").click();
const NOTE = "Made-up note for the PDF receipt: findings are down to one and a permit renewal is coming up.";
await owner.getByTestId("draft-note").fill(NOTE);
const put1 = owner.waitForResponse((r) => r.url().includes(`/digest/issues/${MAIN_ID}`) && r.request().method() === "PUT", { timeout: 15000 });
await owner.getByTestId("draft-save").click();
await put1;
await owner.getByTestId("digest-note-text").waitFor({ timeout: 10000 }).catch(() => {});
check("O1b. the review box is turned on and the note saved", sql("SELECT review_box, note FROM digest_issues WHERE id = ?", MAIN_ID)?.review_box === 1 && sql("SELECT note FROM digest_issues WHERE id = ?", MAIN_ID)?.note === NOTE);
await owner.getByTestId("draft-publish").click();
await owner.getByTestId("publish-confirm").waitFor({ timeout: 10000 });
const pubResp = owner.waitForResponse((r) => r.url().includes(`/digest/issues/${MAIN_ID}/publish`), { timeout: 15000 });
await owner.getByTestId("publish-confirm").click();
await pubResp;
await owner.getByTestId("digest-download-pdf").waitFor({ timeout: 20000 }).catch(() => {});
check("O1c. published on screen", sql("SELECT status FROM digest_issues WHERE id = ?", MAIN_ID)?.status === "published" && (await text(owner, "digest-meta")).includes("Published"));
check("5. publishing sent nothing: no notice recorded on the issue", sql("SELECT notice_sent_at FROM digest_issues WHERE id = ?", MAIN_ID)?.notice_sent_at == null);

// O2. Download PDF at the header's top right.
const hb = await owner.getByTestId("digest-header").boundingBox(), bb = await owner.getByTestId("digest-download-pdf").boundingBox(), tb = await owner.getByTestId("digest-title").boundingBox();
check("O2b. Download PDF sits at the header's top right, beside the title block (the screen mock)", !!hb && !!bb && !!tb && bb.x + bb.width > hb.x + hb.width - 40 && bb.y < tb.y + tb.height && bb.x > tb.x + tb.width,
  JSON.stringify({ hb, bb, tb }));
check("O2c. the button reads Download PDF, with its icon", (await text(owner, "digest-download-pdf")) === "Download PDF" && (await owner.getByTestId("digest-download-pdf").locator("svg").count()) === 1);
await owner.evaluate(() => window.scrollTo(0, 0));
await owner.screenshot({ path: `${OUT}/digest-pdf-issue-light.png` });
await owner.getByTestId("digest-header").screenshot({ path: `${OUT}/digest-pdf-header-light.png` });

// O3. Download it.
const main = await download(owner, "digest-main.pdf");
const mainPages = pdfPages(main.to);
const mainAll = squash(mainPages.join("\n"));
renderPage1(main.to, path.join(OUT, "digest-pdf-page1.png"));
check("O3a. a PDF downloads, named for the month", fs.statSync(main.to).size > 5000 && fs.readFileSync(main.to).subarray(0, 5).toString() === "%PDF-" && main.name === `Compliance_Digest_${LAST.start.slice(0, 7)}.pdf`, `${main.name} ${fs.statSync(main.to).size}`);
check("O3b. the PDF names the lab, its CLIA, the period and the leadership version", mainAll.includes(LAB_NAME) && mainAll.includes(`CLIA ${CLIA}`) && mainAll.includes(`${monthTitle(LAST.start)} | Leadership version`), mainAll.slice(0, 300));
check("O3c. the note, the change words against the prior month (findings Better, certificates Worse) and its column heading",
  mainAll.includes(NOTE) && mainAll.includes("Open findings VeritaResponse™ 1 open 3 Better") && /Certificates expiring VeritaLab™ 1 expiring within 90 days 0 Worse/.test(mainAll)
    && mainAll.includes(`Section Module ${MONTHS[Number(LAST.start.slice(5, 7)) - 1]} ${PRIOR_SHORT} Change Detail`), mainAll.slice(0, 1200));
check("O3d. the review box is on the PDF (turned on for this issue)", mainAll.includes("Reviewed by the medical director or designee Print name and title Signature Date"));
const inMonth = MONTHS[Number(LAST.start.slice(5, 7)) - 1];
check("O3f. the new tests list: each test, its analyzer and whether a VeritaCheck® study is on file, then the review box (the mock's order)",
  mainAll.includes(`New tests added in ${inMonth} Test Analyzer VeritaCheck® study on file`) && mainAll.includes("BNP Made-up Alphamatic 500 Not yet") && mainAll.includes("Troponin I Made-up Alphamatic 500 Yes")
    && mainAll.includes(`New tests added VeritaMap® 2 tests added in ${inMonth}`) && mainAll.indexOf("New tests added in") < mainAll.indexOf("Reviewed by the medical director"), mainAll.slice(-600));
check("O3e. one page, the footer with Page 1 of 1, no em dash, no person's name", mainPages.length === 1 && mainAll.includes("VeritaAssure® | Compliance Digest | Confidential, For Internal Lab Use Only Page 1 of 1")
  && !mainAll.includes(EM_DASH) && ![NAMES.owner, NAMES.md, NAMES.staff, "Brackenridge", "Coldharbour", "Dunwoody", "@"].some((n) => mainAll.includes(n)));

// N1. The notice: the count, then a confirm naming it. A second page opens its confirm first and waits.
await owner.getByTestId("digest-notice-count").waitFor({ timeout: 10000 }).catch(() => {});
check("N1a. the Notice email card shows the count before sending: the owner and the medical director (2)", (await text(owner, "digest-notice-count")) === "It would go to 2 people who can sign in." && await visible(owner, "digest-notice-send"),
  await text(owner, "digest-notice-count"));
const stale = await openAs(OWNER, `/labs/${LAB}/digest/${MAIN_ID}`);
await stale.getByTestId("digest-notice-send").waitFor({ timeout: 20000 });
await stale.getByTestId("digest-notice-send").click();
await stale.getByTestId("notice-dialog").waitFor({ timeout: 10000 });
await owner.getByTestId("digest-notice-send").click();
await owner.getByTestId("notice-dialog").waitFor({ timeout: 10000 });
const dialogText = await text(owner, "notice-dialog-text");
check("N1b. Send notice opens a confirm naming the count, saying it carries no numbers and goes once", (await text(owner, "notice-dialog-count")) === "2 people" && dialogText.includes("It carries no numbers") && dialogText.includes("You can send it once")
  && (await text(owner, "notice-confirm")) === "Send to 2 people", dialogText);
await owner.waitForTimeout(400);
await owner.screenshot({ path: `${OUT}/digest-notice-confirm-light.png` });

// N2. Confirm: sent.
const sendResp = owner.waitForResponse((r) => r.url().includes(`/digest/issues/${MAIN_ID}/notice`) && r.request().method() === "POST", { timeout: 15000 });
await owner.getByTestId("notice-confirm").click();
const sendReq = (await sendResp).request();
await owner.getByTestId("digest-notice-sent").waitFor({ timeout: 15000 }).catch(() => {});
const sentRow = sql("SELECT notice_sent_at, notice_sent_count FROM digest_issues WHERE id = ?", MAIN_ID);
check("N2a. the send names the count the confirm showed (expectedCount 2), and the issue records when and how many", JSON.parse(sendReq.postData() || "{}").expectedCount === 2 && !!sentRow?.notice_sent_at && sentRow?.notice_sent_count === 2, JSON.stringify(sentRow));
check("N2b. the card shows the sent date and count, and no Send notice", /^Notice sent [A-Z][a-z]{2} \d{1,2}, \d{4} to 2 people\. It goes once per issue, so it can't be sent again\.$/.test(await text(owner, "digest-notice-sent")) && !(await visible(owner, "digest-notice-send")),
  await text(owner, "digest-notice-sent"));
let finished = null;
for (let i = 0; i < 40 && !finished; i++) { finished = sql("SELECT entity_label FROM audit_log WHERE entity_type = 'digest_issue' AND entity_id = ? AND entity_label LIKE '%notice finished%'", String(MAIN_ID)); if (!finished) await owner.waitForTimeout(250); }
check("N2c. no email left this local server: the mailer refused both (no RESEND_API_KEY here) and the audit row says 0 sent", /notice finished, 0 sent, 2 not sent$/.test(finished?.entity_label || ""), finished?.entity_label || "no finished row");
await owner.getByTestId("digest-notice").evaluate((el) => el.scrollIntoView({ block: "center" }));
await owner.waitForTimeout(300);
await owner.screenshot({ path: `${OUT}/digest-notice-sent-light.png` });
await owner.getByTestId("digest-notice").screenshot({ path: `${OUT}/digest-notice-card-sent-light.png` });

// N3. A second send is refused.
await stale.getByTestId("notice-confirm").click();
await stale.getByTestId("notice-error").waitFor({ timeout: 10000 }).catch(() => {});
check("N3a. the page that opened its confirm before the first send is refused when it confirms: already went out, and its send button turns off",
  (await text(stale, "notice-error")) === "This issue's notice already went out. It is sent once per issue." && await stale.getByTestId("notice-confirm").isDisabled(), await text(stale, "notice-error"));
await stale.waitForTimeout(500);
await stale.screenshot({ path: `${OUT}/digest-notice-second-refused-light.png` });
await stale.keyboard.press("Escape");
await stale.getByTestId("digest-notice-sent").waitFor({ timeout: 10000 }).catch(() => {});
check("N3b. that page then shows the sent state too", await visible(stale, "digest-notice-sent"));
const direct = await call("POST", `${D}/issues/${MAIN_ID}/notice`, { expectedCount: 2 }, OWNER.token);
check("N3c. a direct second send: 409 NOTICE_SENT, and the issue still records one notice to 2", direct.status === 409 && direct.body.code === "NOTICE_SENT" && sql("SELECT notice_sent_count FROM digest_issues WHERE id = ?", MAIN_ID)?.notice_sent_count === 2, JSON.stringify(direct));

// O4. A second issue: the review box turned on, then off again, before publishing; its PDF has no box.
await owner.goto(`${BASE}/labs/${LAB}/digest`, { waitUntil: "networkidle" });
await owner.getByTestId("draft-period").waitFor({ timeout: 15000 });
await owner.getByTestId("draft-period").selectOption(EARLIER);
await owner.getByTestId("draft-create").click();
await owner.getByTestId("draft-editor").waitFor({ timeout: 20000 }).catch(() => {});
const OFF_ID = Number((owner.url().match(/\/digest\/(\d+)$/) || [])[1]);
const saveDraft = async () => { const r = owner.waitForResponse((x) => x.url().includes(`/digest/issues/${OFF_ID}`) && x.request().method() === "PUT", { timeout: 15000 }); await owner.getByTestId("draft-save").click(); await r; await owner.waitForTimeout(300); };
await owner.getByTestId("draft-review-box").click(); await saveDraft();
const onState = sql("SELECT review_box FROM digest_issues WHERE id = ?", OFF_ID)?.review_box;
await owner.getByTestId("draft-review-box").click(); await saveDraft();
const offState = sql("SELECT review_box FROM digest_issues WHERE id = ?", OFF_ID)?.review_box;
check("O4a. the second draft's review box turned on (saved 1), then off (saved 0)", OFF_ID > 0 && OFF_ID !== MAIN_ID && onState === 1 && offState === 0, JSON.stringify({ OFF_ID, onState, offState }));
await owner.getByTestId("draft-publish").click();
await owner.getByTestId("publish-confirm").waitFor({ timeout: 10000 });
await owner.getByTestId("publish-confirm").click();
await owner.getByTestId("digest-download-pdf").waitFor({ timeout: 20000 }).catch(() => {});
const off = await download(owner, "digest-review-box-off.pdf");
const offAll = squash(pdfPages(off.to).join("\n"));
check("O4b. its PDF has no review box, and names its own period", offAll.includes(`${monthTitle(EARLIER)} | Leadership version`) && !/Reviewed by the medical director or designee/.test(offAll) && !/Print name and title/.test(offAll), offAll.slice(0, 200));
renderPage1(off.to, path.join(OUT, "digest-pdf-review-box-off-page1.png"));

// R1. The medical director: a reader, not an admin.
const md = await openAs(MD, `/labs/${LAB}/digest/${MAIN_ID}`);
await md.getByTestId("digest-download-pdf").waitFor({ timeout: 20000 }).catch(() => {});
check("R1a. the medical director reads the issue with Download PDF, and no Notice email card", await visible(md, "digest-download-pdf") && !(await visible(md, "digest-notice")));
const mdPdf = await download(md, "digest-main-medical-director.pdf");
const mdAll = squash(pdfPages(mdPdf.to).join("\n"));
check("R1b. the medical director's PDF: the same lab, period, numbers and change words", mdAll.includes(LAB_NAME) && mdAll.includes(`${monthTitle(LAST.start)} | Leadership version`) && mdAll.includes("Open findings VeritaResponse™ 1 open 3 Better"));
const staffPage = await openAs(STAFF, `/labs/${LAB}/digest/${MAIN_ID}`);
await staffPage.getByTestId("digest-not-found").waitFor({ timeout: 15000 }).catch(() => {});
check("R1c. a Staff login (the issue is for leadership) gets the not-found state, and no button", await visible(staffPage, "digest-not-found") && !(await visible(staffPage, "digest-download-pdf")));

// D1. Dark mode.
const dark = await openAs(OWNER, `/labs/${LAB}/digest/${MAIN_ID}`, { colorScheme: "dark" });
await dark.getByTestId("digest-notice-sent").waitFor({ timeout: 20000 }).catch(() => {});
const darkOn = await dark.evaluate(() => document.documentElement.classList.contains("dark"));
const cBtn = await contrast(dark, "digest-download-pdf", "digest-header"), cSent = await contrast(dark, "digest-notice-sent", "digest-notice");
check("D1. dark mode: Download PDF and the sent state read at 4.5:1 or better", darkOn && cBtn.ratio >= 4.5 && cSent.ratio >= 4.5, JSON.stringify({ darkOn, cBtn, cSent }));
await dark.screenshot({ path: `${OUT}/digest-pdf-issue-dark.png` });
await dark.getByTestId("digest-notice").evaluate((el) => el.scrollIntoView({ block: "center" }));
await dark.waitForTimeout(300);
await dark.screenshot({ path: `${OUT}/digest-notice-sent-dark.png` });
await dark.getByTestId("digest-notice").screenshot({ path: `${OUT}/digest-notice-card-sent-dark.png` });
await dark.getByTestId("digest-header").screenshot({ path: `${OUT}/digest-pdf-header-dark.png` });

// P1. Phone width.
const phone = await openAs(OWNER, `/labs/${LAB}/digest/${MAIN_ID}`, { viewport: { width: 390, height: 844 } });
await phone.getByTestId("digest-download-pdf").waitFor({ timeout: 20000 }).catch(() => {});
const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const pTitle = await phone.getByTestId("digest-title").boundingBox(), pLab = await phone.getByTestId("digest-lab").boundingBox(), pBtn = await phone.getByTestId("digest-download-pdf").boundingBox();
check("P1. on a phone the issue view has no sideways scroll, and Download PDF sits below the title block instead of squeezing it", overflow <= 0 && !!pBtn && !!pLab && !!pTitle && pBtn.y >= pLab.y + pLab.height - 1 && pTitle.height < 45,
  JSON.stringify({ overflow, pTitle, pLab, pBtn }));
await phone.screenshot({ path: `${OUT}/digest-pdf-issue-phone.png`, fullPage: true });

await browser.close();

// The receipts folder in the repo: every screenshot, the rendered pages and the PDFs.
const RECEIPTS = path.join(process.cwd(), "docs", "receipts", "digest-pdf");
fs.mkdirSync(RECEIPTS, { recursive: true });
for (const f of fs.readdirSync(OUT).filter((x) => /\.(png|pdf)$/.test(x))) fs.copyFileSync(path.join(OUT, f), path.join(RECEIPTS, f));
console.log(`INFO  copied ${fs.readdirSync(RECEIPTS).length} files to ${RECEIPTS}`);
console.log(`${passes} PASS, ${failures} FAIL`);
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
