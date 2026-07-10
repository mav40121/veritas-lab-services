// scripts/verify-veritapolicy-med-client.mjs
//
// Receipt for the VeritaPolicy client MED batch (audit #4/#5/#6, 2026-07-10):
//   #4 search box was a no-op (the `grouped` useMemo iterated filteredDocs but
//      depended on [documents, manuals], so typing never re-filtered).
//   #5 app + demo copy claimed "96" policies; the real master list has 58.
//   #6 a "Mayo" placeholder shipped in the Upload-new-version change-summary field.
//
//   node scripts/verify-veritapolicy-med-client.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

const myPolicies = read("client/src/pages/VeritaPolicyMyPoliciesPage.tsx");
const appPage = read("client/src/pages/VeritaPolicyAppPage.tsx");
const demo = read("client/src/pages/DemoLabPage.tsx");

// #4 search: grouped memo now depends on filteredDocs (re-filters on keystroke)
ok("#4 grouped memo depends on filteredDocs (search re-filters)", /\}, \[filteredDocs, manuals\]\);/.test(myPolicies));
ok("#4 no stale [documents, manuals] dep remains on the grouped memo",
  !/docs: byManual\.get\(name\)!,\s*\}\)\);\s*\}, \[documents, manuals\]\);/.test(myPolicies));

// #5 count: 58 not 96, and the app card is data-driven
ok("#5 app card count is data-driven (policies.length || 58)", /\$\{policies\.length \|\| 58\}-policy/.test(appPage) && /\$\{policies\.length \|\| 58\}-row/.test(appPage));
ok("#5 no hardcoded '96' policy claim in the app page", !/96-policy|96-row/.test(appPage));
ok("#5 demo page states 58 CFR-anchored policies", /58 CFR-anchored laboratory policies/.test(demo));
ok("#5 demo page no longer claims 96", !/96 CFR-anchored|96 generic policy templates/.test(demo));
ok("#5 demo section list includes Results (was omitted)", /Testing, Results, Personnel/.test(demo));

// #6 Mayo placeholder removed
ok("#6 no Mayo placeholder in the new-version field", !/Mayo/.test(myPolicies));
ok("#6 the change-summary example now cites MEC review", /Updated critical value list per MEC review/.test(myPolicies));

console.log(fails === 0 ? "\n=== VERITAPOLICY MED CLIENT BATCH: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
