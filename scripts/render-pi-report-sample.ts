// Local render of the real PI report module with sample data, to eyeball vs the
// approved mock. npx tsx scripts/render-pi-report-sample.ts
import { generatePiReportPDF } from "../server/piReport";
import fs from "node:fs";

const OUT = "C:/Users/veril/AppData/Local/Temp/claude/C--Users-veril/76f2cc96-752b-49d6-be5b-616759d60139/scratchpad/pi_report_real.pdf";

const metric = {
  name: "Blood Culture Contamination Rate", unit: "%", direction: "lower_is_better",
  benchmark_green: 3.0, benchmark_yellow: 5.0, benchmark_red: null, department: "Microbiology",
};
const entries = [
  { year: 2026, month: 1, value: 3.8, volume: 420, notes: "New draw staff onboarding" },
  { year: 2026, month: 2, value: 3.1, volume: 445, notes: "" },
  { year: 2026, month: 3, value: 2.9, volume: 460, notes: "" },
  { year: 2026, month: 4, value: 3.4, volume: 438, notes: "ED night-shift outlier" },
  { year: 2026, month: 5, value: 2.6, volume: 472, notes: "" },
  { year: 2026, month: 6, value: 2.4, volume: 455, notes: "" },
  { year: 2026, month: 7, value: 2.8, volume: 468, notes: "" },
  { year: 2026, month: 8, value: 2.2, volume: 480, notes: "" },
];
const ctx = { labName: "Troy Regional Medical Center", cliaNumber: "01D0303925", preparedBy: "Rachel Hermosilla", year: 2026 };

(async () => {
  const buf = await generatePiReportPDF(metric as any, entries as any, ctx);
  fs.writeFileSync(OUT, buf);
  console.log("wrote", OUT, buf.length, "bytes");
  process.exit(0);
})();
