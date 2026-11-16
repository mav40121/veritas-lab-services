// tests/integration/seat-count-system-scope.test.ts
//
// Michael 2026-11-16 (Q345 = 1), "how was michael's lab maxed out at 25 with only 9 members?", and his rule that same
// day: "unclaimed seats after 30 days should be removed, and email sent to owner that it was unclaimed, and the seat
// returned". Made-up owners, labs and seats on a fresh database. It checks:
//   1. a lab in an organization counts only the owner's seats in THAT organization's labs, against THAT organization's
//      pool; seats in the owner's standalone labs, a second organization's labs, and seats with no lab (when the owner
//      has labs outside the organization) aren't counted against it
//   2. a seat with no lab still counts when every lab the owner owns is in that one organization
//   3. a dismissed or deactivated invite holds no seat (system and standalone); a pending one does
//   4. a dismissed invite no longer blocks inviting that address to the lab again (admin create-lab-invite and the
//      Members invite route both reuse the row)
//   5. the 30-day job: dry run writes and sends nothing; with no mailer nothing ends; with one, each owner gets ONE email
//      listing their unclaimed invitations, those rows end ('deactivated', one audit row each), a 29-day invite, an
//      accepted seat and a pending row with an account attached stay; the seat comes back on the count; a second run
//      does nothing; a failed send leaves that owner's rows pending; SQLite's "YYYY-MM-DD HH:MM:SS" dates are read
//   6. the admin route: refuses without the header, defaults to a dry run, answers with no addresses or names
// Run: rm -f .tmp-seatscope.db && DB_PATH=.tmp-seatscope.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/seat-count-system-scope.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  :: ${detail}`}`);
};

async function main() {
  delete process.env.RESEND_API_KEY;
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { labSeatSummary } = await import("../../server/labSeats");
  const { runUnclaimedSeatInvites, setUnclaimedSeatMailerForTest, invitedAtMs } = await import("../../server/unclaimedSeatInvites");
  const sqlite = (db as any).$client;
  sqlite.pragma("foreign_keys = OFF");
  const cols = (t: string) => sqlite.prepare(`PRAGMA table_info(${t})`).all() as { name: string; notnull: number; dflt_value: any }[];
  const insert = (table: string, values: Record<string, unknown>) => {
    const row: Record<string, unknown> = { ...values };
    for (const c of cols(table)) if (c.notnull && c.dflt_value == null && !(c.name in row) && c.name !== "id") row[c.name] = /_at$|date/i.test(c.name) ? "2026-11-10T00:00:00Z" : /count|_id$|is_/i.test(c.name) ? 0 : "made-up";
    const keys = Object.keys(row);
    return Number(sqlite.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map((k) => "@" + k).join(",")})`).run(row).lastInsertRowid);
  };
  const user = (tag: string, extra: Record<string, unknown> = {}) => insert("users", { email: `${tag}-345@example.test`, name: `Made-up ${tag}`, plan: "hospital", seat_count: 0, ...extra });
  const member = (lab: number, u: number, role: string) => insert("lab_members", { lab_id: lab, user_id: u, role, status: "active" });
  const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
  const seat = (owner: number, lab: number | null, tag: string, status = "active", extra: Record<string, unknown> = {}) =>
    insert("user_seats", { owner_user_id: owner, lab_id: lab, seat_email: `${tag}-345@example.test`, seat_user_id: null, seat_type: "active", status, invited_at: daysAgo(5), ...extra });
  const statusOf = (id: number) => (sqlite.prepare("SELECT status FROM user_seats WHERE id = ?").get(id) as any)?.status;

  // ── Owner O: system A (two labs, pool 40), system B (one lab, pool 20), a standalone lab, and seats with no lab ──
  const O = user("ownerO");
  const orgA = insert("organizations", { name: "Made-up System A", billing_owner_user_id: O, active_seat_pool: 40 });
  const orgB = insert("organizations", { name: "Made-up System B", billing_owner_user_id: O, active_seat_pool: 20 });
  const A1 = insert("labs", { lab_name: "Made-up A1", owner_user_id: O, plan: "hospital", organization_id: orgA });
  const A2 = insert("labs", { lab_name: "Made-up A2", owner_user_id: O, plan: "hospital", organization_id: orgA });
  const B1 = insert("labs", { lab_name: "Made-up B1", owner_user_id: O, plan: "hospital", organization_id: orgB });
  const S1 = insert("labs", { lab_name: "Made-up S1", owner_user_id: O, plan: "hospital", organization_id: null });
  for (const l of [A1, A2, B1, S1]) member(l, O, "owner");
  for (let i = 1; i <= 3; i++) seat(O, A1, `a1w${i}`);
  seat(O, A1, "a1pending", "pending");
  const a1Dismissed = seat(O, A1, "a1dismissed", "dismissed");
  seat(O, A1, "a1gone", "deactivated");
  for (let i = 1; i <= 2; i++) seat(O, A2, `a2w${i}`);
  for (let i = 1; i <= 4; i++) seat(O, B1, `b1w${i}`);
  for (let i = 1; i <= 5; i++) seat(O, S1, `s1w${i}`);
  seat(O, S1, "s1dismissed", "dismissed");
  for (let i = 1; i <= 2; i++) seat(O, null, `nolab${i}`);

  // ── Owner C: every lab in one system (pool 10), plus one seat with no lab ──
  const C = user("ownerC");
  const orgC = insert("organizations", { name: "Made-up System C", billing_owner_user_id: C, active_seat_pool: 10 });
  const C1 = insert("labs", { lab_name: "Made-up C1", owner_user_id: C, plan: "hospital", organization_id: orgC });
  member(C1, C, "owner");
  seat(C, C1, "c1w1"); seat(C, C1, "c1w2"); seat(C, null, "c1nolab");

  // 1-3 ──
  const a1 = labSeatSummary(sqlite, A1)!, a2 = labSeatSummary(sqlite, A2)!, b1 = labSeatSummary(sqlite, B1)!, s1 = labSeatSummary(sqlite, S1)!, c1 = labSeatSummary(sqlite, C1)!;
  check("1. system A's lab: 3 + 1 pending in A1, 2 in A2, the owner once = 7 of 40 (B1, S1 and the no-lab seats left out)", a1.activeUsed === 7 && a1.activeIncluded === 40 && a1.pooled, JSON.stringify(a1));
  check("1. A2 reads the same pooled number (7 of 40)", a2.activeUsed === 7 && a2.activeIncluded === 40, JSON.stringify(a2));
  check("1. system B's lab: its own pool (20, not A's 40) and its own 4 seats + owner = 5", b1.activeIncluded === 20 && b1.activeUsed === 5, JSON.stringify(b1));
  check("3. standalone lab: 5 seats + owner = 6; its dismissed invite holds nothing", s1.activeUsed === 6 && !s1.pooled, JSON.stringify(s1));
  check("2. owner whose labs are all in one system: the no-lab seat counts (2 + 1 + owner = 4 of 10)", c1.activeUsed === 4 && c1.activeIncluded === 10, JSON.stringify(c1));

  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const ADMIN = process.env.ADMIN_SECRET || "";
  const jwt = (await import("jsonwebtoken")).default;
  const tok = (uid: number) => jwt.sign({ svc: true, userId: uid }, process.env.JWT_SECRET!, { expiresIn: "10m" });
  try {
    // 4. a dismissed invite no longer blocks a new invitation to that address ──
    const re = await fetch(`${base}/api/admin/create-lab-invite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: ADMIN, labId: A1, email: "a1dismissed-345@example.test", role: "staff", permissionsMode: "edit_all" }) });
    const rej: any = await re.json().catch(() => ({}));
    check("4. admin invite to a dismissed address on the same lab: 200 and the old row is reused", re.status === 200 && rej.seat?.id === a1Dismissed && statusOf(a1Dismissed) === "pending", `${re.status} ${JSON.stringify(rej).slice(0, 200)}`);
    const dup = await fetch(`${base}/api/admin/create-lab-invite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: ADMIN, labId: A1, email: "a1dismissed-345@example.test", role: "staff" }) });
    check("4. ... and a second invite while that one is pending is still refused (409)", dup.status === 409, String(dup.status));
    const memInvite = await fetch(`${base}/api/labs/${S1}/members`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok(O)}`, "X-Active-Lab-Id": String(S1) }, body: JSON.stringify({ email: "s1dismissed-345@example.test", role: "staff", firstName: "Made-up", lastName: "Reinvite" }) });
    const memJ: any = await memInvite.json().catch(() => ({}));
    const s1Row = sqlite.prepare("SELECT COUNT(*) AS n, MAX(status) AS st FROM user_seats WHERE lab_id = ? AND seat_email = ?").get(S1, "s1dismissed-345@example.test") as any;
    check("4. Members invite to a dismissed address: accepted, still one row, now pending", memInvite.status < 300 && s1Row.n === 1 && s1Row.st === "pending", `${memInvite.status} ${JSON.stringify(memJ).slice(0, 200)} ${JSON.stringify(s1Row)}`);

    // 5. the 30-day job ──
    const P = user("ownerP"), Q = user("ownerQ"), R = user("ownerR");
    const L = insert("labs", { lab_name: "Made-up Lab <P>", owner_user_id: P, plan: "hospital", organization_id: null });
    const LQ = insert("labs", { lab_name: "Made-up Lab Q", owner_user_id: Q, plan: "hospital", organization_id: null });
    const LR = insert("labs", { lab_name: "Made-up Lab R", owner_user_id: R, plan: "hospital", organization_id: null });
    for (const [l, o] of [[L, P], [LQ, Q], [LR, R]]) member(l, o, "owner");
    const old1 = seat(P, L, "p-old1", "pending", { invited_at: daysAgo(31), invitee_name: "Made-up Old One" });
    const old2 = seat(P, L, "p-old2", "pending", { invited_at: new Date(Date.now() - 40 * 86400000).toISOString().replace("T", " ").slice(0, 19) });
    const staffOld = seat(P, L, "p-staffold", "pending", { invited_at: daysAgo(35), seat_type: "staff_portal" });
    const young = seat(P, L, "p-young", "pending", { invited_at: daysAgo(29) });
    const withAcct = seat(P, L, "p-acct", "pending", { invited_at: daysAgo(50), seat_user_id: user("pacct") });
    const accepted = seat(P, L, "p-accepted", "active", { invited_at: daysAgo(60) });
    const qOld = seat(Q, LQ, "q-old", "pending", { invited_at: daysAgo(45) });
    const pendingBefore = sqlite.prepare("SELECT COUNT(*) AS n FROM user_seats WHERE status = 'pending'").get().n;
    check("5. SQLite's 'YYYY-MM-DD HH:MM:SS' invited_at is read as UTC", Math.abs(invitedAtMs("2026-10-01 12:00:00") - Date.parse("2026-10-01T12:00:00Z")) === 0);
    const lBefore = labSeatSummary(sqlite, L)!;

    const sent: { to: string; subject: string; html: string }[] = [];
    const dry = await runUnclaimedSeatInvites({ dryRun: true });
    check("5. dry run: 4 unclaimed invitations, 2 owners, 1 pending row with an account left alone",
      dry.dryRun && dry.invites === 4 && dry.owners === 2 && dry.pendingWithAccount === 1, JSON.stringify(dry));
    check("5. ... and it writes nothing", sqlite.prepare("SELECT COUNT(*) AS n FROM user_seats WHERE status = 'pending'").get().n === pendingBefore);

    setUnclaimedSeatMailerForTest(null);
    const nomail = await runUnclaimedSeatInvites();
    check("5. no mailer: nothing ends", nomail.noMailer && nomail.ended === 0 && statusOf(old1) === "pending", JSON.stringify(nomail));

    setUnclaimedSeatMailerForTest(async (m) => { sent.push(m); });
    const run1 = await runUnclaimedSeatInvites();
    check("5. one email per owner (2), 4 invitations ended", run1.emailed === 2 && run1.ended === 4 && run1.errors === 0 && sent.length === 2, JSON.stringify(run1));
    const pMail = sent.find((m) => m.to === "ownerP-345@example.test");
    check("5. the owner's email lists their 3 invitations (name, addresses, seat types, days ago) and links to the lab's Members page",
      !!pMail && /3 invitations weren't accepted in 30 days/.test(pMail.subject) && pMail.html.includes("Made-up Old One") && pMail.html.includes("p-old2-345@example.test")
        && pMail.html.includes("p-staffold-345@example.test") && pMail.html.includes("Staff login (read and sign)") && pMail.html.includes("31 days ago")
        && pMail.html.includes(`/labs/${L}/members`) && !pMail.html.includes("p-young") && !pMail.html.includes("p-acct"), pMail?.subject);
    check("5. ... lab names are escaped, and no em dash", !!pMail && pMail.html.includes("Made-up Lab &lt;P&gt;") && !/—/.test(pMail.html + pMail.subject));
    check("5. Q's single invitation: singular wording", /^An invitation wasn't accepted in 30 days/.test(sent.find((m) => m.to === "ownerQ-345@example.test")?.subject || ""));
    check("5. the ended rows are 'deactivated'; the 29-day invite, the accepted seat and the row with an account are untouched",
      [old1, old2, staffOld, qOld].every((id) => statusOf(id) === "deactivated") && statusOf(young) === "pending" && statusOf(accepted) === "active" && statusOf(withAcct) === "pending");
    const audits = sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'seat_invite_unclaimed_ended' AND user_id = 0").get().n;
    check("5. one audit row per ended invitation (4), by the system actor", audits === 4, String(audits));
    const lAfter = labSeatSummary(sqlite, L)!;
    check("5. the seats came back: 2 fewer active, 1 fewer Staff login", lAfter.activeUsed === lBefore.activeUsed - 2 && lAfter.staffPortalUsed === lBefore.staffPortalUsed - 1, `${JSON.stringify(lBefore)} -> ${JSON.stringify(lAfter)}`);
    const run2 = await runUnclaimedSeatInvites();
    check("5. a second run finds nothing and sends nothing", run2.invites === 0 && sent.length === 2, JSON.stringify(run2));
    const again = await fetch(`${base}/api/admin/create-lab-invite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: ADMIN, labId: L, email: "p-old1-345@example.test", role: "staff" }) });
    check("5. an ended invitation's address can be invited again (row reused)", again.status === 200 && statusOf(old1) === "pending", String(again.status));

    const rOld = seat(R, LR, "r-old", "pending", { invited_at: daysAgo(33) });
    setUnclaimedSeatMailerForTest(async () => { throw new Error("made-up provider refusal"); });
    const fail = await runUnclaimedSeatInvites();
    check("5. a failed send leaves that owner's invitation pending for the next run", fail.errors === 1 && fail.ended === 0 && statusOf(rOld) === "pending", JSON.stringify(fail));
    setUnclaimedSeatMailerForTest(null);

    // 6. the admin route ──
    const noHdr = await fetch(`${base}/api/admin/seat-invites/unclaimed`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: ADMIN }) });
    check("6. refuses without the x-admin-secret header (403)", noHdr.status === 403, String(noHdr.status));
    const ar = await fetch(`${base}/api/admin/seat-invites/unclaimed`, { method: "POST", headers: { "Content-Type": "application/json", "x-admin-secret": ADMIN }, body: "{}" });
    const aj: any = await ar.json();
    check("6. defaults to a dry run (R's invitation still pending) and lists it", ar.status === 200 && aj.dryRun === true && aj.invites === 1 && statusOf(rOld) === "pending", JSON.stringify(aj));
    check("6. no addresses or names in the answer", !/@|Made-up/i.test(JSON.stringify(aj)), JSON.stringify(aj));
  } finally {
    server.close();
  }
  console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
