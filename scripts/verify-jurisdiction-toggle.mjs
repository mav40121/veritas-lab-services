// scripts/verify-jurisdiction-toggle.mjs
//
// Receipt for the Laboratory Jurisdiction control redesign (2026-07-11). The
// card used to show a one-way "Confirm NYS DOH / CLEP jurisdiction" button (with
// "Revert to CLIA" only visible from the other state), which read as a one-time
// commit. It is now a two-option segmented control [ CLIA (federal) | NYS DOH /
// CLEP ] with the active regime highlighted; switching opens a ConfirmDialog
// (jurisdiction re-frames the lab's compliance context). The accreditor
// prerequisite and the director/admin permission gate are preserved.
//
//   node scripts/verify-jurisdiction-toggle.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "client/src/pages/AccountSettingsPage.tsx"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

// old one-way buttons removed
ok("old 'Confirm NYS DOH / CLEP jurisdiction' button removed", !/Confirm NYS DOH \/ CLEP jurisdiction/.test(src));
ok("old 'Revert to CLIA' button removed", !/Revert to CLIA/.test(src));

// segmented two-state control present
ok("segmented control present (role=group aria-label)", /role="group" aria-label="Laboratory jurisdiction"/.test(src));
ok("both regime labels rendered", /CLIA \(federal\)/.test(src) && /NYS DOH \/ CLEP/.test(src));
ok("active regime marked aria-current", (src.match(/aria-current="true"/g) || []).length >= 2);

// switching gated by a confirm dialog that fires the mutation
ok("switch to CLIA goes through ConfirmDialog -> mutate('CLIA')",
  /confirmLabel="Switch to CLIA"[\s\S]*?onConfirm=\{\(\) => jurisdictionMutation\.mutate\("CLIA"\)\}/.test(src));
ok("switch to NYS-CLEP goes through ConfirmDialog -> mutate('NYS-CLEP')",
  /confirmLabel="Switch to NYS DOH \/ CLEP"[\s\S]*?onConfirm=\{\(\) => jurisdictionMutation\.mutate\("NYS-CLEP"\)\}/.test(src));

// accreditor prerequisite preserved: the NYS segment is only actionable when a national accreditor exists
ok("NYS segment gated on canSetJurisdiction && hasNationalAccreditor",
  /canSetJurisdiction && hasNationalAccreditor \?/.test(src));
ok("accreditor-first hint retained", /Select a national accreditor \(TJC, CAP, or COLA\) above before setting this lab to NYS DOH \/ CLEP\./.test(src));

// permission gate preserved
ok("director/admin permission note retained",
  /Only the laboratory director or designee \(owner or admin\) can set jurisdiction\./.test(src));

console.log(fails === 0 ? "\n=== JURISDICTION TOGGLE: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
