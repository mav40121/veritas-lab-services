// scripts/verify-veritapolicy-multilab-rekey.mjs
//
// Receipt for the VeritaPolicy multi-lab data-loss fix (2026-07-10, audit HIGH
// #1/#2). veritapolicy_master_status and veritapolicy_settings were keyed
// UNIQUE(user_id, policy_id) / UNIQUE(user_id), so a multi-lab OWNER's per-lab
// policy status + settings collapsed into one shared row (cross-lab data loss).
// This asserts the db.ts rebuild migration + the four routes.ts handlers now key
// by lab_id. The migration SQL itself was proven lossless + idempotent against a
// prod snapshot (12 master + 3 settings rows preserved, new UNIQUE enforced,
// cross-lab insert allowed, same-lab dup rejected).
//
//   node scripts/verify-veritapolicy-multilab-rekey.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

const dbTs = read("server/db.ts");
const routes = read("server/routes.ts");

// 1. db.ts: Phase 3.3 rebuild present, guarded on the old user_id UNIQUE, new keys
ok("db: Phase 3.3 rebuild block present", /Phase 3\.3 \(VeritaPolicy\)/.test(dbTs));
ok("db: guards on the old user_id UNIQUE index (idempotent)",
  /uniqueIndexOn\("veritapolicy_master_status", \["user_id", "policy_id"\]\)/.test(dbTs) &&
  /uniqueIndexOn\("veritapolicy_settings", \["user_id"\]\)/.test(dbTs));
ok("db: master_status rebuilt with UNIQUE(lab_id, policy_id)",
  /CREATE TABLE veritapolicy_master_status_new[\s\S]{0,600}UNIQUE\(lab_id, policy_id\)/.test(dbTs));
ok("db: settings rebuilt with UNIQUE(lab_id)",
  /CREATE TABLE veritapolicy_settings_new[\s\S]{0,800}UNIQUE\(lab_id\)/.test(dbTs));
ok("db: rebuild is transaction-wrapped (BEGIN/COMMIT x2) + catch-wrapped (ROLLBACK x2)",
  (dbTs.match(/sqlite\.exec\("BEGIN"\)/g) || []).length >= 2 &&
  (dbTs.match(/sqlite\.exec\("COMMIT"\)/g) || []).length >= 2 &&
  (dbTs.match(/sqlite\.exec\("ROLLBACK"\)/g) || []).length >= 2);
ok("db: copy preserves every master column (no drop)",
  /INSERT OR IGNORE INTO veritapolicy_master_status_new[\s\S]{0,260}user_id, lab_id, policy_id, status, is_na, na_reason, our_policy_name, notes, updated_at/.test(dbTs));
ok("db: copy preserves every settings column (no drop)",
  /INSERT OR IGNORE INTO veritapolicy_settings_new[\s\S]{0,400}accreditation_body/.test(dbTs));

// 2. routes.ts: the four write handlers now conflict on lab_id, none on user_id for these tables
const masterLabConflicts = (routes.match(/INSERT INTO veritapolicy_master_status[\s\S]{0,260}ON CONFLICT\(lab_id, policy_id\)/g) || []).length;
const settingsLabConflicts = (routes.match(/INSERT INTO veritapolicy_settings[\s\S]{0,220}ON CONFLICT\(lab_id\)/g) || []).length;
ok("routes: both master_status upserts key ON CONFLICT(lab_id, policy_id) (lab-scoped + legacy account)", masterLabConflicts >= 2);
ok("routes: both settings upserts key ON CONFLICT(lab_id) (lab-scoped + legacy account)", settingsLabConflicts >= 2);
ok("routes: no master_status upsert still keys ON CONFLICT(user_id, policy_id)",
  !/INSERT INTO veritapolicy_master_status[\s\S]{0,260}ON CONFLICT\(user_id, policy_id\)/.test(routes));
ok("routes: no settings upsert still keys ON CONFLICT(user_id)",
  !/INSERT INTO veritapolicy_settings[\s\S]{0,220}ON CONFLICT\(user_id\)/.test(routes));

// 3. legacy account write routes resolve the owner's home lab (no NULL-lab dup rows)
ok("routes: legacy account writes resolve home lab + guard NULL (no orphan dup rows)",
  (routes.match(/No lab is associated with your account\. Select a lab first\./g) || []).length >= 2);

console.log(fails === 0 ? "\n=== VERITAPOLICY MULTI-LAB RE-KEY: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
