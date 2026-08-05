// Verify the PI report math + status logic via the real buildPiReportHTML output.
//   npx tsx scripts/verify-pi-report.ts
import { buildPiReportHTML } from "../server/piReport";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}`); } };

// lower-is-better: blood culture contamination, benchmark green<=3.0, watch<=5.0
const lb = buildPiReportHTML(
  { name: "Blood Culture Contamination Rate", unit: "%", direction: "lower_is_better", benchmark_green: 3.0, benchmark_yellow: 5.0, benchmark_red: null, department: "Microbiology" },
  [
    { year: 2026, month: 1, value: 3.8, volume: 420, notes: "" },
    { year: 2026, month: 2, value: 3.1, volume: 445, notes: "" },
    { year: 2026, month: 3, value: 2.9, volume: 460, notes: "" },
    { year: 2026, month: 4, value: 3.4, volume: 438, notes: "" },
    { year: 2026, month: 5, value: 2.6, volume: 472, notes: "" },
    { year: 2026, month: 6, value: 2.4, volume: 455, notes: "" },
    { year: 2026, month: 7, value: 2.8, volume: 468, notes: "" },
    { year: 2026, month: 8, value: 2.2, volume: 480, notes: "" },
  ],
  { labName: "Troy Regional Medical Center", cliaNumber: "01D0303925", preparedBy: "Rachel", year: 2026 }
);
// unweighted avg = (3.8+3.1+2.9+3.4+2.6+2.4+2.8+2.2)/8 = 2.9000
ok("lower: YTD unweighted 2.90%", lb.includes("2.90</b>%") || lb.includes("2.90%</b>"));
// pooled = sum(v*vol)/sum(vol) = 2.8815... -> 2.88
ok("lower: pooled 2.88%", lb.includes("2.88</b>%") || lb.includes("2.88%</b>"));
// months on target ( <=3.0 ): Mar,May,Jun,Jul,Aug = 5
ok("lower: 5 of 8 on target", lb.includes("<b>5 of 8</b>"));
ok("lower: has On target (green) status", lb.includes("On target") && lb.includes("#437A22"));
ok("lower: has Watch (amber) status for 3.8/3.1/3.4", lb.includes("Watch") && lb.includes("#964219"));
ok("lower: no em-dash in body (footer TM verified in render)", !lb.includes("—"));

// higher-is-better: % compliance, green>=95, watch>=90
const hb = buildPiReportHTML(
  { name: "Critical Value Callback Compliance", unit: "%", direction: "higher_is_better", benchmark_green: 95, benchmark_yellow: 90, benchmark_red: null, department: "Core Lab" },
  [
    { year: 2026, month: 1, value: 96, volume: 100, notes: "" }, // On target
    { year: 2026, month: 2, value: 92, volume: 100, notes: "" }, // Watch
    { year: 2026, month: 3, value: 88, volume: 100, notes: "" }, // Action
  ],
  { labName: "L", cliaNumber: "C", preparedBy: "p", year: 2026 }
);
ok("higher: 96 is On target (green)", hb.includes("On target"));
ok("higher: 92 is Watch (amber)", hb.includes("Watch"));
ok("higher: 88 is Action (red)", hb.includes("Action") && hb.includes("#A12C7B"));
ok("higher: 1 of 3 on target", hb.includes("<b>1 of 3</b>"));

// empty year: no crash, shows empty-state
const empty = buildPiReportHTML(
  { name: "X", unit: "%", direction: "lower_is_better", benchmark_green: 3, benchmark_yellow: 5, benchmark_red: null, department: null },
  [], { labName: "L", cliaNumber: "C", preparedBy: "p", year: 2027 }
);
ok("empty: renders without crash + shows no-data", empty.includes("No entries for 2027") || empty.includes("No monthly values"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
