// scripts/verify-veritabench-copy.mjs
//
// Receipt for the VeritaBench copy-fixes batch (2026-07-12):
//   #2  the public /demo/operations productivity calculator dollarized an arbitrary
//       benchmark gap into "$X/yr in labor savings" / "Annual savings potential".
//       That unsubstantiated financial claim (and its orphan hourly-rate input) is
//       removed; the honest hours/FTE gap vs the benchmark midpoint remains.
//   #13 the customer-facing PI starter library cited "AABB Standards 34th ed." in
//       metric source fields. Per the dated-manual ban (CLAUDE.md Sec 3) it now
//       reads "AABB Standards".
//
//   node scripts/verify-veritabench-copy.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const demo = fs.readFileSync(path.join(ROOT, "client/src/pages/DemoPage.tsx"), "utf8");
const lib = fs.readFileSync(path.join(ROOT, "client/src/lib/piStarterLibrary.ts"), "utf8");
const spec = fs.readFileSync(path.join(ROOT, "tests/playwright/veritabench-copy.spec.ts"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

// #2 dollar-savings claim removed
ok("#2 no 'labor savings' claim remains on the demo calculator", !/labor savings/i.test(demo));
ok("#2 no 'savings potential' claim remains", !/savings potential/i.test(demo));
ok("#2 the annualSavings computation is gone", !/annualSavings/.test(demo));
ok("#2 the orphan hourly-rate state/input is gone", !/hourlyRate/.test(demo));
ok("#2 the result object no longer carries annualSavings",
  /return \{ ratio, band, midpoint, targetHours, hoursDiff, fteDiff, isOutperforming \};/.test(demo));
ok("#2 the honest per-test metric label remains", /productive hours per billable test/.test(demo));

// #13 dated AABB reference removed
ok("#13 no dated AABB edition remains in the PI starter library", !/AABB Standards \d/.test(lib) && !/34th ed/.test(lib));
ok("#13 the undated 'AABB Standards' citation remains", /AABB Standards/.test(lib));

// no em-dashes introduced
ok("no em-dash in DemoPage", !demo.includes("—"));
ok("no em-dash in piStarterLibrary", !lib.includes("—"));

// gate3 browser evidence
ok("spec added and asserts the demo calculator has no savings claim",
  /demo\/operations/.test(spec) && /labor savings|savings potential|Average Hourly/i.test(spec));

console.log(fails === 0 ? "\n=== VERITABENCH COPY: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
