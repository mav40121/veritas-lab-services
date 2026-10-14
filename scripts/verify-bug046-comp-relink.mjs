// scripts/verify-bug046-comp-relink.mjs
//
// BUG-046 receipt (Sampson lab 36, 2026-10-13): a VeritaComp employee removed and added again must not break the
// employee's competency screens. LOCAL server + scratch DB only (people below are test fixtures).
//   1. VeritaStaff person "Pat Testrow"; VeritaComp employee A with that name; opening A's instruments links A
//   2. remove A (inactive, keeps the link); add the same name again as B; opening B's instruments and suggested method
//      groups returns 200 (was 500 "UNIQUE constraint failed"), and the link moves from A to B
//   3. a second ACTIVE row C with the same name: opening C returns 200 and the link stays on B (no write)
// Run: PW_BASE=http://localhost:5166 SCRATCH_DB=<db> node scripts/verify-bug046-comp-relink.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j }; };

const email = `relink-${Date.now()}@example.com`;
const owner = (await call("POST", "/api/auth/register", { email, password: "testpass123", name: "Relink Owner", hipaa_acknowledged: true })).body;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Relink Lab", plan: "hospital" })).body.labId;
let db = new Database(process.env.SCRATCH_DB);
db.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?").run(email);
db.close();
const T = owner.token, L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Relink Lab", cliaNumber: "11D7654399", accreditationBody: "CLIA_ONLY", complexity: "high" }, T);
const staff = await call("POST", `${L}/staff/employees`, { firstName: "Pat", lastName: "Testrow", title: "MLS", performsTesting: true }, T);
const staffId = staff.body.id;
check("0. VeritaStaff person created", staff.status === 200 && !!staffId, `${staff.status} ${JSON.stringify(staff.body).slice(0, 120)}`);
const prog = await call("POST", `${L}/competency/programs`, { name: "Chemistry Competency", department: "Chemistry", type: "technical" }, T);
const progId = prog.body.id;
const linkOf = (id) => { const d = new Database(process.env.SCRATCH_DB, { readonly: true }); const r = d.prepare("SELECT staff_employee_id, status FROM competency_employees WHERE id = ?").get(id); d.close(); return r; };

const A = (await call("POST", `${L}/competency/employees`, { name: "Pat Testrow", title: "MLS" }, T)).body.id;
const a1 = await call("GET", `${L}/competency/employees/${A}/staff-instruments`, undefined, T);
check("1. A opens and links to the VeritaStaff person", a1.status === 200 && linkOf(A)?.staff_employee_id === staffId, `${a1.status}, A link ${JSON.stringify(linkOf(A))}`);

await call("DELETE", `${L}/competency/employees/${A}`, undefined, T);
const B = (await call("POST", `${L}/competency/employees`, { name: "Pat Testrow", title: "MLS" }, T)).body.id;
const b1 = await call("GET", `${L}/competency/employees/${B}/staff-instruments`, undefined, T);
const b2 = await call("GET", `${L}/competency/programs/${progId}/employees/${B}/suggested-method-groups`, undefined, T);
check("2. re-added B: instruments screen opens (no 500)", b1.status === 200, `${b1.status} ${JSON.stringify(b1.body).slice(0, 100)}`);
check("2. re-added B: suggested method groups open (no 500)", b2.status === 200, `${b2.status} ${JSON.stringify(b2.body).slice(0, 100)}`);
check("2. the link moved from removed A to active B", linkOf(B)?.staff_employee_id === staffId && linkOf(A)?.staff_employee_id == null, `A ${JSON.stringify(linkOf(A))}, B ${JSON.stringify(linkOf(B))}`);

const C = (await call("POST", `${L}/competency/employees`, { name: "Pat Testrow", title: "MLS" }, T)).body.id;
const c1 = await call("GET", `${L}/competency/employees/${C}/staff-instruments`, undefined, T);
check("3. a second active duplicate C opens (no 500) and the link stays on B", c1.status === 200 && linkOf(B)?.staff_employee_id === staffId && linkOf(C)?.staff_employee_id == null, `${c1.status}, B ${JSON.stringify(linkOf(B))}, C ${JSON.stringify(linkOf(C))}`);
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
