// scripts/verify-veritatrack-copy-batch.mjs
//
// Receipt for the VeritaTrack copy + false-success batch (audit #8, #13, #14,
// 2026-07-11):
//   #8  "Auto-imports schedules from VeritaMap so adding a new instrument
//       creates its cadence automatically" overstated a manual Import button.
//       Reworded to the one-click reality across all 4 surfaces (AppPage,
//       DemoLabPage, VeritaAssurePage, and the inject_howto_cards.py generator).
//   #13 banned "Cal Ver" / "cal ver" abbreviation + "method comparison" alone
//       in customer-facing UI copy -> full labels.
//   #14 deleteTask never checked r.ok, so a failed delete reported success.
//
//   node scripts/verify-veritatrack-copy-batch.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

const app = read("client/src/pages/VeritaTrackAppPage.tsx");
const demo = read("client/src/pages/DemoLabPage.tsx");
const suite = read("client/src/pages/VeritaAssurePage.tsx");
const script = read("scripts/inject_howto_cards.py");

// #8 auto-import overstatement removed across the class of 4
ok("#8 AppPage no longer claims auto-import 'automatically'",
  !/Auto-imports schedules from VeritaMap so adding a new instrument creates its cal-ver cadence automatically/.test(app) &&
  !/tasks auto-create here at their CLIA cadence/.test(app));
ok("#8 AppPage states the one-click manual import", /One-click import of your VeritaMap test menu/.test(app));
ok("#8 DemoLabPage class-copy reworded (no 'auto-creates its cal-ver cadence')",
  !/adding a new instrument auto-creates its cal-ver cadence/.test(demo) && !/Auto-imports schedules from VeritaMap&#8482;\./.test(demo));
ok("#8 VeritaAssurePage class-copy reworded", !/Auto-imports schedules from VeritaMap™\./.test(suite) && /One-click import of your VeritaMap™ test menu/.test(suite));
ok("#8 the inject_howto_cards.py generator matches (no auto-create)",
  !/creates its cal-ver cadence automatically/.test(script) && !/tasks auto-create here at their CLIA cadence/.test(script));

// #13 Cal-Ver / method-comparison copy corrected (customer-facing strings only)
ok("#13 placeholder uses 'Calibration Verification', not 'Cal Ver'", /placeholder="e\.g\. Calibration Verification - Sodium"/.test(app));
ok("#13 import tooltip uses full labels (calibration verification + correlation / method comparison)",
  /Import calibration verification, correlation \/ method comparison, precision, and SOP schedules/.test(app));

// #14 deleteTask now checks r.ok
ok("#14 deleteTask throws on !r.ok (no false success)",
  /const deleteTask = useMutation\(\{[\s\S]*?method: "DELETE"[\s\S]*?if \(!r\.ok\) throw new Error/.test(app));

console.log(fails === 0 ? "\n=== VERITATRACK COPY BATCH: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
