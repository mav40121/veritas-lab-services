// tests/integration/digest-pdf-notice.test.ts
//
// 2026-11-11 (Michael, Q281 = 1; the compliance digest, PR 5 of 5; the approved PDF mock, Q284 = 1): the issue PDF
// (GET /api/labs/:labId/digest/issues/:id/pdf, server/digestPdf.ts) and the notice email (GET and POST .../issues/:id/notice,
// server/digestIssues.ts). A made-up owner, lab and people on a fresh database; outgoing mail is captured by swapping the
// read-and-sign notice's mailer (readSignMailer.send), so nothing is ever sent. It checks:
//   1. the shared labels: the column headings, which period "last month" is, the file name;
//   2. PDF reach, the issue GET's exactly: the owner, an admin and the medical director (a reader the leadership issue
//      reaches) get it; an editor outside the audience, a limited Staff login on a leadership issue and a Staff login outside a
//      group issue get the issue GET's own 404; a draft and a withdrawn issue are refused (409 NOT_PUBLISHED for the owner,
//      the GET's 404 for a reader); another lab's issue is 404;
//   3. the PDF's words, read with PyMuPDF (python -E): the lab's name and CLIA, the period and version, the meta line, the
//      note, each section's row exactly as the screen's rules give it (number, unit, last period's number, the change word,
//      detail), Better, Worse and No change where the data put them, the new tests list, the review box only when the issue's
//      review_box is 1, the footer and Page X of Y on every page, one page, the author "Perplexity Computer", no em dash,
//      no person's name or address, no SAMPLE banner or "Optional" line; a null section reads "Not available"; a lab with
//      no CLIA reads "CLIA: Not on file. Enter it in account settings."; the reader's PDF compares with the prior issue as
//      that reader's screen does;
//   4. layout: a long new-tests list runs to page 2 with the title block, note and table on page 1; with the review box on,
//      the box stays on page 1 (printed after the table); a normal list keeps the mock's order (list, then the box);
//   5. the notice: publishing sends nothing; the count first (owner and admins only); 409 COUNT_CHANGED when the count
//      isn't the screen's; 409 NOT_PUBLISHED for a draft and a withdrawn issue; Veritas support refused (403
//      VLS_SUPPORT_CANNOT_SIGN); one email per person reached who has a login with an address; the email has the subject,
//      the sender, the link to the issue, the recipient's own greeting, whether acknowledgment is asked, no counts and no
//      other name; once per issue (409 NOTICE_SENT, and two at once send one); the sent date and count on the issue;
//      audit rows; no em dash in any reply.
// Run: rm -f <db> && DB_PATH=<db> JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/digest-pdf-notice.test.ts
// PDF_OUT=<dir> keeps the PDFs it reads.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);
delete process.env.RESEND_API_KEY; // belt and braces: the mailer is swapped out below, and without a key it can't send anyway

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}
const EM_DASH = String.fromCharCode(0x2014);
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { readSignMailer } = await import("../../server/policyReadSign");
  const { DIGEST_NOTICE_FROM } = await import("../../server/digestIssues");
  const { digestPdfRows, generateDigestPDF, buildDigestPdfHTML, digestPdfFilename, DIGEST_PDF_FOOTER_TEXT } = await import("../../server/digestPdf");
  const { getBrowser } = await import("../../server/pdfReport");
  const cards = await import("../../shared/digestCards");
  const { labToday, addLabDays, withLabClock } = await import("../../server/dateLocal");
  const { PDFDocument } = await import("pdf-lib");
  const sqlite = (db as any).$client;
  const ADMIN_SECRET = process.env.ADMIN_SECRET || "test-admin-secret";
  const mail: Array<{ from?: string; to: string; subject: string; html: string }> = [];
  readSignMailer.pauseMs = 0;
  readSignMailer.send = async (m: any) => { mail.push(m); };

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "digest-pdf-"));
  const keep = process.env.PDF_OUT || "";
  if (keep) fs.mkdirSync(keep, { recursive: true });
  // PyMuPDF reads the words the PDF itself carries (pdf-lib can't), page by page.
  const pdfPages = (buf: Buffer, name: string): string[] => {
    const file = path.join(work, name);
    fs.writeFileSync(file, buf);
    if (keep) fs.copyFileSync(file, path.join(keep, name));
    const out = execFileSync("python", ["-E", "-c",
      "import sys, json, fitz\nsys.stdout.reconfigure(encoding='utf-8')\nprint(json.dumps([p.get_text() for p in fitz.open(sys.argv[1])]))", file]).toString("utf-8");
    return JSON.parse(out);
  };

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const replies: string[] = [];
  const call = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const buf = Buffer.from(await r.arrayBuffer());
    const isPdf = /^application\/pdf/.test(r.headers.get("content-type") || "");
    const text = isPdf ? "" : buf.toString("utf-8");
    if (!isPdf) replies.push(text);
    let j: any = {}; try { j = JSON.parse(text); } catch { /* not JSON */ }
    return { s: r.status, j, text, buf, isPdf, headers: r.headers };
  };

  try {
    // ── 1. The shared labels ───────────────────────────────────────────────────────────────────────────────────────
    const oct = { period_start: "2026-10-01", period_end: "2026-10-31" };
    check("1. column headings: October against Sept., as the mock has them",
      cards.periodColumnLabel(oct.period_start, oct.period_end) === "October" && cards.priorColumnLabel({ period_start: "2026-09-01", period_end: "2026-09-30" }, oct) === "Sept.");
    check("1. a quarter's headings: Q3 2026 against Q2 2026; no prior issue: Last month / Last quarter",
      cards.periodColumnLabel("2026-07-01", "2026-09-30") === "Q3 2026" && cards.priorColumnLabel({ period_start: "2026-04-01", period_end: "2026-06-30" }, { period_start: "2026-07-01", period_end: "2026-09-30" }) === "Q2 2026"
        && cards.priorColumnLabel(null, oct) === "Last month" && cards.priorColumnLabel(null, { period_start: "2026-07-01", period_end: "2026-09-30" }) === "Last quarter");
    const sentences: Array<[any, any, string]> = [
      [{ period_start: "2026-09-01", period_end: "2026-09-30" }, oct, "Last month = September 2026."],
      [{ period_start: "2026-08-01", period_end: "2026-08-31" }, oct, "Last issue = August 2026."],
      [{ period_start: "2025-12-01", period_end: "2025-12-31" }, { period_start: "2026-01-01", period_end: "2026-01-31" }, "Last month = December 2025."],
      [{ period_start: "2026-04-01", period_end: "2026-06-30" }, { period_start: "2026-07-01", period_end: "2026-09-30" }, "Last quarter = Q2 2026."],
      [{ period_start: "2026-01-01", period_end: "2026-03-31" }, { period_start: "2026-07-01", period_end: "2026-09-30" }, "Last issue = Q1 2026."],
      [null, oct, "No earlier published issue to compare with."],
    ];
    for (const [prior, cur, want] of sentences) check(`1. which period the comparison is: "${want}"`, cards.priorPeriodSentence(prior, cur) === want, cards.priorPeriodSentence(prior, cur));
    check("1. the file name: Compliance_Digest_2026-10.pdf for a month, Compliance_Digest_2026-Q3.pdf for a quarter",
      digestPdfFilename(oct) === "Compliance_Digest_2026-10.pdf" && digestPdfFilename({ period_start: "2026-07-01", period_end: "2026-09-30" }) === "Compliance_Digest_2026-Q3.pdf");
    check("1. the Change column's words: Better, Worse, No change, and blank for information only",
      cards.DIGEST_CHANGE_WORDS.better === "Better" && cards.DIGEST_CHANGE_WORDS.worse === "Worse" && cards.DIGEST_CHANGE_WORDS.same === "No change" && cards.DIGEST_CHANGE_WORDS.info === "");

    // ── Setup: a made-up owner and lab on New York time, its people, a group, another customer's lab ───────────────
    const stamp = Date.now();
    const NAMES = {
      owner: "Made-up Digest Owner Pembury", admin: "Made-up Admin Rothwell", editor: "Made-up Editor Sandal", md: "Made-up Director Tallis",
      staffIn: "Made-up Staff Ulverston", staffOut: "Made-up Staff Wigton", vls: "Made-up Veritas Support Yarrow", noAddr: "Made-up Admin Zennor", other: "Made-up Other Owner Ashby",
    };
    const register = async (tag: string, name: string) => {
      const email = `digest-pdf-${tag}-${stamp}@example.test`;
      const reg = (await call("POST", "/api/auth/register", { email, password: "Testpass123", name, hipaa_acknowledged: true })).j;
      return { email, name, token: reg.token as string, id: Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id) };
    };
    const provision = async (email: string, labName: string) => Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN_SECRET, ownerEmail: email, labName, plan: "hospital" })).j.labId);
    const now = new Date().toISOString();
    const member = (lab: number, userId: number, role = "staff") => sqlite.prepare(
      "INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, ?, '{}', 'active', 0, ?, ?, ?)"
    ).run(lab, userId, role, now, now, now);
    const LAB_NAME = "Made-up Digest PDF Lab";
    const CLIA = "22D7654321";
    const OWNER = await register("owner", NAMES.owner);
    const LAB = await provision(OWNER.email, LAB_NAME);
    const L = `/api/labs/${LAB}/digest`;
    const TZ = "America/New_York";
    sqlite.prepare("UPDATE labs SET time_zone = ?, clia_number = ?, lab_name = ? WHERE id = ?").run(TZ, CLIA, LAB_NAME, LAB);
    const today = withLabClock(TZ, () => labToday());
    const M0 = `${today.slice(0, 8)}01`;
    const month = (back: number) => ({ start: addLabDays(M0, 0, -back), end: addLabDays(addLabDays(M0, 0, -back + 1), -1) });
    const prev = month(1), prev2 = month(2), prev3 = month(3), prev4 = month(4), prev5 = month(5);

    const staffLab = Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(OWNER.id, LAB_NAME, CLIA, LAB, now, now).lastInsertRowid);
    const roster = (first: string, last: string) => Number(sqlite.prepare(
      "INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'Made-up Tech', 'active', ?, ?)"
    ).run(staffLab, LAB, OWNER.id, last, first, now, now).lastInsertRowid);
    const seat = (u: { id: number; email: string }, type: string, perms: string, emp: number | null) => sqlite.prepare(
      "INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, staff_employee_id, permissions, invited_at, accepted_at) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)"
    ).run(OWNER.id, u.email, u.id, type, LAB, emp, perms, now, now);
    const ADMIN = await register("admin", NAMES.admin); member(LAB, ADMIN.id, "admin");
    const EDITOR = await register("editor", NAMES.editor); member(LAB, EDITOR.id); seat(EDITOR, "active", '{"mode":"edit_all"}', null);
    const MD = await register("md", NAMES.md); member(LAB, MD.id);
    sqlite.prepare("UPDATE labs SET medical_director_email = ? WHERE id = ?").run(MD.email, LAB);
    const STAFF_IN = await register("staffin", NAMES.staffIn); member(LAB, STAFF_IN.id);
    const empIn = roster("Made-up", "Ulverston"); seat(STAFF_IN, "staff_portal", '{"mode":"view_all"}', empIn);
    const STAFF_OUT = await register("staffout", NAMES.staffOut); member(LAB, STAFF_OUT.id);
    const empOut = roster("Made-up", "Wigton"); seat(STAFF_OUT, "staff_portal", '{"mode":"view_all"}', empOut);
    const VLS = await register("vls", NAMES.vls); sqlite.prepare("UPDATE users SET vls_support = 1 WHERE id = ?").run(VLS.id);
    // An admin whose login has no usable address: in the leadership audience, never mailed.
    const NOADDR = await register("noaddr", NAMES.noAddr); member(LAB, NOADDR.id, "admin");
    sqlite.prepare("UPDATE users SET email = ? WHERE id = ?").run(`no-address-${stamp}`, NOADDR.id);
    const G1 = Number(sqlite.prepare("INSERT INTO lab_groups (lab_id, name, retired, created_by) VALUES (?, 'Made-up Chemistry Group', 0, ?)").run(LAB, OWNER.id).lastInsertRowid);
    sqlite.prepare("INSERT INTO lab_group_members (group_id, lab_id, employee_id, name, added_by) VALUES (?, ?, ?, 'Made-up Ulverston', ?)").run(G1, LAB, empIn, OWNER.id);
    const OTHER = await register("other", NAMES.other);
    const LAB_B = await provision(OTHER.email, "Made-up Other Customer Lab");
    check("setup: two customers' labs, eight people in the lab, a group with one Staff login", [LAB, LAB_B, OWNER.id, ADMIN.id, EDITOR.id, MD.id, STAFF_IN.id, STAFF_OUT.id, NOADDR.id, G1].every((x) => x > 0) && !!OWNER.token,
      JSON.stringify({ LAB, LAB_B, today }));
    const T = OWNER.token;
    const NOT_FOUND = (await call("GET", `${L}/issues/999999`, undefined, T)).text;

    // Made-up data: 3 open findings, and a test menu built long ago with two tests switched on last month, one with a study.
    const finding = () => Number(sqlite.prepare("INSERT INTO findings (user_id, lab_id, accreditor, status, due_date, description) VALUES (?, ?, 'CAP', 'open', ?, 'Made-up finding')").run(OWNER.id, LAB, addLabDays(today, 90)).lastInsertRowid);
    const findingIds = [finding(), finding(), finding()];
    const mapId = (await call("POST", `/api/labs/${LAB}/veritamap/maps`, { name: "Made-up Chemistry Menu" }, T)).j.id as number;
    const inst = (await call("POST", `/api/labs/${LAB}/veritamap/maps/${mapId}/instruments`, { instrument_name: "Made-up Alphamatic 500", role: "Primary", category: "Chemistry" }, T)).j.id as number;
    const tests = (await call("PUT", `/api/labs/${LAB}/veritamap/maps/${mapId}/instruments/${inst}/tests`, { tests: [
      { analyte: "Troponin I", specialty: "General Chemistry", complexity: "MODERATE", active: 1 },
      { analyte: "BNP", specialty: "General Chemistry", complexity: "MODERATE", active: 1 },
      { analyte: "Sodium", specialty: "General Chemistry", complexity: "MODERATE", active: 1 },
    ] }, T)).s;
    sqlite.prepare("UPDATE veritamap_maps SET created_at = ? WHERE id = ?").run(`${addLabDays(M0, 0, -12)}T15:00:00.000Z`, mapId);
    sqlite.prepare("UPDATE veritamap_instrument_tests SET active_since = NULL WHERE instrument_id = ?").run(inst);
    sqlite.prepare("UPDATE veritamap_instrument_tests SET active_since = ? WHERE instrument_id = ? AND analyte IN ('Troponin I', 'BNP')").run(`${addLabDays(prev.start, 9)}T16:00:00.000Z`, inst);
    sqlite.prepare(`INSERT INTO studies (user_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at, lab_id, lifecycle_state)
      VALUES (?, 'Troponin I', 'Made-up Alphamatic 500', 'MU', ?, 'cal_ver', 0.1, '[]', '[]', 'pass', ?, ?, 'draft')`).run(OWNER.id, addLabDays(prev.start, 12), now, LAB);
    check("setup: a made-up menu with two tests switched on last month", mapId > 0 && inst > 0 && tests === 200);

    // ── Issues ─────────────────────────────────────────────────────────────────────────────────────────────────────
    const draftFor = async (period: { start: string }, edits: Record<string, unknown>) => {
      const c = await call("POST", `${L}/issues`, { periodStart: period.start }, T);
      const id = Number(c.j.id);
      if (Object.keys(edits).length) await call("PUT", `${L}/issues/${id}`, edits, T);
      return id;
    };
    const publish = async (id: number) => (await call("POST", `${L}/issues/${id}/publish`, {}, T)).s;
    // The prior issue (two months back), to everyone in the lab, while 3 findings are open and no certificate is expiring.
    const PRIOR = await draftFor(prev2, { audience: "staff" });
    const pubPrior = await publish(PRIOR);
    // A group issue three months back that asks for acknowledgment, the review box off.
    const GROUP = await draftFor(prev3, { audience: "groups", audience_group_ids: [G1], ack_requested: true, note: "Made-up group note." });
    const pubGroup = await publish(GROUP);
    // Then the lab changes: 2 findings closed (fewer: better), a certificate expiring within 90 days (more: worse).
    sqlite.prepare(`UPDATE findings SET status = 'closed' WHERE id IN (${findingIds.slice(0, 2).join(", ")})`).run();
    sqlite.prepare("INSERT INTO lab_certificates (user_id, lab_id, cert_type, cert_name, expiration_date, is_active, created_at, updated_at) VALUES (?, ?, 'other', 'Made-up permit', ?, 1, ?, ?)").run(OWNER.id, LAB, addLabDays(today, 30), now, now);
    // The main issue: last month, leadership, the review box on (the lab's setting when it is drafted), a note.
    await call("PUT", `${L}/settings`, { review_box: true }, T);
    const NOTE = "Made-up note for the month: findings are down to one and a permit renewal is coming up.";
    const MAIN = await draftFor(prev, { note: NOTE });
    await call("PUT", `${L}/settings`, { review_box: false }, T);
    const pubMain = await publish(MAIN);
    const DRAFT = await draftFor(prev4, {});
    const WITHDRAWN = await draftFor(prev5, { audience: "staff" });
    await publish(WITHDRAWN);
    const wd = await call("POST", `${L}/issues/${WITHDRAWN}/withdraw`, { reason: "Made-up reason: the wrong month" }, T);
    const row = (id: number) => sqlite.prepare("SELECT * FROM digest_issues WHERE id = ?").get(id) as any;
    check("setup: the prior, group and main issues published; a draft; a withdrawn issue; the main issue's review box on, the group issue's off",
      [pubPrior, pubGroup, pubMain].every((s) => s === 200) && wd.s === 200 && row(MAIN).review_box === 1 && row(GROUP).review_box === 0 && row(DRAFT).status === "draft" && row(WITHDRAWN).status === "withdrawn",
      JSON.stringify([pubPrior, pubGroup, pubMain, wd.s]));
    check("5. publishing sends nothing: no email after three publishes", mail.length === 0, String(mail.length));

    // ── 2. PDF reach ───────────────────────────────────────────────────────────────────────────────────────────────
    const pdfOf = (lab: string, id: number, token: string) => call("GET", `${lab}/issues/${id}/pdf`, undefined, token);
    const reach: Array<[string, { token: string }, number, boolean]> = [
      ["the owner", OWNER, MAIN, true], ["an admin", ADMIN, MAIN, true], ["the medical director (a reader the leadership issue reaches)", MD, MAIN, true],
      ["an editor (outside the leadership audience)", EDITOR, MAIN, false], ["a limited Staff login on the leadership issue", STAFF_IN, MAIN, false],
      ["a Staff login in the group", STAFF_IN, GROUP, true], ["a Staff login outside the group", STAFF_OUT, GROUP, false], ["an editor on the staff issue", EDITOR, PRIOR, true],
    ];
    for (const [who, u, id, gets] of reach) {
      const [pdf, issue] = [await pdfOf(L, id, u.token), await call("GET", `${L}/issues/${id}`, undefined, u.token)];
      const kind = id === MAIN ? "leadership" : id === GROUP ? "group" : "staff";
      check(`2. ${kind} issue, ${who}: ${gets ? "200 application/pdf, as the issue opens for them" : "the issue GET's own 404, as the issue is hidden from them"}`,
        gets ? pdf.s === 200 && pdf.isPdf && pdf.buf.slice(0, 5).toString() === "%PDF-" && issue.s === 200 : pdf.s === 404 && pdf.text === NOT_FOUND && issue.s === 404,
        `${pdf.s} ${pdf.text.slice(0, 100)} / issue ${issue.s}`);
    }
    for (const [what, id] of [["a draft", DRAFT], ["a withdrawn issue", WITHDRAWN]] as const) {
      const o = await pdfOf(L, id, T), r = await pdfOf(L, id, STAFF_IN.token);
      check(`2. ${what}: no PDF (409 NOT_PUBLISHED for the owner; the issue GET's 404 for a Staff login)`, o.s === 409 && o.j.code === "NOT_PUBLISHED" && r.s === 404 && r.text === NOT_FOUND, `${o.s} ${o.text} / ${r.s}`);
    }
    const bId = Number((await call("POST", `/api/labs/${LAB_B}/digest/issues`, {}, OTHER.token)).j.id);
    await call("PUT", `/api/labs/${LAB_B}/digest/issues/${bId}`, { audience: "staff" }, OTHER.token);
    await call("POST", `/api/labs/${LAB_B}/digest/issues/${bId}/publish`, {}, OTHER.token);
    const crossed = await pdfOf(L, bId, T), direct = await pdfOf(`/api/labs/${LAB_B}/digest`, bId, T);
    check("2. another customer's issue through this lab's path: 404; through its own lab's path: refused (no membership)", crossed.s === 404 && crossed.text === NOT_FOUND && direct.s === 403, `${crossed.s} ${direct.s}`);
    check("2. signed out: refused", [401, 403].includes((await call("GET", `${L}/issues/${MAIN}/pdf`)).s));

    // ── 3. The PDF's words ─────────────────────────────────────────────────────────────────────────────────────────
    const own = await pdfOf(L, MAIN, T);
    const pages = pdfPages(own.buf, "digest-main-owner.pdf");
    const all = squash(pages.join("\n"));
    const doc = await PDFDocument.load(own.buf);
    const mainView = (await call("GET", `${L}/issues/${MAIN}`, undefined, T)).j;
    const title = cards.periodTitle(prev.start, prev.end);
    check("3. one Letter page, author Perplexity Computer, the file named for the month", pages.length === 1 && doc.getPageCount() === 1 && doc.getAuthor() === "Perplexity Computer"
      && Math.round(doc.getPage(0).getWidth()) === 612 && Math.round(doc.getPage(0).getHeight()) === 792 && (own.headers.get("content-disposition") || "").includes(`filename="Compliance_Digest_${prev.start.slice(0, 7)}.pdf"`),
      `${pages.length} ${doc.getAuthor()} ${own.headers.get("content-disposition")}`);
    check("3. the title block: Compliance Digest, the period and the leadership version, the lab's name and CLIA",
      all.includes("Compliance Digest") && all.includes(`${title} | Leadership version`) && all.includes(LAB_NAME) && all.includes(`CLIA ${CLIA}`), all.slice(0, 300));
    const asOf = mainView.counts.asOf;
    const priorLabel = `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(prev2.start.slice(5, 7)) - 1]} ${prev2.start.slice(0, 4)}`;
    const metaWant = `Numbers as of ${cards.formatDay(asOf)} (lab time). Published ${cards.formatMomentDay(mainView.published_at, TZ)} to the Leadership group. Counts only: no patient information and no staff names. Last month = ${priorLabel}.`;
    check("3. the meta line: numbers as of, published and to whom, counts only, which period last month is", all.includes(metaWant), `${metaWant} || ${all.slice(0, 500)}`);
    check("3. the note from the medical director or designee", all.includes("A note from the medical director or designee") && all.includes(NOTE));
    check("3. the table's headings: Section, Module, this month, last month (the mock's abbreviation), Change, Detail",
      all.includes(`Section Module ${cards.periodColumnLabel(prev.start, prev.end)} ${cards.priorColumnLabel(mainView.previous, mainView)} Change Detail`), all.slice(0, 900));
    const rows = digestPdfRows(mainView);
    check("3. one row per section the issue includes (every default section: 11), and the prior issue is the staff issue two months back",
      rows.length === 11 && rows.length === mainView.sections.length && mainView.previous?.id === PRIOR, `${rows.length} ${mainView.previous?.id}`);
    for (const r of rows) {
      // The screen's rules, applied here to the frozen counts: the number, unit and detail from cardBody, the change from changeLine.
      const sec = mainView.counts[r.key];
      const body = cards.cardBody(r.key as any, sec, { start: mainView.period_start, end: mainView.period_end, asOf }, { newTestsListedBelow: true });
      const ch = cards.changeLine(r.key as any, sec, mainView.previous, mainView);
      const prior = ch ? cards.headlineNumber(r.key as any, mainView.previous.counts[r.key]) : null;
      const cells = [cards.DIGEST_CARDS[r.key as keyof typeof cards.DIGEST_CARDS].title, cards.DIGEST_CARDS[r.key as keyof typeof cards.DIGEST_CARDS].module,
        body.available ? `${body.big} ${body.unit}` : "Not available", prior == null ? "" : String(prior), ch ? cards.DIGEST_CHANGE_WORDS[ch.kind] : "", body.detail].filter(Boolean);
      const line = squash(cells.join(" "));
      check(`3. row ${r.key}: "${line.slice(0, 110)}"`, all.includes(line), all.slice(0, 200));
    }
    const rowOf = (k: string) => rows.find((r) => r.key === k)!;
    check("3. findings: 1 open, 3 the month before, Better", rowOf("findings").big === 1 && rowOf("findings").prior === 3 && rowOf("findings").changeWord === "Better" && all.includes("Open findings VeritaResponse™ 1 open 3 Better"));
    check("3. certificates: 1 expiring, 0 the month before, Worse", rowOf("certificates").big === 1 && rowOf("certificates").prior === 0 && rowOf("certificates").changeWord === "Worse"
      && all.includes("Certificates expiring VeritaLab™ 1 expiring within 90 days 0 Worse"));
    check("3. studies: the same as the month before, No change", rowOf("studies").changeWord === "No change" && all.includes(`Studies due VeritaCheck® ${rowOf("studies").big} overdue ${rowOf("studies").prior} No change`));
    check("3. new tests: 2 added, information only (no change word), the detail pointing to the list", rowOf("newTests").big === 2 && rowOf("newTests").changeWord === ""
      && all.includes(`New tests added VeritaMap® 2 tests added in ${cards.periodPhrase(prev.start, prev.end)} 0 VeritaCheck® study on file for 1 of 2 (listed below)`));
    check("3. the change words carry the mock's colors in the HTML (better #437A22, worse #A12C7B, no change #7A7974)", (() => {
      const html = buildDigestPdfHTML(mainView, { labName: LAB_NAME, cliaNumber: CLIA });
      return html.includes(".better { color: #437A22; }") && html.includes(".worse { color: #A12C7B; }") && html.includes(".same, .info { color: #7A7974; }")
        && /<tr data-row="findings">.*class="chg better">Better</.test(html) && /<tr data-row="certificates">.*class="chg worse">Worse</.test(html) && /<tr data-row="studies">.*class="chg same">No change</.test(html);
    })());
    check("3. the new tests list: its heading and each test with its analyzer and whether a study is on file",
      all.includes(`New tests added in ${cards.periodPhrase(prev.start, prev.end)} Test Analyzer VeritaCheck® study on file`) && all.includes("Troponin I Made-up Alphamatic 500 Yes") && all.includes("BNP Made-up Alphamatic 500 Not yet"), all.slice(-700));
    check("3. the review box (the issue's review_box is 1): its heading and Print name and title, Signature, Date",
      all.includes("Reviewed by the medical director or designee Print name and title Signature Date"), all.slice(-400));
    check("3. the mock's order: the list, then the review box", all.indexOf("New tests added in") < all.indexOf("Reviewed by the medical director or designee"));
    check("3. the footer and Page 1 of 1", pages.every((p, i) => squash(p).includes(DIGEST_PDF_FOOTER_TEXT) && squash(p).includes(`Page ${i + 1} of ${pages.length}`)) && DIGEST_PDF_FOOTER_TEXT === "VeritaAssure® | Compliance Digest | Confidential, For Internal Lab Use Only");
    const people = [...Object.values(NAMES), "Pembury", "Rothwell", "Sandal", "Tallis", "Ulverston", "Wigton", "Zennor", OWNER.email, MD.email, STAFF_IN.email, "@", "digest-pdf-"];
    check("3. no person's name or address anywhere in the PDF", people.every((p) => !all.toLowerCase().includes(p.toLowerCase())), people.filter((p) => all.toLowerCase().includes(p.toLowerCase())).join(", "));
    check("3. no em dash, no SAMPLE banner, no Optional line", !all.includes(EM_DASH) && !/SAMPLE/i.test(all) && !/Optional/i.test(all) && !/made up for illustration/i.test(all));
    check("3. medical director only ever as \"medical director or designee\"", (all.match(/medical director/gi) || []).length === (all.match(/medical director or designee/gi) || []).length && /medical director or designee/i.test(all));

    // The medical director's copy: the same issue, the same comparison as their screen (the staff issue reaches them too).
    const mdView = (await call("GET", `${L}/issues/${MAIN}`, undefined, MD.token)).j;
    const mdAll = squash(pdfPages((await pdfOf(L, MAIN, MD.token)).buf, "digest-main-md.pdf").join("\n"));
    check("3. the medical director's PDF compares with the issue their screen compares with, and reads as the owner's",
      mdView.previous?.id === PRIOR && mdAll.includes("Open findings VeritaResponse™ 1 open 3 Better") && mdAll.includes(metaWant));

    // The group issue: the staff version, the group named, no review box, a section that came back null prints Not available.
    const g = JSON.parse(row(GROUP).counts_json);
    g.qc = null; // as if the QC count had thrown when it was taken (digestCountsForLab returns null for that section)
    sqlite.prepare("UPDATE digest_issues SET counts_json = ? WHERE id = ?").run(JSON.stringify(g), GROUP);
    const gPdf = await pdfOf(L, GROUP, STAFF_IN.token);
    const gPages = pdfPages(gPdf.buf, "digest-group-staff.pdf");
    const gAll = squash(gPages.join("\n"));
    check("3. the group issue (review_box 0): the staff version, sent to the group, and no review box",
      gAll.includes(`${cards.periodTitle(prev3.start, prev3.end)} | Staff version`) && gAll.includes("to the lab group Made-up Chemistry Group.") && !/Reviewed by/i.test(gAll) && !/Print name and title/.test(gAll) && !/Signature/.test(gAll), gAll.slice(0, 400));
    check("3. a section that came back null reads Not available, never 0", gAll.includes("QC rejections without a corrective action VeritaQC™ Not available This count couldn't be taken when the numbers were gathered."), gAll.slice(0, 1600));
    check("3. the oldest issue has nothing to compare with, and says so; its prior column is headed Last month",
      gAll.includes("No earlier published issue to compare with.") && gAll.includes(`Section Module ${cards.periodColumnLabel(prev3.start, prev3.end)} Last month Change Detail`));
    check("3. the group issue's footer and page count", gPages.length === 1 && squash(gPages[0]).includes(`${DIGEST_PDF_FOOTER_TEXT} Page 1 of 1`), squash(gPages[0]).slice(-200));
    // No CLIA on file.
    sqlite.prepare("UPDATE labs SET clia_number = NULL WHERE id = ?").run(LAB);
    const noClia = squash(pdfPages((await pdfOf(L, MAIN, T)).buf, "digest-main-no-clia.pdf").join("\n"));
    check("3. a lab with no CLIA on file: \"CLIA: Not on file. Enter it in account settings.\"", noClia.includes("CLIA: Not on file. Enter it in account settings.") && !noClia.includes(`CLIA ${CLIA}`));
    sqlite.prepare("UPDATE labs SET clia_number = ? WHERE id = ?").run(CLIA, LAB);

    // ── 4. Layout: a long new-tests list ───────────────────────────────────────────────────────────────────────────
    const longItems = Array.from({ length: 48 }, (_, i) => ({ mapId: 1, analyte: `Made-up Analyte ${String(i + 1).padStart(2, "0")}`, instrumentName: "Made-up Omnianalyzer 9", studyOnFile: i % 3 === 0 }));
    const longView = { ...mainView, counts: { ...mainView.counts, newTests: { count: longItems.length, items: longItems, maps: [{ mapId: 1, mapBuiltThisMonth: false, newTests: longItems.length }] } } };
    const ctx = { labName: LAB_NAME, cliaNumber: CLIA };
    const longOn = await generateDigestPDF({ ...longView, review_box: true }, ctx);
    const onPages = pdfPages(longOn.pdf, "digest-long-review.pdf").map(squash);
    check("4. a long list with the review box on: two pages; the review box moves up to stay on page 1",
      onPages.length === 2 && longOn.reviewBeforeList === true && onPages[0].includes("Reviewed by the medical director or designee") && !onPages[1].includes("Reviewed by"), `${onPages.length} ${longOn.reviewBeforeList}`);
    check("4. page 1 holds the title block, the note and the whole table; page 2 the rest of the list",
      onPages[0].includes("Compliance Digest") && onPages[0].includes(NOTE) && rows.every((r) => onPages[0].includes(r.title)) && onPages[1].includes("Made-up Analyte 48") && !onPages[0].includes("Made-up Analyte 48"));
    check("4. the list's heading row repeats on page 2, and every page has the footer with Page X of 2",
      onPages[1].includes("Test Analyzer VeritaCheck® study on file") && onPages.every((p, i) => p.includes(DIGEST_PDF_FOOTER_TEXT) && p.includes(`Page ${i + 1} of 2`)));
    const longOff = await generateDigestPDF({ ...longView, review_box: false }, ctx);
    const offPages = pdfPages(longOff.pdf, "digest-long-no-review.pdf").map(squash);
    check("4. the same list with the review box off: two pages, no review box anywhere, the table on page 1",
      offPages.length === 2 && longOff.reviewBeforeList === false && !offPages.join(" ").includes("Reviewed by") && rows.every((r) => offPages[0].includes(r.title)));
    const shortOn = await generateDigestPDF({ ...mainView, review_box: true }, ctx);
    check("4. a normal list with the review box: the mock's order kept (list, then the box), one page", shortOn.reviewBeforeList === false && shortOn.html.indexOf('data-block="tests"') < shortOn.html.indexOf('data-block="review"')
      && pdfPages(shortOn.pdf, "digest-short.pdf").length === 1);

    // ── 5. The notice ──────────────────────────────────────────────────────────────────────────────────────────────
    const N = (id: number) => `${L}/issues/${id}/notice`;
    const plan = await call("GET", N(MAIN), undefined, T);
    check("5. the count first: the leadership issue reaches the owner, two admins and the medical director; three have an address (one admin has none)",
      plan.s === 200 && plan.j.recipients === 3 && plan.j.no_address === 1 && plan.j.sent_at === null && plan.j.can_send === true, plan.text);
    const planEditor = await call("GET", N(PRIOR), undefined, EDITOR.token), planMd = await call("GET", N(MAIN), undefined, MD.token), planOut = await call("GET", N(GROUP), undefined, STAFF_OUT.token);
    check("5. the count is the owner's and admins': an editor and the medical director get 403 OWNER_OR_ADMIN_ONLY; a Staff login outside the group 404",
      planEditor.s === 403 && planEditor.j.code === "OWNER_OR_ADMIN_ONLY" && planMd.s === 403 && planOut.s === 404 && planOut.text === NOT_FOUND, `${planEditor.s} ${planMd.s} ${planOut.s}`);
    const refusals: Array<[string, number, unknown, string, number, string]> = [
      ["no expectedCount", MAIN, {}, T, 409, "COUNT_CHANGED"], ["a count that isn't the screen's", MAIN, { expectedCount: 2 }, T, 409, "COUNT_CHANGED"],
      ["a draft", DRAFT, { expectedCount: 3 }, T, 409, "NOT_PUBLISHED"], ["a withdrawn issue", WITHDRAWN, { expectedCount: 3 }, T, 409, "NOT_PUBLISHED"],
      ["Veritas support", MAIN, { expectedCount: 3 }, VLS.token, 403, "VLS_SUPPORT_CANNOT_SIGN"], ["an editor who can read the staff issue", PRIOR, { expectedCount: 1 }, EDITOR.token, 403, "OWNER_OR_ADMIN_ONLY"],
      ["the medical director", MAIN, { expectedCount: 3 }, MD.token, 403, "OWNER_OR_ADMIN_ONLY"], ["a Staff login outside the group", GROUP, { expectedCount: 1 }, STAFF_OUT.token, 404, ""],
    ];
    for (const [what, id, body, token, s, code] of refusals) {
      const r = await call("POST", N(id), body, token);
      check(`5. send refused for ${what}: ${s}${code ? ` ${code}` : ""}`, r.s === s && (!code || r.j.code === code) && (s !== 404 || r.text === NOT_FOUND), `${r.s} ${r.text}`);
    }
    const cc = await call("POST", N(MAIN), { expectedCount: 2 }, T);
    check("5. COUNT_CHANGED names the count now", cc.j.recipients === 3);
    check("5. nothing went out and nothing was recorded by the refusals", mail.length === 0 && [MAIN, DRAFT, WITHDRAWN, PRIOR, GROUP].every((id) => row(id).notice_sent_at === null));
    const crossNotice = await call("POST", N(bId), { expectedCount: 1 }, T);
    check("5. another customer's issue through this lab's path: 404, and its row is untouched", crossNotice.s === 404 && crossNotice.text === NOT_FOUND && row(bId).notice_sent_at === null);

    const sent = await call("POST", N(MAIN), { expectedCount: 3 }, ADMIN.token);
    const waitFor = async (n: number) => { for (let i = 0; i < 100 && mail.length < n; i++) await new Promise((r) => setTimeout(r, 50)); };
    await waitFor(3);
    await new Promise((r) => setTimeout(r, 150));
    const sentRow = row(MAIN);
    check("5. an admin sends it: 202, sending to 3; the issue records when, how many and who", sent.s === 202 && sent.j.sending === 3 && !!sentRow.notice_sent_at && sentRow.notice_sent_count === 3 && sentRow.notice_sent_by_user_id === ADMIN.id, `${sent.s} ${sent.text}`);
    const toSet = mail.map((m) => m.to).sort();
    check("5. one email per person reached who has an address: the owner, the admin and the medical director (not the admin with no address, not the editor or Staff logins)",
      mail.length === 3 && JSON.stringify(toSet) === JSON.stringify([OWNER.email, ADMIN.email, MD.email].sort()), JSON.stringify(toSet));
    const link = `https://www.veritaslabservices.com/labs/${LAB}/digest/${MAIN}`;
    const nameOf: Record<string, string> = { [OWNER.email]: NAMES.owner, [ADMIN.email]: NAMES.admin, [MD.email]: NAMES.md };
    for (const m of mail) {
      const others = Object.values(NAMES).filter((nm) => nm !== nameOf[m.to]);
      // The link and the button's styling carry digits; the period's title carries the year. Anything else with a digit would be a count.
      const stripped = m.html.replace(/href="[^"]*"/g, "").replace(/style="[^"]*"/g, "").replace(title, "");
      check(`5. the email to ${m.to.split("@")[0]}: subject, sender, link, own greeting, no acknowledgment asked`,
        m.subject === `${LAB_NAME}: ${title} compliance digest is ready` && m.from === DIGEST_NOTICE_FROM && DIGEST_NOTICE_FROM === "VeritaAssure® <info@veritaslabservices.com>"
          && m.html.includes(`href="${link}"`) && m.html.includes(`Hello ${nameOf[m.to]},`) && m.html.includes("No acknowledgment is needed for this issue.") && m.html.includes("Open the digest"), `${m.subject} | ${m.from} | ${m.html.slice(0, 300)}`);
      check(`5. the email to ${m.to.split("@")[0]} carries no counts and no other person's name`,
        !/\d/.test(stripped) && !others.some((nm) => m.html.includes(nm)) && !Object.values(cards.DIGEST_CARDS).some((c) => m.html.includes(c.title)) && !/overdue|expiring|unacceptable|findings/i.test(m.html),
        stripped);
      check(`5. the email to ${m.to.split("@")[0]}: no em dash, the paragraphs spaced as the read-and-sign notice spaces them`, !m.html.includes(EM_DASH) && !m.subject.includes(EM_DASH) && m.html.includes("</div><div><br></div><div>"));
    }
    const again = await call("POST", N(MAIN), { expectedCount: 3 }, T);
    await new Promise((r) => setTimeout(r, 150));
    check("5. a second notice for the same issue: 409 NOTICE_SENT with when and how many, and no more email", again.s === 409 && again.j.code === "NOTICE_SENT" && again.j.sent_at === sentRow.notice_sent_at && again.j.sent_count === 3 && mail.length === 3, `${again.s} ${again.text}`);
    const after = await call("GET", N(MAIN), undefined, T);
    const ownerView = (await call("GET", `${L}/issues/${MAIN}`, undefined, T)).j, mdAfter = (await call("GET", `${L}/issues/${MAIN}`, undefined, MD.token)).j;
    check("5. after sending: the count route and the owner's issue carry the sent date and count; the medical director's issue doesn't",
      after.j.sent_at === sentRow.notice_sent_at && after.j.sent_count === 3 && after.j.can_send === false && ownerView.notice_sent_at === sentRow.notice_sent_at && ownerView.notice_sent_count === 3
        && !("notice_sent_at" in mdAfter) && !("notice_sent_count" in mdAfter));
    // The group issue asks for acknowledgment; two sends at once send one.
    const gPlan = (await call("GET", N(GROUP), undefined, T)).j;
    const [s1, s2] = await Promise.all([call("POST", N(GROUP), { expectedCount: gPlan.recipients }, T), call("POST", N(GROUP), { expectedCount: gPlan.recipients }, ADMIN.token)]);
    await waitFor(4);
    await new Promise((r) => setTimeout(r, 150));
    const statuses = [s1.s, s2.s].sort();
    check("5. two sends at once for the group issue: one 202, one 409 NOTICE_SENT, one email (to the one Staff login in the group)",
      gPlan.recipients === 1 && JSON.stringify(statuses) === JSON.stringify([202, 409]) && [s1, s2].some((r) => r.j.code === "NOTICE_SENT") && mail.length === 4 && mail[3].to === STAFF_IN.email, JSON.stringify({ statuses, n: mail.length, gPlan }));
    check("5. that email asks for acknowledgment and greets the Staff login by its own name only",
      mail[3]?.html.includes("Your lab asks each reader to acknowledge this issue. Open it and select &quot;I've read this&quot;.") && mail[3]?.html.includes(`Hello ${NAMES.staffIn},`)
        && !Object.values(NAMES).filter((nm) => nm !== NAMES.staffIn).some((nm) => mail[3].html.includes(nm)) && mail[3]?.subject === `${LAB_NAME}: ${cards.periodTitle(prev3.start, prev3.end)} compliance digest is ready`);
    const audits = (sqlite.prepare("SELECT entity_label, user_id, after_json FROM audit_log WHERE entity_type = 'digest_issue' AND entity_id = ? ORDER BY id").all(String(MAIN)) as any[]).map((a) => ({ ...a, after: JSON.parse(a.after_json || "{}") }));
    const sentAudit = audits.find((a) => /notice sent to 3$/.test(a.entity_label)), doneAudit = audits.find((a) => /notice finished, 3 sent, 0 not sent$/.test(a.entity_label));
    check("5. audit rows: the send (by the admin, with when and how many) and its finish (3 sent, 0 not sent)",
      !!sentAudit && sentAudit.user_id === ADMIN.id && sentAudit.after.notice_sent_count === 3 && sentAudit.after.notice_sent_at === sentRow.notice_sent_at && !!doneAudit && doneAudit.after.sent === 3 && doneAudit.after.failed === 0,
      JSON.stringify(audits.map((a) => a.entity_label)));
    check("5. no notice was recorded on the issues nobody sent one for", [PRIOR, DRAFT, WITHDRAWN, bId].every((id) => row(id).notice_sent_at === null));
    check(`5. no em dash in any of the ${replies.length} replies (error messages included)`, replies.every((t) => !t.includes(EM_DASH)), replies.filter((t) => t.includes(EM_DASH)).slice(0, 2).join(" | "));
  } finally {
    server.close();
    try { await (await getBrowser()).close(); } catch { /* no browser was started */ }
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log(failures ? `${failures} FAILED` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
