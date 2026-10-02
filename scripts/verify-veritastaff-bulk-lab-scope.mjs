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

// (a) the per-handler inline resolution was centralized into two helpers:
//   activeStaffLab(req, dataUserId) = resolveActiveLabForRequest(...) -> staffLabByLabId(...)
//   staffLabByLabId(labId, ownerUserId) = staff_labs WHERE tier2_lab_id (active lab),
//                                         with a WHERE user_id fallback.
// The bulk template/preview/commit handlers call activeStaffLab() (same multi-lab
// correctness, now DRY). Assert the helper chain rather than the old inline SQL.
ok("activeStaffLab() resolves the active lab then the staff_labs row",
  /function activeStaffLab\(req: any, dataUserId: number\)[\s\S]{0,160}resolveActiveLabForRequest\(req\.userId, req\)[\s\S]{0,120}staffLabByLabId\(activeLab\?\.id/.test(routes));
ok("staffLabByLabId resolves staff_labs by the active lab's tier2_lab_id",
  /function staffLabByLabId\([\s\S]{0,300}FROM staff_labs WHERE tier2_lab_id = \?"\)\.get\(labId\)/.test(routes));
ok("staffLabByLabId keeps a user_id fallback for single-lab / no header",
  /function staffLabByLabId\([\s\S]{0,400}FROM staff_labs WHERE user_id = \?"\)\.all\(ownerUserId\)/.test(routes));
ok("the bulk-commit handler resolves the lab via activeStaffLab(req, dataUserId)",
  /const lab = activeStaffLab\(req, dataUserId\)/.test(routes));

// (b) bulk-commit INSERT now sets tier2_lab_id (visible in the lab-scoped roster)
ok("bulk-commit INSERT sets tier2_lab_id",
  /INSERT INTO staff_employees \(lab_id, tier2_lab_id, user_id,[\s\S]*?VALUES \(\?,\?,\?,\?,\?,\?,\?,\?,\?,\?,\?,\?,\?,\?,\?,\?\)/.test(routes));
ok("bulk-commit passes lab.tier2_lab_id to the INSERT",
  /insertEmpStmt\.run\(\s*lab\.id, lab\.tier2_lab_id, dataUserId,/.test(routes));

console.log(fails === 0 ? "\n=== VERITASTAFF BULK LAB-SCOPE: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
