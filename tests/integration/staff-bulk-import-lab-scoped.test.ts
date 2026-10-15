// tests/integration/staff-bulk-import-lab-scoped.test.ts
//
// Receipt for BUG-014 (2026-10-11). VeritaStaff Bulk Import (template, preview, commit) had only the old
// /api/staff routes, which resolve the lab through membership and check the caller's OWN plan, so Veritas support
// (no membership, no plan) could not import a client's roster, and a commit stamped staff_employees.user_id with
// the caller. Boots the REAL routes on a scratch DB and proves:
//   1. the old template route still refuses Veritas support (it has no plan of its own); unchanged
//   2. the lab-scoped template route serves the client lab's template to Veritas support
//   3. lab-scoped preview validates an uploaded roster against the client lab
//   4. lab-scoped commit inserts into the client lab: tier2_lab_id = the lab, user_id = the lab OWNER, roles carry
//      tier2_lab_id; the rows show on the client's roster; the audit row is stamped acting_as 'vls_support'
//   5. an outsider (no membership, not Veritas support) is refused on the lab-scoped routes
//   6. the owner's old route still imports (no change for single-lab owners)
//   7. BUG-032: a single employee added by Veritas support on the lab-scoped route is filed under the lab owner
//   8. BUG-032 repair: POST /api/admin/staff/repair-owner dry run counts a row filed under someone else and writes
//      nothing; the real run re-points it to the owner
// Run (from bash): DB_PATH=.tmp-sbi.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/staff-bulk-import-lab-scoped.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { default: ExcelJS } = await import("exceljs");
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
  const app = express(); app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app); await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address(); const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j: any = {}; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
  const stamp = Date.now();
  const reg = async (tag: string) => (await call("POST", "/api/auth/register", { email: `sbi-${tag}-${stamp}@example.com`, password: "Testpass123", name: `SBI ${tag}`, hipaa_acknowledged: true })).j;
  const owner = await reg("owner"), vls = await reg("vls"), outsider = await reg("outsider");
  const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: `sbi-owner-${stamp}@example.com`, labName: "Client Import Lab", plan: "hospital" })).j.labId;
  const L = `/api/labs/${labId}`;
  await call("POST", `${L}/staff/lab`, { labName: "Client Import Lab", cliaNumber: "11D7654340", accreditationBody: "CLIA_ONLY", complexity: "high" }, owner.token);
  const flag = await call("POST", "/api/admin/vls-support/user", { secret: ADMIN, email: `sbi-vls-${stamp}@example.com`, enabled: true });
  check("fixture: client lab, Veritas support flagged, outsider", !!labId && flag.s === 200, `lab=${labId} flag=${flag.s}`);

  const get = (path: string, token: string) => fetch(base + path, { headers: { Authorization: `Bearer ${token}`, "X-Active-Lab-Id": String(labId) } });
  const oldT = await get("/api/staff/employees/template", vls.token);
  check("1. old template route still refuses Veritas support (no plan of its own)", oldT.status === 403, String(oldT.status));
  const newT = await get(`${L}/staff/employees/template`, vls.token);
  const tplBuf = Buffer.from(await newT.arrayBuffer());
  check("2. lab-scoped template route serves the client lab's template to Veritas support", newT.status === 200 && /spreadsheetml/.test(newT.headers.get("content-type") || "") && tplBuf.length > 1000, `${newT.status} ${tplBuf.length}`);

  // Fill two people into the template's Roster sheet.
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(tplBuf as any);
  const ros = wb.getWorksheet("Roster")!;
  const put = (row: number, vals: (string | number | null)[]) => vals.forEach((v, i) => { ros.getRow(row).getCell(i + 1).value = v as any; });
  put(2, [null, "Imported", "Ava", "", "MLS(ASCP)", "2019-04-01", "", "H", "Y", "", "", "", "Y", "", "", "", "", "N", "N"]);
  put(3, [null, "Imported", "Ben", "", "MLT(ASCP)", "2021-08-15", "", "M", "Y", "", "", "", "", "", "Y", "", "", "N", "N"]);
  for (let r = 4; r <= ros.rowCount; r++) ros.getRow(r).values = [];
  const upload = Buffer.from(await wb.xlsx.writeBuffer());
  const post = async (path: string, token: string) => {
    const fd = new FormData();
    fd.append("file", new Blob([upload]), "roster.xlsx");
    const r = await fetch(base + path, { method: "POST", headers: { Authorization: `Bearer ${token}`, "X-Active-Lab-Id": String(labId) }, body: fd });
    let j: any = {}; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
  const prev = await post(`${L}/staff/employees/bulk-preview`, vls.token);
  check("3. lab-scoped preview validates the roster against the client lab", prev.s === 200 && prev.j.summary?.willInsert === 2 && prev.j.summary?.error === 0, JSON.stringify(prev.j.summary ?? prev.j).slice(0, 200));

  const commit = await post(`${L}/staff/employees/bulk-commit`, vls.token);
  const rows = sqlite.prepare("SELECT id, first_name, tier2_lab_id, user_id FROM staff_employees WHERE last_name = 'Imported' ORDER BY id").all() as any[];
  const ownerId = (sqlite.prepare("SELECT owner_user_id FROM labs WHERE id = ?").get(labId) as any).owner_user_id;
  const roleLab = rows.length ? (sqlite.prepare("SELECT role, tier2_lab_id FROM staff_roles WHERE employee_id = ?").all(rows[0].id) as any[]) : [];
  check("4a. lab-scoped commit inserts into the client lab, owned by the lab owner (not Veritas)", commit.s === 200 && commit.j.inserted === 2 && rows.length === 2 && rows.every((r) => r.tier2_lab_id === labId && r.user_id === ownerId),
    `${commit.s} ${JSON.stringify(commit.j).slice(0, 120)} rows=${JSON.stringify(rows)} owner=${ownerId} vls=${vls.user?.id}`);
  check("4b. imported roles carry the lab id", roleLab.length === 1 && roleLab[0].role === "TS" && roleLab[0].tier2_lab_id === labId, JSON.stringify(roleLab));
  const roster = await call("GET", `${L}/staff/employees`, undefined, owner.token);
  check("4c. the client's own roster shows both imported people", Array.isArray(roster.j) && roster.j.filter((e: any) => e.last_name === "Imported").length === 2);
  const audit = sqlite.prepare("SELECT owner_user_id, acting_as FROM audit_log WHERE entity_type = 'bulk_import' ORDER BY id DESC LIMIT 1").get() as any;
  check("4d. audit row filed under the lab owner, stamped acting_as 'vls_support'", audit?.owner_user_id === ownerId && audit?.acting_as === "vls_support", JSON.stringify(audit));

  const outT = await get(`${L}/staff/employees/template`, outsider.token);
  const outP = await post(`${L}/staff/employees/bulk-commit`, outsider.token);
  check("5. an outsider is refused on the lab-scoped routes", (outT.status === 403 || outT.status === 404) && (outP.s === 403 || outP.s === 404), `${outT.status} ${outP.s}`);

  // 6. Old route, as the owner, with only the second row changed to a new person.
  ros.getRow(2).values = []; put(2, [null, "Legacy", "Cara", "", "MLT(ASCP)", "2020-01-01", "", "M", "Y", "", "", "", "", "", "Y", "", "", "N", "N"]); ros.getRow(3).values = [];
  const upload2 = Buffer.from(await wb.xlsx.writeBuffer());
  const fd2 = new FormData(); fd2.append("file", new Blob([upload2]), "roster.xlsx");
  const legacy = await fetch(base + "/api/staff/employees/bulk-commit", { method: "POST", headers: { Authorization: `Bearer ${owner.token}`, "X-Active-Lab-Id": String(labId) }, body: fd2 });
  const lj: any = await legacy.json().catch(() => ({}));
  const cara = sqlite.prepare("SELECT tier2_lab_id, user_id FROM staff_employees WHERE last_name = 'Legacy'").get() as any;
  check("6. the owner's old route still imports into the active lab", legacy.status === 200 && lj.inserted === 1 && cara?.tier2_lab_id === labId && cara?.user_id === ownerId, `${legacy.status} ${JSON.stringify(cara)}`);

  // 7. Single add on the lab-scoped route, by Veritas support.
  const one = await call("POST", `${L}/staff/employees`, { lastName: "Single", firstName: "Dee", highestComplexity: "H", performsTesting: true, hireDate: "2018-02-02" }, vls.token);
  const dee = sqlite.prepare("SELECT user_id, tier2_lab_id FROM staff_employees WHERE id = ?").get(one.j?.id) as any;
  check("7. a person added by Veritas support is filed under the lab owner (BUG-032)", one.s === 200 && dee?.user_id === ownerId && dee?.tier2_lab_id === labId, `${one.s} ${JSON.stringify(dee)}`);

  // 8. Repair: file one row under the support user the way the old code did, then dry run and run.
  sqlite.prepare("UPDATE staff_employees SET user_id = ? WHERE id = ?").run(vls.user?.id, one.j?.id);
  const dry = await call("POST", "/api/admin/staff/repair-owner", { secret: ADMIN, labIds: [labId] });
  const stillWrong = (sqlite.prepare("SELECT user_id FROM staff_employees WHERE id = ?").get(one.j?.id) as any).user_id;
  check("8a. repair dry run counts the misfiled row and writes nothing", dry.s === 200 && dry.j.dryRun === true && dry.j.totals?.staffEmployees === 1 && stillWrong === vls.user?.id, JSON.stringify(dry.j.totals));
  const run = await call("POST", "/api/admin/staff/repair-owner", { secret: ADMIN, labIds: [labId], dryRun: false });
  const fixed = (sqlite.prepare("SELECT user_id FROM staff_employees WHERE id = ?").get(one.j?.id) as any).user_id;
  const after = await call("POST", "/api/admin/staff/repair-owner", { secret: ADMIN, labIds: [labId] });
  check("8b. repair run re-points it to the owner; a second dry run finds nothing", run.s === 200 && fixed === ownerId && after.j.totals?.staffEmployees === 0, `${fixed} ${JSON.stringify(after.j.totals)}`);
  check("8c. repair refuses a wrong secret", (await call("POST", "/api/admin/staff/repair-owner", { secret: "nope" })).s === 403);

  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
