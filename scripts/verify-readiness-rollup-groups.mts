// scripts/verify-readiness-rollup-groups.mts
//
// Receipt for the roll-up groups' arrangement logic (Michael 2026-11-16, Phase 1; client/src/lib/readinessRollup.ts):
// groupsInRollup, filterRollupByGroup and groupSections, the exact functions Inspection Readiness renders. Made-up labs.
//   1. a group shows only when it holds a lab of this roll-up; groups keep the server's order
//   2. a group filter cuts to that group's labs; "none" gives the labs in no group; an unknown group leaves the roll-up whole
//   3. sections: one per group with its own subtotals (sites, ready, action needed, overdue items, readiness %), labs
//      worst-first, a lab in two groups in both, then "Not in a group" for the rest; no groups, no sections
//   4. subtotals add up: each group's summary equals summarizeRollup over its labs; group lab ids outside the roll-up are
//      ignored (the server already cut them to what the reader sees, but the page doesn't rely on it)
// Run: npx tsx scripts/verify-readiness-rollup-groups.mts   (exits non-zero on fail)

import { summarizeRollup, groupsInRollup, filterRollupByGroup, groupSections, type RollupLab, type RollupGroupRef } from "../client/src/lib/readinessRollup";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? "  (" + detail + ")" : ""}`); }
}

const lab = (id: number, status: "ok" | "attention" | "overdue", overdue: number, attention: number, ok: number, total: number): RollupLab => ({
  lab_id: id, lab_name: `Made-up Lab ${id}`, clia_number: null,
  modules: [{ key: "qc", label: "QC", status, overdue, due_soon: Math.max(0, attention - overdue) }],
  overall: { modules_total: total, modules_ok: ok, attention_items: attention, overdue_items: overdue, status },
});
const L1 = lab(1, "ok", 0, 0, 5, 5);
const L2 = lab(2, "overdue", 3, 4, 3, 5);
const L3 = lab(3, "attention", 0, 2, 4, 5);
const L4 = lab(4, "overdue", 1, 1, 4, 5);
const L5 = lab(5, "ok", 0, 0, 5, 5);
const rollup = [L1, L2, L3, L4, L5];

const A: RollupGroupRef = { id: 10, name: "Consultant A", kind: "consultant", lab_ids: [1, 2, 3] };
const B: RollupGroupRef = { id: 11, name: "Consultant B", kind: "consultant", lab_ids: [3, 4, 99] }; // 99 isn't in this roll-up
const C: RollupGroupRef = { id: 12, name: "Empty here", kind: "region", lab_ids: [77, 88] };
const groups = [A, B, C];

// 1
const shown = groupsInRollup(rollup, groups);
check("1. a group with no lab in this roll-up isn't shown (C)", shown.length === 2 && !shown.some((g) => g.id === 12));
check("1. groups keep the order the server sent", shown[0].id === 10 && shown[1].id === 11);

// 2
const onlyA = filterRollupByGroup(rollup, groups, 10).map((l) => l.lab_id);
check("2. filter to A gives labs 1, 2, 3", JSON.stringify(onlyA) === "[1,2,3]", JSON.stringify(onlyA));
const onlyB = filterRollupByGroup(rollup, groups, 11).map((l) => l.lab_id);
check("2. filter to B gives 3 and 4 (99 isn't in the roll-up)", JSON.stringify(onlyB) === "[3,4]", JSON.stringify(onlyB));
const none = filterRollupByGroup(rollup, groups, "none").map((l) => l.lab_id);
check("2. 'none' gives lab 5, the one lab in no group", JSON.stringify(none) === "[5]", JSON.stringify(none));
check("2. an unknown group id leaves the roll-up whole", filterRollupByGroup(rollup, groups, 999).length === 5);

// 3
const secs = groupSections(rollup, groups);
check("3. three sections: A, B, then Not in a group", secs.length === 3 && secs[0].group?.id === 10 && secs[1].group?.id === 11 && secs[2].group === null, JSON.stringify(secs.map((s) => s.group?.id ?? null)));
check("3. lab 3 shows in both A and B", secs[0].labs.some((l) => l.lab_id === 3) && secs[1].labs.some((l) => l.lab_id === 3));
check("3. Not in a group holds only lab 5", JSON.stringify(secs[2].labs.map((l) => l.lab_id)) === "[5]");
check("3. labs in a section are worst-first (A: 2 overdue, 3 attention, 1 ok)", JSON.stringify(secs[0].labs.map((l) => l.lab_id)) === "[2,3,1]", JSON.stringify(secs[0].labs.map((l) => l.lab_id)));
check("3. A's subtotals: 1/3 ready, 1 action needed, 3 overdue items, 12/15 modules = 80%",
  secs[0].summary.ready === 1 && secs[0].summary.sites === 3 && secs[0].summary.overdueSites === 1 && secs[0].summary.totalOverdue === 3 && secs[0].summary.readinessPct === 80, JSON.stringify(secs[0].summary));
check("3. B's subtotals: 0/2 ready, 1 action needed, 1 overdue item, 8/10 = 80%",
  secs[1].summary.ready === 0 && secs[1].summary.sites === 2 && secs[1].summary.overdueSites === 1 && secs[1].summary.totalOverdue === 1 && secs[1].summary.readinessPct === 80, JSON.stringify(secs[1].summary));
check("3. no groups, no sections", groupSections(rollup, []).length === 0 && groupSections(rollup, [C]).length === 0);
const all = groupSections(rollup, [{ id: 20, name: "Everyone", kind: "region", lab_ids: [1, 2, 3, 4, 5] }]);
check("3. every lab in one group: one section and no 'Not in a group'", all.length === 1 && all[0].labs.length === 5);

// 4
check("4. each section's summary is summarizeRollup over its labs", secs.every((s) => JSON.stringify(s.summary) === JSON.stringify(summarizeRollup(s.labs))));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
