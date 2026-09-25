// scripts/verify-readiness-rollup.mts
//
// Receipt for the multi-lab readiness "command center" aggregation (Build #1,
// 2026-09-25). Exercises the REAL logic the dashboard renders
// (client/src/lib/readinessRollup.ts): network summary counts, network-readiness
// percent, the worst-first action feed (filter + sort), the severity-sorted
// heatmap rows, the stable module-column union, and per-lab bad-module ordering.
//
// Run: npx tsx scripts/verify-readiness-rollup.mts   (exits non-zero on fail)

import { summarizeRollup, badModules, sev, type RollupLab } from "../client/src/lib/readinessRollup";

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
