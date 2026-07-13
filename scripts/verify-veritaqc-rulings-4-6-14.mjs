// scripts/verify-veritaqc-rulings-4-6-14.mjs
//
// Receipt for the three VeritaQC audit items Michael ruled on (2026-07-12):
//   #4  the QC->VeritaResponse escalation stamped '42 CFR 493.1256(d)' (the
//       daily-control/IQCP clause) as "the corrective-action requirement".
//       Corrected to 42 CFR 493.1282 (the CLIA corrective-action standard).
//       NOTE: legitimate 493.1256(d) citations elsewhere (policy templates,
//       VeritaScan checklist, VeritaMap) are QC-control-procedure references and
//       are intentionally left untouched.
//   #6  R-4s fired on a > 4s range alone; canonical R-4s requires the two points
//       to STRADDLE the mean (one > +2s AND the other < -2s). Added the straddle
//       guard.
//   #14 the monthly QC PDF attestation lacked a blank Signature line. Added one.
//
//   node scripts/verify-veritaqc-rulings-4-6-14.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routes = fs.readFileSync(path.join(ROOT, "server/routes.ts"), "utf8");
const daily = fs.readFileSync(path.join(ROOT, "client/src/pages/VeritaQCDailyReviewPage.tsx"), "utf8");
const pdf = fs.readFileSync(path.join(ROOT, "server/pdfQCMonthly.ts"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

console.log("=== #4 escalation CFR -> 493.1282 ===");
ok("#4 the escalation finding INSERT uses 42 CFR 493.1282",
  /VALUES \(\?, \?, 'CMS', \?, '42 CFR 493\.1282', /.test(routes));
ok("#4 the escalation comment cites 493.1282 (corrective-action standard)",
  /citing 42 CFR 493\.1282 \(the CLIA\s*\n?\s*\/\/\s*corrective-action standard\)/.test(routes));
ok("#4 no escalation INSERT still cites 493.1256(d)",
  !/VALUES \(\?, \?, 'CMS', \?, '42 CFR 493\.1256\(d\)'/.test(routes));
ok("#4 the daily-review escalate toast cites 493.1282",
  /Finding #\$\{data\.finding_id\} created, citing 42 CFR 493\.1282\./.test(daily));
ok("#4 the daily-review escalate button title cites 493.1282",
  /citing 42 CFR 493\.1282"/.test(daily));
ok("#4 no 493.1256\\(d\\) remains anywhere in the daily review page",
  !/493\.1256\(d\)/.test(daily));

console.log("\n=== #6 R-4s straddle guard ===");
ok("#6 R-4s now requires the straddle (one >+2s AND the other <-2s)",
  /Math\.abs\(z - sdis\[i - 1\]\) > 4 &&\s*\n?\s*\(\(z > 2 && sdis\[i - 1\] < -2\) \|\| \(z < -2 && sdis\[i - 1\] > 2\)\)/.test(routes));
ok("#6 the detail text reflects the straddle (not 'across zero')",
  /points straddle the mean \(>\+2s and <-2s\)/.test(routes) && !/range \$\{Math\.abs\(z - sdis\[i - 1\]\)\.toFixed\(2\)\}SD across zero/.test(routes));

// Functional proof of the new R-4s condition.
console.log("\n=== #6 functional R-4s cases ===");
function r4s(z, prev) {
  return Math.abs(z - prev) > 4 && ((z > 2 && prev < -2) || (z < -2 && prev > 2));
}
ok("#6 z=-2.2 then +1.9 (span 4.1, NOT straddling) does NOT fire (old bug fixed)", r4s(1.9, -2.2) === false);
ok("#6 z=+2.5 then -2.5 (span 5.0, straddles) FIRES", r4s(2.5, -2.5) === true);
ok("#6 z=-2.6 then +2.6 (span 5.2, straddles) FIRES", r4s(-2.6, 2.6) === true);
ok("#6 z=+3.1 then +1.0 (span 2.1) does NOT fire", r4s(3.1, 1.0) === false);
ok("#6 z=+2.1 then -2.1 (span 4.2, straddles) FIRES", r4s(2.1, -2.1) === true);

console.log("\n=== #14 PDF signature line ===");
ok("#14 the attestation block has a Signature label", /<div class="ack-label">Signature<\/div>/.test(pdf));
ok("#14 the signature line is a blank ruled line", /Signature<\/div>\s*<div style="border-bottom:1px solid #333;height:22pt"><\/div>/.test(pdf));
ok("#14 no em-dash introduced in the signature block", !/Signature<\/div>[\s\S]{0,120}—/.test(pdf));

console.log(fails === 0 ? "\n=== VERITAQC RULINGS #4 + #6 + #14: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
