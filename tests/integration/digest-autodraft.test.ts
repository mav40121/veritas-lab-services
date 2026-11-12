// tests/integration/digest-autodraft.test.ts
//
// 2026-11-11 (Michael, Q281 = 1; the compliance digest's daily draft job, the last piece): server/digestIssues.ts
// runDigestAutoDrafts, which drafts through createDigestDraft, the function POST issues uses. Made-up owner, labs and people
// on a fresh database; the job runs at set instants (`at`) so each lab's own calendar day is pinned. It checks:
//   1. a lab with the setting off (and one with no settings row) gets no draft;
//   2. a lab with it on gets exactly one draft for the last finished month on ITS clock: a Guam lab (UTC+10) already on
//      October 1 drafts September while UTC is still on September 30, and a New York lab still on September 30 drafts August
//      while UTC is already on October 1;
//   3. quarterly: a draft only once the quarter has ended on the lab's clock;
//   4. a second run, and a later day's, makes nothing new (PERIOD_HAS_ISSUE is "already done"), and a manual draft counts too;
//   5. the job never re-drafts a withdrawn period (withdrawing is how an owner skips a month), while the manual route still can;
//   6. a lab on a plan outside the allowlist gets nothing;
//   7. the draft takes the lab's settings at that moment, is a draft only (never published, no counts frozen, no notice);
//   8. no email: the mailer stub records nothing and no request leaves the test;
//   9. the audit row is the manual draft's, marked as the system (user id 0), and the issue is marked created_by_job;
//  10. the owner's list carries created_by_job; a reader's doesn't;
//  11. the admin "run now" route needs the admin secret and runs the same job.
// Run: rm -f <db> && DB_PATH=<db> JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/digest-autodraft.test.ts
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
delete process.env.RESEND_API_KEY; // belt and braces: the mailer is swapped out below, and without a key nothing can send

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const digest: any = await import("../../server/digestIssues");
  const { readSignMailer } = await import("../../server/policyReadSign");
  const { labLocalDate } = await import("../../server/dateLocal");
  const sqlite = (db as any).$client;
  const ADMIN_SECRET = process.env.ADMIN_SECRET || "test-admin-secret";

  // No email: the notice's mailer records instead of sending, and any request that leaves this machine is recorded too.
  const mail: any[] = [];
  readSignMailer.pauseMs = 0;
  readSignMailer.send = async (m: any) => { mail.push(m); };
  const realFetch = globalThis.fetch;
  const outbound: string[] = [];
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(typeof input === "string" ? input : input?.url ?? input);
    if (!/^http:\/\/127\.0\.0\.1:/.test(url)) outbound.push(url);
    return realFetch(input, init);
  }) as typeof fetch;

  // On main (before the job) there is no runDigestAutoDrafts: every run then drafts nothing, and the checks below fail.
  const run = typeof digest.runDigestAutoDrafts === "function" ? digest.runDigestAutoDrafts : null;
  const job = (at: string, labId?: number) => (run ? run(sqlite, { at: new Date(at), labId })
    : { labs: 0, drafted: 0, alreadyDone: 0, notOnPlan: 0, errors: 0, issues: [] });
  check("the daily draft job exists (runDigestAutoDrafts in server/digestIssues.ts)", !!run);
  check("the system actor is user id 0, the audit_log convention for actions no signed-in person took", digest.DIGEST_SYSTEM_USER_ID === 0, String(digest.DIGEST_SYSTEM_USER_ID));

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
    // ── Setup: a made-up owner with six labs, and a made-up Staff member in the New York lab ───────────────────────────
    const stamp = Date.now();
    const register = async (tag: string, name: string) => {
      const email = `digest-autodraft-${tag}-${stamp}@example.test`;
      const reg = (await call("POST", "/api/auth/register", { email, password: "Testpass123", name, hipaa_acknowledged: true })).j;
      return { email, name, token: reg.token as string, id: Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id) };
    };
    const provision = async (email: string, labName: string, tz: string) => {
      const id = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN_SECRET, ownerEmail: email, labName, plan: "hospital" })).j.labId);
      sqlite.prepare("UPDATE labs SET time_zone = ? WHERE id = ?").run(tz, id);
      return id;
    };
    const OWNER = await register("owner", "Made-up Autodraft Owner Penhallow");
    const NY = await provision(OWNER.email, "Made-up New York Lab", "America/New_York");
    const GUAM = await provision(OWNER.email, "Made-up Guam Lab", "Pacific/Guam");
    const QTR = await provision(OWNER.email, "Made-up Quarterly Lab", "America/New_York");
    const OFF = await provision(OWNER.email, "Made-up Setting Off Lab", "America/New_York");
    const NOROW = await provision(OWNER.email, "Made-up No Settings Lab", "America/New_York");
    const FREE = await provision(OWNER.email, "Made-up Free Plan Lab", "America/New_York");
    const STAFF = await register("staff", "Made-up Staff Trevanion");
    const now = new Date().toISOString();
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 0, ?, ?, ?)").run(NY, STAFF.id, now, now, now);
    check("setup: one made-up owner, six labs, a Staff member", [NY, GUAM, QTR, OFF, NOROW, FREE, OWNER.id, STAFF.id].every((n) => n > 0) && !!OWNER.token, JSON.stringify({ NY, GUAM, QTR, OFF, NOROW, FREE }));

    const settings = async (lab: number, body: unknown) => call("PUT", `/api/labs/${lab}/digest/settings`, body, OWNER.token);
    const sNy = await settings(NY, { enabled: true, sections: ["findings", "studies", "qc"], audience: "staff", ack_default: true, review_box: false });
    check("setup: the owner turns the daily draft on for the New York lab (monthly; three sections, staff, acknowledgment on)", sNy.s === 200 && sNy.j.enabled === true && sNy.j.frequency === "monthly", sNy.text);
    check("setup: the owner turns it on for the Guam lab", (await settings(GUAM, { enabled: true })).j.enabled === true);
    check("setup: the owner turns it on for the quarterly lab", (await settings(QTR, { enabled: true, frequency: "quarterly" })).j.frequency === "quarterly");
    const sOff = await settings(OFF, { ack_default: true });
    check("setup: the setting-off lab has a settings row with the draft off", sOff.s === 200 && sOff.j.enabled === false && !!sqlite.prepare("SELECT 1 FROM digest_settings WHERE lab_id = ? AND enabled = 0").get(OFF));
    check("setup: the no-settings lab has no settings row", !sqlite.prepare("SELECT 1 FROM digest_settings WHERE lab_id = ?").get(NOROW));
    await settings(FREE, { enabled: true });
    sqlite.prepare("UPDATE labs SET plan = 'free' WHERE id = ?").run(FREE); // turned on, then the lab left the plan allowlist
    check("setup: the free-plan lab has the draft on but is outside the plan allowlist", Number((sqlite.prepare("SELECT enabled FROM digest_settings WHERE lab_id = ?").get(FREE) as any)?.enabled) === 1
      && (await call("GET", `/api/labs/${FREE}/digest/settings`, undefined, OWNER.token)).j.code === "PLAN_REQUIRED");

    const issues = (lab: number) => sqlite.prepare("SELECT * FROM digest_issues WHERE lab_id = ? ORDER BY id").all(lab) as any[];
    const live = (lab: number) => issues(lab).filter((r) => r.status !== "withdrawn");
    const periods = (lab: number) => live(lab).map((r) => `${r.period_start}..${r.period_end}`);
    const createAudits = (id: number) => sqlite.prepare("SELECT * FROM audit_log WHERE entity_type = 'digest_issue' AND entity_id = ? AND action = 'create' ORDER BY id").all(String(id)) as any[];
    const lastFinishedUtc = (at: string, f: "monthly" | "quarterly") => digest.lastFinishedDigestPeriod(at.slice(0, 10), f);

    // ── Run 1: 15:00Z on September 30. UTC and New York are on September 30; Guam is already on October 1 ───────────────
    const T0 = "2026-09-30T15:00:00.000Z";
    check("the clocks at run 1: New York on September 30, Guam on October 1",
      labLocalDate(T0, false, "America/New_York") === "2026-09-30" && labLocalDate(T0, false, "Pacific/Guam") === "2026-10-01");
    const r1 = job(T0);
    check("run 1: four labs have it on (the free one among them); three drafts; one lab not on the plan; no errors",
      r1.labs === 4 && r1.drafted === 3 && r1.notOnPlan === 1 && r1.alreadyDone === 0 && r1.errors === 0, JSON.stringify(r1));
    check("1. the lab with the setting off gets no draft", issues(OFF).length === 0);
    check("1. the lab with no settings row gets no draft", issues(NOROW).length === 0);
    check("2. the New York lab gets exactly one draft: August, its last finished month", same(periods(NY), ["2026-08-01..2026-08-31"]), JSON.stringify(periods(NY)));
    check("2. the Guam lab, already on October 1, gets exactly one draft: September (on UTC's day the last finished month would be August)",
      same(periods(GUAM), ["2026-09-01..2026-09-30"]) && lastFinishedUtc(T0, "monthly").start === "2026-08-01", JSON.stringify(periods(GUAM)));
    check("3. the quarterly lab (New York, September 30) gets the second quarter, the last one finished", same(periods(QTR), ["2026-04-01..2026-06-30"]), JSON.stringify(periods(QTR)));
    check("6. the free-plan lab gets nothing", issues(FREE).length === 0);
    check("the run's list names each draft it made", same(r1.issues.map((i: any) => i.lab_id).sort(), [NY, GUAM, QTR].sort()));

    // 7. The draft is the manual one: the lab's settings at that moment, a draft only.
    const aug = live(NY)[0];
    check("7. the New York draft took the lab's settings at that moment: its three sections, staff, acknowledgment on, no review box",
      !!aug && same(JSON.parse(aug.sections), ["studies", "qc", "findings"]) && aug.audience === "staff" && aug.ack_requested === 1 && aug.review_box === 0, JSON.stringify(aug));
    const sepG = live(GUAM)[0];
    check("7. the Guam draft took that lab's settings (the defaults: every section but the scan, leadership)",
      !!sepG && same(JSON.parse(sepG.sections), digest.DEFAULT_DIGEST_SECTIONS) && sepG.audience === "leadership" && sepG.ack_requested === 0);
    const jobRows = [aug, sepG, live(QTR)[0]].filter(Boolean);
    check("7. each is a draft only: not published, no counts frozen, no notice sent", jobRows.length === 3 && jobRows.every((r) => r.status === "draft" && r.published_at == null && r.counts_json == null && r.counts_as_of == null && r.notice_sent_at == null));
    check("9. each is marked as drafted by the job, by the system (created_by_job 1, created_by_user_id 0), dated the run's moment",
      jobRows.every((r) => r.created_by_job === 1 && r.created_by_user_id === 0 && r.created_at === T0), JSON.stringify(jobRows.map((r) => [r.created_by_job, r.created_by_user_id, r.created_at])));

    // ── Run 2: 03:00Z on October 1. UTC and Guam are on October 1; New York is still on September 30 ────────────────────
    const T1 = "2026-10-01T03:00:00.000Z";
    const r2 = job(T1);
    check("4. run 2 makes nothing new: every enabled lab on the plan is already done", r2.drafted === 0 && r2.alreadyDone === 3 && r2.errors === 0, JSON.stringify(r2));
    check("2. the New York lab, still on September 30, gets no September draft yet (on UTC's day, October 1, September would be finished)",
      same(periods(NY), ["2026-08-01..2026-08-31"]) && labLocalDate(T1, false, "America/New_York") === "2026-09-30" && lastFinishedUtc(T1, "monthly").start === "2026-09-01", JSON.stringify(periods(NY)));
    check("3. the quarterly lab gets no third-quarter draft while its own day is still September 30", same(periods(QTR), ["2026-04-01..2026-06-30"]), JSON.stringify(periods(QTR)));

    // Between runs the owner changes the New York lab's settings: the next draft takes the new ones, the August draft keeps its own.
    await settings(NY, { sections: ["pt"], audience: "leadership", ack_default: false, review_box: true });

    // ── Run 3: 05:00Z on October 1. New York is on October 1 now ──────────────────────────────────────────────────────────
    const T2 = "2026-10-01T05:00:00.000Z";
    const r3 = job(T2);
    check("run 3: two new drafts (New York's September, the quarterly lab's third quarter); Guam already done",
      r3.drafted === 2 && r3.alreadyDone === 1 && r3.errors === 0, JSON.stringify(r3));
    check("2. the New York lab, now on October 1, gets September: exactly one draft per month", same(periods(NY), ["2026-08-01..2026-08-31", "2026-09-01..2026-09-30"]), JSON.stringify(periods(NY)));
    check("3. the quarterly lab gets the third quarter once it has ended on its clock", same(periods(QTR), ["2026-04-01..2026-06-30", "2026-07-01..2026-09-30"]), JSON.stringify(periods(QTR)));
    const sepNy = live(NY)[1];
    check("7. the September draft took the settings as changed (the PT section only, leadership, the review box on); August kept its own",
      !!sepNy && same(JSON.parse(sepNy.sections), ["pt"]) && sepNy.audience === "leadership" && sepNy.review_box === 1 && sepNy.ack_requested === 0
        && same(JSON.parse(issues(NY)[0].sections), ["studies", "qc", "findings"]) && issues(NY)[0].audience === "staff", JSON.stringify(sepNy));

    // ── 4. Again at the same moment, and on a later day: nothing new ──────────────────────────────────────────────────────
    const before = (sqlite.prepare("SELECT COUNT(*) AS n FROM digest_issues").get() as any).n;
    const r4 = job(T2);
    const T3 = "2026-10-20T12:00:00.000Z";
    const r5 = job(T3);
    check("4. the same run twice, and a later day's run, make nothing new", r4.drafted === 0 && r5.drafted === 0 && r4.alreadyDone === 3 && r5.alreadyDone === 3
      && (sqlite.prepare("SELECT COUNT(*) AS n FROM digest_issues").get() as any).n === before, JSON.stringify({ r4, r5 }));

    // A manual draft holds its period too: the owner drafts Guam's October by hand, then the run on Guam's November 2 skips it.
    const manual = await call("POST", `/api/labs/${GUAM}/digest/issues`, { periodStart: "2026-10-01" }, OWNER.token);
    const T4 = "2026-11-01T15:00:00.000Z"; // November 2 in Guam: October is its last finished month
    const r6 = job(T4, GUAM);
    check("4. a manual draft holds its period: the run on Guam's November 2 leaves October alone (one lab, already done)",
      manual.s === 201 && r6.labs === 1 && r6.drafted === 0 && r6.alreadyDone === 1 && same(periods(GUAM), ["2026-09-01..2026-09-30", "2026-10-01..2026-10-31"]), JSON.stringify({ s: manual.s, r6, p: periods(GUAM) }));
    const manualRow = issues(GUAM).find((r) => r.id === Number(manual.j.id));
    check("9. the manual draft is marked as by hand: created_by_job 0, the owner's user id", manualRow?.created_by_job === 0 && manualRow?.created_by_user_id === OWNER.id, JSON.stringify(manualRow));

    // ── 5. A withdrawn issue frees the period, as it does by hand ─────────────────────────────────────────────────────────
    const wd = await call("POST", `/api/labs/${NY}/digest/issues/${sepNy?.id ?? 0}/withdraw`, { reason: "Made-up reason: drafted with the wrong sections" }, OWNER.token);
    const byHand = await call("POST", `/api/labs/${OFF}/digest/issues`, { periodStart: "2026-09-01" }, OWNER.token);
    const wdOff = await call("POST", `/api/labs/${OFF}/digest/issues/${byHand.j.id}/withdraw`, { reason: "Made-up reason" }, OWNER.token);
    const again = await call("POST", `/api/labs/${OFF}/digest/issues`, { periodStart: "2026-09-01" }, OWNER.token);
    check("5. (the manual route, for comparison: after a withdraw the same month can be drafted again)", byHand.s === 201 && wdOff.s === 200 && again.s === 201, `${byHand.s} ${wdOff.s} ${again.s}`);
    const r7 = job(T3, NY);
    check("5. the job does NOT bring a withdrawn month back: after the owner withdraws the September draft, the next run leaves September alone",
      wd.s === 200 && r7.drafted === 0 && r7.alreadyDone === 1 && same(periods(NY), ["2026-08-01..2026-08-31"]) && issues(NY).filter((r) => r.period_start === "2026-09-01").length === 1,
      JSON.stringify({ wd: wd.s, r7, p: periods(NY) }));
    const r8 = job(T3, NY);
    check("5. and on later runs too: still nothing for September", r8.drafted === 0 && r8.alreadyDone === 1, JSON.stringify(r8));
    check("1. the setting-off lab still has only the owner's own drafts (the job never drafted there)", issues(OFF).every((r) => r.created_by_job === 0) && issues(OFF).length === 2);

    // ── 9. Audit: the manual draft's row, marked as the system ────────────────────────────────────────────────────────────
    const jobIds = (sqlite.prepare("SELECT id FROM digest_issues WHERE created_by_job = 1 ORDER BY id").all() as any[]).map((r) => Number(r.id));
    const jobAudits = jobIds.map((id) => createAudits(id));
    check(`9. every job draft (${jobIds.length}) has exactly one create audit row`, jobIds.length === 5 && jobAudits.every((a) => a.length === 1), JSON.stringify(jobAudits.map((a) => a.length)));
    const a0 = jobAudits[0]?.[0];
    check("9. the job's audit row is marked as the system: user id 0, the lab's owner as owner_user_id, no IP address, not Veritas support",
      jobAudits.every((a) => a[0]?.user_id === 0 && a[0]?.owner_user_id === OWNER.id && a[0]?.ip_address == null && a[0]?.acting_as == null), JSON.stringify(a0));
    check("9. it is the manual draft's row otherwise: module account, create, digest_issue, the same label with \"automatically\"",
      jobAudits.every((a) => a[0]?.module === "account" && a[0]?.action === "create" && /^Compliance digest \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}: draft created automatically$/.test(a[0]?.entity_label || "")), a0?.entity_label);
    const aAfter = JSON.parse(a0?.after_json || "{}");
    check("9. its after carries the issue's fields and created_by_job: true",
      aAfter.status === "draft" && same(aAfter.sections, ["studies", "qc", "findings"]) && aAfter.audience === "staff" && aAfter.ack_requested === true && aAfter.review_box === false && aAfter.created_by_job === true, a0?.after_json);
    const mAudit = createAudits(Number(manual.j.id));
    check("9. the manual draft's audit row: the owner's user id, \"draft created\", created_by_job false",
      mAudit.length === 1 && mAudit[0].user_id === OWNER.id && /: draft created$/.test(mAudit[0].entity_label) && JSON.parse(mAudit[0].after_json).created_by_job === false, JSON.stringify(mAudit[0]));

    // ── 10. The list ──────────────────────────────────────────────────────────────────────────────────────────────────────
    const ownerList = (await call("GET", `/api/labs/${GUAM}/digest/issues`, undefined, OWNER.token)).j.issues || [];
    check("10. the owner's list marks the job's draft created_by_job true and the hand-made one false",
      ownerList.find((i: any) => i.id === sepG?.id)?.created_by_job === true && ownerList.find((i: any) => i.id === Number(manual.j.id))?.created_by_job === false, JSON.stringify(ownerList.map((i: any) => [i.id, i.created_by_job])));
    // The owner opens and publishes the August draft (the job never does): a normal draft, and still no notice goes out.
    const augId = Number(aug?.id ?? 0);
    const augView = await call("GET", `/api/labs/${NY}/digest/issues/${augId}`, undefined, OWNER.token);
    const pub = await call("POST", `/api/labs/${NY}/digest/issues/${augId}/publish`, {}, OWNER.token);
    check("7. the owner opens the job's draft (live counts) and publishes it by hand; the notice is still unsent",
      augView.s === 200 && augView.j.counts_live === true && augView.j.created_by_job === true && pub.s === 200 && pub.j.status === "published" && issues(NY)[0]?.notice_sent_at == null, `${augView.s} ${pub.s}`);
    const staffList = (await call("GET", `/api/labs/${NY}/digest/issues`, undefined, STAFF.token)).j.issues || [];
    check("10. a Staff reader sees the published issue, with no created_by_job (the owner's and admins' only)",
      staffList.length === 1 && staffList[0].id === augId && !("created_by_job" in staffList[0]), JSON.stringify(staffList));
    // Back on New York's September 30, when August is its last finished month: the published August issue holds it.
    const r9 = job(T1, NY);
    check("4. a published issue holds its period too: on New York's September 30 the run finds August already done", r9.drafted === 0 && r9.alreadyDone === 1 && r9.errors === 0, JSON.stringify(r9));

    // ── 11. The admin "run now" route ─────────────────────────────────────────────────────────────────────────────────────
    const noSecret = await call("POST", "/api/admin/digest-autodraft/run", { labId: QTR });
    const wrong = await call("POST", "/api/admin/digest-autodraft/run", { secret: "not-the-secret", labId: QTR });
    const badLab = await call("POST", "/api/admin/digest-autodraft/run", { secret: ADMIN_SECRET, labId: "x" });
    check("11. the run-now route refuses without the admin secret (403) and a lab id that isn't one (400)", noSecret.s === 403 && wrong.s === 403 && badLab.s === 400, `${noSecret.s} ${wrong.s} ${badLab.s}`);
    const qBefore = issues(QTR).length;
    const ran = await call("POST", "/api/admin/digest-autodraft/run", { secret: ADMIN_SECRET, labId: QTR });
    const ranAgain = await call("POST", "/api/admin/digest-autodraft/run", { secret: ADMIN_SECRET, labId: QTR });
    const realToday = labLocalDate(new Date().toISOString(), false, "America/New_York");
    const lastQ = digest.lastFinishedDigestPeriod(realToday, "quarterly");
    const haveLastQ = issues(QTR).some((r) => r.period_start === lastQ.start && r.status !== "withdrawn");
    check("11. with the secret it runs the same job for that lab, today: the last finished quarter, then already done",
      ran.s === 200 && ran.j.labs === 1 && ran.j.drafted + ran.j.alreadyDone === 1 && haveLastQ && issues(QTR).length === qBefore + ran.j.drafted && ranAgain.j.drafted === 0 && ranAgain.j.alreadyDone === 1,
      JSON.stringify({ ran: ran.j, again: ranAgain.j, lastQ }));

    // ── 8. No email, from any of it ───────────────────────────────────────────────────────────────────────────────────────
    check("8. no email: the mailer stub recorded nothing", mail.length === 0, JSON.stringify(mail.map((m) => m.to)));
    check("8. no request left the test (no mail service, nothing outside this machine)", outbound.length === 0, outbound.join(", "));
    const noticeAudits = (sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'digest_issue' AND entity_label LIKE '%notice%'").get() as any).n;
    check("8. no notice anywhere: no issue has notice_sent_at, and no notice audit row", (sqlite.prepare("SELECT COUNT(*) AS n FROM digest_issues WHERE notice_sent_at IS NOT NULL").get() as any).n === 0 && noticeAudits === 0);
    check("7. the job never published: the only published issue is the one the owner published",
      same((sqlite.prepare("SELECT id FROM digest_issues WHERE status = 'published'").all() as any[]).map((r) => r.id), [augId]));
    check(`no em dash in any of the ${replies.length} replies`, replies.every((t) => !t.includes(EM_DASH)), replies.filter((t) => t.includes(EM_DASH)).slice(0, 2).join(" | "));
  } finally {
    globalThis.fetch = realFetch;
    server.close();
  }
  console.log(failures ? `${failures} FAILED` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
