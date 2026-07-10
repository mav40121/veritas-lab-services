// scripts/verify-nys-clep-phase0.mjs
//
// Receipt for NYS CLEP Phase-0 (2026-07-10): per-lab jurisdiction foundation on
// the core `labs` table (data model + director-confirm + "NYS DOH / CLEP" badge),
// dual-accreditation model, zero change for CLIA labs. Catholic Health / Maria
// Walsh demo dependency. See project_catholic_health_nys_clep memory.
//
//   node scripts/verify-nys-clep-phase0.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

const db = read("server/db.ts");
const routes = read("server/routes.ts");
const mem = read("client/src/hooks/useMemberships.ts");
const sw = read("client/src/components/LabSwitcher.tsx");
const acct = read("client/src/pages/AccountSettingsPage.tsx");

// 1. Schema: 4 columns, CLIA/none defaults (CLIA-safe, pure ALTER+DEFAULT)
ok("schema: primary_regime DEFAULT 'CLIA'", /ALTER TABLE labs ADD COLUMN primary_regime TEXT NOT NULL DEFAULT 'CLIA'/.test(db));
ok("schema: nys_permit_type DEFAULT 'none'", /ALTER TABLE labs ADD COLUMN nys_permit_type TEXT NOT NULL DEFAULT 'none'/.test(db));
ok("schema: nys_confirmed_by + nys_confirmed_at", /nys_confirmed_by INTEGER/.test(db) && /nys_confirmed_at TEXT/.test(db));
ok("schema: added via the guarded ensure() ALTER pattern (no cascading writes)", /ensure\("primary_regime"/.test(db));

// 2. Membership read exposes regime + soft NY suggestion
ok("read: response carries primaryRegime default CLIA", /primaryRegime: m\.primary_regime \|\| 'CLIA'/.test(routes));
ok("read: nysSuggested from owner state = NY, never NYS-CLEP already", /nysSuggested: m\.primary_regime !== 'NYS-CLEP' && String\(m\.owner_state/.test(routes));

// 3. Confirm endpoint: owner/admin gate + dual-accreditor requirement + audit
ok("endpoint: POST /api/labs/:labId/jurisdiction exists", /app\.post\("\/api\/labs\/:labId\/jurisdiction"/.test(routes));
ok("endpoint: only owner/admin may set (403)", /Only the laboratory director or designee \(owner or admin\) can set jurisdiction/.test(routes));
ok("endpoint: NYS-CLEP requires a national accreditor (dual model, 400)",
  /A New York laboratory is dual: NYS DOH \/ CLEP plus a national accreditor/.test(routes) &&
  /accreditation_tjc \|\| lab\.accreditation_cap \|\| lab\.accreditation_cola/.test(routes));
ok("endpoint: director-attested (nys_confirmed_by/_at) + audit log", /nys_confirmed_by = \?, nys_confirmed_at = \?/.test(routes) && /INSERT INTO lab_audit_log[\s\S]{0,120}'primary_regime'/.test(routes));

// 4. Client type + badge (only for NYS-CLEP = CLIA-safe)
ok("type: Membership has primaryRegime union", /primaryRegime\?: "CLIA" \| "NYS-CLEP"/.test(mem));
ok("badge: renders ONLY when primaryRegime === 'NYS-CLEP'", /\{m\.primaryRegime === "NYS-CLEP" &&/.test(sw) && /NYS DOH \/ CLEP/.test(sw));
ok("badge: shows the dual accreditor (+ TJC/CAP/COLA)", /NYS DOH \/ CLEP\{m\.accreditationTjc \? " \+ TJC"/.test(sw));

// 5. Confirm card gated on owner/admin + accreditor
ok("card: Laboratory Jurisdiction card present", /Laboratory Jurisdiction/.test(acct));
ok("card: confirm gated on owner/admin + national accreditor", /canSetJurisdiction/.test(acct) && /hasNationalAccreditor/.test(acct) && /jurisdictionMutation\.mutate\("NYS-CLEP"\)/.test(acct));
ok("card: invalidates /api/labs/me so the badge refreshes", /invalidateQueries\(\{ queryKey: \["\/api\/labs\/me"\] \}\)/.test(acct));

console.log(fails === 0 ? "\n=== NYS CLEP PHASE-0: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
