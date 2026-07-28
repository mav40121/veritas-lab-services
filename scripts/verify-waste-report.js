#!/usr/bin/env node
/**
 * verify-waste-report.js
 *
 * Math receipt for the VeritaStock Wastage and Losses report aggregation
 * (server/wasteReport.ts buildWasteReport). Hardcodes the exact illustrative
 * Michaels Lab dataset shown in the approved mock (8 items, 11 write-off events,
 * $4,113 total) and asserts the grouped-by-item rollup, per-reason totals, top
 * item, ordering, share percentages, and the deleted-item fallback.
 *
 * This is a faithful re-implementation of buildWasteReport's pure logic; keep it
 * in lockstep with the source if that aggregation changes.
 */

const WASTE_REASON_ORDER = ["expired", "damaged", "recalled", "lost"];
const REASON_LABEL = { expired: "Expired", damaged: "Damaged", recalled: "Recalled", lost: "Lost" };
const reasonLabel = (r) => REASON_LABEL[r] || (r ? r[0].toUpperCase() + r.slice(1) : "Other");
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function buildWasteReport(events) {
  const total_loss = round2(events.reduce((s, e) => s + (Number(e.waste_value) || 0), 0));
  const byReasonMap = new Map();
  for (const e of events) {
    const r = (e.reason_code || "other").toLowerCase();
    const cur = byReasonMap.get(r) || { value: 0, events: 0 };
    cur.value += Number(e.waste_value) || 0; cur.events += 1; byReasonMap.set(r, cur);
  }
  const knownFirst = [...WASTE_REASON_ORDER, ...[...byReasonMap.keys()].filter((r) => !WASTE_REASON_ORDER.includes(r))];
  const by_reason = knownFirst.filter((r) => byReasonMap.has(r))
    .map((r) => ({ reason: r, label: reasonLabel(r), value: round2(byReasonMap.get(r).value), events: byReasonMap.get(r).events }));

  const groups = new Map();
  for (const e of events) {
    const key = e.item_id != null ? `id:${e.item_id}` : `name:${(e.item_name || "Unknown item").toLowerCase()}`;
    let g = groups.get(key);
    if (!g) { g = { item_id: e.item_id ?? null, item_name: e.item_name || "Unknown item", department: e.department ?? null, vendor: e.vendor ?? null, events: 0, qty: 0, unit_cost: null, loss: 0, last_event_date: null, _reasonSet: new Set() }; groups.set(key, g); }
    g.events += 1; g.qty += Number(e.qty) || 0; g.loss += Number(e.waste_value) || 0;
    if (Number(e.unit_cost) > 0 && g.unit_cost == null) g.unit_cost = round2(Number(e.unit_cost));
    g._reasonSet.add((e.reason_code || "other").toLowerCase());
    if (e.event_date && (!g.last_event_date || e.event_date > g.last_event_date)) g.last_event_date = e.event_date;
  }
  const by_item = [...groups.values()].map((g) => ({
    item_id: g.item_id, item_name: g.item_name, department: g.department, vendor: g.vendor,
    reasons: WASTE_REASON_ORDER.filter((r) => g._reasonSet.has(r)).map(reasonLabel),
    events: g.events, qty: round2(g.qty), unit_cost: g.unit_cost, loss: round2(g.loss),
    share_pct: total_loss > 0 ? Math.round((g.loss / total_loss) * 1000) / 10 : 0,
    last_event_date: g.last_event_date,
  })).sort((a, b) => b.loss - a.loss || a.item_name.localeCompare(b.item_name));
  const top = by_item[0] || null;
  return { summary: { total_loss, event_count: events.length, item_count: by_item.length, by_reason, top_item: top ? { item_name: top.item_name, loss: top.loss, reason: top.reasons[0] || "" } : null }, by_item };
}

// Illustrative Michaels Lab dataset from the approved mock.
const E = (item_id, item_name, department, vendor, reason_code, qty, unit_cost, event_date) =>
  ({ item_id, item_name, department, vendor, reason_code, qty, unit_cost, waste_value: round2(qty * unit_cost), event_date });
const EVENTS = [
  E(1, "Pfizer Demo - Troponin I Reagent Kit", "Chemistry", "Ortho", "expired", 6, 185.5, "2026-07-27"),
  E(2, "CBC reagent / diluent pack", "Hematology", "Sysmex", "expired", 1, 360, "2026-06-10"),
  E(2, "CBC reagent / diluent pack", "Hematology", "Sysmex", "expired", 1, 360, "2026-07-01"),
  E(3, "Comprehensive Metabolic Panel reagent", "Chemistry", "Roche", "expired", 1, 415, "2026-06-15"),
  E(3, "Comprehensive Metabolic Panel reagent", "Chemistry", "Roche", "damaged", 1, 415, "2026-07-05"),
  E(4, "Assayed Chemistry Control, Level 1", "Chemistry", "Bio-Rad", "expired", 2, 110, "2026-05-20"),
  E(4, "Assayed Chemistry Control, Level 1", "Chemistry", "Bio-Rad", "expired", 1, 110, "2026-07-10"),
  E(5, "Multi-analyte Calibrator set", "Chemistry", "Bio-Rad", "expired", 1, 255, "2026-06-22"),
  E(6, "PT / INR thromboplastin reagent", "Coagulation", "Werfen", "recalled", 2, 305, "2026-06-30"),
  E(7, "Blood culture bottles, aerobic", "Microbiology", "BD BACTEC", "lost", 1, 150, "2026-07-12"),
  E(8, "Nitrile exam gloves, Medium", "Materials Mgmt", "Medline", "damaged", 1, 105, "2026-07-18"),
];

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
  ok ? pass++ : fail++;
};

const r = buildWasteReport(EVENTS);
check("total loss", r.summary.total_loss, 4113);
check("event count", r.summary.event_count, 11);
check("item count", r.summary.item_count, 8);
check("top item name", r.summary.top_item.item_name, "Pfizer Demo - Troponin I Reagent Kit");
check("top item loss", r.summary.top_item.loss, 1113);
check("by_reason expired", r.summary.by_reason.find((x) => x.reason === "expired"), { reason: "expired", label: "Expired", value: 2833, events: 7 });
check("by_reason damaged", r.summary.by_reason.find((x) => x.reason === "damaged"), { reason: "damaged", label: "Damaged", value: 520, events: 2 });
check("by_reason recalled", r.summary.by_reason.find((x) => x.reason === "recalled"), { reason: "recalled", label: "Recalled", value: 610, events: 1 });
check("by_reason lost", r.summary.by_reason.find((x) => x.reason === "lost"), { reason: "lost", label: "Lost", value: 150, events: 1 });
check("reason order (expired first, lost last)", r.summary.by_reason.map((x) => x.reason), ["expired", "damaged", "recalled", "lost"]);
check("ranked item order (loss desc)", r.by_item.map((g) => g.loss), [1113, 830, 720, 610, 330, 255, 150, 105]);
check("CMP has both reasons in canonical order", r.by_item.find((g) => g.item_id === 3).reasons, ["Expired", "Damaged"]);
check("CMP events + loss", [r.by_item.find((g) => g.item_id === 3).events, r.by_item.find((g) => g.item_id === 3).loss], [2, 830]);
check("Troponin share pct", r.by_item[0].share_pct, 27.1);
check("shares sum ~100", Math.round(r.by_item.reduce((s, g) => s + g.share_pct, 0)), 100);
check("Assayed last_event_date is the later of two", r.by_item.find((g) => g.item_id === 4).last_event_date, "2026-07-10");

// Deleted-item fallback: item_id null groups by name.
const orphan = buildWasteReport([
  { item_id: null, item_name: "Deleted Reagent", reason_code: "expired", qty: 1, unit_cost: 50, waste_value: 50, event_date: "2026-07-01" },
  { item_id: null, item_name: "Deleted Reagent", reason_code: "damaged", qty: 1, unit_cost: 50, waste_value: 50, event_date: "2026-07-02" },
]);
check("deleted item groups by name", [orphan.summary.item_count, orphan.by_item[0].events, orphan.by_item[0].loss], [1, 2, 100]);

// Empty period.
check("empty period is clean zero", buildWasteReport([]).summary, { total_loss: 0, event_count: 0, item_count: 0, by_reason: [], top_item: null });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
