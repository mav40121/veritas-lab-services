// scripts/verify-readiness-rollup.mts
//
// Receipt for the multi-lab readiness "command center" aggregation (Build #1,
// 2026-09-25). Exercises the REAL logic the dashboard renders
// (client/src/lib/readinessRollup.ts): network summary counts, network-readiness
// percent, the worst-first action feed (filter + sort), the severity-sorted
// heatmap rows, the stable module-column union, and per-lab bad-module ordering.
//
// Run: npx tsx scripts/verify-readiness-rollup.mts   (exits non-zero on fail)

import { summarizeRollup, badModules, sev, moduleWork, moduleCount, onlyUndated, type RollupLab } from "../client/src/lib/readinessRollup";
import { accreditorLabel, filterFindings, labsForFilter } from "../client/src/lib/systemFindings";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? "  (" + detail + ")" : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? "  (" + detail + ")" : ""}`); }
}

const KEYS = ["equipment", "pt_deadlines", "qc", "certificates", "competency"];
const LABELS: Record<string, string> = {
  equipment: "Equipment maintenance", pt_deadlines: "PT submission deadlines",
  qc: "QC corrective actions", certificates: "Certificate expirations", competency: "Competency assessments",
};
function mods(statuses: Record<string, ["ok"|"attention"|"overdue", number, number]>): any[] {
  return KEYS.map(k => {
    const [status, overdue, due_soon] = statuses[k] || ["ok", 0, 0];
    return { key: k, label: LABELS[k], status, overdue, due_soon, total: 1, headline: "" };
  });
}
function lab(id: number, name: string, statuses: any, overall: any): RollupLab {
  return { lab_id: id, lab_name: name, clia_number: null, modules: mods(statuses), overall };
}

const A = lab(1, "Alpha", {}, { modules_total: 5, modules_ok: 5, attention_items: 0, overdue_items: 0, status: "ok" });
const B = lab(2, "Bravo",
  { pt_deadlines: ["attention", 0, 1], certificates: ["attention", 0, 1] },
  { modules_total: 5, modules_ok: 3, attention_items: 2, overdue_items: 0, status: "attention" });
const C = lab(3, "Charlie",
  { qc: ["overdue", 2, 0], competency: ["overdue", 0, 0], certificates: ["attention", 0, 1] },
  { modules_total: 5, modules_ok: 2, attention_items: 3, overdue_items: 2, status: "overdue" });

// Intentionally pass in a non-worst order so we prove the sorts do work.
const s = summarizeRollup([A, B, C]);

// --- summary band ---
check("sites total", s.sites === 3, String(s.sites));
check("sites ready", s.ready === 1, String(s.ready));
check("sites need attention", s.attention === 1, String(s.attention));
check("sites action needed (overdue)", s.overdueSites === 1, String(s.overdueSites));
check("total overdue items = 2", s.totalOverdue === 2, String(s.totalOverdue));
check("total due-soon = attention(5) - overdue(2) = 3", s.totalDueSoon === 3, String(s.totalDueSoon));
check("network readiness pct = round(10/15) = 67", s.readinessPct === 67, String(s.readinessPct));

// --- columns (stable union, first-seen order) ---
check("cols are the 5 modules in order", JSON.stringify(s.cols.map(c => c.key)) === JSON.stringify(KEYS), s.cols.map(c => c.key).join(","));
check("col label carried", s.cols[2].label === "QC corrective actions", s.cols[2].label);

// --- action feed (only labs with work, worst-first) ---
check("feed excludes the all-ok lab", !s.feed.some(l => l.lab_id === 1));
check("feed length 2 (Bravo + Charlie)", s.feed.length === 2, String(s.feed.length));
check("feed worst-first: Charlie(overdue) before Bravo(attention)", s.feed[0].lab_id === 3 && s.feed[1].lab_id === 2, s.feed.map(l => l.lab_id).join(","));

// --- heatmap rows (severity-sorted) ---
check("rows sorted worst-first: C, B, A", JSON.stringify(s.rows.map(l => l.lab_id)) === JSON.stringify([3, 2, 1]), s.rows.map(l => l.lab_id).join(","));

// --- bad modules for a lab, worst-first ---
const cbad = badModules(C);
check("Charlie bad modules: overdue ones before attention", cbad[0].status === "overdue" && cbad[cbad.length - 1].status === "attention", cbad.map(m => `${m.key}:${m.status}`).join(","));
check("Charlie has 3 non-ok modules", cbad.length === 3, String(cbad.length));

// --- sev helper ---
check("sev ordering overdue>attention>ok", sev("overdue") > sev("attention") && sev("attention") > sev("ok"));

// --- edge: empty + all-ok network ---
const empty = summarizeRollup([]);
check("empty rollup: 100% readiness, no divide-by-zero", empty.readinessPct === 100 && empty.sites === 0);
const allOk = summarizeRollup([A, lab(9, "Delta", {}, { modules_total: 5, modules_ok: 5, attention_items: 0, overdue_items: 0, status: "ok" })]);
check("all-ok network: empty feed", allOk.feed.length === 0);

// --- Not set up (B2, 2026-11-24): out of ready, out of the percent, never in the feed ---
const N = { lab_id: 20, lab_name: "Nova", clia_number: null,
  modules: mods({}).map((m) => ({ ...m, status: "not_set_up", total: 0 })),
  overall: { modules_total: 0, modules_ok: 0, modules_not_set_up: 5, attention_items: 0, overdue_items: 0, other_items: 0, status: "not_set_up" } } as RollupLab;
const withN = summarizeRollup([N, A, C]);
check("not set up: counted apart, not ready", withN.ready === 1 && withN.notSetUp === 1 && withN.sites === 3, `${withN.ready} ready, ${withN.notSetUp} not set up`);
check("not set up: the percent is the same as without that lab", withN.readinessPct === summarizeRollup([A, C]).readinessPct, String(withN.readinessPct));
check("not set up: no feed entry, no bad modules", !withN.feed.some((l) => l.lab_id === 20) && badModules(N).length === 0);
check("not set up: sorts after attention and before ready", JSON.stringify(summarizeRollup([A, N, B]).rows.map((l) => l.lab_id)) === JSON.stringify([2, 20, 1]));
check("only not-set-up labs: no percent at all", summarizeRollup([N]).readinessPct === null);
// --- items with no date ---
const M = (overdue: number, due_soon: number, other: number, other_label: string | null = null): any => ({ key: "k", label: "L", status: "attention", overdue, due_soon, other, other_label });
check("a chip says what is outstanding", moduleWork(M(3, 2, 4, "missing")) === "3 overdue" && moduleWork(M(0, 2, 4, "missing")) === "2 due soon, 4 missing" && moduleWork(M(0, 0, 2, "waiting for approval")) === "2 waiting for approval" && moduleWork(M(0, 1, 0)) === "1 due soon");
check("a cell's number: overdue, else everything amber", moduleCount(M(3, 2, 4)) === 3 && moduleCount(M(0, 2, 4)) === 6 && moduleCount(M(0, 0, 0)) === 0);
check("amber with no date isn't called due soon", onlyUndated(M(0, 0, 4)) && !onlyUndated(M(0, 1, 4)) && !onlyUndated(M(1, 0, 4)));
check("a server that sends no other count reads as before", moduleWork({ key: "k", label: "L", status: "attention", overdue: 0, due_soon: 2 } as any) === "2 due soon" && moduleCount({ overdue: 0, due_soon: 2 } as any) === 2);

// --- the cross-lab findings list's filters ---
const fl = (id: number, lab_id: number, accreditor: string, source_type = "inspection"): any => ({ id, lab_id, lab_name: null, organization_id: null, accreditor, source_type, finding_number: null, standard_ref: null, due_date: null, status: "open", past_due: false, past_target: false });
const L = (lab_id: number, organization_id: number | null) => ({ lab_id, lab_name: null, clia_number: null, organization_id, organization_name: null });
const FL = [L(1, 9), L(2, 9), L(3, null)], FR = [fl(1, 1, "CAP"), fl(2, 2, "TJC"), fl(3, 3, "CAP"), fl(4, 1, "Other", "pt_failure"), fl(5, 2, "ISO"), fl(6, 2, "CAP", "internal_nce")];
const FG = [{ id: 50, name: "North", kind: "region", lab_ids: [1, 99] }];
const all = { organizationId: null, group: "all" as const, accreditor: null };
const idsOf = (f: any) => filterFindings(FR, FL, FG, { ...all, ...f }).map((r) => r.id).join(",");
check("findings: the accreditor column reads the accreditor, ISO 15189, or the entry's type", accreditorLabel(FR[0]) === "CAP" && accreditorLabel(FR[4]) === "ISO 15189" && accreditorLabel(FR[3]) === "PT failure" && accreditorLabel(FR[5]) === "CAP" && accreditorLabel(fl(7, 1, "Other")) === "Other");
check("findings: no filter, every row", idsOf({}) === "1,2,3,4,5,6");
check("findings: by group, only that group's labs that are in the list", idsOf({ group: 50 }) === "1,4" && labsForFilter(FL, FG, { organizationId: null, group: 50 }).length === 1);
check("findings: not in a group", idsOf({ group: "none" }) === "2,3,5,6");
check("findings: by system", idsOf({ organizationId: 9 }) === "1,2,4,5,6");
check("findings: by accreditor, and with a group", idsOf({ accreditor: "CAP" }) === "1,3,6" && idsOf({ accreditor: "CAP", group: 50 }) === "1" && idsOf({ accreditor: "PT failure" }) === "4");
check("findings: a row for a lab not in the list never shows", filterFindings([fl(8, 77, "CAP")], FL, FG, all).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
