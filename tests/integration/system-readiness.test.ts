// tests/integration/system-readiness.test.ts
//
// Inspection Readiness across a system (B2, 2026-11-24; server/labReadiness.ts, server/coverageCounts.ts,
// server/rollupGroups.ts, server/systemFindings.ts). Made-up people, labs and two organizations on a fresh database, through
// the real routes. It checks:
//   1. findings, documents and verification studies on a lab's readiness, each equal to its own module's screen, and the
//      roll-up's numbers for a lab equal to the lab's own page
//   2. "Not set up": a lab with nothing reads not_set_up everywhere and stays out of the counts the percent is made of; a
//      lab whose work is all done reads ok in every module
//   3. the kept Coverage counts always equal computeCoverageForLab, through a new study, an exemption, a voided outside
//      record, a removed study and a change of day
//   4. plan: an org admin whose own account is free reads the roll-up, its groups and a lab on the organization's plan (403
//      before), and only that organization's labs; a deactivated org admin, an org_member, an admin of an organization with
//      no plan, and a free account get 403
//   5. the open findings list: a system leader only (SYSTEM_LEADER_ONLY for a lab member, a lab owner and a support login),
//      exactly the labs the roll-up gives that person, open findings only, no free text, a lab whose trial has ended closed
//   6. visibility doesn't widen: with two organizations and a member of one lab, each person's roll-up and list are their
//      own labs only, before and after groups exist, even a group row that names another organization's lab
// Run: rm -f .tmp-sysreadiness.db && DB_PATH=.tmp-sysreadiness.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/system-readiness.test.ts
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
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { computeCoverageForLab } = await import("../../server/veritacheckCoverage");
  const { coverageCountsForLab } = await import("../../server/coverageCounts");
  const { withLabClock, labToday, addLabDays } = await import("../../server/dateLocal");
  const sqlite = (db as any).$client;
  sqlite.pragma("foreign_keys = OFF");
  const cols = (t: string) => sqlite.prepare(`PRAGMA table_info(${t})`).all() as { name: string; notnull: number; dflt_value: any }[];
  const insert = (table: string, values: Record<string, unknown>) => {
    const row: Record<string, unknown> = { ...values };
    for (const c of cols(table)) if (c.notnull && c.dflt_value == null && !(c.name in row) && c.name !== "id") row[c.name] = /_at$|date/i.test(c.name) ? "2026-11-10T00:00:00Z" : /count|_id$|is_|mean|sd$|clia_allowable|value/i.test(c.name) ? 0 : "made-up";
    const keys = Object.keys(row);
    return Number(sqlite.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map((k) => "@" + k).join(",")})`).run(row).lastInsertRowid);
  };
  const user = (tag: string, plan = "free") => insert("users", { email: `${tag}-sr@example.test`, name: `Made-up ${tag}`, plan, seat_count: 0 });
  const labOf = (name: string, owner: number, extra: Record<string, unknown> = {}) => insert("labs", { lab_name: name, owner_user_id: owner, plan: "hospital", time_zone: "America/New_York", ...extra });
  const member = (lab: number, u: number, role = "staff") => insert("lab_members", { lab_id: lab, user_id: u, role, status: "active" });
  const orgMember = (org: number, u: number, role: string, status = "active") => insert("organization_members", { organization_id: org, user_id: u, org_role: role, status });

  // ── Two organizations, people and labs ──
  const O1 = user("owner1", "hospital"), O2 = user("owner2", "hospital"), O3 = user("owner3"), OS = user("ownersolo", "hospital");
  const ADMIN1 = user("admin1"), LEADER2 = user("leader2"), DUAL = user("dual", "hospital"), MEM = user("member", "hospital"), XSTAFF = user("xstaff");
  const EXADMIN = user("exadmin"), ORGMEM = user("orgmember"), ADMIN3 = user("admin3"), FREE = user("free"), SUPPORT = user("support", "enterprise");
  const ORG1 = insert("organizations", { name: "Made-up System One", billing_owner_user_id: O1, plan: "enterprise" });
  const ORG2 = insert("organizations", { name: "Made-up System Two", billing_owner_user_id: O2, plan: null });
  const ORG3 = insert("organizations", { name: "Made-up System Three", billing_owner_user_id: O3, plan: null });
  orgMember(ORG1, ADMIN1, "org_admin"); orgMember(ORG1, DUAL, "org_admin"); orgMember(ORG1, EXADMIN, "org_admin", "deactivated"); orgMember(ORG1, ORGMEM, "org_member");
  orgMember(ORG2, LEADER2, "org_owner"); orgMember(ORG3, ADMIN3, "org_admin");
  const X1 = labOf("Alder Lab", O1, { organization_id: ORG1 }), X2 = labOf("Birch Lab", O1, { organization_id: ORG1, plan: null }), X3 = labOf("Cedar Lab", O1, { organization_id: ORG1 });
  const XT = labOf("Elm Trial Lab", O1, { organization_id: ORG1, is_trial: 1, subscription_expires_at: "2026-01-01T00:00:00Z" });
  const XR = labOf("Repository", O1, { organization_id: ORG1, is_repository: 1 });
  const Y1 = labOf("Fir Lab", O2, { organization_id: ORG2 }), Y2 = labOf("Gum Lab", O2, { organization_id: ORG2 });
  const Z1 = labOf("Hazel Lab", O3, { organization_id: ORG3, plan: null });
  const S1 = labOf("Solo Lab", OS); const F1 = labOf("Free Lab", ADMIN1, { plan: "free" });
  member(X1, O1, "owner"); member(Y1, O2, "owner"); member(S1, OS, "owner"); member(F1, ADMIN1, "owner");
  member(X1, MEM); member(X2, XSTAFF); member(S1, DUAL);
  sqlite.prepare("UPDATE users SET vls_support = 1 WHERE id = ?").run(SUPPORT);
  const ids = (...n: number[]) => JSON.stringify([...n].sort((a, b) => a - b));

  // ── What each lab holds ──
  const today = withLabClock("America/New_York", () => labToday());
  const day = (n: number) => addLabDays(today, n);
  const finding = (lab: number, accreditor: string, status: string, due: string | null, extra: Record<string, unknown> = {}) =>
    insert("findings", { lab_id: lab, user_id: O1, accreditor, status, due_date: due, description: "SECRET-DESCRIPTION", surveyor_notes: "SECRET-NOTES", root_cause: "SECRET-CAUSE", signed_by: "SECRET-SIGNER", ...extra });
  const doc = (lab: number, status: string, due: string | null, extra: Record<string, unknown> = {}) => insert("policy_documents", { lab_id: lab, title: "Made-up procedure", status, owner_user_id: O1, next_review_date: due, ...extra });
  const map = (lab: number) => insert("veritamap_maps", { user_id: O1, lab_id: lab, name: "Made-up map" });
  const instrument = (m: number, name: string, nick: string) => insert("veritamap_instruments", { map_id: m, instrument_name: name, nickname: nick, role: "Primary", category: "Chemistry" });
  const test = (m: number, inst: number, analyte: string, extra: Record<string, unknown> = {}) => insert("veritamap_instrument_tests", { map_id: m, instrument_id: inst, analyte, specialty: "General Chemistry", complexity: "MODERATE", active: 1, ...extra });
  const study = (lab: number, name: string, inst: string, type: string, date: string, status = "pass") => insert("studies", { user_id: O1, lab_id: lab, test_name: name, instrument: inst, study_type: type, status, lifecycle_state: "finalized", date, finalized_at: date, data_points: "[]", instruments: "[]" });

  // X1: something of everything.
  const capDue = finding(X1, "CAP", "open", day(10), { finding_number: "7", standard_ref: "GEN.20316" });
  finding(X1, "CMS", "drafting", day(-5)); finding(X1, "COLA", "open", day(-3)); finding(X1, "CAP", "submitted", day(60));
  finding(X1, "Other", "open", null, { source_type: "internal_nce" }); finding(X1, "TJC", "closed", day(-10)); finding(X1, "CAP", "accepted", day(-10));
  doc(X1, "approved", day(-20)); doc(X1, "approved", day(-1)); doc(X1, "approved", day(20)); doc(X1, "approved", day(90));
  doc(X1, "expired", day(-80)); doc(X1, "in_review", null); doc(X1, "in_review", null); doc(X1, "draft", null);
  doc(X1, "approved", day(-20), { archived_at: "2026-10-01T00:00:00Z" });
  const m1 = map(X1), A = instrument(m1, "Alphamatic 500", "Ann"), B = instrument(m1, "Betatron 9", "Ben");
  test(m1, A, "Sodium"); test(m1, B, "Sodium"); test(m1, A, "Potassium"); test(m1, A, "Chloride"); const gluRow = test(m1, A, "Glucose"); test(m1, A, "Calcium", { linearity_exempt_multical: 1 });
  study(X1, "Sodium", "Alphamatic 500 Ann", "cal_ver", day(-250)); study(X1, "Potassium", "Alphamatic 500 Ann", "cal_ver", day(-170)); study(X1, "Glucose", "Alphamatic 500 Ann", "cal_ver", day(-10), "fail");
  // X2: nothing at all. XT: one open finding behind an ended trial. Y1 and S1: one open finding each.
  finding(XT, "CAP", "open", day(5)); const y1f = finding(Y1, "TJC", "open", day(5)); finding(S1, "COLA", "open", day(40)); finding(Z1, "CAP", "open", day(5));
  // X3: everything set up and finished.
  insert("lab_equipment", { lab_id: X3, status: "active", next_due_date: day(200) });
  insert("pt_events", { lab_id: X3, enrollment_id: 1, user_id: O1, event_date: day(-60), analyte: "Glucose", pass_fail: "pass", submission_due_date: day(-40) });
  insert("qc_control_lots", { lab_id: X3, analyte: "Glucose", lot_number: "L1", status: "inactive" });
  insert("lab_certificates", { user_id: O1, lab_id: X3, cert_type: "clia", cert_name: "CLIA", expiration_date: day(400), is_active: 1 });
  const emp = insert("staff_employees", { user_id: O1, lab_id: X3, tier2_lab_id: X3, first_name: "Made", last_name: "Up", status: "active", performs_testing: 1, hire_date: day(-900) });
  insert("staff_competency_schedules", { employee_id: emp, lab_id: X3, initial_completed_at: day(-60), six_month_due_at: day(120) });
  finding(X3, "CAP", "closed", day(-30)); doc(X3, "approved", day(300)); doc(X3, "draft", null);
  const m3 = map(X3), C = instrument(m3, "Alphamatic 500", "Cy"); test(m3, C, "Sodium"); study(X3, "Sodium", "Alphamatic 500 Cy", "cal_ver", day(-20));

  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const jwt = (await import("jsonwebtoken")).default;
  const tok = (uid: number) => jwt.sign({ svc: true, userId: uid }, process.env.JWT_SECRET!, { expiresIn: "10m" });
  const call = async (method: string, path: string, uid: number | null, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(uid ? { Authorization: `Bearer ${tok(uid)}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let j: any = {}; try { j = JSON.parse(text); } catch { /* not JSON */ }
    return { s: r.status, j, text };
  };
  const rollup = async (uid: number) => call("GET", "/api/readiness/rollup", uid);
  const rollupIds = async (uid: number) => { const r = await rollup(uid); return Array.isArray(r.j) ? ids(...r.j.map((l: any) => l.lab_id)) : `${r.s}`; };
  const list = async (uid: number | null) => call("GET", "/api/readiness/rollup/findings", uid);
  const listIds = async (uid: number) => { const r = await list(uid); return Array.isArray(r.j?.labs) ? ids(...r.j.labs.map((l: any) => l.lab_id)) : `${r.s} ${r.j?.code || ""}`; };
  const mod = (o: any, key: string) => (o?.modules || []).find((m: any) => m.key === key);
  try {
    // 1. the three new modules, each against its own screen
    const x1 = await call("GET", `/api/labs/${X1}/readiness`, O1);
    const f = mod(x1.j, "findings"), d = mod(x1.j, "documents"), v = mod(x1.j, "verification");
    check("1. findings: 5 open, 1 due within 30 days, 1 past due, 1 past target (COLA is a soft clock, never overdue)",
      x1.s === 200 && f?.status === "overdue" && JSON.stringify(f?.counts) === JSON.stringify({ open: 5, due_in_30: 1, past_due: 1, past_target: 1 }) && f?.overdue === 1 && f?.due_soon === 2 && f?.total === 7, JSON.stringify(f));
    const fl = await call("GET", `/api/labs/${X1}/findings`, O1);
    check("1. ... the same open count as the lab's own findings list", fl.s === 200 && (fl.j as any[]).filter((r) => !["closed", "accepted"].includes(r.status)).length === f?.counts?.open);
    check("1. documents: 2 overdue for review, 1 expired, 1 due within 30 days, 2 waiting for approval (a draft and a retired document left out)",
      d?.status === "overdue" && JSON.stringify(d?.counts) === JSON.stringify({ overdue_review: 2, expired: 1, due_in_30: 1, waiting_approval: 2 }) && d?.overdue === 3 && d?.due_soon === 1 && d?.other === 2, JSON.stringify(d));
    const comp = await call("GET", `/api/labs/${X1}/veritapolicy/compliance`, O1);
    check("1. ... the same as the VeritaDC compliance page (overdue list, due soon list, expired, in review)",
      comp.s === 200 && comp.j.overdueList?.length === 2 && comp.j.dueSoonList?.length === 1 && Number(comp.j.headline?.expired_total) === 1 && Number(comp.j.headline?.in_review_total) === 2, JSON.stringify({ s: comp.s, h: comp.j.headline, o: comp.j.overdueList?.length, n: comp.j.dueSoonList?.length }));
    check("1. verification studies: 6 required, 1 overdue, 3 missing (nothing, failed, no comparison), 1 to review, 1 due within 30 days; the exempt test left out",
      v?.status === "overdue" && JSON.stringify(v?.counts) === JSON.stringify({ required: 6, missing: 3, review: 1, overdue: 1, due_in_30: 1 }) && v?.overdue === 1 && v?.other === 4, JSON.stringify(v));
    const cov = await call("GET", `/api/labs/${X1}/veritacheck/coverage`, O1);
    const s = cov.j.summary;
    check("1. ... the same as the Coverage page: its Missing holds the overdue ones too", cov.s === 200 && s?.linearityRequired + s?.methodComparisonsNeeded === 6 && s?.linearityReview === 1
      && s?.linearityMissing + (s?.methodComparisonsNeeded - s?.methodComparisonsDone) === v?.counts?.missing + v?.counts?.overdue, JSON.stringify(s));
    const r1 = await rollup(O1);
    const rx1 = (r1.j as any[]).find((l) => l.lab_id === X1);
    check("1. the roll-up's numbers for the lab are the lab page's", JSON.stringify(rx1?.modules) === JSON.stringify(x1.j.modules) && JSON.stringify(rx1?.overall) === JSON.stringify(x1.j.overall));

    // 2. not set up, and finished
    const ra = await rollup(DUAL);
    const rx2 = (ra.j as any[]).find((l) => l.lab_id === X2), rx3 = (ra.j as any[]).find((l) => l.lab_id === X3);
    check("2. a lab with nothing set up: every module not_set_up, the lab not_set_up, none of the modules in the percent",
      rx2?.modules?.length === 8 && rx2.modules.every((m: any) => m.status === "not_set_up") && rx2.overall.status === "not_set_up" && rx2.overall.modules_total === 0 && rx2.overall.modules_ok === 0 && rx2.overall.modules_not_set_up === 8, JSON.stringify(rx2?.overall));
    check("2. a lab whose work is all done (PT graded, lots retired, findings closed, every study current) reads ok in all 8 modules",
      rx3?.modules?.length === 8 && rx3.modules.every((m: any) => m.status === "ok") && rx3.overall.status === "ok" && rx3.overall.modules_total === 8 && rx3.overall.modules_ok === 8 && rx3.overall.modules_not_set_up === 0, JSON.stringify(rx3?.modules?.map((m: any) => `${m.key}:${m.status}:${m.headline}`)));
    check("2. a lab with some modules set up counts only those", rx1?.overall?.modules_total === 3 && rx1?.overall?.modules_not_set_up === 5, JSON.stringify(rx1?.overall));
    const { summarizeRollup } = await import("../../client/src/lib/readinessRollup");
    const only = summarizeRollup([rx2, rx3] as any);
    check("2. the command center's percent leaves the not-set-up lab out (1 ready of 2 sites, 1 not set up, 100% of what is set up), and is blank when nothing is set up",
      only.ready === 1 && only.sites === 2 && only.notSetUp === 1 && only.readinessPct === 100 && summarizeRollup([rx2] as any).readinessPct === null, JSON.stringify({ ready: only.ready, pct: only.readinessPct }));
    const draftsOnly = doc(X2, "draft", null);
    const x2drafts = await call("GET", `/api/labs/${X2}/readiness`, DUAL);
    check("2. drafts alone aren't a library: still not set up, and says so", mod(x2drafts.j, "documents")?.status === "not_set_up" && /1 draft/.test(mod(x2drafts.j, "documents")?.headline), JSON.stringify(mod(x2drafts.j, "documents")));
    sqlite.prepare("DELETE FROM policy_documents WHERE id = ?").run(draftsOnly);

    // 3. the kept counts are always Coverage's
    const truth = (lab: number, tz: string) => withLabClock(tz, () => {
      const c = computeCoverageForLab(sqlite, lab), t = labToday(), soon = addLabDays(t, 30);
      const all = [...c.rows.filter((r) => r.linearityStatus !== "exempt"), ...c.methodComparisons] as any[];
      return JSON.stringify({
        hasMap: c.hasMap, required: c.summary.linearityRequired + c.summary.methodComparisonsNeeded,
        missing: c.rows.filter((r) => r.linearityStatus === "missing" && !r.overdue).length + c.methodComparisons.filter((m) => !m.nextDueOn).length,
        review: c.summary.linearityReview, overdue: all.filter((r) => r.overdue).length, dueSoon: all.filter((r) => r.nextDueOn && !r.overdue && r.nextDueOn <= soon).length,
      });
    });
    const kept = (lab: number, tz: string) => withLabClock(tz, () => JSON.stringify(coverageCountsForLab(sqlite, lab)));
    const NY = "America/New_York";
    const same = (why: string) => check(`3. kept counts equal Coverage: ${why}`, kept(X1, NY) === truth(X1, NY), `${kept(X1, NY)} vs ${truth(X1, NY)}`);
    same("as first read");
    const k0 = kept(X1, NY);
    const clStudy = study(X1, "Chloride", "Alphamatic 500 Ann", "cal_ver", day(-1));
    same("after a new study"); check("3. ... and it changed at once", kept(X1, NY) !== k0);
    sqlite.prepare("UPDATE veritamap_instrument_tests SET linearity_exempt_other = 'made-up reason' WHERE id = ?").run(gluRow);
    same("after an exemption");
    const out = insert("veritacheck_outside_records", { lab_id: X1, kind: "cal_ver", instrument_id: B, analyte: "Sodium", performed_on: day(-100), records_location: "Binder", reviewed_by: "Made-up" });
    same("after an outside record"); sqlite.prepare("UPDATE veritacheck_outside_records SET voided_at = ? WHERE id = ?").run(day(0), out); same("after it is voided");
    sqlite.prepare("DELETE FROM studies WHERE id = ?").run(clStudy); same("after the study is removed");
    sqlite.prepare("UPDATE veritamap_instrument_tests SET linearity_exempt_other = NULL WHERE id = ?").run(gluRow); same("after the exemption is cleared");
    check("3. ... back to the first answer", kept(X1, NY) === k0);
    // Two zones that are always on different calendar days: the counts follow the reader's day with nothing recalculated.
    const edge = day(-60); const edgeStudy = study(X1, "Chloride", "Alphamatic 500 Ann", "cal_ver", edge);
    let daysAgree = true, sawChange = false;
    for (let n = -200; n <= -150; n++) {
      sqlite.prepare("UPDATE studies SET date = ?, finalized_at = ? WHERE id = ?").run(day(n), day(n), edgeStudy);
      const a = kept(X1, "Pacific/Pago_Pago"), b = kept(X1, "Pacific/Kiritimati");
      if (a !== truth(X1, "Pacific/Pago_Pago") || b !== truth(X1, "Pacific/Kiritimati")) daysAgree = false;
      if (a !== b) sawChange = true;
    }
    check("3. kept counts follow the calendar day: equal to Coverage on both sides of the date line for 51 study dates, and the two days differ on some", daysAgree && sawChange, `${daysAgree} ${sawChange}`);
    sqlite.prepare("DELETE FROM studies WHERE id = ?").run(edgeStudy);

    // 4. plan
    const a1 = await rollup(ADMIN1);
    check("4. an org admin on a free account reads the roll-up on the organization's plan (403 before), only that organization's labs: not their own free lab, not the repository",
      a1.s === 200 && ids(...(a1.j as any[]).map((l) => l.lab_id)) === ids(X1, X2, X3, XT), `${a1.s} ${a1.text.slice(0, 120)}`);
    const g1 = await call("GET", "/api/rollup-groups", ADMIN1);
    check("4. ... and the roll-up groups", g1.s === 200 && g1.j.can_build?.organizations?.[0]?.id === ORG1, `${g1.s} ${g1.text.slice(0, 120)}`);
    const a1x2 = await call("GET", `/api/labs/${X2}/readiness`, ADMIN1);
    check("4. ... and opens a lab that carries no plan of its own (covered by the organization's)", a1x2.s === 200 && a1x2.j.lab_id === X2, `${a1x2.s} ${a1x2.text.slice(0, 120)}`);
    check("4. a member of that lab who isn't an org admin still gets 403 there", (await call("GET", `/api/labs/${X2}/readiness`, XSTAFF)).s === 403);
    check("4. the org admin's own free lab stays closed", (await call("GET", `/api/labs/${F1}/readiness`, ADMIN1, undefined, { "X-Active-Lab-Id": String(F1) })).s === 403);
    const l2 = await rollup(LEADER2);
    check("4. an org owner whose organization carries no plan reads its labs that carry one", l2.s === 200 && ids(...(l2.j as any[]).map((l) => l.lab_id)) === ids(Y1, Y2), `${l2.s}`);
    const refused = await Promise.all([EXADMIN, ORGMEM, ADMIN3, FREE, XSTAFF].map(async (u) => (await rollup(u)).s));
    check("4. 403: a deactivated org admin, an org_member, an admin of an organization with no plan, a free account, a free member of a lab with no plan", refused.every((n) => n === 403), refused.join(","));
    check("4. ... and for the groups", (await call("GET", "/api/rollup-groups", EXADMIN)).j.code === "PLAN_REQUIRED" && (await call("GET", "/api/rollup-groups", ADMIN3)).j.code === "PLAN_REQUIRED");

    // 5. the open findings list
    const anon = await list(null);
    check("5. signed out: 401", anon.s === 401, String(anon.s));
    const codes = await Promise.all([MEM, OS, SUPPORT, EXADMIN, ORGMEM, FREE].map(async (u) => { const r = await list(u); return `${r.s} ${r.j?.code}`; }));
    check("5. 403 SYSTEM_LEADER_ONLY: a lab member, a standalone lab's owner, a support login, a deactivated org admin, an org_member, a free account", codes.every((c) => c === "403 SYSTEM_LEADER_ONLY"), codes.join(" | "));
    const a3 = await list(ADMIN3);
    check("5. an admin of an organization with no plan: 403 PLAN_REQUIRED", a3.s === 403 && a3.j.code === "PLAN_REQUIRED", `${a3.s} ${a3.j?.code}`);
    for (const [who, u] of [["the free org admin", ADMIN1], ["the second organization's owner", LEADER2], ["an org admin who also belongs to a standalone lab", DUAL]] as const) {
      check(`5. ${who}: exactly the labs of their roll-up`, (await listIds(u)) === (await rollupIds(u)), `${await listIds(u)} vs ${await rollupIds(u)}`);
    }
    const la = await list(ADMIN1);
    const rows = la.j.findings as any[];
    check("5. open findings only, from those labs (X1's five; none from the ended trial, the other organization or the standalone lab)",
      rows.length === 5 && rows.every((r) => r.lab_id === X1) && rows.every((r) => !["closed", "accepted"].includes(r.status)), JSON.stringify(rows.map((r) => [r.lab_id, r.accreditor, r.status])));
    check("5. past due first (CMS), then by date, undated last; COLA past its target isn't past due",
      rows[0].accreditor === "CMS" && rows[0].past_due === true && rows[1].accreditor === "COLA" && rows[1].past_due === false && rows[1].past_target === true && rows[4].due_date === null, JSON.stringify(rows.map((r) => [r.accreditor, r.due_date, r.past_due, r.past_target])));
    const cap = rows.find((r) => r.id === capDue);
    check("5. a row is the lab, accreditor, entry type, number, standard, due date and status, and nothing else of the finding",
      JSON.stringify(Object.keys(cap || {}).sort()) === JSON.stringify(["accreditor", "due_date", "finding_number", "id", "lab_id", "lab_name", "organization_id", "past_due", "past_target", "source_type", "standard_ref", "status"]) && !/SECRET/.test(la.text), JSON.stringify(Object.keys(cap || {})));
    check("5. the roll-up's open count for a lab is the list's", (a1.j as any[]).every((l) => l.lab_id === XT || mod(l, "findings").counts.open === rows.filter((r) => r.lab_id === l.lab_id).length));
    const dl = await list(DUAL);
    check("5. a leader who belongs to a standalone lab sees its findings too, because their roll-up has it", (dl.j.findings as any[]).some((r) => r.lab_id === S1) && !(dl.j.findings as any[]).some((r) => r.lab_id === Y1));

    // 6. visibility doesn't widen
    const people: [string, number, string][] = [["member of one lab", MEM, ids(X1)], ["standalone owner", OS, ids(S1)], ["support login", SUPPORT, ids()], ["org 1 admin", ADMIN1, ids(X1, X2, X3, XT)], ["org 2 owner", LEADER2, ids(Y1, Y2)], ["org 1 admin with a standalone lab", DUAL, ids(X1, X2, X3, XT, S1)]];
    const before: string[] = [];
    for (const [who, u, want] of people) { const got = await rollupIds(u); before.push(got); check(`6. ${who}: the roll-up is their own labs only`, got === want, `${got} vs ${want}`); }
    const mk = await call("POST", "/api/rollup-groups", ADMIN1, { name: "North", kind: "region", organizationId: ORG1, labIds: [X1, X3] });
    const bad = await call("POST", "/api/rollup-groups", ADMIN1, { name: "Reach", kind: "region", organizationId: ORG1, labIds: [X1, Y1] });
    check("6. an organization's group is made (201) and can't take the other organization's lab", mk.s === 201 && bad.s === 400 && bad.j.code === "LAB_NOT_ELIGIBLE", `${mk.s} ${bad.s} ${bad.j?.code}`);
    // Even a group row that names another organization's lab, put there behind the routes' back, grants nothing.
    insert("rollup_group_labs", { group_id: mk.j.id, lab_id: Y1 });
    const pg = insert("rollup_groups", { name: "Member's own", kind: "other", organization_id: null, owner_user_id: MEM, created_by_user_id: MEM });
    for (const l of [X1, X3, Y1]) insert("rollup_group_labs", { group_id: pg, lab_id: l });
    for (const [i, [who, u]] of people.entries()) check(`6. ${who}: the same labs with groups in place`, (await rollupIds(u)) === before[i]);
    const la2 = await list(ADMIN1);
    check("6. ... and the findings list is the same answer, with nothing from the other organization", JSON.stringify(la2.j) === JSON.stringify(la.j) && !(la2.j.findings as any[]).some((r) => r.id === y1f));
    const mg = await call("GET", "/api/rollup-groups", MEM);
    check("6. ... and a group reads back cut to the reader's labs", JSON.stringify(mg.j.groups?.[0]?.lab_ids) === JSON.stringify([X1]), JSON.stringify(mg.j.groups));
    check("6. the member still can't open a lab their group names", (await call("GET", `/api/labs/${X3}/readiness`, MEM)).s === 403 && (await call("GET", `/api/labs/${Y1}/readiness`, MEM)).s === 403);
    check("6. an org admin can't open the other organization's lab, and its findings list refuses them", (await call("GET", `/api/labs/${Y1}/readiness`, ADMIN1)).s === 403 && (await call("GET", `/api/labs/${Y1}/findings`, ADMIN1)).s === 403);
    check("6. naming another organization's lab as the active lab changes nothing", (await call("GET", "/api/readiness/rollup/findings", ADMIN1, undefined, { "X-Active-Lab-Id": String(Y1) })).text === la2.text);
  } finally {
    server.close();
  }
  console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
