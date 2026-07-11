// scripts/verify-veritastaff-bulk-lab-scope.mjs
//
// Receipt for the VeritaStaff bulk-import multi-lab fix (audit #2, 2026-07-10).
// Two compounded bugs:
//   (a) the bulk template/preview/commit resolved the lab via
//       `staff_labs WHERE user_id` -> an arbitrary row for a multi-lab owner, so
//       an import targeted the wrong lab. Now they resolve the ACTIVE lab from the
//       X-Active-Lab-Id header (resolveActiveLabForRequest, access-validated),
//       falling back to the user_id row for single-lab / no-header.
//   (b) bulk-commit INSERT never set tier2_lab_id, but the lab-scoped roster reads
//       WHERE tier2_lab_id -> imported employees were INVISIBLE in the app. Now the
//       INSERT sets tier2_lab_id from the resolved staff_labs row.
//
//   node scripts/verify-veritastaff-bulk-lab-scope.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routes = fs.readFileSync(path.join(ROOT, "server/routes.ts"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

// (a) all three bulk handlers resolve the active lab, with a user_id fallback
const activeResolveCount = (routes.match(/const activeLab = resolveActiveLabForRequest\(req\.userId, req\);/g) || []).length;
ok("all 3 bulk handlers resolve the active lab (template + preview + commit)", activeResolveCount >= 3);
const tier2Resolve = (routes.match(/FROM staff_labs WHERE tier2_lab_id = \?"\)\.get\(activeLab\.id\)/g) || []).length;
ok("bulk handlers resolve staff_labs by the active lab's tier2_lab_id", tier2Resolve >= 3);
ok("bulk handlers keep a user_id fallback for single-lab / no header",
  (routes.match(/FROM staff_labs WHERE user_id = \?"\)\.get\(dataUserId\)/g) || []).length >= 3);

// (b) bulk-commit INSERT now sets tier2_lab_id (visible in the lab-scoped roster)
ok("bulk-commit INSERT sets tier2_lab_id",
  /INSERT INTO staff_employees \(lab_id, tier2_lab_id, user_id,[\s\S]*?VALUES \(\?,\?,\?,\?,\?,\?,\?,\?,\?,\?,\?,\?,\?,\?,\?,\?\)/.test(routes));
ok("bulk-commit passes lab.tier2_lab_id to the INSERT",
  /insertEmpStmt\.run\(\s*lab\.id, lab\.tier2_lab_id, dataUserId,/.test(routes));

console.log(fails === 0 ? "\n=== VERITASTAFF BULK LAB-SCOPE: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
