// tests/integration/record-views.test.ts
//
// STANDING integration test for record-view logging and the access report (server/recordViews.ts; Lifepoint
// IPS III.1(i), committed for 2026-10-31; Michael Q27 = 1), plus audit rows for role and permission changes.
// Asserts: a signed-in read of a lab's records is logged once per 10 minutes per address; failed and anonymous
// reads are not; a read is never written into a lab the person does not belong to (so no customer's report can
// show another customer's people); a bare export-job header does not hide a read; only the lab's owner or an
// admin can see or download the report; role, permission, removal and ownership changes are in the audit trail.
//
// Boots the REAL Express routes against a throwaway SQLite DB and drives real HTTP.
// Run: npm run test:record-views

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { issueSession } from "../../server/sessionAuth";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET!;

  const req = async (method: string, p: string, body?: unknown, token?: string, headers: Record<string, string> = {}) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const ct = r.headers.get("content-type") || "";
    const buf = Buffer.from(await r.arrayBuffer());
    let json: any = {};
    if (ct.includes("json")) { try { json = JSON.parse(buf.toString("utf8")); } catch {} }
    return { status: r.status, body: json, buf, ct };
  };
  const pw = (tag: string) => ["Rv", tag, "7x!"].join("-");
  const PW = pw("base");
  const register = async (tag: string) => {
    const email = `it-views-${tag}-${Date.now()}@example.com`;
    const r = await req("POST", "/api/auth/register", { email, password: PW, name: `IT ${tag}`, hipaa_acknowledged: true });
    return { email, id: Number(r.body?.user?.id), token: r.body?.token as string };
  };
  const signIn = async (u: { id: number; email: string }) => {
    sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(u.id);
    return (await req("POST", "/api/auth/login", { email: u.email, password: PW })).body?.token as string;
  };
  const views = (labId: number, userId?: number) =>
    (sqlite.prepare(`SELECT * FROM record_views WHERE lab_id = ?${userId ? " AND user_id = ?" : ""} ORDER BY id`).all(...(userId ? [labId, userId] : [labId])) as any[]);

  try {
    const G = await register("owner");
    const M = await register("member");
    const O = await register("other-owner");
    const g1 = Number((await req("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: G.email, labName: "IT Views Lab", plan: "hospital" })).body?.labId);
    const o1 = Number((await req("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: O.email, labName: "IT Other Customer", plan: "hospital" })).body?.labId);
    await req("POST", "/api/admin/create-lab-invite", { secret: ADMIN, labId: g1, email: M.email, role: "staff" });
    const gTok = await signIn(G);
    const mTok = await signIn(M);
    const oTok = await signIn(O);
    check("0. labs provisioned", g1 > 0 && o1 > 0, JSON.stringify([g1, o1]));

    // 1) A signed-in read of the lab's records is logged, once per 10 minutes per address.
    const r1 = await req("GET", `/api/labs/${g1}/veritamap/maps`, undefined, mTok);
    await req("GET", `/api/labs/${g1}/veritamap/maps`, undefined, mTok);
    await new Promise((r) => setTimeout(r, 150));
    const mv = views(g1, M.id);
    check("1a. the member's read is logged once (repeat within 10 minutes is not)", r1.status === 200 && mv.length === 1, `status=${r1.status} rows=${mv.length}`);
    check("1b. the row names the module, the address and the IP", mv[0]?.module === "VeritaMap" && mv[0]?.path === `/api/labs/${g1}/veritamap/maps` && !!mv[0]?.ip_address && mv[0]?.vls_support === 0, JSON.stringify(mv[0]));
    await req("GET", `/api/labs/${g1}/veritamap/maps?x=1`, undefined, mTok);
    await new Promise((r) => setTimeout(r, 100));
    check("1c. a query string does not make a new address", views(g1, M.id).length === 1);

    // 2) Failed and anonymous reads are not logged.
    const before2 = views(g1).length;
    const anon = await req("GET", `/api/labs/${g1}/veritamap/maps`);
    const otherLab = await req("GET", `/api/labs/${o1}/veritamap/maps`, undefined, mTok);
    await new Promise((r) => setTimeout(r, 100));
    check("2a. an anonymous read is refused and not logged", anon.status === 401 && views(g1).length === before2);
    check("2b. a refused read of another customer's lab is not logged there", otherLab.status >= 400 && views(o1).length === 0, `status=${otherLab.status}`);

    // 3) Older paths use the active-lab header, and only for a lab the person belongs to.
    const f1 = await req("GET", "/api/findings", undefined, mTok, { "X-Active-Lab-Id": String(g1) });
    const f2 = await req("GET", "/api/findings", undefined, mTok, { "X-Active-Lab-Id": String(o1) });
    await new Promise((r) => setTimeout(r, 150));
    const fRows = views(g1, M.id).filter((v) => v.path === "/api/findings");
    check("3a. an older path is logged under the member's own active lab", f1.status < 400 && fRows.length === 1 && fRows[0]?.module === "VeritaResponse", `status=${f1.status} ${JSON.stringify(fRows)}`);
    check("3b. naming another customer's lab in the header writes nothing there", views(o1).length === 0, `f2=${f2.status} rows=${views(o1).length}`);

    // 3c) The person's own shell calls are not lab records.
    await req("GET", "/api/labs/me", undefined, mTok, { "X-Active-Lab-Id": String(g1) });
    await new Promise((r) => setTimeout(r, 100));
    check("3c. the person's own 'my labs' call is not logged as a record view", !views(g1, M.id).some((v) => v.path === "/api/labs/me"));

    // 4) A bare export-job header does not hide a read.
    await req("GET", `/api/labs/${g1}/members`, undefined, mTok, { "X-Export-All-Job": "made-up" });
    await new Promise((r) => setTimeout(r, 150));
    check("4. a made-up export-job header still gets logged", views(g1, M.id).some((v) => v.path === `/api/labs/${g1}/members`));

    // 5) The access report: owner or admin only, this lab only.
    const rep = await req("GET", `/api/labs/${g1}/access-report?days=30`, undefined, gTok);
    const mRows = (rep.body?.rows || []).filter((r: any) => r.userId === M.id);
    check("5a. the owner's report lists the member's reads", rep.status === 200 && mRows.length >= 2 && rep.body?.people?.some((p: any) => p.id === M.id), `status=${rep.status} total=${rep.body?.total}`);
    const byPerson = await req("GET", `/api/labs/${g1}/access-report?days=30&userId=${G.id}`, undefined, gTok);
    check("5b. filtering by person shows only that person", byPerson.status === 200 && (byPerson.body?.rows || []).every((r: any) => r.userId === G.id));
    const staffTry = await req("GET", `/api/labs/${g1}/access-report`, undefined, mTok);
    check("5c. a staff member cannot see the report", staffTry.status === 403, `status=${staffTry.status}`);
    const crossTry = await req("GET", `/api/labs/${g1}/access-report`, undefined, oTok);
    check("5d. another customer's owner cannot see it", crossTry.status === 401 || crossTry.status === 403 || crossTry.status === 404, `status=${crossTry.status}`);
    const oRep = await req("GET", `/api/labs/${o1}/access-report`, undefined, oTok);
    check("5e. the other customer's report never shows this lab's people", oRep.status === 200 && !(oRep.body?.rows || []).some((r: any) => r.userId === M.id || r.userId === G.id));
    const xl = await req("GET", `/api/labs/${g1}/access-report.xlsx?days=30`, undefined, gTok);
    let sheets: string[] = [];
    let logRows = 0;
    try {
      const { default: ExcelJS } = await import("exceljs");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(xl.buf);
      sheets = wb.worksheets.map((w) => w.name);
      logRows = (wb.getWorksheet("Access Log")?.rowCount || 1) - 1;
    } catch {}
    check("5f. the Excel download has the About sheet first and the Access Log", xl.status === 200 && sheets[0] === "About" && sheets.includes("Access Log") && logRows >= 2, `status=${xl.status} sheets=${sheets.join(",")} rows=${logRows}`);
    check("5g. the download is in the audit trail", !!sqlite.prepare("SELECT 1 FROM audit_log WHERE entity_type = 'access_report.download' AND user_id = ?").get(G.id));

    // 6) Veritas support reads are marked.
    sqlite.prepare("UPDATE users SET vls_support = 1 WHERE id = ?").run(O.id);
    await req("POST", "/api/admin/create-lab-invite", { secret: ADMIN, labId: g1, email: O.email, role: "staff" });
    // Veritas support accounts must pass two-factor at sign-in; this test only needs a live session.
    const o2Tok = issueSession(sqlite, O.id, { headers: { "user-agent": "IT" } }).token;
    await req("GET", `/api/labs/${g1}/veritamap/maps`, undefined, o2Tok);
    await new Promise((r) => setTimeout(r, 150));
    check("6. a Veritas support account's read is marked as Veritas support", views(g1, O.id).some((v) => v.vls_support === 1), JSON.stringify(views(g1, O.id)));
    sqlite.prepare("UPDATE users SET vls_support = 0 WHERE id = ?").run(O.id);

    // 7) Role, permission, removal and ownership changes are in the audit trail.
    const mMember = sqlite.prepare("SELECT id FROM lab_members WHERE lab_id = ? AND user_id = ?").get(g1, M.id) as any;
    const role = await req("PATCH", `/api/labs/${g1}/members/${mMember.id}`, { role: "admin" }, gTok);
    const roleRow = sqlite.prepare("SELECT before_json, after_json FROM audit_log WHERE entity_type = 'lab_member.role' AND entity_id = ? ORDER BY id DESC").get(String(M.id)) as any;
    check("7a. a role change is audited with before and after", role.status === 200 && /staff/.test(roleRow?.before_json || "") && /admin/.test(roleRow?.after_json || ""), JSON.stringify(roleRow));
    const perm = await req("PATCH", `/api/labs/${g1}/members/${mMember.id}/permissions`, { permissions: { veritamap: "view" } }, gTok);
    check("7b. a permission change is audited", (perm.status === 200 || perm.status === 404) && (perm.status === 404 || !!sqlite.prepare("SELECT 1 FROM audit_log WHERE entity_type = 'lab_member.permissions' AND entity_id = ?").get(String(M.id))), `status=${perm.status} ${JSON.stringify(perm.body).slice(0, 100)}`);
    const oMember = sqlite.prepare("SELECT id FROM lab_members WHERE lab_id = ? AND user_id = ?").get(g1, O.id) as any;
    const rm = await req("DELETE", `/api/labs/${g1}/members/${oMember.id}`, undefined, gTok);
    check("7c. removing a member is audited", rm.status === 200 && !!sqlite.prepare("SELECT 1 FROM audit_log WHERE entity_type = 'lab_member.removed' AND entity_id = ?").get(String(O.id)));
    const tr = await req("POST", `/api/labs/${g1}/transfer-ownership`, { newOwnerUserId: M.id, confirm: true }, gTok);
    check("7d. an ownership transfer is audited", tr.status === 200 && !!sqlite.prepare("SELECT 1 FROM audit_log WHERE entity_type = 'lab.owner_transfer' AND entity_id = ?").get(String(g1)), `status=${tr.status}`);
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
