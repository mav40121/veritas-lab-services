// tests/integration/qc-rule-settings.test.ts
//
// STANDING integration test for VeritaQC rule settings (B12 part 2; server/qcRuleSets.ts, shared/qcRuleSets.ts, QC rules mock 4).
// Boots the REAL routes on a throwaway SQLite DB (made-up labs, people and results only) and proves:
//   1. Before any change, today's rules give the same flags as main on a fixed run set (main's engine is copied below, frozen at
//      origin/main 3d923a66), with nothing across levels; and every lab starts on exactly those rules (version 1).
//   2. A change applies only from its day: a run dated that day or later is judged under it.
//   3. A late entry (dated before the change, entered after it) is judged under the rules of its own date, and says so.
//   4. A judged run keeps its flags and the version that judged it; nothing judges it again (the Veritas re-score finds 0 changed).
//   5. Across levels (Q3): a run pairs with the latest accepted run of each other level on that analyzer, that day; the flag lands
//      on the later run and names the other.
//   6. Q2: a save that leaves no rejection rule is refused.
//   7. An analyte's own set replaces the laboratory's, and can go back to it.
//   8. The lock (Q1): it refuses an editor and accepts the medical director and a designee whose signed letter names "Establish and
//      maintain the QA and QC programs", with name and password; it refuses a designee without that duty, and a technical consultant
//      on high complexity. Unlocked, an editor saves with a reason.
//   9. Refusals: another lab, a view-only seat, a Staff login and Veritas support.
//  10. The monthly review: "Rules in force", "Judged under", the across-levels note. Audit rows. The admin rule-settings route.
//  11. enabled_rules_json: read when the starting rules are made, never applied. Export-all and the customer purge take both tables.
// Run: npm run test:qc-rule-settings

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { computeBasis, basisConfig, loadBasisLot } from "../../server/qcBasis";
import { buildMonthlyReviewPayload } from "../../server/qcMonthlyReviewPayload";
import { buildMonthlyReviewHTML } from "../../server/pdfQCMonthly";
import { EXPORT_TABLES } from "../../server/exportAllTables";
import { unclassifiedTables } from "../../server/exportAll";
import { purgeRule, unruledTables } from "../../server/customerPurge";
import { STARTING_RULES, type QcRuleSet } from "../../shared/qcRuleSets";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

// ── main's rule engine, copied verbatim from origin/main 3d923a66 server/qcWestgard.ts (westgardRulesAt) ──
function mainRulesAt(vals: number[], ids: number[], i: number, mean: number, sd: number, biasN: number, trendN: number) {
  const violations: { rule_code: string; severity: string }[] = [];
  if (i < 0 || i >= vals.length) return violations;
  if (!Number.isFinite(mean) || !Number.isFinite(sd) || sd <= 0) return violations;
  const sdis = vals.map(x => (x - mean) / sd);
  const z = sdis[i];
  if (Math.abs(z) > 3) violations.push({ rule_code: "1-3s", severity: "rejection" });
  else if (Math.abs(z) > 2) violations.push({ rule_code: "1-2s", severity: "warning" });
  if (i >= 1 && Math.abs(z) > 2 && Math.abs(sdis[i - 1]) > 2 && z * sdis[i - 1] > 0) violations.push({ rule_code: "2-2s", severity: "rejection" });
  if (i >= 1 && Math.abs(z - sdis[i - 1]) > 4 && ((z > 2 && sdis[i - 1] < -2) || (z < -2 && sdis[i - 1] > 2))) violations.push({ rule_code: "R-4s", severity: "rejection" });
  if (i >= 3) {
    const window = sdis.slice(i - 3, i + 1);
    if (window.every(s => Math.abs(s) > 1) && window.every(s => s * window[0] > 0)) violations.push({ rule_code: "4-1s", severity: "rejection" });
  }
  if (biasN > 0 && i >= biasN - 1) {
    const window = sdis.slice(i - biasN + 1, i + 1);
    if (window.every(s => s * window[0] > 0)) violations.push({ rule_code: `${biasN}-x`, severity: "rejection" });
  }
  if (trendN > 0 && i >= trendN - 1) {
    const window = vals.slice(i - trendN + 1, i + 1);
    const up = window.every((x, k) => k === 0 || x > window[k - 1]);
    const down = window.every((x, k) => k === 0 || x < window[k - 1]);
    if (up || down) violations.push({ rule_code: `${trendN}-T`, severity: "rejection" });
  }
  return violations;
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const clone = (s: QcRuleSet): QcRuleSet => JSON.parse(JSON.stringify(s));
const key = (vs: { rule_code: string; severity: string }[]) => vs.map((v) => `${v.rule_code}:${v.severity}`).sort().join(",");

async function main() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET!;
  const PW = ["Qc", "rules", "77!"].join("-");
  const now = new Date().toISOString();
  const call = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const mkLab = async (tag: string) => {
    const email = `qcr-${tag}-${Date.now()}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: `Owner ${tag}`, hipaa_acknowledged: true });
    const prov = await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `QC Rules Lab ${tag}`, plan: "hospital" });
    return { email, token: reg.body.token as string, labId: prov.body.labId as number, userId: Number(reg.body.user?.id ?? reg.body.id) };
  };
  const addPerson = async (lab: { labId: number; userId: number }, tag: string, kind: "member" | "editor" | "viewer" | "staff", name: string, domain = "example.com") => {
    const email = `qcr-${tag}-${Date.now()}@${domain}`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name, hipaa_acknowledged: true });
    const userId = Number(reg.body.user?.id ?? reg.body.id);
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?, 'staff','active',1,?,?,?)").run(lab.labId, userId, now, now, now);
    sqlite.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(lab.labId, userId);
    if (kind === "staff") {
      const sl = (sqlite.prepare("SELECT id FROM staff_labs WHERE tier2_lab_id = ?").get(lab.labId) as any)?.id
        ?? Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Made-up', '99D0000000', ?, ?, ?)").run(lab.userId, lab.labId, now, now).lastInsertRowid);
      const emp = Number(sqlite.prepare("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'Made', 'active', ?, ?)").run(sl, lab.labId, lab.userId, tag, now, now).lastInsertRowid);
      sqlite.prepare(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, staff_employee_id, permissions, invited_at, accepted_at) VALUES (?, ?, ?, 'active', 'staff_portal', ?, ?, '{"mode":"view_all"}', ?, ?)`).run(lab.userId, email, userId, lab.labId, emp, now, now);
    } else if (kind === "editor" || kind === "viewer") {
      sqlite.prepare(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, 'active')`)
        .run(lab.userId, email, userId, now, now, kind === "editor" ? '{"mode":"edit_all"}' : '{"mode":"view_all"}', `qcr-${tag}-${Date.now()}`, lab.labId);
    }
    sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(userId);
    const login = await call("POST", "/api/auth/login", { email, password: PW });
    return { email, userId, token: login.body.token as string, name };
  };
  const letter = (labId: number, userId: number, position: string, duties: Record<string, boolean>) => sqlite.prepare(
    "INSERT INTO director_delegations (lab_id, delegate_user_id, delegate_name, position, complexity_scope, responsibilities_json, status, signed_at, created_at, updated_at) VALUES (?, ?, 'Made-up Delegate', ?, 'high', ?, 'active', ?, ?, ?)"
  ).run(labId, userId, position, JSON.stringify(duties), now, now, now);

  try {
    const A = await mkLab("a");
    const B = await mkLab("b"); // another customer
    sqlite.prepare("UPDATE labs SET is_demo = 0 WHERE id IN (?, ?)").run(A.labId, B.labId);
    const L = `/api/labs/${A.labId}`;
    const lot = async (analyte: string, level: string, mean: number, sd: number) =>
      Number((await call("POST", `${L}/qc/control-lots`, { analyte, level, lot_number: `${analyte}-${level}-${Date.now()}`, mfr_mean: mean, mfr_sd: sd }, A.token)).body.lot?.id);
    const run = (lotId: number, value: number, date: string, extra: Record<string, unknown> = {}) =>
      call("POST", `${L}/qc/results`, { control_lot_id: lotId, result_value: value, result_date: date, instrument: "CH-500", ...extra }, A.token);
    const stored = (id: number) => sqlite.prepare("SELECT rule_code, severity, detail, related_result_ids FROM qc_rule_violations WHERE qc_result_id = ? AND superseded_at IS NULL ORDER BY id").all(id) as any[];
    const versionOf = (id: number) => (sqlite.prepare("SELECT rule_version_id FROM qc_results WHERE id = ?").get(id) as any)?.rule_version_id;

    // The Veritas admin route still works (and makes the lab's settings row, with the default list).
    const adm = await call("POST", "/api/admin/qc/rule-settings", { secret: ADMIN, labId: A.labId, establishingRules: "westgard", establishN: 20 });
    check("0. the Veritas admin route POST /api/admin/qc/rule-settings still works", adm.status === 200 && adm.body.after?.establishing_rules === "westgard" && adm.body.after?.establish_n === 20, JSON.stringify(adm.body));
    const today = (await call("GET", `${L}/qc/rule-settings`, undefined, A.token)).body.today as string;
    check("0. the settings screen reads, with the lab's today", /^\d{4}-\d{2}-\d{2}$/.test(String(today)));

    // ── 1. Before any change: the same flags as main ──
    const g1 = await lot("Glucose", "Level 1", 100, 2);
    const g2 = await lot("Glucose", "Level 2", 300, 6);
    const start = addDays(today, -60);
    // SDIs on the manufacturer's 100 / 2: 1-2s, 1-3s + 2-2s, 1-2s + R-4s, 4-1s, 10-x, then a 7-T after 20 runs (cumulative basis).
    const g1Vals = [100, 104.5, 107, 95.5, 102.5, 102.4, 102.6, 102.2, 102.1, 101, 100.5, 100.8, 101.2, 100.3, 96, 97, 98, 99, 100.2, 101, 102, 99.5, 100, 104.6, 95.2];
    const g1Ids: number[] = [];
    for (let i = 0; i < g1Vals.length; i++) {
      const date = addDays(start, i);
      g1Ids.push(Number((await run(g1, g1Vals[i], date)).body.result_id));
      // Level 2 on the same days, opposite sides of Level 1 on day 3 (main never pairs levels; neither does a lab until it chooses to).
      if (i === 3 || i === 23 || i === 24) await run(g2, i === 3 ? 313.8 : i === 23 ? 286 : 314, date);
    }
    const lotRow = loadBasisLot(sqlite, A.labId, g1)!;
    const cfg = basisConfig(sqlite, A.labId, "Glucose");
    let same = 0; const diffs: string[] = []; const fired = new Set<string>();
    for (let i = 0; i < g1Vals.length; i++) {
      const b = computeBasis(lotRow, g1Vals.slice(0, i), cfg)!;
      const want = key(mainRulesAt(g1Vals.slice(0, i + 1), g1Ids.slice(0, i + 1), i, b.mean, b.sd, 10, 7));
      const got = key(stored(g1Ids[i]));
      for (const v of stored(g1Ids[i])) fired.add(v.rule_code);
      if (want === got) same++; else diffs.push(`#${i}: main ${want} / now ${got}`);
    }
    check("1. before any change, every run gets main's flags", same === g1Vals.length, diffs.join(" | "));
    check("1. ... and the fixed set fires every rule", ["1-2s", "1-3s", "2-2s", "R-4s", "4-1s", "10-x", "7-T"].every((c) => fired.has(c)), Array.from(fired).join(","));
    const g2Runs = sqlite.prepare("SELECT id FROM qc_results WHERE control_lot_id = ? ORDER BY id").all(g2) as any[];
    check("1. ... and nothing across levels (off for every lab until it chooses)", g2Runs.every((r) => stored(r.id).every((v) => !/across/.test(v.rule_code))) && g1Ids.every((id) => stored(id).every((v) => !/across/.test(v.rule_code))));
    const v1 = sqlite.prepare("SELECT * FROM qc_rule_versions WHERE lab_id = ? AND analyte IS NULL").all(A.labId) as any[];
    check("1. every lab starts on exactly today's rules: one starting version, the app's rules", v1.length === 1 && v1[0].kind === "start" && JSON.stringify(JSON.parse(v1[0].rules_json)) === JSON.stringify(STARTING_RULES) && v1[0].note === null, JSON.stringify(v1));
    check("1. each run keeps the version that judged it", g1Ids.every((id) => versionOf(id) === v1[0].id));

    // ── 2-4. A change from today; a late entry; judged runs stay as judged ──
    const na1 = await lot("Sodium", "Level 1", 140, 1);
    const na2 = await lot("Sodium", "Level 2", 140, 1);
    const r1 = Number((await run(na2, 142.2, addDays(today, -3))).body.result_id);
    const r2res = await run(na2, 142.4, addDays(today, -2));
    const r2 = Number(r2res.body.result_id);
    check("2. before the change, 2-2s is a rejection (as main)", key(stored(r2)) === "1-2s:warning,2-2s:rejection" && r2res.body.requires_corrective_action === true, key(stored(r2)));
    const editor = await addPerson(A, "editor", "editor", "Edie Editor");
    const settings0 = (await call("GET", `${L}/qc/rule-settings`, undefined, editor.token)).body;
    check("2. an editor may change unlocked rules", settings0.laboratory?.can_change === true && settings0.lock?.locked === false, JSON.stringify(settings0.laboratory));
    const next = clone(STARTING_RULES);
    next.rules["2-2s"] = { on: true, severity: "warning", across: true };
    next.rules["R-4s"] = { on: true, severity: "rejection", across: true };
    next.rules["N-T"] = { ...next.rules["N-T"], on: false };
    const noReason = await call("PUT", `${L}/qc/rule-settings`, { analyte: null, rules: next }, editor.token);
    check("2. a change needs a reason", noReason.status === 400 && noReason.body.code === "REASON_REQUIRED", JSON.stringify(noReason.body));
    const stale = await call("PUT", `${L}/qc/rule-settings`, { analyte: null, rules: next, reason: "x", expect_version_id: 999999 }, editor.token);
    check("2. a screen opened before another change is told to reload", stale.status === 409 && stale.body.code === "MOVED");
    const saved = await call("PUT", `${L}/qc/rule-settings`, { analyte: null, rules: next, reason: "6 months of data reviewed; N-T found no true errors.", expect_version_id: settings0.laboratory.version.id }, editor.token);
    const v2 = sqlite.prepare("SELECT * FROM qc_rule_versions WHERE id = ?").get(saved.body.version_id) as any;
    check("2. the change is a dated version with the reason and who", saved.status === 200 && v2?.effective_from === today && v2.reason.startsWith("6 months") && v2.changed_by_user_id === editor.userId && v2.changed_by_name === "Edie Editor" && v2.signed === 0 && v2.capacity_label === "Editor", JSON.stringify(saved.body).slice(0, 300));
    check("2. ... and keeps what changed, as the screen showed it", JSON.parse(v2.changes_json).map((c: any) => `${c.rule}: ${c.was} -> ${c.willBe}`).join(" | ") ===
      "2-2s: Rejection, within a level -> Warning, within and across levels | R-4s: Rejection, within a level -> Rejection, within and across levels | N-T: Rejection, 7 in a row -> Off", v2.changes_json);
    check("2. nothing to change is refused", (await call("PUT", `${L}/qc/rule-settings`, { analyte: null, rules: next, reason: "again" }, editor.token)).body.code === "NO_CHANGE");

    const r3 = Number((await run(na2, 140.4, today)).body.result_id);
    const r4 = Number((await run(na2, 142.1, addDays(today, 1))).body.result_id);
    const r5res = await run(na2, 142.3, addDays(today, 2));
    const r5 = Number(r5res.body.result_id);
    check("2. a run dated from the change's day is judged under it: 2-2s is a warning now", key(stored(r5)) === "1-2s:warning,2-2s:warning" && r5res.body.requires_corrective_action === false && versionOf(r5) === v2.id && versionOf(r3) === v2.id, key(stored(r5)));
    check("2. ... and says which rules", r5res.body.judged_under?.label === `Rules of ${today.slice(5, 7)}/${today.slice(8, 10)}/${today.slice(0, 4)}` && r5res.body.judged_under?.own_date === false, JSON.stringify(r5res.body.judged_under));
    const r6res = await run(na2, 142.5, addDays(today, -1));
    const r6 = Number(r6res.body.result_id);
    check("3. a late entry is judged under the rules of its own date: 2-2s still a rejection", key(stored(r6)) === "1-2s:warning,2-2s:rejection" && r6res.body.requires_corrective_action === true && versionOf(r6) === v1[0].id, key(stored(r6)));
    check("3. ... and says so", r6res.body.judged_under?.own_date === true && r6res.body.judged_under?.label === "Starting rules", JSON.stringify(r6res.body.judged_under));
    check("4. a run judged before the change keeps its flags and its version", key(stored(r1)) === "1-2s:warning" && key(stored(r2)) === "1-2s:warning,2-2s:rejection" && versionOf(r1) === v1[0].id && versionOf(r2) === v1[0].id);
    check("4. ... and a run entered after the late one isn't judged again", key(stored(r4)) === "1-2s:warning" && key(stored(r5)) === "1-2s:warning,2-2s:warning");
    const listed = (await call("GET", `${L}/qc/results?control_lot_id=${na2}`, undefined, A.token)).body.results as any[];
    check("4. the run list says what judged each run", listed.find((r) => r.id === r6)?.judged_under === "Starting rules" && listed.find((r) => r.id === r5)?.judged_under?.startsWith("Rules of "), JSON.stringify(listed.map((r) => r.judged_under)));

    // ── 5. Across levels ──
    const d5 = addDays(today, 5), d6 = addDays(today, 6);
    await run(na2, 140.0, addDays(today, 4));
    const l1 = Number((await run(na1, 137.8, d5, { run_time: "06:10" })).body.result_id);
    await run(na1, 137.4, d5, { run_time: "06:12", instrument: "CH-900" }); // another analyzer, entered later: not the pair
    const l2res = await run(na2, 142.3, d5, { run_time: "06:14" });
    const l2 = Number(l2res.body.result_id);
    const acr = stored(l2).find((v) => v.rule_code === "R-4s across");
    check("5. across levels pairs the run with the other level's run on that analyzer that day, and flags the later run", !!acr && acr.severity === "rejection" && JSON.parse(acr.related_result_ids).includes(l1) && l2res.body.requires_corrective_action === true, JSON.stringify(stored(l2)));
    check("5. ... naming the other run", /with Level 1, 6:10 AM/.test(String(acr?.detail)), String(acr?.detail));
    check("5. ... the first of the pair has no across flag", stored(l1).every((v) => !/across/.test(v.rule_code)), JSON.stringify(stored(l1)));
    await run(na1, 137.6, d6, { run_time: "05:00" });
    const late1 = Number((await run(na1, 140.3, d6, { run_time: "07:00" })).body.result_id);
    const l2b = Number((await run(na2, 142.5, d6, { run_time: "07:05" })).body.result_id);
    check("5. it pairs with the LATEST run of the other level that day", stored(l2b).every((v) => !/across/.test(v.rule_code)) && late1 > 0, JSON.stringify(stored(l2b)));
    const noAnalyzer = Number((await call("POST", `${L}/qc/results`, { control_lot_id: na2, result_value: 142.4, result_date: d5 }, A.token)).body.result_id);
    check("5. a run with no analyzer recorded isn't paired", stored(noAnalyzer).every((v) => !/across/.test(v.rule_code)));

    // ── 6. Q2: at least one rejection rule stays on ──
    const allWarn = clone(next);
    for (const c of Object.keys(allWarn.rules) as (keyof QcRuleSet["rules"])[]) allWarn.rules[c].severity = "warning";
    const q2 = await call("PUT", `${L}/qc/rule-settings`, { analyte: null, rules: allWarn, reason: "try" }, editor.token);
    check("6. a save that leaves no rejection rule is refused", q2.status === 400 && q2.body.code === "NO_REJECTION_RULE", JSON.stringify(q2.body));
    const oneOn = clone(allWarn); oneOn.rules["1-3s"].severity = "rejection";
    for (const c of ["2-2s", "R-4s", "4-1s", "N-x"] as const) oneOn.rules[c] = { ...oneOn.rules[c], on: false, across: false };
    const offAll = clone(oneOn); offAll.rules["1-3s"].on = false;
    check("6. ... including one whose only rejection rule is off", (await call("PUT", `${L}/qc/rule-settings`, { analyte: null, rules: offAll, reason: "try" }, editor.token)).body.code === "NO_REJECTION_RULE");

    // ── 7. An analyte's own set replaces the laboratory's ──
    const k1 = await lot("Potassium", "Level 1", 4, 0.1);
    const own = clone(next); own.rules["1-2s"] = { ...own.rules["1-2s"], on: false };
    const ownSave = await call("PUT", `${L}/qc/rule-settings`, { analyte: "Potassium", rules: own, reason: "Potassium: 1-2s off, our own data." }, editor.token);
    const kRun = await call("POST", `${L}/qc/results`, { control_lot_id: k1, result_value: 4.25, result_date: today, instrument: "CH-500" }, A.token);
    const naRun = Number((await run(na1, 142.5, addDays(today, 8))).body.result_id);
    check("7. an analyte's own set replaces the laboratory's (1-2s off for Potassium only)", ownSave.status === 200 && stored(kRun.body.result_id).length === 0 && key(stored(naRun)) === "1-2s:warning", `${ownSave.status} ${key(stored(kRun.body.result_id))} / ${key(stored(naRun))}`);
    check("7. ... and the run says so", kRun.body.judged_under?.label?.includes("(Potassium)"), JSON.stringify(kRun.body.judged_under));
    check("7. an analyte not in this lab is refused", (await call("PUT", `${L}/qc/rule-settings`, { analyte: "Unobtainium", rules: own, reason: "x" }, editor.token)).status === 404);
    const back = await call("PUT", `${L}/qc/rule-settings`, { analyte: "Potassium", use_lab: true, reason: "Back to the laboratory's rules." }, editor.token);
    await call("POST", `${L}/qc/results`, { control_lot_id: k1, result_value: 4.0, result_date: today, instrument: "CH-500" }, A.token);
    const kRun2 = await call("POST", `${L}/qc/results`, { control_lot_id: k1, result_value: 4.25, result_date: addDays(today, 1), instrument: "CH-500" }, A.token);
    check("7. ... and can go back to the laboratory's", back.status === 200 && key(stored(kRun2.body.result_id)) === "1-2s:warning" && !String(kRun2.body.judged_under?.label).includes("Potassium"), `${back.status} ${key(stored(kRun2.body.result_id))}`);

    // ── 8. The lock ──
    const md = await addPerson(A, "md", "member", "Jordan Ellis, MD");
    sqlite.prepare("UPDATE labs SET medical_director_email = ? WHERE id = ?").run(md.email, A.labId);
    const ts = await addPerson(A, "ts", "member", "Taylor Supervisor"); letter(A.labId, ts.userId, "technical_supervisor", { qc_program: true });
    const tsNo = await addPerson(A, "tsno", "member", "Terry NoDuty"); letter(A.labId, tsNo.userId, "technical_supervisor", { qc_period_cosign: true });
    const tc = await addPerson(A, "tc", "member", "Casey Consultant"); letter(A.labId, tc.userId, "technical_consultant", { qc_program: true });
    const lockBody = (locked: boolean, name: string, password = PW) => ({ locked, reason: "Rules approved for use.", typed_signature: name, password });
    const edLock = await call("POST", `${L}/qc/rule-settings/lock`, lockBody(true, "Edie Editor"), editor.token);
    check("8. an editor can't lock the rules", edLock.status === 403 && edLock.body.code === "NOT_DIRECTOR_OR_DESIGNEE", JSON.stringify(edLock.body));
    check("8. the owner can't either (the lock is the director's)", (await call("POST", `${L}/qc/rule-settings/lock`, lockBody(true, "Owner a"), A.token)).status === 403);
    const badPw = await call("POST", `${L}/qc/rule-settings/lock`, lockBody(true, md.name, "wrong-password"), md.token);
    check("8. the director's lock needs their own password", badPw.status === 401 && (sqlite.prepare("SELECT COUNT(*) AS n FROM qc_rule_lock_events WHERE lab_id = ?").get(A.labId) as any).n === 0, JSON.stringify(badPw.body));
    const noName = await call("POST", `${L}/qc/rule-settings/lock`, { locked: true, reason: "x", password: PW }, md.token);
    check("8. ... and their typed name", noName.status === 400 && /full name/.test(String(noName.body.error)), JSON.stringify(noName.body));
    const locked = await call("POST", `${L}/qc/rule-settings/lock`, lockBody(true, md.name), md.token);
    check("8. the medical director locks the rules with name and password", locked.status === 200 && locked.body.settings?.lock?.locked === true && locked.body.settings.lock.by === md.name
      && (sqlite.prepare("SELECT signed_with FROM qc_rule_lock_events WHERE lab_id = ? ORDER BY id DESC LIMIT 1").get(A.labId) as any)?.signed_with === "password", JSON.stringify(locked.body).slice(0, 200));
    const tweak = clone(next); tweak.rules["N-x"] = { ...tweak.rules["N-x"], n: 8 };
    const edLocked = await call("PUT", `${L}/qc/rule-settings`, { analyte: null, rules: tweak, reason: "Catch a shift sooner." }, editor.token);
    check("8. locked: an editor can't change the rules", edLocked.status === 403 && edLocked.body.code === "RULES_LOCKED", JSON.stringify(edLocked.body));
    const edView = (await call("GET", `${L}/qc/rule-settings`, undefined, editor.token)).body;
    check("8. ... and the screen tells them so", edView.laboratory?.can_change === false && edView.lock?.locked === true);
    check("8. a designee without the QA and QC programs duty is refused", (await call("PUT", `${L}/qc/rule-settings`, { analyte: null, rules: tweak, reason: "x", typed_signature: tsNo.name, password: PW }, tsNo.token)).status === 403);
    check("8. a technical consultant is refused on high complexity", (await call("PUT", `${L}/qc/rule-settings`, { analyte: null, rules: tweak, reason: "x", typed_signature: tc.name, password: PW }, tc.token)).status === 403);
    const tsNoPw = await call("PUT", `${L}/qc/rule-settings`, { analyte: null, rules: tweak, reason: "Catch a shift sooner.", typed_signature: ts.name }, ts.token);
    check("8. locked: the designee must sign", tsNoPw.status === 400 && /password/i.test(String(tsNoPw.body.error)), JSON.stringify(tsNoPw.body));
    // S0: where the signer's domain requires its hospital sign-in, a password can't sign (server/eSignature.ts); nothing is written.
    const tsSso = await addPerson(A, "tssso", "member", "Hana Hospital", "qcr-hospital.test"); letter(A.labId, tsSso.userId, "technical_supervisor", { qc_program: true });
    sqlite.prepare("INSERT INTO sso_configs (name, issuer, client_id, email_domains, required, enabled) VALUES ('Made-up Hospital', 'https://idp.example.com', 'made-up', ?, 1, 1)").run(JSON.stringify(["qcr-hospital.test"]));
    const before8 = (sqlite.prepare("SELECT COUNT(*) AS n FROM qc_rule_versions WHERE lab_id = ?").get(A.labId) as any).n;
    const ssoPw = await call("PUT", `${L}/qc/rule-settings`, { analyte: null, rules: tweak, reason: "x", typed_signature: tsSso.name, password: PW }, tsSso.token);
    check("8. a designee whose hospital requires its sign-in can't sign with a password (S0's check)", ssoPw.status === 403 && ssoPw.body.code === "SSO_SIGN_REQUIRED"
      && (sqlite.prepare("SELECT COUNT(*) AS n FROM qc_rule_versions WHERE lab_id = ?").get(A.labId) as any).n === before8, JSON.stringify(ssoPw.body));
    const tsSaved = await call("PUT", `${L}/qc/rule-settings`, { analyte: null, rules: tweak, reason: "Catch a shift sooner.", typed_signature: ts.name, password: PW }, ts.token);
    const v3 = sqlite.prepare("SELECT * FROM qc_rule_versions WHERE id = ?").get(tsSaved.body.version_id) as any;
    check("8. a technical supervisor named for the QA and QC programs changes locked rules, signed", tsSaved.status === 200 && v3.signed === 1 && v3.capacity === "designee" && /Technical Supervisor/.test(v3.capacity_label) && v3.typed_signature === ts.name && v3.signed_with === "password" && v3.signed_with_provider === null, JSON.stringify(tsSaved.body).slice(0, 200));
    // A technical consultant covers moderate complexity: Sodium is moderate on the lab's VeritaMap, the lab also has a high test.
    const map = Number(sqlite.prepare("INSERT INTO veritamap_maps (user_id, name, created_at, updated_at, lab_id) VALUES (?, 'Made-up map', ?, ?, ?)").run(A.userId, now, now, A.labId).lastInsertRowid);
    sqlite.prepare("INSERT INTO veritamap_tests (map_id, analyte, specialty, complexity, updated_at) VALUES (?, 'Sodium', 'Chemistry', 'MODERATE', ?)").run(map, now);
    sqlite.prepare("INSERT INTO veritamap_tests (map_id, analyte, specialty, complexity, updated_at) VALUES (?, 'Troponin', 'Chemistry', 'HIGH', ?)").run(map, now);
    const tcNa = await call("PUT", `${L}/qc/rule-settings`, { analyte: "Sodium", rules: tweak, reason: "Sodium keeps its own rules.", typed_signature: tc.name, password: PW }, tc.token);
    check("8. ... and a technical consultant with the duty changes a moderate-complexity analyte's rules", tcNa.status === 200, JSON.stringify(tcNa.body).slice(0, 200));
    check("8. ... but not the laboratory's (its highest complexity is high)", (await call("PUT", `${L}/qc/rule-settings`, { analyte: null, rules: next, reason: "x", typed_signature: tc.name, password: PW }, tc.token)).status === 403);
    const mdSaved = await call("PUT", `${L}/qc/rule-settings`, { analyte: null, rules: next, reason: "Back to 10-x.", typed_signature: md.name, password: PW }, md.token);
    check("8. the medical director changes locked rules", mdSaved.status === 200 && (sqlite.prepare("SELECT capacity FROM qc_rule_versions WHERE id = ?").get(mdSaved.body.version_id) as any).capacity === "medical_director");
    const unlocked = await call("POST", `${L}/qc/rule-settings/lock`, lockBody(false, md.name), md.token);
    const edAgain = await call("PUT", `${L}/qc/rule-settings`, { analyte: null, rules: tweak, reason: "Catch a shift sooner." }, editor.token);
    check("8. unlocked again (signed), an editor saves with a reason", unlocked.status === 200 && edAgain.status === 200, `${unlocked.status} ${edAgain.status} ${JSON.stringify(edAgain.body).slice(0, 120)}`);

    // ── 9. Refusals ──
    const viewer = await addPerson(A, "viewer", "viewer", "Vic Viewer");
    const staff = await addPerson(A, "staff", "staff", "Stan Stafford");
    const support = await addPerson(B, "support", "member", "Sam Support");
    sqlite.prepare("UPDATE users SET vls_support = 1 WHERE id = ?").run(support.userId);
    const put = (token: string) => call("PUT", `${L}/qc/rule-settings`, { analyte: null, rules: next, reason: "x" }, token);
    const wrongLab = await put(B.token);
    check("9. another lab's owner is refused, and can't read them", wrongLab.status === 403 && (await call("GET", `${L}/qc/rule-settings`, undefined, B.token)).status === 403, String(wrongLab.status));
    const vw = await put(viewer.token);
    check("9. a view-only seat is refused", vw.status === 403 && vw.body.code === "EDIT_REQUIRED", JSON.stringify(vw.body));
    const st = await put(staff.token);
    check("9. a Staff login is refused", st.status === 403, JSON.stringify(st.body));
    const stView = await call("GET", `${L}/qc/rule-settings`, undefined, staff.token);
    check("9. ... and reads the rules without coworkers' names", stView.status === 200 && stView.body.history.every((h: any) => h.who == null) && stView.body.laboratory.can_change === false);
    const sp = await put(support.token);
    const spLock = await call("POST", `${L}/qc/rule-settings/lock`, lockBody(true, "Sam Support"), support.token);
    check("9. Veritas support is refused, changing or locking", sp.status === 403 && /veritas/i.test(String(sp.body.error)) && spLock.status === 403, `${sp.status} ${JSON.stringify(sp.body)} ${spLock.status}`);
    const lastVersion = (sqlite.prepare("SELECT MAX(id) AS m FROM qc_rule_versions WHERE lab_id = ?").get(A.labId) as any).m;
    check("9. none of them wrote a version", lastVersion === edAgain.body.version_id);

    // ── 10. The monthly review, audit, the admin re-score ──
    const ym = today.slice(0, 7);
    const lotNa2 = sqlite.prepare("SELECT * FROM qc_control_lots WHERE id = ?").get(na2) as any;
    const labRow = sqlite.prepare("SELECT id, lab_name, clia_number FROM labs WHERE id = ?").get(A.labId) as any;
    const payload = buildMonthlyReviewPayload(sqlite, A.labId, lotNa2, labRow, Number(ym.slice(0, 4)), Number(ym.slice(5, 7)));
    const html = buildMonthlyReviewHTML(payload);
    check("10. the monthly review names the rules in force, and every change in the month", (payload.rulesInForce ?? []).some((l) => l.startsWith(`From ${today.slice(5, 7)}/${today.slice(8, 10)}/${today.slice(0, 4)}`) && /Edie Editor/.test(l)) && /RULES IN FORCE/.test(html), JSON.stringify(payload.rulesInForce));
    check("10. ... each run says what judged it", /<th>Judged under<\/th>/.test(html) && payload.results.every((r) => !!r.judged_under), JSON.stringify(payload.results.map((r) => r.judged_under)));
    const nextMonth = addDays(`${ym}-28`, 7).slice(0, 7);
    const p2 = buildMonthlyReviewPayload(sqlite, A.labId, lotNa2, labRow, Number(d5.slice(0, 4)), Number(d5.slice(5, 7)));
    check("10. ... and an across-levels flag names its pair under the table", /R-4s across: with Level 1, 6:10 AM/.test(buildMonthlyReviewHTML(p2)) && !!nextMonth);
    const audit = sqlite.prepare("SELECT entity_type, before_json, after_json FROM audit_log WHERE module = 'veritaqc' AND entity_type IN ('qc_rule_set', 'qc_rule_lock') ORDER BY id").all() as any[];
    check("10. every change and lock wrote an audit row with before and after", audit.filter((a) => a.entity_type === "qc_rule_set").length === (sqlite.prepare("SELECT COUNT(*) AS n FROM qc_rule_versions WHERE lab_id = ? AND kind <> 'start'").get(A.labId) as any).n && audit.filter((a) => a.entity_type === "qc_rule_lock").length === 2 && audit.every((a) => a.before_json && a.after_json));
    const rescore = await call("POST", "/api/admin/qc/rescore", { secret: ADMIN, labIds: [A.labId], since: addDays(today, -90) });
    const changed = (rescore.body.report ?? []).reduce((n: number, r: any) => n + r.changed, 0);
    check("4. the Veritas re-score judges each run under its own version and finds nothing to change", rescore.status === 200 && changed === 0, JSON.stringify(rescore.body).slice(0, 600));
    const adm2 = await call("POST", "/api/admin/qc/rule-settings", { secret: ADMIN, labId: A.labId, establishingRules: "range", dryRun: true });
    check("10. the admin route's dry run still answers after rule changes", adm2.status === 200 && adm2.body.dryRun === true && adm2.body.after?.establishing_rules === "range");

    // ── 11. enabled_rules_json; export and purge ──
    const C = await mkLab("c");
    sqlite.prepare("INSERT INTO qc_rule_settings (lab_id, analyte, bias_consecutive_count, trend_consecutive_count, enabled_rules_json, created_at, updated_at) VALUES (?, NULL, 10, 7, ?, ?, ?)").run(C.labId, '["1-2s","1-3s"]', now, now);
    const cView = (await call("GET", `/api/labs/${C.labId}/qc/rule-settings`, undefined, C.token)).body;
    const cStart = cView.laboratory?.version;
    check("11. a stored list that was never applied is read, noted, and not applied", cStart?.kind === "start" && JSON.stringify(cStart.rules) === JSON.stringify(STARTING_RULES) && /1-2s, 1-3s/.test(String(cStart.note)), JSON.stringify(cStart));
    check("11. ... the default list notes nothing", v1[0].note === null && (sqlite.prepare("SELECT enabled_rules_json FROM qc_rule_settings WHERE lab_id = ? AND analyte IS NULL").get(A.labId) as any).enabled_rules_json === '["1-2s","1-3s","2-2s","R-4s","4-1s","N-x","N-T"]');
    check("11. both new tables are in the lab's export and the customer purge", EXPORT_TABLES.qc_rule_versions?.scope.kind === "lab" && EXPORT_TABLES.qc_rule_lock_events?.scope.kind === "lab"
      && !unclassifiedTables(sqlite).some((t) => t.startsWith("qc_rule_")) && !unruledTables(sqlite).some((t) => t.startsWith("qc_rule_"))
      && purgeRule("qc_rule_versions")?.kind === "delete" && purgeRule("qc_rule_lock_events")?.kind === "delete");
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
