// scripts/verify-digest-screens-ui.mjs
//
// Browser receipt (Gate 3 step 8) for the compliance digest's screens (Michael 2026-11-11, Q281 = 1; PR 4 of 5; the approved
// screen mock of 2026-11-10). On a local production build with a scratch DB, a made-up owner, lab, three made-up Staff logins
// (two in a made-up lab group, one outside it) and made-up findings and a certificate, all written through the app's own
// routes or the scratch DB, never production:
//   O1. Inspection Readiness links to the Compliance Digest
//   O2. the owner sets the settings: the review box toggle (off by default), acknowledgment by default, a group audience
//   O3. the owner drafts last month (the default period): the draft view shows live counts and the change lines
//   O4. a note with patient information is refused on screen; a clean note saves and shows in the note card
//   O5. Publish confirms the counts' as-of day and the audience, then the issue is published with its counts frozen
//   S1. a Staff login in the group opens it: the cards and the change lines against the prior issue, in the mock's colors
//   S2. it marks the prior issue read (Mark as read); S3. it acknowledges this one (I've read this)
//   S4. a limited Staff login sees no other person's name anywhere on these screens, and no roster
//   O6. the owner sees the roster: counts and names
//   X1. a Staff login outside the audience gets the not-found state, and its list doesn't show the issue
//   D1. dark mode (prefers-color-scheme dark): the reader view, the owner's draft and the roster stay readable
//   P1. phone width: the reader view has no sideways scroll
// Screenshots go to OUT. Run: PW_BASE=http://localhost:5207 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-digest-screens-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a).lastInsertRowid; } finally { db.close(); } };
const pw = ["Digest", "Screens", "77!"].join("-");
const stamp = Date.now();
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDay = (d) => `${SHORT[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`;
const monthTitle = (d) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const monthBefore = (start) => { let y = Number(start.slice(0, 4)), m = Number(start.slice(5, 7)) - 1; if (m < 1) { m = 12; y--; } return `${y}-${String(m).padStart(2, "0")}-01`; };

// ── A made-up owner, lab and people on the scratch DB ─────────────────────────────────────────────────────────────
const NAMES = { owner: "Made-up Owner Quillfeather", staffIn: "Made-up Staff Ingleton", staffIn2: "Made-up Staff Harrowgate", staffOut: "Made-up Staff Outerbridge" };
const register = async (tag, name) => {
  const email = `digest-ui-${tag}-${stamp}@example.com`;
  const r = await call("POST", "/api/auth/register", { email, password: pw, name, hipaa_acknowledged: true });
  return { email, name, token: r.body.token, id: Number(sql("SELECT id FROM users WHERE email = ?", email)?.id) };
};
const OWNER = await register("owner", NAMES.owner);
const STAFF_IN = await register("staffin", NAMES.staffIn);
const STAFF_IN2 = await register("staffin2", NAMES.staffIn2);
const STAFF_OUT = await register("staffout", NAMES.staffOut);
const LAB = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: OWNER.email, labName: "Made-up Digest Screens Lab", plan: "hospital" })).body.labId;
for (const u of [OWNER, STAFF_IN, STAFF_IN2, STAFF_OUT]) sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?", u.id);
sql("UPDATE labs SET has_completed_onboarding = 1, clia_number = '22D7790011', time_zone = 'America/New_York' WHERE id = ?", LAB);
const now = new Date().toISOString();
const member = (userId, role = "staff") => sql("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, ?, '{}', 'active', 0, ?, ?, ?)", LAB, userId, role, now, now, now);
const staffLab = sql("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Made-up Digest Screens Lab', '22D7790011', ?, ?, ?)", OWNER.id, LAB, now, now);
const roster = (first, last) => sql("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'Made-up Tech', 'active', ?, ?)", staffLab, LAB, OWNER.id, last, first, now, now);
const staffSeat = (u, emp) => sql("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, staff_employee_id, permissions, invited_at, accepted_at) VALUES (?, ?, ?, 'active', 'staff_portal', ?, ?, '{\"mode\":\"view_all\"}', ?, ?)", OWNER.id, u.email, u.id, LAB, emp, now, now);
const people = [[STAFF_IN, "Ingleton"], [STAFF_IN2, "Harrowgate"], [STAFF_OUT, "Outerbridge"]];
const emp = {};
for (const [u, last] of people) { member(u.id); emp[u.id] = roster("Made-up", last); staffSeat(u, emp[u.id]); }
const G1 = Number(sql("INSERT INTO lab_groups (lab_id, name, retired, created_by) VALUES (?, 'Made-up Chemistry Bench', 0, ?)", LAB, OWNER.id));
for (const u of [STAFF_IN, STAFF_IN2]) sql("INSERT INTO lab_group_members (group_id, lab_id, employee_id, name, added_by) VALUES (?, ?, ?, ?, ?)", G1, LAB, emp[u.id], u.name, OWNER.id);

const D = `/api/labs/${LAB}/digest`;
const s0 = (await call("GET", `${D}/settings`, undefined, OWNER.token)).body;
const LAST = s0.default_period; // the last finished month on the lab's clock
const PRIOR = { start: monthBefore(LAST.start) };
PRIOR.end = addDays(LAST.start, -1);
const sameYear = PRIOR.start.slice(0, 4) === LAST.start.slice(0, 4);
const PRIOR_LABEL = sameYear ? MONTHS[Number(PRIOR.start.slice(5, 7)) - 1] : monthTitle(PRIOR.start);
check("setup: a made-up lab with three Staff logins, a group of two, the review box off and a monthly default period",
  LAB > 0 && G1 > 0 && !!STAFF_IN.token && s0.review_box === false && s0.ack_default === false && s0.frequency === "monthly" && /^\d{4}-\d{2}-01$/.test(LAST?.start || ""), JSON.stringify({ LAB, LAST, rb: s0.review_box }));

// The prior issue (the month before last), published through the app's routes to the group, while 3 made-up findings are open.
// Due dates well after the lab's today (this month started the day after LAST.end), so nothing reads past due.
for (let i = 0; i < 3; i++) sql("INSERT INTO findings (user_id, lab_id, accreditor, status, due_date, description) VALUES (?, ?, 'CAP', 'open', ?, 'Made-up finding for the digest receipt')", OWNER.id, LAB, addDays(LAST.end, 90));
const priorC = await call("POST", `${D}/issues`, { periodStart: PRIOR.start }, OWNER.token);
const PRIOR_ID = Number(priorC.body.id);
await call("PUT", `${D}/issues/${PRIOR_ID}`, { audience: "groups", audience_group_ids: [G1] }, OWNER.token);
const priorPub = await call("POST", `${D}/issues/${PRIOR_ID}/publish`, {}, OWNER.token);
const priorCounts = priorPub.body.counts || {};
check("setup: the prior issue is published to the group with 3 open findings in its frozen counts", priorPub.status === 200 && priorPub.body.status === "published" && priorCounts.findings?.open === 3, JSON.stringify({ s: priorPub.status, f: priorCounts.findings }));
// Then the lab changes: 2 findings closed (fewer: better), a certificate now expires within 90 days (more: worse).
sql("UPDATE findings SET status = 'closed' WHERE id IN (SELECT id FROM findings WHERE lab_id = ? ORDER BY id LIMIT 2)", LAB);
sql("INSERT INTO lab_certificates (user_id, lab_id, cert_type, cert_name, expiration_date, is_active, created_at, updated_at) VALUES (?, ?, 'other', 'Made-up permit', ?, 1, ?, ?)", OWNER.id, LAB, addDays(priorCounts.asOf, 30), now, now);

// ── Browser ─────────────────────────────────────────────────────────────────────────────────────────────────────────
let browser;
try { browser = await chromium.launch(); } catch (e) { console.log(`INFO  bundled Chromium didn't start (${String(e.message || e).split("\n")[0]}); using channel chrome`); browser = await chromium.launch({ channel: "chrome" }); }
// A navigation that fails on a passing local network blip (net::ERR_NETWORK_CHANGED seen once here) is tried once more.
const go = async (page, url, opts) => { try { return await page.goto(url, opts); } catch (e) { if (!/ERR_NETWORK_CHANGED|ERR_CONNECTION_RESET/.test(String(e?.message))) throw e; console.log("INFO  navigation retried after a network blip"); return page.goto(url, opts); } };
const openAs = async (u, path, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1100, height: 950 }, colorScheme: opts.colorScheme || "light" });
  const page = await ctx.newPage();
  await go(page, `${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, u.token]);
  await page.evaluate(([t, usr, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(usr.user || usr)); localStorage.setItem("veritas_active_lab_id", String(l)); }, [u.token, me, LAB]);
  await go(page, `${BASE}${path}`, { waitUntil: "networkidle" });
  return page;
};
const text = async (page, testId) => ((await page.getByTestId(testId).first().textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
const visible = (page, testId) => page.getByTestId(testId).first().isVisible().catch(() => false);
const pageText = (page) => page.evaluate(() => document.body.innerText);
const rgb = (page, testId) => page.getByTestId(testId).first().evaluate((el) => getComputedStyle(el).color).catch(() => "");

// O1. Inspection Readiness links to the digest
const owner = await openAs(OWNER, `/labs/${LAB}/readiness`);
await owner.getByTestId("readiness-digest-link").waitFor({ timeout: 20000 }).catch(() => {});
check("O1a. Inspection Readiness shows a Compliance Digest link", await visible(owner, "readiness-digest-link"));
await owner.getByTestId("readiness-digest-link").click();
await owner.getByTestId("digest-settings").waitFor({ timeout: 20000 }).catch(() => {});
check("O1b. the link opens the lab's digest, with the owner's settings card", owner.url().endsWith(`/labs/${LAB}/digest`) && await visible(owner, "digest-settings"), owner.url());

// O2. Settings
const reviewBox = owner.getByTestId("settings-review-box");
check("O2a. the review box toggle is off by default", (await reviewBox.getAttribute("data-state")) === "unchecked");
check("O2b. the review box toggle reads as the approved wording", ((await text(owner, "digest-settings")) || "").includes("Print the medical director or designee review box on the PDF"));
await reviewBox.click();
await owner.getByTestId("settings-ack-default").click();
await owner.getByTestId("settings-audience-groups").check();
await owner.getByTestId(`settings-group-${G1}`).click();
const saveResp = owner.waitForResponse((r) => r.url().includes("/digest/settings") && r.request().method() === "PUT", { timeout: 15000 });
await owner.getByTestId("settings-save").click();
const saved = await (await saveResp).json().catch(() => ({}));
await owner.getByText("Digest settings saved").first().waitFor({ timeout: 10000 }).catch(() => {});
check("O2c. Save settings stores the review box, acknowledgment by default and the group audience", saved.review_box === true && saved.ack_default === true && saved.audience === "groups" && JSON.stringify(saved.audience_group_ids) === JSON.stringify([G1]), JSON.stringify(saved));
await owner.reload({ waitUntil: "networkidle" });
await owner.getByTestId("digest-settings").waitFor({ timeout: 15000 });
check("O2d. after a reload the card shows them as saved", (await owner.getByTestId("settings-review-box").getAttribute("data-state")) === "checked" && (await owner.getByTestId("settings-ack-default").getAttribute("data-state")) === "checked"
  && await owner.getByTestId("settings-audience-groups").isChecked() && (await owner.getByTestId(`settings-group-${G1}`).getAttribute("data-state")) === "checked");

// O3. Draft last month
const periodValue = await owner.getByTestId("draft-period").inputValue();
const periodLabel = await owner.getByTestId("draft-period").locator("option:checked").textContent();
check("O3a. Draft an issue offers the last finished month by default", periodValue === LAST.start && /\(last finished\)/.test(periodLabel || ""), `${periodValue} ${periodLabel}`);
const priorOption = await owner.getByTestId("draft-period").locator(`option[value="${PRIOR.start}"]`).evaluate((o) => ({ disabled: o.disabled, t: o.textContent })).catch(() => null);
check("O3b. the month that already has an issue can't be picked again", !!priorOption?.disabled && /published/.test(priorOption?.t || ""), JSON.stringify(priorOption));
await owner.getByTestId("draft-create").click();
await owner.getByTestId("draft-editor").waitFor({ timeout: 20000 }).catch(() => {});
const MAIN_ID = Number((owner.url().match(/\/digest\/(\d+)$/) || [])[1]);
const draftApi = (await call("GET", `${D}/issues/${MAIN_ID}`, undefined, OWNER.token)).body;
check("O3c. the draft opens in its own view, for last month, as a draft", MAIN_ID > 0 && draftApi.status === "draft" && draftApi.period_start === LAST.start && await visible(owner, "draft-editor"), owner.url());
check("O3d. the draft took the settings: acknowledgment and the review box on, the group audience", draftApi.ack_requested === true && draftApi.review_box === true && draftApi.audience === "groups"
  && (await owner.getByTestId("draft-ack").getAttribute("data-state")) === "checked" && (await owner.getByTestId("draft-review-box").getAttribute("data-state")) === "checked");
check("O3e. the sheet's title is the month, the header names the lab and its CLIA", (await text(owner, "digest-title")) === monthTitle(LAST.start) && (await text(owner, "digest-lab")).includes("Made-up Digest Screens Lab") && (await text(owner, "digest-lab")).includes("CLIA 22D7790011"),
  `${await text(owner, "digest-title")} | ${await text(owner, "digest-lab")}`);
const cardCount = await owner.locator('[data-testid^="digest-card-"][data-testid$="-number"], [data-testid^="digest-card-"][data-testid$="-na"]').count();
check("O3f. one card per section the issue includes (every default section: 11)", cardCount === draftApi.sections.length && cardCount === 11, `${cardCount} of ${draftApi.sections.length}`);
check("O3g. the draft's numbers are its live counts (findings 1 open, as the API's live counts say)", (await text(owner, "digest-card-findings-number")) === String(draftApi.counts.findings.open) && draftApi.counts.findings.open === 1 && draftApi.counts_live === true);
check("O3h. the draft view already shows the change line against the prior issue", (await text(owner, "digest-card-findings-change")) === `Better: Down from 3 in ${PRIOR_LABEL}`, await text(owner, "digest-card-findings-change"));
check("O3i. the draft says readers can't see it and its numbers are live", (await text(owner, "draft-live-note")).includes("Readers can't see this yet") && (await text(owner, "digest-meta")).includes("(lab time, live)"));
await owner.screenshot({ path: `${OUT}/digest-owner-draft-light.png`, fullPage: true });

// O4. The note: patient information refused, a clean note saved
await owner.getByTestId("draft-note").fill("Made-up note: MRN 12345678 was the outlier");
await owner.getByTestId("draft-save").click();
await owner.getByTestId("draft-error").waitFor({ timeout: 10000 }).catch(() => {});
check("O4a. a note with a medical record number is refused on screen, and nothing is saved", /patient information/.test(await text(owner, "draft-error")) && sql("SELECT note FROM digest_issues WHERE id = ?", MAIN_ID)?.note == null, await text(owner, "draft-error"));
const NOTE = "Made-up note for the receipt: findings are down to one and a permit renewal is coming up. Please read the cards below.";
await owner.getByTestId("draft-note").fill(NOTE);
const putResp = owner.waitForResponse((r) => r.url().includes(`/digest/issues/${MAIN_ID}`) && r.request().method() === "PUT", { timeout: 15000 });
await owner.getByTestId("draft-save").click();
await putResp;
await owner.getByTestId("digest-note-text").waitFor({ timeout: 10000 }).catch(() => {});
check("O4b. the clean note saves and shows in the note card under the approved heading", (await text(owner, "digest-note-text")) === NOTE && (await text(owner, "digest-note")).startsWith("A note from the medical director or designee"), await text(owner, "digest-note"));

// O5. Publish, with the as-of day in the confirm
await owner.getByTestId("draft-publish").click();
await owner.getByTestId("publish-dialog").waitFor({ timeout: 10000 }).catch(() => {});
const confirmText = await text(owner, "publish-dialog-text");
const asOf = (await call("GET", `${D}/issues/${MAIN_ID}`, undefined, OWNER.token)).body.counts?.asOf;
check("O5a. the publish confirm states the counts' as-of day (the lab's today) and who it goes to", !!asOf && confirmText.includes(`frozen as of ${fmtDay(asOf)}`) && confirmText.includes("Made-up Chemistry Bench") && confirmText.includes("(2 readers)"), confirmText);
await owner.waitForTimeout(500);
await owner.screenshot({ path: `${OUT}/digest-owner-publish-confirm.png` });
const pubResp = owner.waitForResponse((r) => r.url().includes(`/digest/issues/${MAIN_ID}/publish`), { timeout: 15000 });
await owner.getByTestId("publish-confirm").click();
const pubReq = (await pubResp).request();
const pubBody = JSON.parse(pubReq.postData() || "{}");
await owner.getByTestId("digest-roster").waitFor({ timeout: 15000 }).catch(() => {});
const mainRow = sql("SELECT status, counts_json FROM digest_issues WHERE id = ?", MAIN_ID);
check("O5b. Publish sent the as-of day it showed (expectedCountsAsOf) and the issue is published with frozen counts", pubBody.expectedCountsAsOf === asOf && mainRow?.status === "published" && !!mainRow?.counts_json, JSON.stringify({ pubBody, status: mainRow?.status }));
check("O5c. the owner's view now reads Published, with no draft editor", (await text(owner, "digest-meta")).includes("Published") && !(await visible(owner, "draft-editor")));
const frozen = JSON.parse(mainRow?.counts_json || "{}");

// S1. A Staff login in the group reads it
const reader = await openAs(STAFF_IN, `/labs/${LAB}/digest`);
await reader.getByTestId(`issue-row-${MAIN_ID}`).waitFor({ timeout: 20000 }).catch(() => {});
check("S1a. the Staff login's list shows this issue and the prior one", await visible(reader, `issue-row-${MAIN_ID}`) && await visible(reader, `issue-row-${PRIOR_ID}`));
const readerListText = await pageText(reader);
await reader.getByTestId(`issue-row-${MAIN_ID}`).click();
await reader.getByTestId("digest-sheet").waitFor({ timeout: 20000 }).catch(() => {});
check("S1b. the reader view opens: Staff version, the month, the note, published, sent to the group", (await text(reader, "digest-eyebrow")) === "Compliance Digest | Staff version" && (await text(reader, "digest-title")) === monthTitle(LAST.start)
  && (await text(reader, "digest-note-text")) === NOTE && (await text(reader, "digest-meta")).includes("Published") && (await text(reader, "digest-sent-to")) === "Sent to Lab groups: Made-up Chemistry Bench",
  `${await text(reader, "digest-eyebrow")} | ${await text(reader, "digest-sent-to")}`);
check("S1c. the reader sees one card per section, each number from the frozen counts", (await text(reader, "digest-card-findings-number")) === String(frozen.findings.open) && (await text(reader, "digest-card-certificates-number")) === String(frozen.certificates.expiringIn90)
  && (await reader.locator('[data-testid^="digest-card-"][data-testid$="-link"]').count()) === 11);
const fChange = reader.getByTestId("digest-card-findings-change"), cChange = reader.getByTestId("digest-card-certificates-change");
check(`S1d. findings: "Better: Down from 3 in ${PRIOR_LABEL}" (3 open then, 1 now)`, (await text(reader, "digest-card-findings-change")) === `Better: Down from 3 in ${PRIOR_LABEL}` && (await fChange.getAttribute("data-kind")) === "better", await text(reader, "digest-card-findings-change"));
check(`S1e. certificates: "Worse: Up from ${priorCounts.certificates.expiringIn90} in ${PRIOR_LABEL}" (one more expiring now)`, (await text(reader, "digest-card-certificates-change")) === `Worse: Up from ${priorCounts.certificates.expiringIn90} in ${PRIOR_LABEL}` && (await cChange.getAttribute("data-kind")) === "worse", await text(reader, "digest-card-certificates-change"));
check(`S1f. studies: "No change: Same as ${PRIOR_LABEL} (${priorCounts.studies.overdue})"; new tests is information only`, (await text(reader, "digest-card-studies-change")) === `No change: Same as ${PRIOR_LABEL} (${priorCounts.studies.overdue})`
  && (await text(reader, "digest-card-newTests-change")) === `${PRIOR_LABEL}: ${priorCounts.newTests.count} added` && (await reader.getByTestId("digest-card-newTests-change").getAttribute("data-kind")) === "info");
check("S1g. the mock's colors: better #437A22, worse #A12C7B, no change #7A7974", (await rgb(reader, "digest-card-findings-change")) === "rgb(67, 122, 34)" && (await rgb(reader, "digest-card-certificates-change")) === "rgb(161, 44, 123)" && (await rgb(reader, "digest-card-studies-change")) === "rgb(122, 121, 116)",
  `${await rgb(reader, "digest-card-findings-change")} ${await rgb(reader, "digest-card-certificates-change")} ${await rgb(reader, "digest-card-studies-change")}`);
check(`S1h. "Change shown against ${PRIOR_LABEL}." and the counts-only line`, (await text(reader, "digest-glance-note")) === `Counts only: no patient information and no staff names. Change shown against ${PRIOR_LABEL}.`, await text(reader, "digest-glance-note"));
check("S1i. each card links to its module screen (findings to VeritaResponse™)", (await reader.getByTestId("digest-card-findings-link").getAttribute("href")) === `/labs/${LAB}/veritaresponse` && (await text(reader, "digest-card-findings-link")).startsWith("View in VeritaResponse™"));
check("S1j. the acknowledgment card: requested, not yet read, only you and the lab admins see it", (await text(reader, "digest-status-card")).includes("Acknowledgment requested for this issue") && (await text(reader, "digest-my-status")) === "Your status: not yet read. Only you and the lab admins see your status." && await visible(reader, "digest-ack"));
check("S1k. no Download PDF button and no SAMPLE banner on the reader view", !/Download PDF/i.test(await pageText(reader)) && !/SAMPLE ISSUE/i.test(await pageText(reader)));
await reader.screenshot({ path: `${OUT}/digest-reader-light.png`, fullPage: true });
const readerMainText = await pageText(reader);

// S2. Mark the prior issue read
await reader.goto(`${BASE}/labs/${LAB}/digest/${PRIOR_ID}`, { waitUntil: "networkidle" });
await reader.getByTestId("digest-mark-read").waitFor({ timeout: 15000 }).catch(() => {});
check("S2a. the prior issue (no acknowledgment asked) offers Mark as read, and has no change lines (nothing before it)", await visible(reader, "digest-mark-read") && !(await visible(reader, "digest-ack")) && (await reader.locator('[data-testid$="-change"]').count()) === 0);
await reader.getByTestId("digest-mark-read").click();
await reader.getByText("Your status: read").first().waitFor({ timeout: 10000 }).catch(() => {});
const readAck = sql("SELECT read_at, acknowledged_at FROM digest_issue_acks WHERE issue_id = ? AND user_id = ?", PRIOR_ID, STAFF_IN.id);
check("S2b. Mark as read records it and the card says so", !!readAck?.read_at && !readAck?.acknowledged_at && /^Your status: read [A-Z][a-z]{2} \d{1,2}, \d{4}\. Only you and the lab admins see your status\.$/.test(await text(reader, "digest-my-status")) && !(await visible(reader, "digest-mark-read")), await text(reader, "digest-my-status"));
const readerPriorText = await pageText(reader);

// S3. Acknowledge this issue
await reader.goto(`${BASE}/labs/${LAB}/digest/${MAIN_ID}`, { waitUntil: "networkidle" });
await reader.getByTestId("digest-ack").waitFor({ timeout: 15000 }).catch(() => {});
await reader.getByTestId("digest-ack").click();
await reader.getByText("Your status: acknowledged").first().waitFor({ timeout: 10000 }).catch(() => {});
const ackRow = sql("SELECT read_at, acknowledged_at FROM digest_issue_acks WHERE issue_id = ? AND user_id = ?", MAIN_ID, STAFF_IN.id);
check("S3. I've read this records the acknowledgment (and the read), and the button goes away", !!ackRow?.acknowledged_at && !!ackRow?.read_at && (await text(reader, "digest-my-status")).startsWith("Your status: acknowledged") && !(await visible(reader, "digest-ack")), await text(reader, "digest-my-status"));
await reader.screenshot({ path: `${OUT}/digest-reader-acknowledged-light.png`, fullPage: true });
const readerAckText = await pageText(reader);

// S4. No other person's name for a limited Staff login
const others = [NAMES.owner, NAMES.staffIn2, NAMES.staffOut, "Quillfeather", "Harrowgate", "Outerbridge", OWNER.email, STAFF_IN2.email];
const shown = [readerListText, readerMainText, readerPriorText, readerAckText].flatMap((t) => others.filter((n) => t.includes(n)));
check("S4a. the Staff login's list, the issue (before and after acknowledging) and the prior issue name no other person", shown.length === 0, shown.join(", "));
check("S4b. the Staff login sees no roster, no settings and no draft tools", !(await visible(reader, "digest-roster")) && !/Who has read it/.test(readerAckText) && !/Settings for this lab/.test(readerListText) && !/Draft an issue/.test(readerListText));

// O6. The owner's roster
await owner.reload({ waitUntil: "networkidle" });
await owner.getByTestId("digest-roster").waitFor({ timeout: 15000 }).catch(() => {});
const totals = await text(owner, "digest-roster-totals");
check("O6a. the roster's counts: 2 in the audience, 1 read, 1 acknowledged", totals === "2 in the audience · 1 read · 1 not read · 1 acknowledged · 1 not acknowledged", totals);
const rowIn = await text(owner, `roster-row-${STAFF_IN.id}`), rowIn2 = await text(owner, `roster-row-${STAFF_IN2.id}`);
check("O6b. the roster names who read and acknowledged, and who hasn't", rowIn.startsWith(NAMES.staffIn) && /Read [A-Z][a-z]{2} \d/.test(rowIn) && /Acknowledged [A-Z][a-z]{2} \d/.test(rowIn) && rowIn2.startsWith(NAMES.staffIn2) && /Not read/.test(rowIn2) && /Not acknowledged/.test(rowIn2), `${rowIn} | ${rowIn2}`);
check("O6c. the owner's header counts the readers: Sent to the group (2 readers)", (await text(owner, "digest-sent-to")) === "Sent to Lab groups: Made-up Chemistry Bench (2 readers)", await text(owner, "digest-sent-to"));
check("O6d. the owner is not in the group audience, so no read or acknowledgment card is offered to them", !(await visible(owner, "digest-status-card")));
await owner.evaluate(() => window.scrollTo(0, 0));
await owner.screenshot({ path: `${OUT}/digest-roster-light.png`, fullPage: true });
await owner.getByTestId("digest-roster").screenshot({ path: `${OUT}/digest-roster-card-light.png` });

// X1. Outside the audience
const outsider = await openAs(STAFF_OUT, `/labs/${LAB}/digest/${MAIN_ID}`);
await outsider.getByTestId("digest-not-found").waitFor({ timeout: 15000 }).catch(() => {});
check("X1a. a Staff login outside the group opening the issue gets the not-found state, and no sheet", await visible(outsider, "digest-not-found") && !(await visible(outsider, "digest-sheet")));
const outsiderText = await pageText(outsider);
const notFoundMain = await text(outsider, "digest-not-found");
await outsider.screenshot({ path: `${OUT}/digest-not-found-light.png`, fullPage: true });
await outsider.goto(`${BASE}/labs/${LAB}/digest`, { waitUntil: "networkidle" });
await outsider.getByTestId("digest-issues-empty").waitFor({ timeout: 15000 }).catch(() => {});
const outsiderListText = await pageText(outsider);
const outsiderSees = [NAMES.owner, NAMES.staffIn, NAMES.staffIn2, "Quillfeather", "Ingleton", "Harrowgate", OWNER.email].filter((n) => outsiderText.includes(n) || outsiderListText.includes(n));
check("X1b. its list shows no issue (both were sent to a group it isn't in), and no other person's name", await visible(outsider, "digest-issues-empty") && !(await visible(outsider, `issue-row-${MAIN_ID}`)) && outsiderSees.length === 0, outsiderSees.join(", "));
await outsider.goto(`${BASE}/labs/${LAB}/digest/999999`, { waitUntil: "networkidle" });
await outsider.getByTestId("digest-not-found").waitFor({ timeout: 15000 }).catch(() => {});
check("X1c. an id that doesn't exist shows the same not-found state", !!notFoundMain && (await text(outsider, "digest-not-found")) === notFoundMain, `${notFoundMain} | ${await text(outsider, "digest-not-found")}`);

// D1. Dark mode
const contrast = (page, testId, bgTestId) => page.evaluate(([t, b]) => {
  const parse = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const lum = ([r, g, b2]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b2); };
  const el = document.querySelector(`[data-testid="${t}"]`), bg = document.querySelector(`[data-testid="${b}"]`);
  if (!el || !bg) return { ratio: 0 };
  const fg = parse(getComputedStyle(el).color), back = parse(getComputedStyle(bg).backgroundColor);
  const [hi, lo] = [lum(fg), lum(back)].sort((x, y) => y - x);
  return { ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100, fg, back };
}, [testId, bgTestId]);
const dark = await openAs(STAFF_IN, `/labs/${LAB}/digest/${MAIN_ID}`, { colorScheme: "dark" });
await dark.getByTestId("digest-sheet").waitFor({ timeout: 20000 }).catch(() => {});
const darkState = await dark.evaluate(() => ({ dark: document.documentElement.classList.contains("dark"), body: getComputedStyle(document.body).backgroundColor }));
check("D1a. dark mode follows the system setting (prefers-color-scheme dark)", darkState.dark, JSON.stringify(darkState));
const cTitle = await contrast(dark, "digest-title", "digest-header"), cNum = await contrast(dark, "digest-card-findings-number", "digest-card-findings");
const cDetail = await contrast(dark, "digest-card-findings-detail", "digest-card-findings"), cBetter = await contrast(dark, "digest-card-findings-change", "digest-card-findings");
const cWorse = await contrast(dark, "digest-card-certificates-change", "digest-card-certificates"), cNote = await contrast(dark, "digest-note-text", "digest-note");
check("D1b. dark mode: the title, numbers, detail lines, change lines and note read at 4.5:1 or better",
  [cTitle, cNum, cDetail, cBetter, cWorse, cNote].every((c) => c.ratio >= 4.5), JSON.stringify({ cTitle: cTitle.ratio, cNum: cNum.ratio, cDetail: cDetail.ratio, cBetter: cBetter.ratio, cWorse: cWorse.ratio, cNote: cNote.ratio }));
await dark.screenshot({ path: `${OUT}/digest-reader-dark.png`, fullPage: true });
// The owner's roster and a second draft (the month three back), in dark mode.
const darkOwner = await openAs(OWNER, `/labs/${LAB}/digest/${MAIN_ID}`, { colorScheme: "dark" });
await darkOwner.getByTestId("digest-roster").waitFor({ timeout: 15000 }).catch(() => {});
const cRoster = await contrast(darkOwner, `roster-row-${STAFF_IN.id}`, "digest-roster");
check("D1c. dark mode: the roster reads at 4.5:1 or better", cRoster.ratio >= 4.5, JSON.stringify(cRoster));
await darkOwner.getByTestId("digest-roster").screenshot({ path: `${OUT}/digest-roster-card-dark.png` });
await darkOwner.screenshot({ path: `${OUT}/digest-roster-dark.png`, fullPage: true });
const d3 = await call("POST", `${D}/issues`, { periodStart: monthBefore(PRIOR.start) }, OWNER.token);
await darkOwner.goto(`${BASE}/labs/${LAB}/digest/${d3.body.id}`, { waitUntil: "networkidle" });
await darkOwner.getByTestId("draft-editor").waitFor({ timeout: 15000 }).catch(() => {});
const cDraft = await contrast(darkOwner, "digest-card-findings-number", "digest-card-findings");
check("D1d. dark mode: the owner's draft view renders and reads at 4.5:1 or better", d3.status === 201 && await visible(darkOwner, "draft-editor") && cDraft.ratio >= 4.5, JSON.stringify({ s: d3.status, c: cDraft.ratio }));
await darkOwner.screenshot({ path: `${OUT}/digest-owner-draft-dark.png`, fullPage: true });

// P1. Phone width
const phone = await openAs(STAFF_IN, `/labs/${LAB}/digest/${MAIN_ID}`, { viewport: { width: 390, height: 844 } });
await phone.getByTestId("digest-sheet").waitFor({ timeout: 20000 }).catch(() => {});
const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check("P1. on a phone the reader view has no sideways scroll", overflow <= 0, `${overflow}px`);
await phone.screenshot({ path: `${OUT}/digest-reader-phone.png`, fullPage: true });

await browser.close();
console.log(`${passes} PASS, ${failures} FAIL`);
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
