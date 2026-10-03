// scripts/verify-lab-reset.mjs
//
// Receipt for server/labReset.ts (the /api/admin/labs/reset-and-reassign engine).
// Builds a synthetic SQLite that reproduces the three hazards the real schema has:
//   1. a grandchild reached only through a parent (signoffs -> tasks -> labs),
//   2. the staff_labs indirection where a child's `lab_id` is staff_labs.id NOT
//      labs.id (a naive "DELETE WHERE lab_id IN (targets)" deletes the WRONG rows),
//   3. an undeclared labs-scoped column (policy_manuals.lab_id with no FK),
// plus a non-target lab whose data must be left completely intact.
//
// Run: npx tsx scripts/verify-lab-reset.mjs
import { createRequire } from "module";
import { computeDeletionScope, applyDeletion, transferOwnership, orphanScan } from "../server/labReset.ts";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const db = new Database(":memory:");
db.pragma("foreign_keys = OFF");
db.exec(`
  CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, name TEXT);
  CREATE TABLE organizations (id INTEGER PRIMARY KEY, name TEXT, billing_owner_user_id INTEGER, created_at TEXT, updated_at TEXT);
  CREATE TABLE labs (id INTEGER PRIMARY KEY, lab_name TEXT, clia_number TEXT, owner_user_id INTEGER, organization_id INTEGER, created_at TEXT, updated_at TEXT);
  CREATE TABLE organization_members (id INTEGER PRIMARY KEY, organization_id INTEGER, user_id INTEGER, org_role TEXT, status TEXT, created_at TEXT, updated_at TEXT);
  CREATE TABLE lab_members (id INTEGER PRIMARY KEY, lab_id INTEGER REFERENCES labs(id), user_id INTEGER, role TEXT, status TEXT, is_primary_lab INTEGER DEFAULT 0, updated_at TEXT);
  CREATE TABLE user_seats (id INTEGER PRIMARY KEY, lab_id INTEGER, owner_user_id INTEGER REFERENCES users(id), seat_email TEXT, seat_user_id INTEGER, status TEXT);
  CREATE TABLE studies (id INTEGER PRIMARY KEY, lab_id INTEGER REFERENCES labs(id), name TEXT);
  CREATE TABLE veritatrack_tasks (id INTEGER PRIMARY KEY, lab_id INTEGER REFERENCES labs(id), name TEXT);
  CREATE TABLE veritatrack_signoffs (id INTEGER PRIMARY KEY, task_id INTEGER REFERENCES veritatrack_tasks(id), lab_id INTEGER REFERENCES labs(id));
  CREATE TABLE staff_labs (id INTEGER PRIMARY KEY, tier2_lab_id INTEGER REFERENCES labs(id), lab_name TEXT);
  CREATE TABLE staff_employees (id INTEGER PRIMARY KEY, lab_id INTEGER REFERENCES staff_labs(id), name TEXT);
  CREATE TABLE policy_manuals (id INTEGER PRIMARY KEY, lab_id INTEGER, title TEXT);
`);

// users: 100 old owner, 200 new owner, 300 bystander admin
db.exec(`INSERT INTO users (id,email,name) VALUES (100,'old@x','Old'),(200,'new@x','New'),(300,'mv@x','MV')`);
db.exec(`INSERT INTO organizations (id,name,billing_owner_user_id,created_at,updated_at) VALUES (10,'Org',100,'t','t')`);
// target lab 1 (org 10), non-target lab 99 (org 10), same owner 100
db.exec(`INSERT INTO labs (id,lab_name,clia_number,owner_user_id,organization_id,created_at,updated_at)
         VALUES (1,'Target','C1',100,10,'t','t'),(99,'Keep','C99',100,10,'t','t')`);
db.exec(`INSERT INTO organization_members (id,organization_id,user_id,org_role,status,created_at,updated_at)
         VALUES (1,10,100,'org_owner','active','t','t'),(2,10,300,'org_admin','active','t','t')`);
db.exec(`INSERT INTO lab_members (id,lab_id,user_id,role,status,is_primary_lab,updated_at) VALUES
         (1,1,100,'owner','active',1,'t'),(2,1,200,'admin','active',0,'t'),(3,1,300,'admin','active',0,'t'),
         (4,99,100,'owner','active',0,'t')`);
db.exec(`INSERT INTO user_seats (id,lab_id,owner_user_id,seat_email,seat_user_id,status) VALUES
         (1,1,100,'new@x',200,'active'),(2,1,100,'mv@x',300,'active'),(3,99,100,'x@x',NULL,'active')`);
db.exec(`INSERT INTO studies (id,lab_id,name) VALUES (1,1,'a'),(2,1,'b'),(3,99,'keep')`);
db.exec(`INSERT INTO veritatrack_tasks (id,lab_id,name) VALUES (1,1,'t1'),(2,1,'t2'),(3,99,'keep')`);
db.exec(`INSERT INTO veritatrack_signoffs (id,task_id,lab_id) VALUES (1,1,1),(2,3,99)`);
// staff_labs ids deliberately DIFFER from labs ids to trap the lab_id-means-staff_labs.id gotcha.
db.exec(`INSERT INTO staff_labs (id,tier2_lab_id,lab_name) VALUES (1,99,'keep-staff'),(50,1,'target-staff')`);
// staff_employees.lab_id is staff_labs.id. id=10 belongs to target (staff_labs 50 -> lab 1);
// id=11 belongs to NON-target (staff_labs 1 -> lab 99). A naive lab_id IN (1) delete would
// delete id=11 (WRONG) and miss id=10 (WRONG). The closure must do the opposite.
db.exec(`INSERT INTO staff_employees (id,lab_id,name) VALUES (10,50,'target-emp'),(11,1,'keep-emp')`);
db.exec(`INSERT INTO policy_manuals (id,lab_id,title) VALUES (1,1,'target-manual'),(2,99,'keep-manual')`);

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? " -- " + d : ""}`); } };
const n = (sql, ...a) => db.prepare(sql).get(...a).n;

const { scope, meta, warnings } = computeDeletionScope(db, [1]);
const tx = db.transaction(() => {
  applyDeletion(db, scope, meta.pk);
  transferOwnership(db, { labIds: [1], newOwnerId: 200, oldOwnerId: 100, orgId: 10, makeOrgOwner: true });
});
tx();

ok("no scope warnings", warnings.length === 0, JSON.stringify(warnings));
ok("target studies deleted", n(`SELECT COUNT(*) n FROM studies WHERE lab_id=1`) === 0);
ok("non-target studies kept", n(`SELECT COUNT(*) n FROM studies WHERE lab_id=99`) === 1);
ok("target tasks deleted", n(`SELECT COUNT(*) n FROM veritatrack_tasks WHERE lab_id=1`) === 0);
ok("grandchild signoff of target task deleted", n(`SELECT COUNT(*) n FROM veritatrack_signoffs WHERE id=1`) === 0);
ok("grandchild signoff of non-target task kept", n(`SELECT COUNT(*) n FROM veritatrack_signoffs WHERE id=2`) === 1);
ok("staff_labs target (id 50) deleted", n(`SELECT COUNT(*) n FROM staff_labs WHERE id=50`) === 0);
ok("staff_labs non-target (id 1) kept", n(`SELECT COUNT(*) n FROM staff_labs WHERE id=1`) === 1);
ok("staff_employee of TARGET (id 10, lab_id=50) deleted via indirection", n(`SELECT COUNT(*) n FROM staff_employees WHERE id=10`) === 0);
ok("staff_employee of NON-target (id 11, lab_id=1) NOT deleted", n(`SELECT COUNT(*) n FROM staff_employees WHERE id=11`) === 1);
ok("undeclared policy_manuals target deleted", n(`SELECT COUNT(*) n FROM policy_manuals WHERE lab_id=1`) === 0);
ok("undeclared policy_manuals non-target kept", n(`SELECT COUNT(*) n FROM policy_manuals WHERE lab_id=99`) === 1);
ok("lab shell 1 preserved", n(`SELECT COUNT(*) n FROM labs WHERE id=1`) === 1);
ok("lab 1 owner = 200", db.prepare(`SELECT owner_user_id o FROM labs WHERE id=1`).get().o === 200);
ok("lab 99 owner unchanged = 100", db.prepare(`SELECT owner_user_id o FROM labs WHERE id=99`).get().o === 100);
ok("lab_members for lab 1 preserved (3)", n(`SELECT COUNT(*) n FROM lab_members WHERE lab_id=1`) === 3);
ok("200 is owner of lab 1", n(`SELECT COUNT(*) n FROM lab_members WHERE lab_id=1 AND user_id=200 AND role='owner'`) === 1);
ok("100 demoted to admin on lab 1", n(`SELECT COUNT(*) n FROM lab_members WHERE lab_id=1 AND user_id=100 AND role='admin'`) === 1);
ok("300 still admin on lab 1", n(`SELECT COUNT(*) n FROM lab_members WHERE lab_id=1 AND user_id=300 AND role='admin'`) === 1);
ok("seats for lab 1 preserved + reparented to 200", n(`SELECT COUNT(*) n FROM user_seats WHERE lab_id=1 AND owner_user_id=200`) === 2);
ok("org billing owner = 200", db.prepare(`SELECT billing_owner_user_id b FROM organizations WHERE id=10`).get().b === 200);
ok("200 is org_owner", n(`SELECT COUNT(*) n FROM organization_members WHERE organization_id=10 AND user_id=200 AND org_role='org_owner'`) === 1);
ok("100 demoted to org_admin", n(`SELECT COUNT(*) n FROM organization_members WHERE organization_id=10 AND user_id=100 AND org_role='org_admin'`) === 1);
ok("no new orphans", orphanScan(db, meta.edges).length === 0, JSON.stringify(orphanScan(db, meta.edges)));

console.log(`\n${fail === 0 ? "ALL PASS" : fail + " FAILED"} (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
