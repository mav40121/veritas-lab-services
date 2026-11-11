// tests/integration/digest-issues.test.ts
//
// 2026-11-11 (Michael, Q281 = 1; the compliance digest, PR 3 "issue builder"; review box Q284 = 1): server/digestIssues.ts,
// the routes under /api/labs/:labId/digest. A made-up owner, lab and people on a fresh database. It checks:
//   0. the period rules: last finished month or calendar quarter, on the lab's own calendar day;
//   1. settings: any member reads them, only the owner or an admin writes (an editor and a Staff login get 403
//      OWNER_OR_ADMIN_ONLY), bad values are refused, the review box defaults off;
//   2. a draft: owner or admin only, the last finished month by default, 409 on a second issue for the same period,
//      a period that hasn't ended refused;
//   3. a draft shows live counts that move as data changes, and only the owner and admins can see it;
//   4. patient information in the note (or a withdraw reason) is refused, 400 PHI_REFUSED with the field;
//   5. publish freezes the counts: data that changes afterwards doesn't move them; nothing in counts_json carries an @ or
//      a made-up name;
//   6. audience reach: leadership, staff and group issues, and a 404 (the same as an id that doesn't exist) for anyone
//      outside the audience, a limited Staff login included;
//   7. read and acknowledgment, each recorded once; acknowledgment refused when the issue doesn't ask for it;
//   8. the roster is the owner's and admins'; a reader gets only their own status;
//   9. withdraw keeps the row, needs a reason, and the period can be drafted again;
//  10. the review box: a draft takes the lab's setting when created, and a published issue keeps its own;
//  11. quarterly periods, and a quarter's maintenance review covering its three months;
//  12. another lab's issue is 404 through this lab's path; 13. the plan allowlist; 14. audit rows; no em dash in any reply;
//  15. (PR 4, the screens) GET issues/:id's `previous`: the lab's prior published issue of the same frequency, never a
//      withdrawn one or a draft, its stored counts picked to this issue's sections and never recomputed, null for a reader
//      the prior issue's audience doesn't reach; a group issue's `audience_groups`; the owner's settings `groups`.
// Run: rm -f <db> && DB_PATH=<db> JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/digest-issues.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const EM_DASH = String.fromCharCode(0x2014);

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { digestCountsForLab } = await import("../../server/digestCounts");
  const { lastFinishedDigestPeriod, digestPeriodFrom, DEFAULT_DIGEST_SECTIONS } = await import("../../server/digestIssues");
  const { labToday, labLocalDate, addLabDays, withLabClock } = await import("../../server/dateLocal");
  const sqlite = (db as any).$client;
  const ADMIN_SECRET = process.env.ADMIN_SECRET || "test-admin-secret";

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const replies: string[] = [];
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    replies.push(text);
    let j: any = {}; try { j = JSON.parse(text); } catch { /* not JSON */ }
    return { s: r.status, j, text };
  };

  try {
    // ── 0. Periods ─────────────────────────────────────────────────────────────────────────────────────────────────────
    const P = (today: string, f: "monthly" | "quarterly") => lastFinishedDigestPeriod(today, f);
    const cases: Array<[string, "monthly" | "quarterly", string, string]> = [
      ["2026-01-15", "monthly", "2025-12-01", "2025-12-31"], ["2026-03-01", "monthly", "2026-02-01", "2026-02-28"],
      ["2024-03-10", "monthly", "2024-02-01", "2024-02-29"], ["2026-12-31", "monthly", "2026-11-01", "2026-11-30"],
      ["2026-01-15", "quarterly", "2025-10-01", "2025-12-31"], ["2026-03-31", "quarterly", "2025-10-01", "2025-12-31"],
      ["2026-04-01", "quarterly", "2026-01-01", "2026-03-31"], ["2026-07-01", "quarterly", "2026-04-01", "2026-06-30"],
      ["2026-09-30", "quarterly", "2026-04-01", "2026-06-30"], ["2026-11-11", "quarterly", "2026-07-01", "2026-09-30"],
    ];
    for (const [today, f, s, e] of cases) {
      const got = P(today, f);
      check(`0. on ${today} the last finished ${f === "monthly" ? "month" : "quarter"} is ${s} to ${e}`, got.start === s && got.end === e, JSON.stringify(got));
    }
    const q4 = digestPeriodFrom("2026-10-01", "quarterly") as any;
    check("0. a quarter starting October 1 ends December 31", q4.start === "2026-10-01" && q4.end === "2026-12-31", JSON.stringify(q4));
    check("0. a quarter can't start in February", "error" in digestPeriodFrom("2026-02-01", "quarterly"));
    check("0. a month can't start on the 15th", "error" in digestPeriodFrom("2026-01-15", "monthly"));
    check("0. a month that doesn't exist is refused", "error" in digestPeriodFrom("2026-13-01", "monthly") && "error" in digestPeriodFrom("garbage", "monthly"));
    // 10 PM on November 30 in New York is already December 1 in UTC: the lab's last finished month is still October.
    const nyDay = labLocalDate("2026-12-01T03:00:00.000Z", false, "America/New_York");
    check("0. on the lab's clock: 03:00Z on December 1 is November 30 in New York, so the last finished month is October (UTC would say November)",
      nyDay === "2026-11-30" && P(nyDay, "monthly").start === "2026-10-01" && P("2026-12-01", "monthly").start === "2026-11-01", nyDay);

    // ── Setup: a made-up owner and lab on New York time, its people, a group, and another customer's lab ─────────────
    const stamp = Date.now();
    const NAMES = {
      owner: "Made-up Digest Owner Quillon", admin: "Made-up Admin Brisbane", editor: "Made-up Editor Calloway",
      md: "Made-up Director Dunmore", staffIn: "Made-up Staff Ingleby", staffOut: "Made-up Staff Outram", other: "Made-up Other Owner Vasquale",
      vls: "Made-up Veritas Support",
    };
    const register = async (tag: string, name: string) => {
      const email = `digest-issues-${tag}-${stamp}@example.test`;
      const reg = (await call("POST", "/api/auth/register", { email, password: "Testpass123", name, hipaa_acknowledged: true })).j;
      return { email, name, token: reg.token as string, id: Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id) };
    };
    const provision = async (email: string, labName: string) => Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN_SECRET, ownerEmail: email, labName, plan: "hospital" })).j.labId);
    const now = new Date().toISOString();
    const member = (lab: number, userId: number, role = "staff") => sqlite.prepare(
      "INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, ?, '{}', 'active', 0, ?, ?, ?)"
    ).run(lab, userId, role, now, now, now);

    const OWNER = await register("owner", NAMES.owner);
    const LAB = await provision(OWNER.email, "Made-up Digest Issues Lab");
    const L = `/api/labs/${LAB}/digest`;
    const TZ = "America/New_York";
    sqlite.prepare("UPDATE labs SET time_zone = ? WHERE id = ?").run(TZ, LAB);
    const today = withLabClock(TZ, () => labToday());
    const M0 = `${today.slice(0, 8)}01`;
    const prev = { start: addLabDays(M0, 0, -1), end: addLabDays(M0, -1) };
    const prev2 = digestPeriodFrom(addLabDays(M0, 0, -2), "monthly") as { start: string; end: string };
    const prev3 = digestPeriodFrom(addLabDays(M0, 0, -3), "monthly") as { start: string; end: string };

    const staffLab = Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Made-up Digest Issues Lab', '11D7654395', ?, ?, ?)").run(OWNER.id, LAB, now, now).lastInsertRowid);
    const roster = (first: string, last: string) => Number(sqlite.prepare(
      "INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'Made-up Tech', 'active', ?, ?)"
    ).run(staffLab, LAB, OWNER.id, last, first, now, now).lastInsertRowid);
    const seat = (u: { id: number; email: string }, type: string, perms: string, emp: number | null) => sqlite.prepare(
      "INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, staff_employee_id, permissions, invited_at, accepted_at) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)"
    ).run(OWNER.id, u.email, u.id, type, LAB, emp, perms, now, now);

    const ADMIN = await register("admin", NAMES.admin); member(LAB, ADMIN.id, "admin");
    const EDITOR = await register("editor", NAMES.editor); member(LAB, EDITOR.id); seat(EDITOR, "active", '{"mode":"edit_all"}', null);
    const MD = await register("md", NAMES.md); member(LAB, MD.id);
    sqlite.prepare("UPDATE labs SET medical_director_email = ? WHERE id = ?").run(MD.email.toUpperCase(), LAB); // matched without case
    const STAFF_IN = await register("staffin", NAMES.staffIn); member(LAB, STAFF_IN.id);
    const empIn = roster("Made-up", "Ingleby"); seat(STAFF_IN, "staff_portal", '{"mode":"view_all"}', empIn);
    const STAFF_OUT = await register("staffout", NAMES.staffOut); member(LAB, STAFF_OUT.id);
    const empOut = roster("Made-up", "Outram"); seat(STAFF_OUT, "staff_portal", '{"mode":"view_all"}', empOut);
    const VLS = await register("vls", NAMES.vls); sqlite.prepare("UPDATE users SET vls_support = 1 WHERE id = ?").run(VLS.id);
    const group = (name: string, retired = 0) => Number(sqlite.prepare("INSERT INTO lab_groups (lab_id, name, retired, created_by) VALUES (?, ?, ?, ?)").run(LAB, name, retired, OWNER.id).lastInsertRowid);
    const G1 = group("Made-up Chemistry Group");
    const GRETIRED = group("Made-up Retired Group", 1);
    sqlite.prepare("INSERT INTO lab_group_members (group_id, lab_id, employee_id, name, added_by) VALUES (?, ?, ?, 'Made-up Ingleby', ?)").run(G1, LAB, empIn, OWNER.id);

    const OTHER = await register("other", NAMES.other);
    const LAB_B = await provision(OTHER.email, "Made-up Other Customer Lab");
    const LB = `/api/labs/${LAB_B}/digest`;
    const GB = Number(sqlite.prepare("INSERT INTO lab_groups (lab_id, name, created_by) VALUES (?, 'Made-up Other Group', ?)").run(LAB_B, OTHER.id).lastInsertRowid);
    const LAB_FREE = await provision(OTHER.email, "Made-up Free Lab");
    sqlite.prepare("UPDATE labs SET plan = 'free' WHERE id = ?").run(LAB_FREE);
    check("setup: two customers' labs, six people in the lab, a group with one Staff login", [LAB, LAB_B, LAB_FREE, OWNER.id, ADMIN.id, EDITOR.id, MD.id, STAFF_IN.id, STAFF_OUT.id, G1].every((n) => n > 0) && !!OWNER.token && !!STAFF_IN.token,
      JSON.stringify({ LAB, LAB_B, today }));

    const finding = (lab: number) => sqlite.prepare("INSERT INTO findings (user_id, lab_id, accreditor, status, due_date, description) VALUES (?, ?, 'CAP', 'open', ?, 'Made-up finding')").run(OWNER.id, lab, addLabDays(today, 30));
    const study = (date: string) => sqlite.prepare(
      `INSERT INTO studies (user_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at, lab_id, lifecycle_state)
       VALUES (?, 'Albumin', 'Alphamatic 500', 'MU', ?, 'precision', 0.1, '[]', '[]', 'pass', ?, ?, 'draft')`
    ).run(OWNER.id, date, now, LAB);
    const auditRows = (entityType: string, id: number) => sqlite.prepare("SELECT action, entity_label, before_json, after_json, user_id FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY id").all(entityType, String(id)) as any[];
    const issueRow = (id: number) => sqlite.prepare("SELECT * FROM digest_issues WHERE id = ?").get(id) as any;
    const NOT_FOUND = (await call("GET", `${L}/issues/999999`, undefined, OWNER.token)).text;

    // ── 1. Settings ──────────────────────────────────────────────────────────────────────────────────────────────────
    const sStaff = await call("GET", `${L}/settings`, undefined, STAFF_IN.token);
    check("1. any member reads the settings: a Staff login gets the defaults (off, monthly, every section but the scan, leadership, no acknowledgment, no review box)",
      sStaff.s === 200 && sStaff.j.enabled === false && sStaff.j.frequency === "monthly" && same(sStaff.j.sections, DEFAULT_DIGEST_SECTIONS) && sStaff.j.sections.length === 11
        && !sStaff.j.sections.includes("scan") && sStaff.j.audience === "leadership" && sStaff.j.ack_default === false && sStaff.j.review_box === false && sStaff.j.can_edit === false,
      JSON.stringify(sStaff.j));
    check("1. the default period is the last finished month on the lab's clock", same(sStaff.j.default_period, prev), JSON.stringify({ got: sStaff.j.default_period, prev }));
    for (const [who, u] of [["an editor", EDITOR], ["a Staff login", STAFF_IN], ["the medical director (a plain member)", MD]] as const) {
      const r = await call("PUT", `${L}/settings`, { enabled: true }, u.token);
      check(`1. settings write refused for ${who}: 403 OWNER_OR_ADMIN_ONLY`, r.s === 403 && r.j.code === "OWNER_OR_ADMIN_ONLY", `${r.s} ${r.text}`);
    }
    check("1. nothing was stored by the refused writes", !sqlite.prepare("SELECT 1 FROM digest_settings WHERE lab_id = ?").get(LAB));
    const sAdmin = await call("PUT", `${L}/settings`, { ack_default: true }, ADMIN.token);
    check("1. an admin changes the settings", sAdmin.s === 200 && sAdmin.j.ack_default === true && sAdmin.j.can_edit === true, `${sAdmin.s} ${sAdmin.text}`);
    const bad: Array<[string, unknown, string]> = [
      ["a frequency other than monthly or quarterly", { frequency: "weekly" }, "BAD_FREQUENCY"],
      ["an unknown section", { sections: ["findings", "horoscope"] }, "BAD_SECTIONS"],
      ["no sections", { sections: [] }, "BAD_SECTIONS"],
      ["a group audience with no groups", { audience: "groups", audience_group_ids: [] }, "BAD_GROUPS"],
      ["a retired group", { audience: "groups", audience_group_ids: [GRETIRED] }, "BAD_GROUPS"],
      ["another lab's group", { audience: "groups", audience_group_ids: [GB] }, "BAD_GROUPS"],
      ["an audience that doesn't exist", { audience: "everyone" }, "BAD_AUDIENCE"],
      ["a review box that isn't yes or no", { review_box: "maybe" }, "BAD_VALUE"],
    ];
    for (const [what, body, code] of bad) {
      const r = await call("PUT", `${L}/settings`, body, OWNER.token);
      check(`1. settings refuse ${what} (400 ${code})`, r.s === 400 && r.j.code === code, `${r.s} ${r.text}`);
    }
    const sOwner = await call("PUT", `${L}/settings`, { ack_default: false, review_box: true }, OWNER.token);
    check("1. the owner turns the review box on (Q284 = 1)", sOwner.s === 200 && sOwner.j.review_box === true && sOwner.j.ack_default === false, sOwner.text);
    check("1. a settings change writes an audit row", auditRows("digest_settings", LAB).length === 2);

    // ── 2. A draft ───────────────────────────────────────────────────────────────────────────────────────────────────
    for (const [who, u] of [["an editor", EDITOR], ["a Staff login", STAFF_IN]] as const) {
      const r = await call("POST", `${L}/issues`, {}, u.token);
      check(`2. drafting is refused for ${who}: 403 OWNER_OR_ADMIN_ONLY`, r.s === 403 && r.j.code === "OWNER_OR_ADMIN_ONLY", `${r.s} ${r.text}`);
    }
    const c1 = await call("POST", `${L}/issues`, {}, OWNER.token);
    const D1 = Number(c1.j.id);
    check("2. the owner drafts the default issue: the last finished month on the lab's clock, as a draft with live counts",
      c1.s === 201 && c1.j.status === "draft" && c1.j.period_start === prev.start && c1.j.period_end === prev.end && c1.j.counts_live === true
        && c1.j.counts?.monthStart === prev.start && c1.j.counts?.monthEnd === prev.end && c1.j.counts?.asOf === today,
      `${c1.s} ${c1.text.slice(0, 300)}`);
    check("2. the draft takes the lab's settings: every default section, leadership, no acknowledgment, the review box on",
      same(c1.j.sections, DEFAULT_DIGEST_SECTIONS) && c1.j.audience === "leadership" && c1.j.ack_requested === false && c1.j.review_box === true, JSON.stringify(c1.j));
    check("2. a draft stores no counts (counts_json and counts_as_of NULL)", issueRow(D1).counts_json === null && issueRow(D1).counts_as_of === null);
    const dup = await call("POST", `${L}/issues`, {}, OWNER.token);
    const dup2 = await call("POST", `${L}/issues`, { periodStart: prev.start }, ADMIN.token);
    check("2. a second issue for the same period: 409 PERIOD_HAS_ISSUE, by default and naming the period", dup.s === 409 && dup.j.code === "PERIOD_HAS_ISSUE" && dup.j.issueId === D1 && dup2.s === 409 && dup2.j.code === "PERIOD_HAS_ISSUE", `${dup.s}/${dup2.s}`);
    for (const [what, periodStart, code] of [["a day that isn't the first", `${prev.start.slice(0, 8)}15`, "BAD_PERIOD"], ["text that isn't a date", "last month", "BAD_PERIOD"], ["a thirteenth month", "2026-13-01", "BAD_PERIOD"],
      ["this month, which hasn't ended", M0, "PERIOD_NOT_FINISHED"], ["next year", `${Number(today.slice(0, 4)) + 1}-01-01`, "PERIOD_NOT_FINISHED"]] as const) {
      const r = await call("POST", `${L}/issues`, { periodStart }, OWNER.token);
      check(`2. drafting refuses ${what} (400 ${code})`, r.s === 400 && r.j.code === code, `${r.s} ${r.text}`);
    }
    check("2. only the one draft exists", (sqlite.prepare("SELECT COUNT(*) AS n FROM digest_issues WHERE lab_id = ?").get(LAB) as any).n === 1);

    // ── 10 (part). The review box: the draft keeps what it took when the lab's setting changes ───────────────────────
    await call("PUT", `${L}/settings`, { review_box: false }, OWNER.token);
    check("10. the lab turns the review box off: the draft made while it was on keeps it", (await call("GET", `${L}/issues/${D1}`, undefined, OWNER.token)).j.review_box === true && issueRow(D1).review_box === 1);

    // ── 3. Live counts ───────────────────────────────────────────────────────────────────────────────────────────────
    const g1 = await call("GET", `${L}/issues/${D1}`, undefined, OWNER.token);
    const f0 = g1.j.counts?.findings?.open, s0 = g1.j.counts?.studies?.completedInMonth;
    finding(LAB); study(prev.start);
    const g2 = await call("GET", `${L}/issues/${D1}`, undefined, ADMIN.token);
    check("3. a draft's counts move as data changes: one more open finding and one more study in the month",
      typeof f0 === "number" && g2.j.counts.findings.open === f0 + 1 && g2.j.counts.studies.completedInMonth === s0 + 1 && g2.j.counts_live === true,
      JSON.stringify({ f0, s0, f1: g2.j.counts?.findings, s1: g2.j.counts?.studies }));
    check("3. the live counts match digestCountsForLab for the period", same(g2.j.counts.findings, digestCountsForLab(sqlite, LAB, prev.start, prev.end).findings));
    check("3. a draft's counts_as_of is the moment they were taken", typeof g2.j.counts_as_of === "string" && Math.abs(Date.parse(g2.j.counts_as_of) - Date.now()) < 60000, g2.j.counts_as_of);
    for (const [who, u] of [["an editor", EDITOR], ["the medical director", MD], ["a Staff login", STAFF_IN]] as const) {
      const r = await call("GET", `${L}/issues/${D1}`, undefined, u.token);
      const list = await call("GET", `${L}/issues`, undefined, u.token);
      check(`3. ${who} can't see a draft: the same 404 as an id that doesn't exist, and it isn't listed`, r.s === 404 && r.text === NOT_FOUND && list.s === 200 && list.j.issues.length === 0, `${r.s} ${r.text} ${list.text.slice(0, 200)}`);
    }

    // ── 4. Patient information ───────────────────────────────────────────────────────────────────────────────────────
    for (const [what, note] of [["a medical record number", "Made-up note: MRN 12345678 was the outlier"], ["a labeled patient name", "Patient name: Made-up"], ["a Social Security number", "Made-up 123-45-6789"]] as const) {
      const r = await call("PUT", `${L}/issues/${D1}`, { note }, OWNER.token);
      check(`4. a note with ${what} is refused: 400 PHI_REFUSED naming the note`, r.s === 400 && r.j.code === "PHI_REFUSED" && r.j.field === "note" && !r.text.includes(note), `${r.s} ${r.text}`);
    }
    check("4. the refused notes were not saved", issueRow(D1).note === null);
    const NOTE = "Made-up note for the month. QC looks steady and the new analyzer is in.";
    const e1 = await call("PUT", `${L}/issues/${D1}`, { note: NOTE, sections: ["findings", "studies", "qc"] }, OWNER.token);
    check("4. a clean note saves, and the sections narrow to three (in the digest's order)", e1.s === 200 && e1.j.note === NOTE && same(e1.j.sections, ["studies", "qc", "findings"]), `${e1.s} ${e1.text.slice(0, 200)}`);
    check("4. the draft's counts carry only those three sections", same(Object.keys(e1.j.counts).sort(), ["asOf", "findings", "monthEnd", "monthStart", "qc", "studies", "timeZone"]), JSON.stringify(Object.keys(e1.j.counts)));
    const tog = [await call("PUT", `${L}/issues/${D1}`, { review_box: false }, OWNER.token), await call("PUT", `${L}/issues/${D1}`, { review_box: true }, OWNER.token)];
    check("10. a draft's review box can be set by the owner", tog[0].j.review_box === false && tog[1].j.review_box === true);
    const eEditor = await call("PUT", `${L}/issues/${D1}`, { note: "Made-up editor note" }, EDITOR.token);
    check("4. an editor editing the draft gets 404 (they can't see it)", eEditor.s === 404 && issueRow(D1).note === NOTE, `${eEditor.s}`);

    // ── 5. Publish freezes the counts ────────────────────────────────────────────────────────────────────────────────
    const pEditor = await call("POST", `${L}/issues/${D1}/publish`, {}, EDITOR.token);
    check("5. an editor can't publish (404, the draft is invisible to them)", pEditor.s === 404 && issueRow(D1).status === "draft");
    const pStale = await call("POST", `${L}/issues/${D1}/publish`, { expectedCountsAsOf: "2000-01-01" }, OWNER.token);
    check("5. publishing with counts reviewed on another day is refused: 409 COUNTS_AS_OF_CHANGED", pStale.s === 409 && pStale.j.code === "COUNTS_AS_OF_CHANGED" && pStale.j.asOf === today && issueRow(D1).status === "draft", `${pStale.s} ${pStale.text}`);
    const before = await call("GET", `${L}/issues/${D1}`, undefined, OWNER.token);
    const pub = await call("POST", `${L}/issues/${D1}/publish`, { expectedCountsAsOf: before.j.counts.asOf }, OWNER.token);
    const stored = issueRow(D1);
    const frozen = JSON.parse(stored.counts_json || "{}");
    check("5. the owner publishes: status published, counts frozen with the moment they were taken, by the owner",
      pub.s === 200 && pub.j.status === "published" && stored.status === "published" && !!stored.counts_as_of && stored.published_by_user_id === OWNER.id && pub.j.counts_live === false,
      `${pub.s} ${pub.text.slice(0, 200)}`);
    check("5. only the issue's sections are stored", same(Object.keys(frozen).sort(), ["asOf", "findings", "monthEnd", "monthStart", "qc", "studies", "timeZone"]), JSON.stringify(Object.keys(frozen)));
    check("5. what was stored is what the reviewer saw", same(frozen.findings, before.j.counts.findings) && same(frozen.studies, before.j.counts.studies), JSON.stringify({ frozen: frozen.findings, saw: before.j.counts.findings }));
    finding(LAB); finding(LAB); study(prev.start);
    const after = await call("GET", `${L}/issues/${D1}`, undefined, OWNER.token);
    check("5. data that changes after publishing doesn't move the counts", same(after.j.counts, frozen) && after.j.counts.findings.open === before.j.counts.findings.open && after.j.counts_as_of === stored.counts_as_of,
      JSON.stringify({ now: after.j.counts?.findings, frozen: frozen.findings }));
    check("5. (while the live count has moved)", digestCountsForLab(sqlite, LAB, prev.start, prev.end).findings!.open === frozen.findings.open + 2);
    const ePub = await call("PUT", `${L}/issues/${D1}`, { note: "Made-up late edit" }, OWNER.token);
    const rePub = await call("POST", `${L}/issues/${D1}/publish`, {}, OWNER.token);
    check("5. a published issue can't be edited or published again: 409 NOT_DRAFT", ePub.s === 409 && ePub.j.code === "NOT_DRAFT" && rePub.s === 409 && rePub.j.code === "NOT_DRAFT" && issueRow(D1).note === NOTE);

    // ── 6. Audience reach ────────────────────────────────────────────────────────────────────────────────────────────
    const draftFor = async (period: { start: string }, edits: Record<string, unknown>) => {
      const c = await call("POST", `${L}/issues`, { periodStart: period.start }, OWNER.token);
      const id = Number(c.j.id);
      const e = await call("PUT", `${L}/issues/${id}`, edits, OWNER.token);
      return { id, s: [c.s, e.s] };
    };
    const P2 = await draftFor(prev2, { audience: "staff", note: "Made-up staff note" });
    const P3 = await draftFor(prev3, { audience: "groups", audience_group_ids: [G1], ack_requested: true });
    check("10. issues drafted after the lab turned the review box off take it off", issueRow(P2.id).review_box === 0 && issueRow(P3.id).review_box === 0);
    const pub2 = await call("POST", `${L}/issues/${P2.id}/publish`, {}, ADMIN.token);
    const pub3 = await call("POST", `${L}/issues/${P3.id}/publish`, {}, OWNER.token);
    check("6. setup: a staff issue (published by an admin) and a group issue that asks for acknowledgment", same(P2.s, [201, 200]) && same(P3.s, [201, 200]) && pub2.s === 200 && pub3.s === 200, JSON.stringify([P2.s, P3.s, pub2.s, pub3.s]));
    const reach: Array<[string, { token: string }, number, boolean]> = [
      ["owner", OWNER, D1, true], ["admin", ADMIN, D1, true], ["medical director", MD, D1, true], ["editor", EDITOR, D1, false], ["Staff login in the group", STAFF_IN, D1, false], ["Staff login outside the group", STAFF_OUT, D1, false],
      ["owner", OWNER, P2.id, true], ["medical director", MD, P2.id, true], ["editor", EDITOR, P2.id, true], ["Staff login in the group", STAFF_IN, P2.id, true], ["Staff login outside the group", STAFF_OUT, P2.id, true],
      ["admin", ADMIN, P3.id, true], ["Staff login in the group", STAFF_IN, P3.id, true], ["Staff login outside the group", STAFF_OUT, P3.id, false], ["editor", EDITOR, P3.id, false], ["medical director", MD, P3.id, false],
    ];
    for (const [who, u, id, sees] of reach) {
      const r = await call("GET", `${L}/issues/${id}`, undefined, u.token);
      const kind = id === D1 ? "leadership" : id === P2.id ? "staff" : "group";
      check(`6. ${kind} issue, ${who}: ${sees ? "reads it" : "404, the same as an id that doesn't exist"}`, sees ? r.s === 200 && r.j.status === "published" : r.s === 404 && r.text === NOT_FOUND, `${r.s} ${r.text.slice(0, 120)}`);
    }
    const listOf = async (u: { token: string }) => ((await call("GET", `${L}/issues`, undefined, u.token)).j.issues || []).map((i: any) => i.id).sort((a: number, b: number) => a - b);
    const sorted = (...ids: number[]) => ids.sort((a, b) => a - b);
    check("6. the lists: a Staff login in the group gets the staff and group issues", same(await listOf(STAFF_IN), sorted(P2.id, P3.id)));
    check("6. the lists: a Staff login outside the group gets the staff issue only", same(await listOf(STAFF_OUT), [P2.id]));
    check("6. the lists: the medical director gets the leadership and staff issues", same(await listOf(MD), sorted(D1, P2.id)));
    check("6. the lists: an editor gets the staff issue only", same(await listOf(EDITOR), [P2.id]));
    check("6. the lists: the owner gets all three", same(await listOf(OWNER), sorted(D1, P2.id, P3.id)));
    const staffRead = await call("GET", `${L}/issues/${P2.id}`, undefined, STAFF_IN.token);
    check("6. a Staff login's issue carries no person's name or the publisher's id", staffRead.s === 200 && ![NAMES.owner, NAMES.admin, NAMES.staffOut, OWNER.email].some((n) => staffRead.text.includes(n)) && !("published_by_user_id" in staffRead.j), staffRead.text.slice(0, 200));

    // ── 7. Read and acknowledgment ───────────────────────────────────────────────────────────────────────────────────
    const ackRow = (issue: number, user: number) => sqlite.prepare("SELECT COUNT(*) AS n, MIN(read_at) AS r, MIN(acknowledged_at) AS a FROM digest_issue_acks WHERE issue_id = ? AND user_id = ?").get(issue, user) as any;
    const r1 = await call("POST", `${L}/issues/${P2.id}/read`, {}, STAFF_IN.token);
    const r2 = await call("POST", `${L}/issues/${P2.id}/read`, {}, STAFF_IN.token);
    check("7. a Staff login marks the staff issue read, once: the second time keeps the first time", r1.s === 200 && !!r1.j.mine.read_at && r2.j.mine.read_at === r1.j.mine.read_at && ackRow(P2.id, STAFF_IN.id).n === 1, `${r1.text} ${r2.text}`);
    const aNo = await call("POST", `${L}/issues/${P2.id}/ack`, {}, STAFF_IN.token);
    check("7. acknowledging an issue that doesn't ask for it: 409 ACK_NOT_REQUESTED", aNo.s === 409 && aNo.j.code === "ACK_NOT_REQUESTED" && ackRow(P2.id, STAFF_IN.id).a === null, `${aNo.s} ${aNo.text}`);
    const a1 = await call("POST", `${L}/issues/${P3.id}/ack`, {}, STAFF_IN.token);
    const a2 = await call("POST", `${L}/issues/${P3.id}/ack`, {}, STAFF_IN.token);
    check("7. a Staff login in the group acknowledges the group issue, once (it reads as read too)", a1.s === 200 && !!a1.j.mine.acknowledged_at && !!a1.j.mine.read_at && a2.j.mine.acknowledged_at === a1.j.mine.acknowledged_at && ackRow(P3.id, STAFF_IN.id).n === 1, `${a1.text} ${a2.text}`);
    const outRead = await call("POST", `${L}/issues/${P3.id}/read`, {}, STAFF_OUT.token);
    const outAck = await call("POST", `${L}/issues/${P3.id}/ack`, {}, STAFF_OUT.token);
    check("7. a Staff login outside the group can't read or acknowledge the group issue (404), and nothing is recorded", outRead.s === 404 && outAck.s === 404 && ackRow(P3.id, STAFF_OUT.id).n === 0);
    const vlsSees = await call("GET", `${L}/issues/${P3.id}`, undefined, VLS.token);
    const vlsAck = await call("POST", `${L}/issues/${P3.id}/ack`, {}, VLS.token);
    check("7. Veritas support can open the issue but never acknowledges it for a reader (403 VLS_SUPPORT_CANNOT_SIGN)", vlsSees.s === 200 && vlsAck.s === 403 && vlsAck.j.code === "VLS_SUPPORT_CANNOT_SIGN" && ackRow(P3.id, VLS.id).n === 0, `${vlsSees.s} ${vlsAck.s} ${vlsAck.text}`);

    // ── 8. The roster ────────────────────────────────────────────────────────────────────────────────────────────────
    const ro3 = await call("GET", `${L}/issues/${P3.id}/acks`, undefined, OWNER.token);
    const inRoster = (j: any, id: number) => (j.roster || []).find((r: any) => r.user_id === id);
    check("8. the owner's roster for the group issue: one person in the audience, read and acknowledged, named",
      ro3.s === 200 && ro3.j.totals.audience === 1 && ro3.j.totals.read === 1 && ro3.j.totals.acknowledged === 1 && ro3.j.totals.not_acknowledged === 0 && inRoster(ro3.j, STAFF_IN.id)?.name === NAMES.staffIn && !!inRoster(ro3.j, STAFF_IN.id)?.acknowledged_at,
      ro3.text.slice(0, 300));
    const labPeople = (sqlite.prepare("SELECT user_id AS id FROM lab_members WHERE lab_id = ? AND status = 'active' UNION SELECT seat_user_id FROM user_seats WHERE lab_id = ? AND seat_type = 'staff_portal' AND status = 'active'").all(LAB, LAB) as any[]).length;
    const ro2 = await call("GET", `${L}/issues/${P2.id}/acks`, undefined, ADMIN.token);
    check("8. an admin's roster for the staff issue: everyone in the lab, one read, acknowledgment not asked", ro2.s === 200 && ro2.j.totals.audience === labPeople && labPeople >= 6 && ro2.j.totals.read === 1 && ro2.j.totals.acknowledged === null && inRoster(ro2.j, STAFF_OUT.id)?.read_at === null,
      JSON.stringify({ totals: ro2.j.totals, labPeople }));
    const ro1 = await call("GET", `${L}/issues/${D1}/acks`, undefined, OWNER.token);
    const aud1 = new Set((ro1.j.roster || []).filter((r: any) => r.in_audience).map((r: any) => r.user_id));
    check("8. the leadership roster: the owner, the admin and the medical director, not the editor or the Staff logins",
      ro1.s === 200 && aud1.has(OWNER.id) && aud1.has(ADMIN.id) && aud1.has(MD.id) && !aud1.has(EDITOR.id) && !aud1.has(STAFF_IN.id) && !aud1.has(STAFF_OUT.id), JSON.stringify([...aud1]));
    const mine2 = await call("GET", `${L}/issues/${P2.id}/acks`, undefined, STAFF_IN.token);
    check("8. a Staff login asking for the roster gets only its own status, no one else's name",
      mine2.s === 200 && !!mine2.j.mine?.read_at && !("roster" in mine2.j) && !("totals" in mine2.j) && ![NAMES.staffOut, NAMES.owner, NAMES.md].some((n) => mine2.text.includes(n)), mine2.text);
    const mdMine = await call("GET", `${L}/issues/${D1}/acks`, undefined, MD.token);
    check("8. the medical director (not an admin) gets only their own status on the leadership issue", mdMine.s === 200 && !("roster" in mdMine.j) && mdMine.j.mine?.read_at === null, mdMine.text);
    const outRoster = await call("GET", `${L}/issues/${P3.id}/acks`, undefined, STAFF_OUT.token);
    check("8. a Staff login outside the group asking for the group issue's roster: 404", outRoster.s === 404 && outRoster.text === NOT_FOUND);

    // ── 9. Withdraw ──────────────────────────────────────────────────────────────────────────────────────────────────
    const wNo = await call("POST", `${L}/issues/${P2.id}/withdraw`, {}, OWNER.token);
    const wBlank = await call("POST", `${L}/issues/${P2.id}/withdraw`, { reason: "   " }, OWNER.token);
    check("9. withdrawing needs a reason: 400 REASON_REQUIRED", wNo.s === 400 && wNo.j.code === "REASON_REQUIRED" && wBlank.s === 400 && wBlank.j.code === "REASON_REQUIRED");
    const wPhi = await call("POST", `${L}/issues/${P2.id}/withdraw`, { reason: "Made-up: DOB 01/02/1980 was in it" }, OWNER.token);
    check("9. a withdraw reason with patient information is refused: 400 PHI_REFUSED naming the reason", wPhi.s === 400 && wPhi.j.code === "PHI_REFUSED" && wPhi.j.field === "reason" && issueRow(P2.id).status === "published", `${wPhi.s} ${wPhi.text}`);
    const wEditor = await call("POST", `${L}/issues/${P2.id}/withdraw`, { reason: "Made-up reason" }, EDITOR.token);
    const wOut = await call("POST", `${L}/issues/${P3.id}/withdraw`, { reason: "Made-up reason" }, STAFF_OUT.token);
    check("9. an editor who can see the issue is refused (403 OWNER_OR_ADMIN_ONLY); a Staff login who can't see one gets 404", wEditor.s === 403 && wEditor.j.code === "OWNER_OR_ADMIN_ONLY" && wOut.s === 404);
    const REASON = "Made-up reason: the wrong month was picked";
    const w = await call("POST", `${L}/issues/${P2.id}/withdraw`, { reason: REASON }, OWNER.token);
    const wRow = issueRow(P2.id);
    check("9. the owner withdraws the staff issue: the row stays, with its reason, time and frozen counts", w.s === 200 && wRow.status === "withdrawn" && wRow.withdrawn_reason === REASON && !!wRow.withdrawn_at && !!wRow.counts_json && w.j.counts !== null, `${w.s} ${w.text.slice(0, 200)}`);
    const wStaff = await call("GET", `${L}/issues/${P2.id}`, undefined, STAFF_IN.token);
    check("9. readers no longer see a withdrawn issue (404, and off their list); the owner still does", wStaff.s === 404 && !(await listOf(STAFF_IN)).includes(P2.id) && (await call("GET", `${L}/issues/${P2.id}`, undefined, OWNER.token)).j.status === "withdrawn");
    const wAgain = await call("POST", `${L}/issues/${P2.id}/withdraw`, { reason: REASON }, OWNER.token);
    check("9. withdrawing twice: 409 ALREADY_WITHDRAWN", wAgain.s === 409 && wAgain.j.code === "ALREADY_WITHDRAWN");
    const again = await call("POST", `${L}/issues`, { periodStart: prev2.start }, OWNER.token);
    const again2 = await call("POST", `${L}/issues`, { periodStart: prev2.start }, OWNER.token);
    check("9. withdrawn, then the period is drafted again; a second draft for it is 409 again", again.s === 201 && again.j.status === "draft" && Number(again.j.id) !== P2.id && issueRow(P2.id).status === "withdrawn" && again2.s === 409, `${again.s} ${again2.s}`);
    const readDraft = await call("POST", `${L}/issues/${again.j.id}/read`, {}, OWNER.token);
    check("9. a draft can't be marked read: 409 NOT_PUBLISHED", readDraft.s === 409 && readDraft.j.code === "NOT_PUBLISHED");
    const wDraft = await call("POST", `${L}/issues/${again.j.id}/withdraw`, { reason: "Made-up: not needed" }, ADMIN.token);
    check("9. an admin can withdraw a draft; it never had counts", wDraft.s === 200 && issueRow(Number(again.j.id)).status === "withdrawn" && issueRow(Number(again.j.id)).counts_json === null && wDraft.j.counts === null);

    // ── 10. The review box on published issues ───────────────────────────────────────────────────────────────────────
    await call("PUT", `${L}/settings`, { review_box: true }, OWNER.token);
    check("10. the lab turns the review box back on: the published issue drafted with it off keeps it off", issueRow(P3.id).review_box === 0 && (await call("GET", `${L}/issues/${P3.id}`, undefined, OWNER.token)).j.review_box === false);
    await call("PUT", `${L}/settings`, { review_box: false }, OWNER.token);
    check("10. and turning it off leaves the published issue drafted with it on as it was", issueRow(D1).review_box === 1 && (await call("GET", `${L}/issues/${D1}`, undefined, OWNER.token)).j.review_box === true);
    const rbPub = await call("PUT", `${L}/issues/${D1}`, { review_box: false }, OWNER.token);
    check("10. a published issue's review box can't be changed (409 NOT_DRAFT)", rbPub.s === 409 && issueRow(D1).review_box === 1);

    // ── 11. Quarterly ────────────────────────────────────────────────────────────────────────────────────────────────
    const qs = await call("PUT", `${L}/settings`, { frequency: "quarterly" }, OWNER.token);
    const lastQ = lastFinishedDigestPeriod(today, "quarterly");
    check("11. the lab goes quarterly: its default period is the last finished calendar quarter", qs.s === 200 && same(qs.j.default_period, lastQ), qs.text.slice(0, 200));
    const qBad = await call("POST", `${L}/issues`, { periodStart: `${today.slice(0, 4)}-02-01` }, OWNER.token);
    check("11. a quarter can't start on February 1 (400 BAD_PERIOD)", qBad.s === 400 && qBad.j.code === "BAD_PERIOD", qBad.text);
    const qDef = await call("POST", `${L}/issues`, {}, OWNER.token);
    check("11. the default quarterly draft covers the last finished quarter, and its live counts cover the whole quarter",
      qDef.s === 201 && qDef.j.period_start === lastQ.start && qDef.j.period_end === lastQ.end && qDef.j.counts.monthStart === lastQ.start && qDef.j.counts.monthEnd === lastQ.end, `${qDef.s} ${qDef.text.slice(0, 200)}`);
    const curQ = digestPeriodFrom(addLabDays(lastQ.start, 0, 3), "quarterly") as { start: string; end: string };
    const qNow = await call("POST", `${L}/issues`, { periodStart: curQ.start }, OWNER.token);
    check("11. the quarter we're in hasn't finished (400 PERIOD_NOT_FINISHED)", qNow.s === 400 && qNow.j.code === "PERIOD_NOT_FINISHED", qNow.text);
    const y = Number(today.slice(0, 4)) - 1;
    for (const [start, end] of [[`${y}-01-01`, `${y}-03-31`], [`${y}-04-01`, `${y}-06-30`], [`${y}-07-01`, `${y}-09-30`], [`${y}-10-01`, `${y}-12-31`]]) {
      const r = await call("POST", `${L}/issues`, { periodStart: start }, OWNER.token);
      check(`11. a quarter starting ${start} ends ${end}`, r.s === 201 && r.j.period_start === start && r.j.period_end === end, `${r.s} ${r.text.slice(0, 160)}`);
    }
    const qDup = await call("POST", `${L}/issues`, { periodStart: `${y}-04-01` }, OWNER.token);
    check("11. a second issue for a quarter: 409", qDup.s === 409 && qDup.j.code === "PERIOD_HAS_ISSUE");
    sqlite.prepare("INSERT INTO lab_equipment (lab_id, instrument_name, next_due_date, status, created_at) VALUES (?, 'Made-up Centrifuge', ?, 'active', ?)").run(LAB, addLabDays(lastQ.start, 10), `${addLabDays(lastQ.start, 0, -1)}T12:00:00.000Z`);
    const qc = digestCountsForLab(sqlite, LAB, lastQ.start, lastQ.end).maintenance!;
    const monthly = [0, 1, 2].map((k) => { const p = digestPeriodFrom(addLabDays(lastQ.start, 0, k), "monthly") as any; return digestCountsForLab(sqlite, LAB, p.start, p.end).maintenance!; });
    check("11. a quarter's maintenance review problems add up its three months' reviews",
      qc.reviewProblems === monthly.reduce((n, m) => n + m.reviewProblems, 0) && qc.recordsWithProblems === monthly.reduce((n, m) => n + m.recordsWithProblems, 0),
      JSON.stringify({ quarter: qc, months: monthly }));
    console.log(`INFO  11. the quarter's maintenance review: ${qc.reviewProblems} problem(s) on ${qc.recordsWithProblems} record(s); by month ${monthly.map((m) => m.reviewProblems).join(", ")}`);
    await call("PUT", `${L}/settings`, { frequency: "monthly" }, OWNER.token);

    // ── 12. Another lab's issue ──────────────────────────────────────────────────────────────────────────────────────
    const bIssue = await call("POST", `${LB}/issues`, {}, OTHER.token);
    const BID = Number(bIssue.j.id);
    await call("PUT", `${LB}/issues/${BID}`, { audience: "staff", note: "Made-up other customer's note" }, OTHER.token);
    await call("POST", `${LB}/issues/${BID}/publish`, {}, OTHER.token);
    check("12. setup: the other customer's own issue, published, read by its owner", bIssue.s === 201 && (await call("GET", `${LB}/issues/${BID}`, undefined, OTHER.token)).j.status === "published");
    const crossed: Array<[string, string, unknown]> = [
      ["GET", `${L}/issues/${BID}`, undefined], ["GET", `${L}/issues/${BID}/acks`, undefined], ["PUT", `${L}/issues/${BID}`, { note: "Made-up crossing note" }],
      ["POST", `${L}/issues/${BID}/publish`, {}], ["POST", `${L}/issues/${BID}/withdraw`, { reason: "Made-up crossing reason" }],
      ["POST", `${L}/issues/${BID}/read`, {}], ["POST", `${L}/issues/${BID}/ack`, {}],
    ];
    for (const [who, u] of [["the owner of lab A", OWNER], ["a Staff login in lab A", STAFF_IN]] as const) {
      for (const [method, url, body] of crossed) {
        const r = await call(method, url, body, u.token);
        check(`12. ${who}: ${method} ${url.replace(String(BID), ":id")} with lab B's issue id: 404`, r.s === 404 && r.text === NOT_FOUND && !r.text.includes("other customer"), `${r.s} ${r.text.slice(0, 120)}`);
      }
      const direct = await call("GET", `${LB}/issues/${BID}`, undefined, u.token);
      check(`12. ${who}: lab B's own path is refused (403, no membership there)`, direct.s === 403 && !direct.text.includes("other customer"), `${direct.s}`);
    }
    const bRow = issueRow(BID);
    check("12. lab B's issue is untouched", bRow.status === "published" && bRow.note === "Made-up other customer's note" && (sqlite.prepare("SELECT COUNT(*) AS n FROM digest_issue_acks WHERE issue_id = ?").get(BID) as any).n === 0);
    check("12. lab A's list never includes lab B's issue", !(await listOf(OWNER)).includes(BID));

    // ── 13. The plan allowlist ───────────────────────────────────────────────────────────────────────────────────────
    const free = await call("GET", `/api/labs/${LAB_FREE}/digest/settings`, undefined, OTHER.token);
    const freeDraft = await call("POST", `/api/labs/${LAB_FREE}/digest/issues`, {}, OTHER.token);
    check("13. a lab on a plan outside the allowlist: 403 PLAN_REQUIRED", free.s === 403 && free.j.code === "PLAN_REQUIRED" && freeDraft.s === 403 && freeDraft.j.code === "PLAN_REQUIRED", `${free.s} ${freeDraft.s}`);

    // ── 15. PR 4's read-only fields: the prior issue for the change lines, group names, the settings' groups ─────────
    // State here: D1 published (last month, leadership, studies/qc/findings); P2 withdrawn (two months back, staff) and its
    // redraft withdrawn; P3 published (three months back, group G1, every default section); quarterly drafts only.
    const getAs = async (id: number, u: { token: string }) => (await call("GET", `${L}/issues/${id}`, undefined, u.token)).j;
    const p3Stored = JSON.parse(issueRow(P3.id).counts_json);
    const d1Owner = await getAs(D1, OWNER);
    check("15. the leadership issue's previous is the group issue three months back: the withdrawn issue two months back never counts",
      d1Owner.previous?.id === P3.id && d1Owner.previous?.period_start === prev3.start && d1Owner.previous?.period_end === prev3.end && d1Owner.previous?.counts_as_of === issueRow(P3.id).counts_as_of,
      JSON.stringify(d1Owner.previous ? { ...d1Owner.previous, counts: Object.keys(d1Owner.previous.counts) } : null));
    check("15. previous carries only this issue's sections (studies, qc, findings), each exactly as the prior issue stored it",
      same(Object.keys(d1Owner.previous?.counts || {}), ["studies", "qc", "findings"]) && ["studies", "qc", "findings"].every((k) => same(d1Owner.previous.counts[k], p3Stored[k])),
      JSON.stringify(Object.keys(d1Owner.previous?.counts || {})));
    finding(LAB); // one more open finding today, so the live count for the prior issue's month moves
    const liveP3 = digestCountsForLab(sqlite, LAB, prev3.start, prev3.end).findings!;
    check("15. previous is never recomputed: the prior issue's frozen findings, while the live count for its month has moved",
      d1Owner.previous?.counts?.findings?.open === p3Stored.findings.open && liveP3.open !== p3Stored.findings.open, JSON.stringify({ frozen: p3Stored.findings, live: liveP3 }));
    check("15. the oldest published monthly issue has no previous", (await getAs(P3.id, OWNER)).previous === null);
    check("15. the medical director reads the leadership issue, but its previous (a group issue they aren't in) is null",
      (await getAs(D1, MD)).previous === null && (await getAs(D1, MD)).status === "published");
    check("15. the group issue's detail names its group; the leadership issue names none",
      same((await getAs(P3.id, STAFF_IN)).audience_groups, [{ id: G1, name: "Made-up Chemistry Group", retired: false }]) && same(d1Owner.audience_groups, []));
    // A staff issue two months back, with a section the group issue didn't hold (the scan): its previous is the group issue.
    const p4c = await call("POST", `${L}/issues`, { periodStart: prev2.start }, OWNER.token);
    const P4 = Number(p4c.j.id);
    await call("PUT", `${L}/issues/${P4}`, { audience: "staff", sections: ["findings", "studies", "scan"] }, OWNER.token);
    const p4draft = await getAs(P4, OWNER);
    check("15. a draft gets previous too (the owner's preview): the group issue, picked to the draft's sections; the scan it never held is absent",
      p4c.s === 201 && p4draft.status === "draft" && p4draft.previous?.id === P3.id && same(Object.keys(p4draft.previous.counts), ["studies", "findings"]), JSON.stringify(p4draft.previous && Object.keys(p4draft.previous.counts)));
    await call("POST", `${L}/issues/${P4}/publish`, {}, OWNER.token);
    const p4In = await getAs(P4, STAFF_IN), p4Out = await getAs(P4, STAFF_OUT), p4Ed = await getAs(P4, EDITOR);
    check("15. a Staff login in the group reads the staff issue with its previous (the group issue it can read)",
      p4In.status === "published" && p4In.previous?.id === P3.id && same(p4In.previous.counts.findings, p3Stored.findings), JSON.stringify(p4In.previous && { id: p4In.previous.id }));
    check("15. a Staff login outside the group and an editor read the staff issue, and its previous is null for them (the group issue doesn't reach them)",
      p4Out.status === "published" && p4Out.previous === null && p4Ed.status === "published" && p4Ed.previous === null);
    check("15. a reader's previous names no person", ![NAMES.owner, NAMES.admin, NAMES.staffOut, NAMES.md, OWNER.email].some((n) => JSON.stringify(p4In).includes(n)));
    const d1Now = await getAs(D1, OWNER), d1Md = await getAs(D1, MD);
    check("15. the leadership issue's previous moves to the newer staff issue, which the medical director can read too",
      d1Now.previous?.id === P4 && d1Md.previous?.id === P4 && same(Object.keys(d1Now.previous.counts), ["studies", "findings"]), JSON.stringify({ owner: d1Now.previous?.id, md: d1Md.previous?.id, P4 }));
    // Quarterly: only a published quarter counts, and a month never stands in for a quarter (or the reverse).
    const qd = await call("GET", `${L}/issues`, undefined, OWNER.token);
    const qDraftOf = (start: string) => (qd.j.issues || []).find((i: any) => i.period_start === start && i.status === "draft");
    const qLastYear = qDraftOf(`${y}-04-01`), qLatest = qDraftOf(lastQ.start);
    check("15. setup: the quarterly drafts are there (last year's second quarter, the last finished quarter)", !!qLastYear && !!qLatest, JSON.stringify({ y, lastQ }));
    check("15. a quarterly draft with only drafts before it has no previous (a draft never counts)", (await getAs(qLatest.id, OWNER)).previous === null);
    const qPub = await call("POST", `${L}/issues/${qLastYear.id}/publish`, {}, OWNER.token);
    const qNowPrev = (await getAs(qLatest.id, OWNER)).previous;
    check("15. once last year's second quarter is published, it is the last finished quarter's previous",
      qPub.s === 200 && qNowPrev?.id === qLastYear.id && qNowPrev?.period_start === `${y}-04-01` && qNowPrev?.period_end === `${y}-06-30`, JSON.stringify(qNowPrev && { id: qNowPrev.id, s: qNowPrev.period_start }));
    check("15. a monthly issue's previous is never a quarterly issue", (await getAs(D1, OWNER)).previous?.id === P4 && (await getAs(P3.id, OWNER)).previous === null);
    const { digestPeriodFrequency } = await import("../../server/digestIssues");
    check("15. digestPeriodFrequency: a month, a quarter, and a range that is neither",
      digestPeriodFrequency({ period_start: "2026-10-01", period_end: "2026-10-31" }) === "monthly" && digestPeriodFrequency({ period_start: "2026-10-01", period_end: "2026-12-31" }) === "quarterly"
        && digestPeriodFrequency({ period_start: "2026-11-01", period_end: "2027-01-31" }) === null && digestPeriodFrequency({ period_start: "2026-02-01", period_end: "2026-02-28" }) === "monthly");
    // The settings' groups: the owner and admins get the lab's active groups by name; a Staff login gets none.
    const gOwner = await call("GET", `${L}/settings`, undefined, OWNER.token), gStaff = await call("GET", `${L}/settings`, undefined, STAFF_IN.token);
    check("15. the owner's settings list the lab's active groups by name (not the retired one, no members)",
      same(gOwner.j.groups, [{ id: G1, name: "Made-up Chemistry Group" }]) && !gOwner.text.includes("Made-up Ingleby"), JSON.stringify(gOwner.j.groups));
    check("15. a Staff login's settings carry no groups list", gStaff.s === 200 && !("groups" in gStaff.j));
    const prevB = (await call("GET", `${LB}/issues/${BID}`, undefined, OTHER.token)).j;
    check("15. another customer's issue never takes this lab's earlier published issues as its previous", prevB.status === "published" && prevB.previous === null, JSON.stringify({ s: prevB.status, p: prevB.previous }));

    // ── 14. Audit rows, counts only, no em dash ──────────────────────────────────────────────────────────────────────
    const a = auditRows("digest_issue", D1).map((r) => r.entity_label);
    check("14. the leadership issue's audit trail: created, edited (twice for the note and sections, twice for the review box), published",
      a.length === 5 && /draft created$/.test(a[0]) && a.slice(1, 4).every((l) => /draft edited$/.test(l)) && /published$/.test(a[4]) && auditRows("digest_issue", D1).every((r) => r.user_id === OWNER.id), JSON.stringify(a));
    const editRow = auditRows("digest_issue", D1)[1];
    check("14. an edit's audit row holds what changed", JSON.parse(editRow.before_json).note === null && JSON.parse(editRow.after_json).note === NOTE, editRow.after_json);
    const a2l = auditRows("digest_issue", P2.id).map((r) => r.entity_label);
    check("14. the staff issue's audit trail: created, edited, published, withdrawn", a2l.length === 4 && /withdrawn$/.test(a2l[3]) && /published$/.test(a2l[2]), JSON.stringify(a2l));
    const allCounts = (sqlite.prepare("SELECT counts_json FROM digest_issues WHERE counts_json IS NOT NULL").all() as any[]).map((r) => r.counts_json).join("\n");
    const people = [...Object.values(NAMES), "Quillon", "Brisbane", "Calloway", "Dunmore", "Ingleby", "Outram", OWNER.email, STAFF_IN.email, MD.email, "digest-issues-"];
    check("14. nothing in any counts_json carries an @", allCounts.length > 0 && !allCounts.includes("@"));
    check("14. nothing in any counts_json carries a made-up person's name", people.every((p) => !allCounts.toLowerCase().includes(p.toLowerCase())), people.filter((p) => allCounts.toLowerCase().includes(p.toLowerCase())).join(", "));
    check(`14. no em dash in any of the ${replies.length} replies (error messages included)`, replies.every((t) => !t.includes(EM_DASH)), replies.filter((t) => t.includes(EM_DASH)).slice(0, 2).join(" | "));
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAILED` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
