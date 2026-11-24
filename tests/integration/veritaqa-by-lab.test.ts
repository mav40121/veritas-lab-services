// tests/integration/veritaqa-by-lab.test.ts
//
// VeritaQA by laboratory, an organization's indicators, the reports and the links to findings (B15). Made-up people, labs and
// numbers on a scratch database, through the real routes. It checks:
//   1. the one-time assignment: an account with exactly one laboratory (retired and repository ones aside) has its rows assigned,
//      any other account's stay account-wide; nothing is copied; a second run changes nothing
//   2. every read there was answers as it did before (fixtures/veritaqa-baseline-main.json, captured from main 23d7b11d):
//      one laboratory, three, a repository, a retired one, none, writer seats, a seat with no lab, an admin with no seat
//   3. the laboratory routes the screen calls give those people the same rows, account-wide ones labelled
//   4. who reads and writes: a sister laboratory, another customer, a view-only seat, a Staff login, a member with no seat, support
//   5. assigning an account-wide indicator: named, counted, its entries with it, out of every other laboratory, one audit row
//   6. the quality plan stays account-wide until a laboratory starts its own
//   7. an organization's indicator: who defines it, versions and the target each entry keeps, frequency, on and off
//   8. the report across laboratories: sums and never averages, No entry, different kinds, groups and departments, who reads it
//   9. one laboratory's report, month, quarter and year; PDF and workbook words
//  10. findings linked to a month that missed its target, both ways, and nothing opened by itself
//  11. exports and the per-customer delete: the laboratory's rows and the account-wide ones; an admin load; a deleted account
// Run: npm run test:veritaqa-by-lab
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

async function main() {
  const { db } = await import("../../server/db");
  const sqlite = (db as any).$client;
  const { VERITAQA_LAB_TABLES, ensureVeritaQaLabColumns } = await import("../../server/veritaqaLabColumn");
  const B = await import("./veritaqaBaselineWorld");
  const { U, L } = B;

  // ── The database as the code before B15 left it: no lab column, rows by account. ──
  sqlite.pragma("foreign_keys = OFF");
  for (const t of VERITAQA_LAB_TABLES) { sqlite.exec(`DROP INDEX IF EXISTS idx_${t}_lab`); sqlite.exec(`ALTER TABLE ${t} DROP COLUMN lab_id`); }
  B.seedBaselinePeople(sqlite);
  B.seedBaselineRows(sqlite);
  const countRows = () => VERITAQA_LAB_TABLES.map((t) => Number((sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as any).n));
  const before = countRows();
  const logged: string[] = [];
  const log = console.log;
  console.log = (...a: any[]) => { logged.push(a.join(" ")); };
  const first = ensureVeritaQaLabColumns(sqlite);
  console.log = log;
  const afterFirst = JSON.stringify(VERITAQA_LAB_TABLES.map((t) => sqlite.prepare(`SELECT id, lab_id FROM ${t} ORDER BY id`).all()));
  const second = ensureVeritaQaLabColumns(sqlite);
  const afterSecond = JSON.stringify(VERITAQA_LAB_TABLES.map((t) => sqlite.prepare(`SELECT id, lab_id FROM ${t} ORDER BY id`).all()));

  const { inspectionWorld } = await import("./inspectionFixture");
  const w = await inspectionWorld("qalab");
  const { call, check, one, all, audits } = w;
  const jwt = (await import("jsonwebtoken")).default;
  const as = (id: number) => ({ id, email: "", name: "", token: jwt.sign({ svc: true, userId: id }, process.env.JWT_SECRET!, { expiresIn: "30m" }) });
  const labOf = (t: string, account: number) => all(`SELECT DISTINCT lab_id FROM ${t} WHERE account_id = ?`, account).map((r) => r.lab_id);
  const PI = (lab: number) => `/api/labs/${lab}/veritaqa/pi`;
  const ids = (rows: any) => (Array.isArray(rows) ? rows.map((r: any) => r.id ?? r.metric?.id) : []);

  try {
    // 1. The assignment.
    check("1. an account with one laboratory: every row gets it", VERITAQA_LAB_TABLES.every((t) => JSON.stringify(labOf(t, U.ONE)) === JSON.stringify([L.A])));
    check("1. a repository or a retired laboratory doesn't count against it", JSON.stringify(labOf("pi_metrics", U.REPO)) === JSON.stringify([L.REPO]) && JSON.stringify(labOf("pi_entries", U.RETIRED)) === JSON.stringify([L.RET]));
    check("1. three laboratories, none, or rows under a member's own account: left account-wide", [U.THREE, U.NOLAB, U.ADMIN].every((u) => JSON.stringify(labOf("pi_metrics", u)) === "[null]" && JSON.stringify(labOf("pi_entries", u)) === "[null]"));
    check("1. nothing is copied or removed", JSON.stringify(countRows()) === JSON.stringify(before), `${before} ${countRows()}`);
    check("1. it reports counts only, once", !!first && second === null && logged.length === 1 && /assigned \{"pi_departments":6,/.test(logged[0]) && !/Made-up|@/.test(logged[0]), logged.join(" | "));
    check("1. a second run changes nothing", afterFirst === afterSecond);
    sqlite.prepare("UPDATE pi_metrics SET lab_id = NULL WHERE id = 9501").run();
    ensureVeritaQaLabColumns(sqlite);
    check("1. a later boot assigns nothing again, and an entry follows its indicator", one("SELECT lab_id FROM pi_metrics WHERE id = 9501").lab_id === null && one("SELECT COUNT(*) AS n FROM pi_entries WHERE metric_id = 9501 AND lab_id IS NOT NULL").n === 0);
    sqlite.prepare("UPDATE pi_metrics SET lab_id = ? WHERE id = 9501").run(L.A);
    ensureVeritaQaLabColumns(sqlite);

    // 2. Every read, before and after.
    const fixture = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/integration/fixtures/veritaqa-baseline-main.json"), "utf8"));
    // Everything in the old answer is in the new one, in the same place and order. A new answer may carry more fields.
    const holds = (old: any, now: any, at = ""): string | null => {
      if (Array.isArray(old)) {
        if (!Array.isArray(now) || now.length !== old.length) return `${at}: ${old.length} rows, now ${Array.isArray(now) ? now.length : typeof now}`;
        for (let i = 0; i < old.length; i++) { const d = holds(old[i], now[i], `${at}[${i}]`); if (d) return d; }
        return null;
      }
      if (old && typeof old === "object") {
        if (!now || typeof now !== "object") return `${at}: gone`;
        for (const k of Object.keys(old)) { const d = holds(old[k], now[k], `${at}.${k}`); if (d) return d; }
        return null;
      }
      return old === now ? null : `${at}: ${JSON.stringify(old)} is now ${JSON.stringify(now)}`;
    };
    const ask = async (user: number, lab: number | null, method: string, p: string) => {
      const r = await call(as(user), method, p, method === "GET" ? undefined : {}, lab ?? undefined);
      const body = r.j;
      if (body?.token) body.token = "(a token)";
      return { status: r.s, body };
    };
    const now = await B.capture(ask);
    const diffs: string[] = [];
    for (const [key, [status, i]] of Object.entries(fixture.answers) as [string, [number, number]][]) {
      const got = now[key];
      const d = got.status !== status ? `status ${status} is now ${got.status}` : holds(fixture.bodies[i], got.body);
      if (d) diffs.push(`${key}: ${d}`);
    }
    check(`2. every one of the ${Object.keys(fixture.answers).length} reads answers as it did before`, Object.keys(fixture.answers).length === 405 && diffs.length === 0, `${diffs.length} differ; ${diffs.slice(0, 4).join(" || ")}`);

    // 3. The laboratory routes give the same rows.
    const same = async (who: keyof typeof U, lab: number, base: number, legacyKey: string) => {
      const out: string[] = [];
      for (const p of ["/departments", "/metrics?department_id=all", `/metrics?department_id=${base + 1}`, "/entries?year=2026&department_id=all", "/entries?year=2025&department_id=all", "/dashboard?year=2026&department_id=all", "/dashboard?year=2025&department_id=all", "/plan"]) {
        const [st, i] = fixture.answers[`${legacyKey} GET /api/pi${p}`];
        const r = await call(as(U[who]), "GET", `${PI(lab)}${p}`);
        const d = r.s !== st ? `status ${st} is now ${r.s}` : holds(fixture.bodies[i], r.j);
        if (d) out.push(`${p}: ${d}`);
      }
      return out;
    };
    for (const [who, lab, base, key] of [["ONE", L.A, 9500, `ONE @${L.A}`], ["ONE_SEAT", L.A, 9500, `ONE_SEAT @${L.A}`], ["THREE", L.T1, 9510, `THREE @${L.T1}`], ["THREE", L.T2, 9510, `THREE @${L.T2}`], ["THREE", L.T3, 9510, `THREE @${L.T3}`], ["THREE_SEAT", L.T2, 9510, `THREE_SEAT @${L.T2}`], ["REPO", L.REPO, 9520, `REPO @${L.REPO}`], ["RETIRED", L.RET, 9530, `RETIRED @${L.RET}`]] as const) {
      const d = await same(who, lab, base, key);
      check(`3. ${who} in laboratory ${lab}: the screen shows what it showed`, d.length === 0, d.slice(0, 2).join(" || "));
    }
    const three = await call(as(U.THREE), "GET", `${PI(L.T1)}/metrics?department_id=all`);
    check("3. account-wide rows say so in each laboratory", three.j.length === 5 && three.j.every((m: any) => m.scope === "account" && m.lab_id === null));
    const oneLab = await call(as(U.ONE), "GET", `${PI(L.A)}/metrics?department_id=all`);
    check("3. a laboratory's own rows say so", oneLab.j.length === 5 && oneLab.j.every((m: any) => m.scope === "lab"));
    const admin = await call(as(U.ADMIN), "GET", `${PI(L.A)}/metrics?department_id=all`);
    check("3. an admin with no seat reads the laboratory's indicators, and still their own account-wide ones", admin.s === 200 && admin.j.filter((m: any) => m.scope === "lab").length === 5 && admin.j.filter((m: any) => m.scope === "account" && m.account_id === U.ADMIN).length === 5, JSON.stringify(ids(admin.j)));
    const ownerOfA = await call(as(U.ONE), "GET", `${PI(L.A)}/metrics?department_id=all`);
    check("3. ... which nobody else sees", !ownerOfA.j.some((m: any) => m.account_id === U.ADMIN));
    const T3PLAIN = await w.login("t3plain", "Tam Plain"), T3ADMIN = await w.login("t3admin", "Tia Admin"), MIXED = await w.login("mixed", "Max Mixed");
    w.member(L.T3, T3PLAIN); w.member(L.T3, T3ADMIN, "admin");
    // A Staff login under THREE, older than a writer seat in the one-laboratory account's lab.
    w.member(L.T3, MIXED); w.seat(U.THREE, MIXED, L.T3, { type: "staff_portal", perms: {} }); w.member(L.A, MIXED); w.seat(U.ONE, MIXED, L.A);
    const wideFor = async (u: any, lab: number) => (await call(u, "GET", `${PI(lab)}/metrics?department_id=all`)).j.filter((m: any) => m.scope === "account").map((m: any) => m.account_id);
    check("3. account-wide rows reach nobody new but someone who may assign them: an admin of the laboratory, not a member with no seat", (await wideFor(T3ADMIN, L.T3)).length === 5 && (await wideFor(T3PLAIN, L.T3)).length === 0);
    check("3. a Staff login elsewhere, with a writer seat here, reads this laboratory and never that account's rows", (await call(MIXED, "GET", `${PI(L.A)}/metrics?department_id=all`)).j.length === 5 && (await wideFor(MIXED, L.A)).length === 0 && (await call(MIXED, "GET", `${PI(L.T3)}/metrics?department_id=all`)).s === 403);

    // 4. Who reads, who writes. The organization's labs A and B (one owner), another customer's lab X.
    const { A, B: LB, X, OWNER, OTHER, EDITOR, SCAN_ONLY, VIEWER, STAFF, ADMIN_A, LEADER, SUPPORT, ORG } = w as any;
    const dept = (await call(OWNER, "POST", `${PI(A)}/departments`, { name: "Made-up Chemistry", sort_order: 0 })).j;
    const metric = (await call(EDITOR, "POST", `${PI(A)}/metrics`, { department_id: dept.id, name: "Hemolyzed specimens", unit: "%", direction: "lower_is_better", benchmark_green: 2, benchmark_yellow: 3 })).j;
    check("4. an owner and a writer seat add to the laboratory: the rows carry it", dept.lab_id === A && metric.lab_id === A && metric.account_id === OWNER.id);
    const bDept = (await call(OWNER, "POST", `${PI(LB)}/departments`, { name: "Made-up Chemistry" })).j;
    const bMetric = (await call(OWNER, "POST", `${PI(LB)}/metrics`, { department_id: bDept.id, name: "Lab B only" })).j;
    const reads = ["/departments", "/metrics?department_id=all", "/entries?year=2026&department_id=all", "/dashboard?year=2026&department_id=all", "/plan", "/report?period=month&year=2026&month=3", "/finding-links?year=2026"];
    for (const p of reads) {
      const ok = (await call(EDITOR, "GET", PI(A) + p)).s, adminOk = (await call(ADMIN_A, "GET", PI(A) + p)).s, sys = (await call(LEADER, "GET", PI(A) + p)).s, sup = (await call(SUPPORT, "GET", PI(A) + p)).s;
      const bad = [(await call(VIEWER, "GET", PI(A) + p)).s, (await call(STAFF, "GET", PI(A) + p)).s, (await call(OTHER, "GET", PI(A) + p)).s, (await call(EDITOR, "GET", PI(LB) + p)).s];
      check(`4. GET ${p}: an editor, an admin, the system's admin and support read it; a view-only seat, a Staff login, another customer and a sister-lab editor don't`, [ok, adminOk, sys, sup].every((s) => s === 200) && bad.every((s) => s === 403), `${[ok, adminOk, sys, sup]} / ${bad}`);
    }
    const legacySister = await call(EDITOR, "GET", "/api/pi/metrics?department_id=all", undefined, LB);
    check("4. naming the sister laboratory in the header shows none of its rows on the older routes", legacySister.s === 200 && !ids(legacySister.j).includes(bMetric.id), JSON.stringify(ids(legacySister.j)));
    const legacyOwner = await call(OWNER, "GET", "/api/pi/metrics?department_id=all");
    check("4. ... and the owner of both still reads both there", ids(legacyOwner.j).includes(bMetric.id) && ids(legacyOwner.j).includes(metric.id));
    const PLAIN = await w.login("plain", "Pat Plain"); w.member(A, PLAIN);
    check("4. a member with no seat reads and can't write", (await call(PLAIN, "GET", `${PI(A)}/departments`)).s === 200 && (await call(PLAIN, "POST", `${PI(A)}/departments`, { name: "x" })).s === 403);
    const count = () => JSON.stringify(VERITAQA_LAB_TABLES.map((t) => one(`SELECT COUNT(*) AS n FROM ${t}`).n)) + one("SELECT name FROM pi_metrics WHERE id = ?", bMetric.id).name;
    const frozen = count();
    const refusals: [string, number][] = [];
    for (const [who, u] of [["sister editor", EDITOR], ["another customer", OTHER], ["view-only", VIEWER], ["Staff login", STAFF]] as const) {
      const lab = who === "sister editor" || who === "another customer" ? LB : A;
      for (const [m, p, b] of [["POST", "/departments", { name: "n" }], ["POST", "/metrics", { department_id: bDept.id, name: "n" }], ["PUT", `/metrics/${bMetric.id}`, { name: "n" }], ["DELETE", `/metrics/${bMetric.id}`, undefined], ["POST", "/entries", { metric_id: bMetric.id, year: 2026, month: 1, value: 1 }], ["PUT", "/plan", { title: "n" }]] as const) refusals.push([`${who} ${m} ${p}`, (await call(u, m, PI(lab) + p, b)).s]);
    }
    for (const [m, p, b] of [["PUT", `/metrics/${bMetric.id}`, { name: "n" }], ["DELETE", `/metrics/${bMetric.id}`, undefined], ["POST", "/entries", { metric_id: bMetric.id, year: 2026, month: 1, value: 1 }], ["POST", `/metrics/${bMetric.id}/report`, {}], ["POST", "/metrics", { department_id: bDept.id, name: "n" }]] as const) {
      refusals.push([`sister editor through lab A ${m} ${p}`, (await call(EDITOR, m, PI(A) + p, b)).s]);
      refusals.push([`sister editor on the older route ${m} ${p}`, (await call(EDITOR, m, "/api/pi" + p, b, A)).s]);
    }
    check("4. every write and report by someone outside the laboratory is refused, and nothing moved", refusals.every(([, s]) => s === 403 || s === 404) && count() === frozen, refusals.filter(([, s]) => s !== 403 && s !== 404).map(String).join(" | "));
    const viewOnly = await call(SCAN_ONLY, "POST", `${PI(A)}/entries`, { metric_id: metric.id, year: 2026, month: 1, value: 1 });
    check("4. a seat without VeritaQA edit can't enter a result", viewOnly.s === 403, `${viewOnly.s}`);
    const sup = [await call(SUPPORT, "POST", `${PI(A)}/entries`, { metric_id: metric.id, year: 2026, month: 1, value: 1 }), await call(SUPPORT, "DELETE", `${PI(A)}/metrics/${metric.id}`), await call(SUPPORT, "POST", `${PI(A)}/plan/reviews`, { plan_id: 1, reviewed_by: "x", review_date: "2026-01-01" }), await call(SUPPORT, "POST", `${PI(A)}/metrics/${metric.id}/assign`, {})];
    check("4. a support login can't enter results, delete them, record a leadership review or assign an indicator", sup.every((r) => r.s === 403 && r.j.code === "VLS_SUPPORT_CANNOT_SIGN"), sup.map((r) => r.s).join(","));
    const save = await call(EDITOR, "POST", `${PI(A)}/entries`, { metric_id: metric.id, year: 2026, month: 3, value: 4.2, volume: 500, notes: "Courier delay" });
    const again = await call(EDITOR, "POST", `${PI(A)}/entries`, { metric_id: metric.id, year: 2026, month: 3, value: 4.2, volume: 500, notes: "Courier delay" });
    const fixed = await call(EDITOR, "POST", `${PI(A)}/entries`, { metric_id: metric.id, year: 2026, month: 3, value: 3.6, volume: 500, notes: "Courier delay" });
    const trail = audits("pi_entry", save.j.id);
    check("4. a result carries the laboratory and is in the audit trail with before and after, once per change", save.s === 200 && save.j.lab_id === A && again.s === 200 && fixed.j.value === 3.6 && trail.length === 2 && trail[0].action === "create" && JSON.parse(trail[1].before_json).value === 4.2 && JSON.parse(trail[1].after_json).value === 3.6 && trail[1].user_id === EDITOR.id && trail[1].module === "veritaqa", JSON.stringify(trail.map((t) => t.action)));
    check("4. routes nothing calls are gone", [(await call(OWNER, "PUT", `/api/pi/departments/${dept.id}`, { name: "x" })).s, (await call(OWNER, "DELETE", `/api/pi/departments/${dept.id}`)).s, (await call(OWNER, "DELETE", `/api/pi/entries/${save.j.id}`)).s].every((s) => s === 404));

    // 5. Assigning an account-wide indicator. THREE owns T1, T2, T3; THREE_SEAT works in T2.
    const before5 = await call(as(U.THREE_SEAT), "GET", `${PI(L.T2)}/metrics?department_id=all`);
    check("5. before: the seat in the second laboratory sees the account-wide indicator", ids(before5.j).includes(9511));
    const preview = await call(as(U.THREE), "GET", `${PI(L.T1)}/metrics/9511/assign`);
    check("5. the preview names what moves", preview.s === 200 && preview.j.name === `Hemolysis rate ${U.THREE}` && preview.j.lab_name === "Made-up Three One" && preview.j.entries === 4 && preview.j.first === "2025-12" && preview.j.last === "2026-05" && preview.j.other_labs === 2, JSON.stringify(preview.j));
    const stale = await call(as(U.THREE), "POST", `${PI(L.T1)}/metrics/9511/assign`, { expected_entries: 3 });
    check("5. a count that has moved on is refused", stale.s === 409 && stale.j.code === "COUNT_CHANGED" && one("SELECT lab_id FROM pi_metrics WHERE id = 9511").lab_id === null);
    const outsider = [await call(as(U.OTHER), "POST", `${PI(L.OTHER)}/metrics/9511/assign`, { expected_entries: 4 }), await call(as(U.THREE_SEAT), "POST", `${PI(L.T1)}/metrics/9511/assign`, { expected_entries: 4 })];
    check("5. nobody outside the account, and no seat of another laboratory, assigns it", outsider[0].s === 404 && outsider[1].s === 403, outsider.map((r) => r.s).join());
    const own = await call(as(U.ADMIN), "POST", `${PI(L.A)}/metrics/9551/assign`, { expected_entries: 4 });
    check("5. a person's own account-wide rows (their account owns no laboratory) go to one they can edit", own.s === 200 && own.j.lab_id === L.A && own.j.account_id === U.ONE);
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'admin', '{}', 'active', 0, ?, ?, ?)").run(L.A, U.THREE, w.now, w.now, w.now);
    const crossed = await call(as(U.THREE), "POST", `${PI(L.A)}/metrics/9512/assign`, { expected_entries: 2 });
    check("5. an account that owns laboratories can't hand its indicator to another customer's", crossed.s === 409 && crossed.j.code === "OTHER_ACCOUNT", `${crossed.s} ${crossed.j?.code}`);
    sqlite.prepare("DELETE FROM lab_members WHERE lab_id = ? AND user_id = ?").run(L.A, U.THREE);
    const done = await call(as(U.THREE), "POST", `${PI(L.T1)}/metrics/9511/assign`, { expected_entries: 4 });
    const moved = one("SELECT * FROM pi_metrics WHERE id = 9511"), movedDept = one("SELECT * FROM pi_departments WHERE id = ?", moved.department_id);
    check("5. it moves to the laboratory with its entries, under the laboratory's own department of that name", done.s === 200 && moved.lab_id === L.T1 && movedDept.lab_id === L.T1 && movedDept.name === "Chemistry" && one("SELECT COUNT(*) AS n FROM pi_entries WHERE metric_id = 9511 AND lab_id = ?", L.T1).n === 4 && one("SELECT COUNT(*) AS n FROM pi_entries WHERE metric_id = 9511").n === 4);
    check("5. one audit row says what moved", audits("pi_metric_assign", 9511).length === 1 && JSON.parse(audits("pi_metric_assign", 9511)[0].after_json).entries === 4);
    const t1 = await call(as(U.THREE), "GET", `${PI(L.T1)}/metrics?department_id=all`), t2 = await call(as(U.THREE), "GET", `${PI(L.T2)}/metrics?department_id=all`), seat2 = await call(as(U.THREE_SEAT), "GET", `${PI(L.T2)}/metrics?department_id=all`);
    const seatOld = await call(as(U.THREE_SEAT), "GET", "/api/pi/metrics?department_id=all"), seatRead = await call(as(U.THREE_SEAT), "POST", `/api/pi/metrics/9511/report`, {});
    check("5. the laboratory keeps it; the others, and a seat in another one, no longer see it", ids(t1.j).includes(9511) && !ids(t2.j).includes(9511) && !ids(seat2.j).includes(9511) && !ids(seatOld.j).includes(9511) && seatRead.s === 404 && ids(t2.j).length === 4);
    check("5. its own entries are the same numbers", JSON.stringify((await call(as(U.THREE), "GET", `${PI(L.T1)}/entries?year=2026&department_id=all`)).j.filter((e: any) => e.metric_id === 9511).map((e: any) => e.value)) === "[1.5,3.5,2.5]");
    check("5. it can't be assigned twice", (await call(as(U.THREE), "POST", `${PI(L.T2)}/metrics/9511/assign`, { expected_entries: 4 })).s === 404 && (await call(as(U.THREE), "POST", `${PI(L.T1)}/metrics/9511/assign`, { expected_entries: 4 })).j.code === "ALREADY_ASSIGNED");
    const added = (await call(as(U.THREE), "POST", `${PI(L.T2)}/metrics`, { department_id: 9512, name: "New in T2" })).j;
    check("5. an indicator added under an account-wide department goes to the laboratory's own department", added.lab_id === L.T2 && one("SELECT lab_id FROM pi_departments WHERE id = ?", added.department_id).lab_id === L.T2 && !ids((await call(as(U.THREE), "GET", `${PI(L.T1)}/metrics?department_id=all`)).j).includes(added.id));
    sqlite.prepare("UPDATE labs SET owner_user_id = ? WHERE id = ?").run(U.OTHER, L.T1);
    check("5. a laboratory that changes hands keeps its indicators, and the account-wide ones stay with the old account", (await call(as(U.THREE), "GET", `${PI(L.T1)}/metrics?department_id=all`)).j.some((m: any) => m.id === 9511) && !qaMetricsFor(U.OTHER).includes(9512) && qaMetricsFor(U.OTHER).includes(9511));
    function qaMetricsFor(owner: number): number[] { return all("SELECT m.id FROM pi_metrics m JOIN pi_departments d ON d.id = m.department_id WHERE m.lab_id = ? OR (m.lab_id IS NULL AND m.account_id = ?)", L.T1, owner).map((r) => r.id); }
    sqlite.prepare("UPDATE labs SET owner_user_id = ? WHERE id = ?").run(U.THREE, L.T1);

    // 6. The plan.
    const wide = await call(as(U.THREE), "GET", `${PI(L.T1)}/plan`);
    check("6. with no plan of its own, a laboratory reads the account-wide one, labelled", wide.j.plan.title === "Three lab plan" && wide.j.plan.scope === "account" && wide.j.can_start_lab_plan === true && wide.j.priorities.length === 1);
    const started = await call(as(U.THREE), "POST", `${PI(L.T1)}/plan/start`, { title: "T1 plan" });
    const t1Plan = await call(as(U.THREE), "GET", `${PI(L.T1)}/plan`), t2Plan = await call(as(U.THREE), "GET", `${PI(L.T2)}/plan`), both = await call(as(U.THREE), "GET", `${PI(L.T1)}/plan?scope=account`);
    check("6. starting its own copies nothing and leaves the account-wide one where it was", started.s === 201 && t1Plan.j.plan.title === "T1 plan" && t1Plan.j.plan.scope === "lab" && t1Plan.j.priorities.length === 0 && t2Plan.j.plan.title === "Three lab plan" && both.j.plan.title === "Three lab plan" && t1Plan.j.plans.length === 2);
    check("6. one plan of its own per laboratory", (await call(as(U.THREE), "POST", `${PI(L.T1)}/plan/start`, {})).j.code === "LAB_HAS_PLAN");
    const prio = await call(as(U.THREE), "POST", `${PI(L.T1)}/plan/priorities`, { plan_id: started.j.id, process_name: "Critical calls" });
    const rev = await call(as(U.THREE), "POST", `${PI(L.T1)}/plan/reviews`, { plan_id: started.j.id, reviewed_by: "Made-up Director", review_date: "2026-02-28" });
    check("6. its priorities and reviews carry the laboratory; a sister laboratory can't reach them", prio.j.lab_id === L.T1 && rev.j.lab_id === L.T1 && rev.j.next_review_due === "2027-02-28" && (await call(as(U.THREE_SEAT), "PUT", `${PI(L.T2)}/plan/priorities/${prio.j.id}`, { goal: "x" })).s === 404 && (await call(as(U.THREE_SEAT), "POST", `${PI(L.T2)}/plan/reviews`, { plan_id: started.j.id, reviewed_by: "x", review_date: "2026-01-01" })).s === 404);
    const newPlan = await call(OWNER, "PUT", `${PI(A)}/plan`, { title: "Lab A plan" });
    check("6. a laboratory with no plan at all makes its own", newPlan.j.lab_id === A && (await call(OWNER, "GET", `${PI(LB)}/plan`)).j.plan === null);

    // 7. The organization's indicators. A and B belong to it; X does not.
    const ORGQ = "/api/org-quality";
    const def = { organizationId: ORG, name: "Corrected reports", definition: "Reports corrected after release.", numerator_text: "Corrected reports", denominator_text: "Reports released", kind: "percent", target: 1, direction: "lower_is_better", frequency: "monthly", department: "Reporting" };
    const whoNot = [await call(OWNER, "POST", `${ORGQ}/indicators`, def), await call(EDITOR, "POST", `${ORGQ}/indicators`, def), await call(OTHER, "POST", `${ORGQ}/indicators`, def), await call(SUPPORT, "POST", `${ORGQ}/indicators`, def), await call(LEADER, "POST", `${ORGQ}/indicators`, { ...def, organizationId: 999999 })];
    check("7. only the organization's owner or admin defines one; everyone else gets the same refusal, whatever the id", whoNot.every((r) => r.s === 403 && r.j.code === "SYSTEM_LEADER_ONLY") && one("SELECT COUNT(*) AS n FROM org_quality_indicators").n === 0, whoNot.map((r) => `${r.s} ${r.j?.code}`).join());
    const bads = [await call(LEADER, "POST", `${ORGQ}/indicators`, { ...def, name: "" }), await call(LEADER, "POST", `${ORGQ}/indicators`, { ...def, denominator_text: "" }), await call(LEADER, "POST", `${ORGQ}/indicators`, { ...def, kind: "bogus" }), await call(LEADER, "POST", `${ORGQ}/indicators`, { ...def, definition: ["M", "RN 00123456"].join("") }), await call(LEADER, "POST", `${ORGQ}/indicators`, { ...def, department: "" })];
    check("7. a definition needs a name, a department, what is counted and a known kind, and no patient information", JSON.stringify(bads.map((r) => r.j.code)) === JSON.stringify(["NAME_REQUIRED", "DENOMINATOR_REQUIRED", "BAD_VALUE", "PHI_REFUSED", "DEPARTMENT_REQUIRED"]), JSON.stringify(bads.map((r) => r.j.code)));
    const made = await call(LEADER, "POST", `${ORGQ}/indicators`, def);
    const IND = made.j.id;
    check("7. defined, and on in no laboratory", made.s === 201 && one("SELECT COUNT(*) AS n FROM pi_metrics WHERE org_indicator_id IS NOT NULL").n === 0 && audits("org_quality_indicator", IND).length === 1);
    const notOurs = await call(LEADER, "PUT", `${ORGQ}/indicators/${IND}/labs`, { labIds: [A, X] });
    check("7. only laboratories of the organization", notOurs.s === 400 && notOurs.j.code === "LAB_NOT_ELIGIBLE" && JSON.stringify(notOurs.j.labIds) === JSON.stringify([X]) && one("SELECT COUNT(*) AS n FROM org_quality_indicator_labs").n === 0);
    check("7. a laboratory's owner can't turn it on or change it: the same 404 as an id that doesn't exist", (await call(OWNER, "PUT", `${ORGQ}/indicators/${IND}/labs`, { labIds: [A] })).s === 404 && (await call(OWNER, "PUT", `${ORGQ}/indicators/${IND}`, { target: 9 })).s === 404 && (await call(LEADER, "PUT", `${ORGQ}/indicators/999999`, {})).s === 404);
    const turned = await call(LEADER, "PUT", `${ORGQ}/indicators/${IND}/labs`, { labIds: [A, LB] });
    const mA = one("SELECT * FROM pi_metrics WHERE org_indicator_id = ? AND lab_id = ?", IND, A), mB = one("SELECT * FROM pi_metrics WHERE org_indicator_id = ? AND lab_id = ?", IND, LB);
    check("7. turned on: one row in each laboratory, in its own department of that name, beside its own indicators", turned.s === 200 && JSON.stringify(turned.j.turned_on.sort()) === JSON.stringify([A, LB].sort()) && mA.name === "Corrected reports" && one("SELECT name, lab_id FROM pi_departments WHERE id = ?", mA.department_id).name === "Reporting" && ids((await call(EDITOR, "GET", `${PI(A)}/metrics?department_id=all`)).j).includes(metric.id));
    const locked = [await call(OWNER, "PUT", `${PI(A)}/metrics/${mA.id}`, { benchmark_green: 50 }), await call(OWNER, "DELETE", `${PI(A)}/metrics/${mA.id}`), await call(OWNER, "PUT", `/api/pi/metrics/${mA.id}`, { benchmark_green: 50 }, A)];
    check("7. a laboratory can't change or delete it", locked.every((r) => r.s === 409 && r.j.code === "ORG_DEFINED"), locked.map((r) => r.s).join());
    const thisYm = new Date().toISOString().slice(0, 7), [cy, cm] = thisYm.split("-").map(Number);
    const enter = (who: any, lab: number, m: any, year: number, month: number, numerator: any, denominator: any) => call(who, "POST", `${PI(lab)}/entries`, { metric_id: m.id, year, month, numerator, denominator, notes: null });
    const badEntries = [await enter(EDITOR, A, mA, cy, cm, "", 100), await enter(EDITOR, A, mA, cy, cm, 1, 0), await enter(EDITOR, A, mA, cy, cm, 101, 100), await enter(EDITOR, A, mA, cy, cm, -1, 100)];
    check("7. it takes a numerator and a denominator above 0, the numerator no larger", JSON.stringify(badEntries.map((r) => r.j.code)) === JSON.stringify(["NUMERATOR_REQUIRED", "DENOMINATOR_REQUIRED", "NUMERATOR_TOO_LARGE", "NUMERATOR_REQUIRED"]), JSON.stringify(badEntries.map((r) => r.j.code)));
    const typed = await call(EDITOR, "POST", `${PI(A)}/entries`, { metric_id: mA.id, year: cy, month: cm, value: 0.1, numerator: 3, denominator: 200 });
    check("7. the value is worked out, never taken from the request", typed.j.value === 1.5 && typed.j.numerator === 3 && typed.j.denominator === 200 && typed.j.entry_kind === "percent" && typed.j.target_value === 1 && typed.j.org_version === 1, JSON.stringify(typed.j));
    const past = await call(LEADER, "PUT", `${ORGQ}/indicators/${IND}`, { target: 2, effective_from: "2020-01" });
    const nothing = await call(LEADER, "PUT", `${ORGQ}/indicators/${IND}`, { effective_from: thisYm });
    check("7. a change starts this month or later and has to change something", past.j.code === "MONTH_PAST" && nothing.j.code === "NO_CHANGE");
    const v2 = await call(LEADER, "PUT", `${ORGQ}/indicators/${IND}`, { target: 2, effective_from: thisYm });
    const kept = one("SELECT * FROM pi_entries WHERE id = ?", typed.j.id);
    const correction = await enter(EDITOR, A, mA, cy, cm, 4, 200);
    const fresh = await enter(OWNER, LB, mB, cy, cm, 3, 200);
    check("7. a new version says when it starts; an entry on file, and a correction to it, keep the target it was entered under; a new one takes the new target", v2.j.version === 2 && v2.j.effective_from === thisYm && kept.target_value === 1 && correction.j.target_value === 1 && correction.j.org_version === 1 && correction.j.value === 2 && fresh.j.target_value === 2 && fresh.j.org_version === 2, JSON.stringify([kept.target_value, correction.j, fresh.j?.target_value]));
    const nextYm = cm === 12 ? `${cy + 1}-01` : `${cy}-${String(cm + 1).padStart(2, "0")}`;
    const v3 = await call(LEADER, "PUT", `${ORGQ}/indicators/${IND}`, { target: 5, name: "Corrected reports (all)", effective_from: nextYm });
    const early = await call(LEADER, "PUT", `${ORGQ}/indicators/${IND}`, { target: 6, effective_from: thisYm });
    const shownA = (await call(EDITOR, "GET", `${PI(A)}/metrics?department_id=all`)).j.find((m: any) => m.id === mA.id);
    check("7. a change dated ahead waits for its month, and nothing is slipped in before it", v3.s === 200 && early.j.code === "MONTH_BEFORE_LAST" && shownA.name === "Corrected reports" && shownA.benchmark_green === 2 && shownA.org.versions.length === 3 && shownA.org.version === 2);
    const ahead = await enter(EDITOR, A, mA, Number(nextYm.slice(0, 4)), Number(nextYm.slice(5)), 9, 200);
    check("7. an entry takes the version of its own month", ahead.j.target_value === 5 && ahead.j.org_version === 3);
    const dash = (await call(EDITOR, "GET", `${PI(A)}/dashboard?year=${cy}&department_id=all`)).j.metrics.find((x: any) => x.metric.id === mA.id);
    check("7. the dashboard reads each month against its own target, and the year adds up the counts", dash.monthlyValues[cm].status === "red" && dash.monthlyValues[cm].value === 2 && (nextYm.slice(0, 4) !== String(cy) || dash.ytdAvg === (13 / 400) * 100), JSON.stringify(dash).slice(0, 400));
    const defAudit = audits("org_quality_indicator", IND);
    check("7. each change is in the audit trail with before and after", defAudit.length === 3 && JSON.parse(defAudit[1].before_json).target === 1 && JSON.parse(defAudit[1].after_json).target === 2 && defAudit[1].user_id === LEADER.id);
    // Quarterly, and a count.
    const quarterly = (await call(LEADER, "POST", `${ORGQ}/indicators`, { ...def, name: "Phlebotomy complaints", kind: "count", numerator_text: "Complaints", denominator_text: null, target: 3, frequency: "quarterly", department: "Phlebotomy" })).j.id;
    await call(LEADER, "PUT", `${ORGQ}/indicators/${quarterly}/labs`, { labIds: [A, LB] });
    const qA = one("SELECT * FROM pi_metrics WHERE org_indicator_id = ? AND lab_id = ?", quarterly, A), qB = one("SELECT * FROM pi_metrics WHERE org_indicator_id = ? AND lab_id = ?", quarterly, LB);
    const wrongMonth = await enter(EDITOR, A, qA, 2026, 2, 1, null), rightMonth = await enter(EDITOR, A, qA, 2026, 3, 4, null);
    check("7. a quarterly one is entered in the quarter's last month; a count takes its count alone", wrongMonth.j.code === "WRONG_MONTH" && rightMonth.s === 200 && rightMonth.j.value === 4 && rightMonth.j.denominator === null);
    // Off, and on again.
    const off = await call(LEADER, "PUT", `${ORGQ}/indicators/${quarterly}/labs`, { labIds: [LB] });
    const entryOff = await enter(EDITOR, A, qA, 2026, 6, 1, null);
    check("7. turned off: its entries are kept and it takes no more", JSON.stringify(off.j.turned_off) === JSON.stringify([A]) && one("SELECT COUNT(*) AS n FROM pi_entries WHERE metric_id = ?", qA.id).n === 1 && entryOff.s === 409 && entryOff.j.code === "INDICATOR_OFF" && one("SELECT active FROM pi_metrics WHERE id = ?", qA.id).active === 0);
    await call(LEADER, "PUT", `${ORGQ}/indicators/${quarterly}/labs`, { labIds: [A, LB] });
    check("7. turned on again: the same row with its entries", one("SELECT COUNT(*) AS n FROM pi_metrics WHERE org_indicator_id = ? AND lab_id = ?", quarterly, A).n === 1 && one("SELECT active FROM pi_metrics WHERE id = ?", qA.id).active === 1 && (await enter(EDITOR, A, qA, 2026, 6, 2, null)).s === 200 && audits("org_quality_indicator_lab", quarterly).length === 4);

    // 8. The report across laboratories.
    const repDef = async (name: string, extra: any = {}) => {
      const id = (await call(LEADER, "POST", `${ORGQ}/indicators`, { ...def, name, ...extra })).j.id;
      await call(LEADER, "PUT", `${ORGQ}/indicators/${id}/labs`, { labIds: [A, LB] });
      const of = (lab: number) => one("SELECT * FROM pi_metrics WHERE org_indicator_id = ? AND lab_id = ?", id, lab);
      return { id, a: of(A), b: of(LB) };
    };
    const sums = await repDef("Contaminated cultures", { department: "Microbiology", target: 3 });
    await enter(EDITOR, A, sums.a, 2025, 1, 1, 10); await enter(EDITOR, A, sums.a, 2025, 2, 1, 90);
    await enter(OWNER, LB, sums.b, 2025, 1, 30, 1000);
    const q1 = (u: any, extra = "") => call(u, "GET", `${ORGQ}/report?organizationId=${ORG}&period=quarter&year=2025&quarter=1${extra}`);
    const r8 = (await q1(LEADER)).j;
    const s8 = r8.indicators.find((i: any) => i.id === sums.id), rowA = s8.rows.find((x: any) => x.lab_id === A), rowB = s8.rows.find((x: any) => x.lab_id === LB);
    check("8. a laboratory's quarter is the sum of numerators over the sum of denominators (2 of 100, not the average of 10% and 1.1%)", rowA.result.numerator === 2 && rowA.result.denominator === 100 && rowA.result.value === 2 && rowA.result.met === true && rowA.result_text === "Met" && rowA.result.entered === 2 && rowA.result.expected === 3, JSON.stringify(rowA));
    check("8. the total is the sum across laboratories (32 of 1,100 = 2.909%), never an average of percents", s8.total.shown && s8.total.numerator === 32 && s8.total.denominator === 1100 && Math.abs(s8.total.value - 2.9090909) < 1e-6 && s8.total.labs_counted === 2, JSON.stringify(s8.total));
    check("8. a laboratory at 3% against at most 3 is met; the result follows its own numbers", rowB.result.value === 3 && rowB.result.met === true);
    const feb = (await call(LEADER, "GET", `${ORGQ}/report?organizationId=${ORG}&period=month&year=2025&month=2`)).j.indicators.find((i: any) => i.id === sums.id);
    const febB = feb.rows.find((x: any) => x.lab_id === LB);
    check("8. nothing entered reads No entry: no value, neither met nor missed, and left out of the total", febB.result.state === "no_entry" && febB.result.value === null && febB.result.met === null && febB.result_text === "No entry" && feb.total.labs_counted === 1 && feb.total.numerator === 1 && feb.total.denominator === 90);
    const none = (await call(LEADER, "GET", `${ORGQ}/report?organizationId=${ORG}&period=year&year=2024`)).j.indicators.find((i: any) => i.id === sums.id);
    check("8. a period nobody entered: no total, and it says so", none.total.shown === false && none.total.reason === "No entries in this period." && none.rows.every((x: any) => x.result_text === "No entry"));
    const ytd = (await call(LEADER, "GET", `${ORGQ}/report?organizationId=${ORG}&period=ytd&year=2025&month=1`)).j.indicators.find((i: any) => i.id === sums.id);
    const yr = (await call(LEADER, "GET", `${ORGQ}/report?organizationId=${ORG}&period=year&year=2025`)).j.indicators.find((i: any) => i.id === sums.id);
    check("8. year to date and year add the same way", ytd.total.numerator === 31 && ytd.total.denominator === 1010 && yr.total.numerator === 32 && yr.rows[0].result.expected === 12);
    sqlite.prepare("UPDATE pi_entries SET entry_kind = 'per_1000', entry_unit = 'per 1,000' WHERE metric_id = ?").run(sums.b.id);
    const mixed = (await q1(LEADER)).j.indicators.find((i: any) => i.id === sums.id);
    check("8. laboratories that entered different kinds are not totaled, with the reason; each keeps its own number", mixed.total.shown === false && /different kinds/.test(mixed.total.reason) && mixed.rows.every((x: any) => x.result.value != null));
    sqlite.prepare("UPDATE pi_entries SET entry_kind = 'percent', entry_unit = '%' WHERE metric_id = ?").run(sums.b.id);
    sqlite.prepare("UPDATE pi_entries SET target_value = 9 WHERE metric_id = ? AND month = 2").run(sums.a.id);
    const twoTargets = (await q1(LEADER)).j.indicators.find((i: any) => i.id === sums.id).rows.find((x: any) => x.lab_id === A);
    check("8. a target that changed inside the period is not judged, and says so", twoTargets.result.met === null && twoTargets.result_text === "Not judged" && twoTargets.result.note === "The target changed during the period." && twoTargets.result.value === 2);
    sqlite.prepare("UPDATE pi_entries SET target_value = 3 WHERE metric_id = ?").run(sums.a.id);
    const counts = (await call(LEADER, "GET", `${ORGQ}/report?organizationId=${ORG}&period=year&year=2026`)).j.indicators.find((i: any) => i.id === quarterly);
    const cA = counts.rows.find((x: any) => x.lab_id === A);
    check("8. a count adds up, and several entries aren't judged against a one-entry target", cA.result.value === 6 && cA.result.met === null && /one entry/.test(cA.result.note) && counts.total.value === 6 && cA.result.expected === 4);
    const groupA = (await call(LEADER, "POST", "/api/rollup-groups", { name: "North", kind: "region", organizationId: ORG, labIds: [LB] })).j.id;
    const grouped = (await q1(LEADER, `&groupId=${groupA}`)).j;
    check("8. a group takes laboratories away, and its total is theirs", grouped.labs.length === 1 && grouped.group.name === "North" && grouped.indicators.find((i: any) => i.id === sums.id).total.denominator === 1000);
    const byDept = (await q1(LEADER, "&department=Microbiology")).j;
    check("8. a department filter", byDept.indicators.length === 1 && byDept.indicators[0].id === sums.id && byDept.departments.includes("Reporting"));
    const strangers = await Promise.all([OWNER, EDITOR, ADMIN_A, OTHER, SUPPORT, VIEWER, STAFF].map((u) => q1(u)));
    check("8. a laboratory's owner, its members, another customer and support get the same refusal", strangers.every((r) => r.s === 403 && r.j.code === "SYSTEM_LEADER_ONLY"), strangers.map((r) => r.s).join());
    const files = await Promise.all(([OWNER, OTHER, SUPPORT] as any[]).flatMap((u) => ["pdf", "xlsx"].map((k) => call(u, "POST", `${ORGQ}/report/${k}`, { organizationId: ORG, period: "quarter", year: 2025, quarter: 1 }))));
    check("8. ... and so do its PDF and workbook", files.every((r) => r.s === 403));
    const ORG2 = w.seed("organizations", { name: "Made-up Other System", billing_owner_user_id: OTHER.id, plan: "enterprise" });
    sqlite.prepare("UPDATE labs SET organization_id = ? WHERE id = ?").run(ORG2, X);
    const LEAD2 = await w.login("leader2", "Lou Leader"); w.seed("organization_members", { organization_id: ORG2, user_id: LEAD2.id, org_role: "org_owner", status: "active" });
    const cross = [await q1(LEAD2), await call(LEAD2, "PUT", `${ORGQ}/indicators/${IND}`, { target: 99 }), await call(LEAD2, "PUT", `${ORGQ}/indicators/${IND}/labs`, { labIds: [] })];
    const theirs = (await call(LEAD2, "GET", `${ORGQ}/overview`)).j;
    check("8. another system's leader reads and changes nothing here", cross[0].s === 403 && cross[1].s === 404 && cross[2].s === 404 && theirs.organizations.length === 1 && theirs.organizations[0].id === ORG2 && theirs.organizations[0].indicators.length === 0 && !JSON.stringify(theirs).includes("Contaminated"));
    sqlite.prepare("UPDATE organization_members SET status = 'deactivated' WHERE user_id = ?").run(LEAD2.id);
    check("8. a deactivated organization admin is refused", (await call(LEAD2, "GET", `${ORGQ}/overview`)).s === 403);
    sqlite.prepare("UPDATE labs SET organization_id = NULL WHERE id = ?").run(LB);
    const left = await enter(OWNER, LB, sums.b, 2025, 3, 1, 10);
    check("8. a laboratory that leaves the organization is out of its report and takes no more of its numbers", (await q1(LEADER)).j.labs.length === 1 && left.j.code === "INDICATOR_OFF" && one("SELECT COUNT(*) AS n FROM pi_entries WHERE metric_id = ?", sums.b.id).n === 1);
    sqlite.prepare("UPDATE labs SET organization_id = ? WHERE id = ?").run(ORG, LB);

    // 9. Files: words of the PDF (PyMuPDF, python -E) and the workbook's cells.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qalab-"));
    const file = async (who: any, url: string, body: any) => {
      const t = await call(who, "POST", url, body);
      const r = await call(null, "GET", `/api/pdf/${t.j?.token}`);
      return { s: t.s, name: t.j?.filename as string, buf: r.buf };
    };
    const words = (buf: Buffer) => {
      const f = path.join(tmp, `r${Date.now()}${Math.random()}.pdf`);
      fs.writeFileSync(f, buf);
      return execFileSync("python", ["-E", "-c", "import sys, fitz\nsys.stdout.reconfigure(encoding='utf-8')\nd = fitz.open(sys.argv[1])\nprint(d.metadata.get('author'))\nprint(' '.join(p.get_text() for p in d))", f]).toString("utf8").replace(/\s+/g, " ");
    };
    const cells = async (buf: Buffer) => {
      const { default: ExcelJS } = await import("exceljs");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as any);
      return { names: wb.worksheets.map((s) => s.name), rows: (n: string) => { const out: any[][] = []; wb.getWorksheet(n)!.eachRow((r) => out.push((r.values as any[]).slice(1))); return out; }, protectedAll: wb.worksheets.every((s) => !!(s as any).sheetProtection) };
    };
    const body = { organizationId: ORG, period: "month", year: 2025, month: 2 };
    const sysPdf = await file(LEADER, `${ORGQ}/report/pdf`, body), sysWords = words(sysPdf.buf);
    check("9. the system PDF: the organization, the period, each laboratory, No entry, the footer, the author, no signature line and no em dash",
      sysPdf.s === 200 && sysPdf.name === "VeritaQA_System_Report_Made-up_System_2025-02.pdf" && /^Perplexity Computer/.test(sysWords) && /Made-up System, 2 laboratories/.test(sysWords) && /February 2025/.test(sysWords) && /Contaminated cultures/.test(sysWords) && /Made-up Lab A/.test(sysWords) && /Made-up Lab B/.test(sysWords) && /No entry/.test(sysWords) && /VeritaAssure® \| VeritaQA™ \| Confidential, For Internal Lab Use Only \| Page 1 of/.test(sysWords) && !/Signature|benchmark/i.test(sysWords) && !/[–—]/.test(sysWords), sysWords.slice(0, 500));
    const sysX = await file(LEADER, `${ORGQ}/report/xlsx`, body), sysWb = await cells(sysX.buf);
    const bRow = sysWb.rows("By laboratory").find((r) => r[0] === "Contaminated cultures" && r[1] === "Made-up Lab B")!, aRow = sysWb.rows("By laboratory").find((r) => r[0] === "Contaminated cultures" && r[1] === "Made-up Lab A")!;
    const totalRow = sysWb.rows("Totals").find((r) => r[0] === "Contaminated cultures")!;
    check("9. the system workbook: About first, a row for each laboratory, No entry with blank numbers, the total from the sums", JSON.stringify(sysWb.names) === JSON.stringify(["About", "By laboratory", "Totals", "Definitions"]) && sysWb.protectedAll && aRow[4] === 1 && aRow[5] === 90 && aRow[6] === 1.11 && aRow[9] === "Met" && bRow[4] == null && bRow[6] == null && bRow[9] === "No entry" && totalRow[4] === 1 && totalRow[5] === 90 && totalRow[6] === 1.11, JSON.stringify([aRow, bRow, totalRow]));
    const rep = (period: string) => call(EDITOR, "GET", `${PI(A)}/report?${period}`);
    const march = (await rep("period=month&year=2026&month=3")).j, q126 = (await rep("period=quarter&year=2026&quarter=1")).j, y25 = (await rep("period=year&year=2025")).j;
    const find = (r: any, id: number) => r.sections.flatMap((s: any) => s.departments.flatMap((d: any) => d.rows)).find((x: any) => x.metric_id === id);
    check("9. the laboratory's month: every indicator with its value, its result, or No entry", find(march, metric.id).result_text === "Missed" && find(march, metric.id).months[0].value === 3.6 && find(march, sums.a.id).result_text === "No entry" && find(march, qA.id).result_text === "Missed" && march.counts.indicators >= 4, JSON.stringify(march.counts));
    check("9. the quarter lists months and never averages a value entered alone", find(q126, metric.id).period === null && find(q126, metric.id).period_text === "" && find(q126, metric.id).months.length === 3 && find(q126, metric.id).result_text === "Met 0 of 1");
    check("9. the year adds up an indicator entered as a numerator and a denominator", find(y25, sums.a.id).period.numerator === 2 && find(y25, sums.a.id).period.denominator === 100 && find(y25, sums.a.id).period_text === "2%" && find(y25, sums.a.id).months.length === 12);
    check("9. a bad period is refused", (await rep("period=ytd&year=2026&month=3")).s === 400 && (await rep("period=month&year=2026&month=13")).s === 400);
    const threeReport = (await call(as(U.THREE), "GET", `${PI(L.T1)}/report?period=month&year=2026&month=1`)).j;
    check("9. account-wide indicators are in their own section, labelled, in a laboratory's report", threeReport.sections.length === 2 && threeReport.sections[1].title === "Account-wide, not assigned to a laboratory" && threeReport.sections[0].departments.flatMap((d: any) => d.rows).map((r: any) => r.metric_id).includes(9511) && threeReport.sections[1].departments.flatMap((d: any) => d.rows).map((r: any) => r.metric_id).includes(9512));
    const labPdf = await file(EDITOR, `${PI(A)}/report/pdf`, { period: "quarter", year: 2026, quarter: 1 }), labWords = words(labPdf.buf);
    check("9. the laboratory PDF: its name and CLIA line, the period, the footer, no signature line", labPdf.s === 200 && /Made-up Lab A/.test(labWords) && /CLIA:/.test(labWords) && /Quarter 1, 2026/.test(labWords) && /Hemolyzed specimens/.test(labWords) && /VeritaQA™ \| Confidential, For Internal Lab Use Only/.test(labWords) && !/Signature/i.test(labWords) && !/[–—]/.test(labWords), labWords.slice(0, 300));
    const labX = await file(EDITOR, `${PI(A)}/report/xlsx`, { period: "year", year: 2026 }), labWb = await cells(labX.buf);
    check("9. the laboratory workbook: About, Indicators, Months", JSON.stringify(labWb.names) === JSON.stringify(["About", "Indicators", "Months"]) && labWb.rows("Months").some((r) => r[0] === "Hemolyzed specimens" && r[1] === "2026-03" && r[3] === 3.6 && r[8] === "Missed"));
    const piPdf = await call(EDITOR, "POST", `${PI(A)}/metrics/${sums.a.id}/report?year=2025`, {});
    const piWords = words((await call(null, "GET", `/api/pdf/${piPdf.j.token}`)).buf);
    check("9. one indicator's PDF adds up the counts of an organization's indicator and prints no unweighted average", /Year to date, from 2 of 100: 2%/.test(piWords) && !/unweighted/.test(piWords), piWords.slice(0, 600));
    const widePdf = words((await call(null, "GET", `/api/pdf/${(await call(as(U.THREE), "POST", `${PI(L.T2)}/metrics/9512/report?year=2026`, {})).j.token}`)).buf);
    check("9. one account-wide indicator's PDF says so", /Account-wide, not assigned to a laboratory/.test(widePdf) && /Year-to-date average \(unweighted\)/.test(widePdf));

    // 10. Findings.
    const f1 = w.seed("findings", { user_id: OWNER.id, lab_id: A, accreditor: "CAP", finding_number: "F-1", standard_ref: "Made-up 1", status: "open", source_type: "inspection" });
    const fB = w.seed("findings", { user_id: OWNER.id, lab_id: LB, accreditor: "CAP", finding_number: "F-B", status: "open" });
    const nFindings = () => one("SELECT COUNT(*) AS n FROM findings").n;
    const findingsBefore = nFindings();
    const good = (await call(EDITOR, "POST", `${PI(A)}/entries`, { metric_id: metric.id, year: 2026, month: 4, value: 1.0 })).j;
    const options = await call(EDITOR, "GET", `${PI(A)}/entries/${save.j.id}/finding-options`);
    check("10. an editor sees this laboratory's VeritaResponse entries", options.s === 200 && options.j.some((x: any) => x.id === f1 && x.label === "CAP F-1 Made-up 1") && !options.j.some((x: any) => x.id === fB));
    const bad10 = [await call(EDITOR, "POST", `${PI(A)}/entries/${good.id}/findings`, { finding_id: f1 }), await call(EDITOR, "POST", `${PI(A)}/entries/${save.j.id}/findings`, { finding_id: fB }), await call(SCAN_ONLY, "POST", `${PI(A)}/entries/${save.j.id}/findings`, { finding_id: f1 }), await call(EDITOR, "POST", `${PI(LB)}/entries/${save.j.id}/findings`, { finding_id: f1 }), await call(SUPPORT, "POST", `${PI(A)}/entries/${save.j.id}/findings`, { finding_id: f1 }), await call(as(U.THREE), "POST", `${PI(L.T2)}/entries/${one("SELECT id FROM pi_entries WHERE metric_id = 9512 AND month = 1").id}/findings`, { finding_id: f1 })];
    check("10. not a month that met its target, not another laboratory's finding, not without edit, not a support login, not an account-wide indicator", JSON.stringify(bad10.map((r) => r.s)) === JSON.stringify([409, 404, 403, 403, 403, 409]) && bad10[0].j.code === "TARGET_NOT_MISSED" && bad10[5].j.code === "NOT_ASSIGNED" && one("SELECT COUNT(*) AS n FROM pi_finding_links").n === 0, JSON.stringify(bad10.map((r) => [r.s, r.j?.code])));
    const linked = await call(EDITOR, "POST", `${PI(A)}/entries/${save.j.id}/findings`, { finding_id: f1 });
    check("10. linked once, and nothing was opened", linked.s === 201 && (await call(EDITOR, "POST", `${PI(A)}/entries/${save.j.id}/findings`, { finding_id: f1 })).j.code === "ALREADY_LINKED" && nFindings() === findingsBefore);
    const side1 = (await call(EDITOR, "GET", `${PI(A)}/finding-links?year=2026`)).j, side2 = (await call(EDITOR, "GET", `/api/labs/${A}/findings/${f1}/indicators`)).j;
    check("10. it shows on the indicator's month and on the finding", side1.length === 1 && side1[0].entry_id === save.j.id && side1[0].label === "CAP F-1 Made-up 1" && side2.indicators.length === 1 && side2.indicators[0].name === "Hemolyzed specimens" && side2.indicators[0].month === 3 && side2.indicators[0].value_text === "3.6%" && side2.indicators[0].target_text === "At most 2%", JSON.stringify(side2));
    check("10. ... not to a Staff login, a view-only seat or another customer", [(await call(STAFF, "GET", `/api/labs/${A}/findings/${f1}/indicators`)).s, (await call(VIEWER, "GET", `/api/labs/${A}/findings/${f1}/indicators`)).s, (await call(OTHER, "GET", `/api/labs/${A}/findings/${f1}/indicators`)).s].every((s) => s === 403));
    const hist = (await call(OWNER, "GET", `/api/labs/${A}/findings/${f1}/history`)).j.events;
    check("10. the finding's history and the audit trail both say who linked it", hist[0].event === "indicator_linked" && hist[0].payload.name === "Hemolyzed specimens" && audits("pi_finding_link", linked.j.link_id).length === 1);
    check("10. the laboratory's report lists it", find((await rep("period=month&year=2026&month=3")).j, metric.id).months[0].findings[0].label === "CAP F-1 Made-up 1");
    await call(EDITOR, "POST", `${PI(A)}/entries`, { metric_id: metric.id, year: 2026, month: 3, value: 1.1, volume: 500 });
    check("10. a later correction leaves the link; unlinking leaves both records", (await call(EDITOR, "GET", `${PI(A)}/finding-links?year=2026`)).j.length === 1 && (await call(EDITOR, "DELETE", `${PI(A)}/entries/${save.j.id}/findings/${linked.j.link_id}`)).s === 200 && nFindings() === findingsBefore && one("SELECT value FROM pi_entries WHERE id = ?", save.j.id).value === 1.1);
    await call(EDITOR, "POST", `${PI(A)}/entries`, { metric_id: metric.id, year: 2026, month: 3, value: 8 });
    const l2 = await call(EDITOR, "POST", `${PI(A)}/entries/${save.j.id}/findings`, { finding_id: f1 });
    const orgMissed = await call(EDITOR, "POST", `${PI(A)}/entries/${typed.j.id}/findings`, { finding_id: f1 });
    check("10. an organization's indicator links too, by the target the month was entered under", l2.s === 201 && orgMissed.s === 201);
    const delMetric = await call(EDITOR, "DELETE", `${PI(A)}/metrics/${metric.id}`);
    check("10. deleting an indicator removes its links, and the finding's history says so", delMetric.s === 200 && one("SELECT COUNT(*) AS n FROM pi_finding_links WHERE metric_id = ?", metric.id).n === 0 && one("SELECT COUNT(*) AS n FROM finding_history WHERE finding_id = ? AND event = 'indicator_unlinked'", f1).n === 2 && JSON.parse(audits("pi_metric", metric.id).pop()!.before_json).entries.length === 2);
    const delFinding = await call(OWNER, "DELETE", `/api/labs/${A}/findings/${f1}`);
    check("10. deleting a finding removes its links", delFinding.s === 200 && one("SELECT COUNT(*) AS n FROM pi_finding_links").n === 0);

    // 11. Exports, the per-customer delete, the admin load, a deleted account.
    const { EXPORT_TABLES } = await import("../../server/exportAllTables");
    const { purgeRule } = await import("../../server/customerPurge");
    check("11. the laboratory's rows and the owner's account-wide ones are both in the laboratory's export and the customer's delete", VERITAQA_LAB_TABLES.every((t) => EXPORT_TABLES[t].scope.kind === "labOrOwner" && /lab_id IN .* OR \(lab_id IS NULL AND "account_id" IN/.test((purgeRule(t) as any).where)) && EXPORT_TABLES.pi_finding_links.scope.kind === "lab" && ["org_quality_indicators", "org_quality_indicator_versions", "org_quality_indicator_labs", "pi_finding_links"].every((t) => purgeRule(t)?.kind === "delete"));
    const adminLoad = async (owner: number, b: any) => { const r = await fetch(`${w.base}/api/admin/veritaqa/accounts/${owner}/load`, { method: "POST", headers: { "Content-Type": "application/json", "x-admin-secret": w.ADMIN }, body: JSON.stringify(b) }); return { s: r.status, j: await r.json() as any }; };
    const load = { expectedLabIds: [L.T1, L.T2, L.T3], apply: true, departments: [{ name: "Chemistry", metrics: [{ name: `Corrected reports ${U.THREE}`, unit: "%", direction: "higher_is_better", benchmark_green: 99 }, { name: "Loaded for T3", unit: "%", direction: "lower_is_better", benchmark_green: 5 }] }], plan: { title: "Loaded plan", effective_year: 2027 } };
    const loaded = await adminLoad(U.THREE, { ...load, labId: L.T3 });
    const loadedMetric = one("SELECT * FROM pi_metrics WHERE name = 'Loaded for T3'");
    check("11. an admin load can name the laboratory; what that laboratory already shows is not added again", loaded.s === 200 && loaded.j.labId === L.T3 && loaded.j.metricsAdded === 1 && loaded.j.metricsExisting === 1 && loadedMetric.lab_id === L.T3 && one("SELECT lab_id FROM pi_departments WHERE id = ?", loadedMetric.department_id).lab_id === L.T3 && loaded.j.planExisting === true && (await adminLoad(U.THREE, { ...load, labId: L.T3 })).j.metricsAdded === 0, JSON.stringify(loaded.j));
    check("11. a laboratory outside the list is refused", (await adminLoad(U.THREE, { ...load, labId: L.A })).s === 400);
    const { storage } = await import("../../server/storage");
    sqlite.prepare("UPDATE labs SET owner_user_id = ? WHERE id = ?").run(U.OTHER, L.REPO);
    (storage as any).deleteUser(U.REPO);
    check("11. deleting an account leaves the indicators of a laboratory someone else owns now, and takes its own", one("SELECT COUNT(*) AS n FROM pi_metrics WHERE lab_id = ?", L.REPO).n === 5);
    (storage as any).deleteUser(U.NOLAB);
    check("11. ... its own account-wide rows go", one("SELECT COUNT(*) AS n FROM pi_metrics WHERE account_id = ?", U.NOLAB).n === 0 && one("SELECT COUNT(*) AS n FROM pi_departments WHERE account_id = ?", U.NOLAB).n === 0);
  } catch (e) {
    console.error(e);
    check("the test ran to the end", false, String(e));
  }
  w.finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
