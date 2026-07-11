// scripts/verify-veritastaff-error-states.mjs
//
// Receipt for the VeritaStaff error-state fix (audit #6, 2026-07-10). The two
// dashboard tiles returned zeros on a failed fetch, hit their `total === 0`
// guard, and rendered null -> a broken stats endpoint looked identical to
// "nobody overdue". The roster had no error branch, so a failed employees fetch
// rendered the "No employees yet" empty state -> a director with 20 staff could
// think the roster was wiped and re-add duplicates. Now all three throw / detect
// isError and render a distinct "unavailable, refresh to retry" state.
//
//   node scripts/verify-veritastaff-error-states.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

const comp = read("client/src/components/CompetencyStatusTile.tsx");
const cred = read("client/src/components/CredentialExpirationTile.tsx");
const roster = read("client/src/pages/VeritaStaffAppPage.tsx");

for (const [name, src, msg] of [
  ["CompetencyStatusTile", comp, "Competency status is unavailable"],
  ["CredentialExpirationTile", cred, "Credential status is unavailable"],
]) {
  ok(`${name}: throws on !r.ok (surfaces isError, not zeros)`, /if \(!r\.ok\) throw new Error\(/.test(src));
  ok(`${name}: destructures isError`, /const \{ data, isLoading, isError \} = useQuery/.test(src));
  ok(`${name}: renders a distinct error card before the empty/null guard`,
    new RegExp(`if \\(isError\\) return \\(`).test(src) && src.includes(msg));
}

ok("roster: destructures isError (empError)", /isLoading: empLoading, isError: empError \} = useQuery/.test(roster));
ok("roster: renders an error branch distinct from the empty state",
  /\) : empError \? \(/.test(roster) && /Could not load employees/.test(roster));

console.log(fails === 0 ? "\n=== VERITASTAFF ERROR STATES: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
