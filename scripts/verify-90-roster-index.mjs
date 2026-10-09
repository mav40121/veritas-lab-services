// scripts/verify-90-roster-index.mjs
// Receipt for parking lot #90 (2026-10-08). server/db.ts created
// idx_staff_employees_user_id_unique ON staff_employees(user_id), but user_id
// holds the account OWNER id on every roster row, so on a database built from
// scratch (disaster recovery without a backup restore) the second Add Employee
// in any lab failed on the unique constraint. Production never got the index
// (rows already shared an owner id, so the CREATE failed inside its try/catch).
//
// Run against a LOCAL production build booted on an EMPTY database file:
//   PW_BASE=http://localhost:5144 SCRATCH_DB=<fresh db> node scripts/verify-90-roster-index.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5144", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const sdb = new Database(process.env.SCRATCH_DB, { readonly: true });
const idx = sdb.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_staff_employees_user_id_unique'").get();
check("a database built from scratch has no one-roster-entry-per-owner index", !idx);
sdb.close();

const stamp = Date.now();
const email = `idx90-${stamp}@example.com`;
const token = (await call("POST", "/api/auth/register", { email, password: "testpass123", name: "Ivy Index", hipaa_acknowledged: true })).body.token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Index Lab", plan: "hospital" })).body.labId;
const lab = await call("POST", `/api/labs/${labId}/staff/lab`, { labName: "Index Lab", cliaNumber: `22D${String(stamp).slice(-7)}` }, token);
check("VeritaStaff lab setup saves", lab.status === 200, `HTTP ${lab.status} ${lab.body.error || ""}`);
const names = [["Ann", "First"], ["Ben", "Second"], ["Cal", "Third"]];
for (const [first, last] of names) {
  const r = await call("POST", `/api/labs/${labId}/staff/employees`, { firstName: first, lastName: last, highestComplexity: "H", performsTesting: true, roles: [] }, token);
  check(`Add Employee ${first} ${last} saves`, r.status === 200, `HTTP ${r.status} ${String(r.body.error || "").slice(0, 120)}`);
}
const list = await call("GET", `/api/labs/${labId}/staff/employees`, undefined, token);
check("the roster lists all three", Array.isArray(list.body) && list.body.length === 3, `${Array.isArray(list.body) ? list.body.length : list.status} rows`);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
