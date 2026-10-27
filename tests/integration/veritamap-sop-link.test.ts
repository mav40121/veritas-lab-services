// tests/integration/veritamap-sop-link.test.ts
//
// Receipt for parking lot #93 (Michael Q85 = 1, Q86 = 1, 2026-10-11): a VeritaMap test's SOP links to a VeritaDC
// policy and the map reads that policy's review state.
//   1. link two tests to an approved policy: Current, last review = the newest approval or recertification
//   2. an unlinked test keeps its hand-entered date
//   3. a policy that is not approved, or past its next review date, reads Overdue with the reason
//   4. another lab's policy and an archived policy are refused (404); a test not on the map is refused
//   5. unlink returns the test to its hand-entered date
//   6. the map Excel export shows the linked state; VeritaTrack's import seeds the SOP review from the policy
//
// Boots the REAL routes on a scratch DB (made-up rows only). Run: npm run test:veritamap-sop-link
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const sqlite = (db as any).$client;
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const j = async (r: Response) => { try { return await r.json(); } catch { return {}; } };
  const PW = ["Sop", "lk", "7x!"].join("-");

  const mkOwnerLab = async (tag: string) => {
    const email = `sop-${tag}-${Date.now()}@example.com`;
    const reg = await j(await fetch(base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PW, name: `SOP ${tag}`, hipaa_acknowledged: true }) }));
    const labId = Number((await j(await fetch(base + "/api/admin/provision-demo-lab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: process.env.ADMIN_SECRET, ownerEmail: email, labName: `SOP Lab ${tag}`, plan: "hospital" }) }))).labId);
    const userId = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id);
    return { labId, userId, token: reg.token as string };
  };
  const A = await mkOwnerLab("a");
  const B = await mkOwnerLab("b");
  const H = (l: any) => ({ "Content-Type": "application/json", Authorization: `Bearer ${l.token}`, "X-Active-Lab-Id": String(l.labId) });
  const call = async (l: any, method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, { method, headers: H(l), body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await j(r) };
  };

  // A map with one library instrument on lab A.
  const map = (await call(A, "POST", `/api/labs/${A.labId}/veritamap/maps`, { name: "SOP Link Map" })).body;
  const inst = (await call(A, "POST", `/api/labs/${A.labId}/veritamap/maps/${map.id}/instruments`, { instrument_name: "Abbott ARCHITECT c4000", role: "Primary", category: "Chemistry" })).body;
  // The lab states the complexity (made-up test data on a scratch DB), as the sandbox seed does.
  await call(A, "PUT", `/api/labs/${A.labId}/veritamap/maps/${map.id}/instruments/${inst.id}/tests`, { tests: ["Glucose", "Sodium", "Potassium", "Calcium"].map((analyte) => ({ analyte, specialty: "General Chemistry", complexity: "MODERATE", active: 1 })) });
  const detail = async () => (await call(A, "GET", `/api/labs/${A.labId}/veritamap/maps/${map.id}`)).body;
  const d0 = await detail();
  const names: string[] = (d0.tests || []).map((t: any) => t.analyte);
  const [t1, t2, t3] = names;
  check("0. map with tests", map.id > 0 && names.length >= 3, `${names.length} tests`);
  sqlite.prepare("UPDATE veritamap_tests SET last_sop_review = '2025-01-10' WHERE map_id = ? AND analyte = ?").run(map.id, t3);

  // Made-up VeritaDC policies.
  const now = new Date().toISOString();
  const mkDoc = (labId: number, userId: number, title: string, status: string, next: string | null, archived = false) =>
    Number(sqlite.prepare("INSERT INTO policy_documents (lab_id, title, owner_user_id, status, next_review_date, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(labId, title, userId, status, next, archived ? now : null, now, now).lastInsertRowid);
  const sign = (docId: number, userId: number, action: string, at: string) =>
    sqlite.prepare("INSERT INTO policy_signoffs (document_id, version_id, user_id, action, typed_signature, signed_document_hash, signed_at) VALUES (?, 0, ?, ?, 'Made-Up Signer', 'x', ?)").run(docId, userId, action, at);
  const approved = mkDoc(A.labId, A.userId, "Chemistry Analyzer Procedure", "approved", "2028-06-01");
  sign(approved, A.userId, "approved", "2026-01-15 14:00:00");
  sign(approved, A.userId, "recertified", "2026-06-01 15:30:00");
  sign(approved, A.userId, "rejected", "2026-07-01 10:00:00"); // not an approval; must not count
  const inReview = mkDoc(A.labId, A.userId, "Draft Procedure", "in_review", "2028-01-01");
  const pastDue = mkDoc(A.labId, A.userId, "Old Procedure", "approved", "2026-01-01");
  sign(pastDue, A.userId, "approved", "2024-01-01 12:00:00");
  const otherLab = mkDoc(B.labId, B.userId, "Other Lab Procedure", "approved", "2028-01-01");
  const archived = mkDoc(A.labId, A.userId, "Archived Procedure", "approved", "2028-01-01", true);

  // 1. link two tests
  const link = await call(A, "PUT", `/api/labs/${A.labId}/veritamap/maps/${map.id}/sop-link`, { analytes: [t1, t2], documentId: approved });
  const d1 = await detail();
  const row = (d: any, a: string) => (d.tests || []).find((t: any) => t.analyte === a);
  const l1 = row(d1, t1)?.sop_link;
  check("1. two tests linked to an approved policy read Current", link.status === 200 && l1?.overdue === false && row(d1, t2)?.sop_link?.document_id === approved && l1?.title === "Chemistry Analyzer Procedure", JSON.stringify(l1));
  check("1b. last review is the newest approval or recertification (rejection ignored)", l1?.last_review === "2026-06-01" && l1?.next_review === "2028-06-01", `${l1?.last_review} next ${l1?.next_review}`);

  // 2. unlinked test unchanged
  const r3 = row(d1, t3);
  check("2. an unlinked test keeps its hand-entered date", r3?.sop_link === null && r3?.last_sop_review === "2025-01-10", JSON.stringify({ link: r3?.sop_link, date: r3?.last_sop_review }));

  // 3. overdue states
  await call(A, "PUT", `/api/labs/${A.labId}/veritamap/maps/${map.id}/sop-link`, { analytes: [t3], documentId: inReview });
  const s3a = row(await detail(), t3)?.sop_link;
  await call(A, "PUT", `/api/labs/${A.labId}/veritamap/maps/${map.id}/sop-link`, { analytes: [t3], documentId: pastDue });
  const s3b = row(await detail(), t3)?.sop_link;
  check("3a. a policy in review reads Overdue with the reason", s3a?.overdue === true && /in review/.test(s3a?.reason || ""), JSON.stringify(s3a));
  check("3b. a policy past its next review date reads Overdue", s3b?.overdue === true && /2026-01-01/.test(s3b?.reason || "") && s3b?.last_review === "2024-01-01", JSON.stringify(s3b));

  // 4. refusals
  const cross = await call(A, "PUT", `/api/labs/${A.labId}/veritamap/maps/${map.id}/sop-link`, { analytes: [t1], documentId: otherLab });
  const arch = await call(A, "PUT", `/api/labs/${A.labId}/veritamap/maps/${map.id}/sop-link`, { analytes: [t1], documentId: archived });
  const notOnMap = await call(A, "PUT", `/api/labs/${A.labId}/veritamap/maps/${map.id}/sop-link`, { analytes: ["Not A Test"], documentId: approved });
  const stillLinked = row(await detail(), t1)?.sop_link?.document_id;
  check("4. another lab's policy, an archived policy and a test not on the map are refused; nothing changes", cross.status === 404 && arch.status === 404 && notOnMap.status === 404 && stillLinked === approved, [cross.status, arch.status, notOnMap.status, stillLinked].join(","));
  const otherLabMap = await call(B, "PUT", `/api/labs/${B.labId}/veritamap/maps/${map.id}/sop-link`, { analytes: [t1], documentId: otherLab });
  check("4b. another lab cannot link on this lab's map", otherLabMap.status === 404 || otherLabMap.status === 403, String(otherLabMap.status));

  // 5. unlink
  const un = await call(A, "PUT", `/api/labs/${A.labId}/veritamap/maps/${map.id}/sop-link`, { analytes: [t3], documentId: null });
  const r5 = row(await detail(), t3);
  check("5. unlink returns the test to its hand-entered date", un.status === 200 && r5?.sop_link === null && r5?.last_sop_review === "2025-01-10", JSON.stringify({ link: r5?.sop_link, date: r5?.last_sop_review }));
  check("5b. link changes are audited", !!sqlite.prepare("SELECT 1 FROM audit_log WHERE module = 'veritamap' AND entity_label LIKE ?").get(`%SOP link`));

  // 6. Excel export and VeritaTrack import
  const xr = await fetch(base + `/api/labs/${A.labId}/veritamap/maps/${map.id}/excel`, { method: "POST", headers: H(A) });
  const xbuf = Buffer.from(await xr.arrayBuffer());
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  let linkedCell = "", unlinkedCell = "";
  try {
    await wb.xlsx.load(xbuf);
    wb.eachSheet((ws) => ws.eachRow((r) => {
      const vals = (r.values as any[]).map((v) => (v == null ? "" : String(typeof v === "object" && v.text ? v.text : v)));
      if (vals.includes(t1)) linkedCell = vals.find((v) => /linked policy/.test(v)) || linkedCell;
    }));
  } catch (e: any) { linkedCell = `unreadable: ${e.message}`; }
  check("6a. the map Excel export shows the linked policy's state", xr.ok && /Current \(linked policy\)/.test(linkedCell), `${xr.status} ${linkedCell}`);

  const imp = await call(A, "POST", "/api/veritatrack/import-from-map", {});
  const task = sqlite.prepare("SELECT id FROM veritatrack_tasks WHERE lab_id = ? AND name = ?").get(A.labId, `SOP Review - ${t1}`) as any;
  const so = task ? (sqlite.prepare("SELECT completed_date FROM veritatrack_signoffs WHERE task_id = ? ORDER BY completed_date DESC LIMIT 1").get(task.id) as any) : null;
  check("6b. VeritaTrack's import seeds the SOP review from the linked policy", imp.status === 200 && String(so?.completed_date || "").slice(0, 10) === "2026-06-01", `${imp.status} task=${task?.id} seeded=${so?.completed_date}`);

  server.close();
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
