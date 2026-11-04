// tests/integration/veritadc-submanuals.test.ts
//
// VeritaDC sub-manuals (Michael 2026-11-03, Q151 = 1; parity plan Phase 1 item 1, for Heywood's MediaLab library of
// 5 manuals and about 95 sub-manuals nested up to 6 levels). Boots the REAL routes on a scratch DB and pins:
//   1. boot adds policy_manuals.parent_id; a lab's existing (seeded) manuals stay top level, in their old order
//   2. a manual can be created inside another, to any depth, and the list comes back in tree order with each
//      manual's depth and full path ("Heywood Hospital › Heywood Microbiology › HH Abbott ID NOW")
//   3. two sub-manuals may share a name under different parents; their paths tell them apart
//   4. a parent from another lab, an unknown or malformed parent, and a chain deeper than the limit are refused
//   5. a manual moves under another manual or back to the top level (audited as manual_moved), but never inside
//      itself or one of its own sub-manuals; a rename without parentId leaves it where it is
//   6. a manual with active sub-manuals can't be archived (409); a leaf can, and that is audited (manual_archived)
//   7. the documents list names each document's manual by full path (manual_path), and a document whose manual was
//      archived still comes back
//   8. the delegation picker lists manuals by full path, in tree order
// Every lab, person and document here is made up; the database is a scratch file.
// Run: npm run test:veritadc-submanuals

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";

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
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET!;
  const call = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const mkLab = async (tag: string) => {
    const email = `submanual-${tag}-${Date.now()}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: "Testpass123", name: `Sub ${tag}`, hipaa_acknowledged: true });
    const prov = await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `Sub Lab ${tag}`, plan: "hospital", isWarehouse: true });
    return { token: reg.body.token as string, labId: prov.body.labId as number, userId: Number(reg.body.user?.id ?? reg.body.id) };
  };

  try {
    const cols = (sqlite.prepare("PRAGMA table_info(policy_manuals)").all() as any[]).map((c) => c.name);
    check("1. boot adds policy_manuals.parent_id", cols.includes("parent_id"));

    const A = await mkLab("A");
    const B = await mkLab("B");
    check("two labs provisioned", !!A.token && !!A.labId && !!B.token && !!B.labId, JSON.stringify({ A: A.labId, B: B.labId }));
    const M = (L: { labId: number }) => `/api/labs/${L.labId}/veritapolicy/manuals`;
    const list = async (L: { labId: number; token: string }) => (await call("GET", M(L), undefined, L.token)).body.manuals as any[];

    const seeded = await list(A);
    check("1. seeded manuals are top level with depth 0 and path = name, in display order",
      seeded.length > 0 && seeded.every((m) => m.parent_id == null && m.depth === 0 && m.path === m.name) &&
        seeded.every((m, i) => i === 0 || seeded[i - 1].display_order <= m.display_order),
      `${seeded.length} manuals`);

    // 2. Nesting
    const mk = async (L: { labId: number; token: string }, name: string, parentId?: number | null) =>
      call("POST", M(L), { name, ...(parentId !== undefined ? { parentId } : {}) }, L.token);
    const hh = (await mk(A, "Heywood Hospital")).body.id as number;
    const micro = (await mk(A, "Heywood Microbiology", hh)).body.id as number;
    const idnow = (await mk(A, "HH Abbott ID NOW", micro)).body.id as number;
    const athol = (await mk(A, "Athol Hospital")).body.id as number;
    const eqA = (await mk(A, "Equipment", micro)).body.id as number;
    const eqB = (await mk(A, "Equipment", athol)).body.id as number;
    const tree = await list(A);
    const byId = new Map(tree.map((m) => [m.id, m]));
    const pos = (id: number) => tree.findIndex((m) => m.id === id);
    check("2. a manual inside a manual inside a manual: depth and full path",
      byId.get(idnow)?.depth === 2 && byId.get(idnow)?.path === "Heywood Hospital › Heywood Microbiology › HH Abbott ID NOW" && byId.get(idnow)?.parent_id === micro,
      JSON.stringify(byId.get(idnow)));
    check("2. tree order: each parent comes right before its sub-manuals", pos(hh) < pos(micro) && pos(micro) < pos(idnow) && pos(athol) < pos(eqB),
      tree.map((m) => m.path).join(" | "));
    check("3. two sub-manuals named Equipment, told apart by path",
      byId.get(eqA)?.path === "Heywood Hospital › Heywood Microbiology › Equipment" && byId.get(eqB)?.path === "Athol Hospital › Equipment");
    const created = sqlite.prepare("SELECT details FROM policy_audit_log WHERE lab_id = ? AND action = 'manual_created' ORDER BY id DESC LIMIT 1").get(A.labId) as any;
    check("2. the creation audit row records the parent", JSON.parse(created?.details || "{}").parent_id === athol, created?.details);

    // 4. Refusals on create
    const bManual = (await mk(B, "Lab B manual")).body.id as number;
    const crossLab = await mk(A, "Sneaky", bManual);
    check("4. a parent from another lab is refused", crossLab.status === 400 && crossLab.body.code === "BAD_PARENT", JSON.stringify(crossLab));
    const unknown = await mk(A, "Orphan", 99999999);
    const malformed = await call("POST", M(A), { name: "Bad", parentId: "abc" }, A.token);
    check("4. an unknown or malformed parent is refused", unknown.status === 400 && malformed.status === 400, `${unknown.status} ${malformed.status}`);
    let chainParent: number | null = null;
    let deepest = { status: 0, body: {} as any };
    const chainIds: number[] = [];
    for (let i = 0; i < 11; i++) {
      deepest = await mk(A, `Level ${i + 1}`, chainParent);
      if (deepest.status !== 201) break;
      chainParent = deepest.body.id;
      chainIds.push(chainParent!);
    }
    check("4. nesting stops at 10 levels (the 11th is refused)", chainIds.length === 10 && deepest.status === 400 && deepest.body.code === "TOO_DEEP",
      `${chainIds.length} created, last ${deepest.status} ${deepest.body.code}`);

    // 5. Moves
    const put = (id: number, body: any, L = A) => call("PUT", `${M(L)}/${id}`, body, L.token);
    const intoSelf = await put(micro, { parentId: micro });
    const intoChild = await put(hh, { parentId: idnow });
    check("5. a manual can't move inside itself or its own sub-manual",
      intoSelf.status === 400 && intoChild.status === 400 && intoChild.body.code === "BAD_MOVE", `${intoSelf.status} ${intoChild.status} ${intoChild.body.error}`);
    const tooDeep = await put(hh, { parentId: chainIds[8] });
    check("5. a move that would nest past 10 levels is refused", tooDeep.status === 400, `${tooDeep.status} ${tooDeep.body.error}`);
    const crossMove = await put(micro, { parentId: bManual });
    check("5. a manual can't move under another lab's manual", crossMove.status === 400, String(crossMove.status));
    const otherLab = await put(bManual, { parentId: null });
    check("5. lab A can't move lab B's manual", otherLab.status === 403 || otherLab.status === 404, String(otherLab.status));
    const moveUp = await put(micro, { parentId: null });
    const afterUp = new Map((await list(A)).map((m) => [m.id, m]));
    check("5. moving a manual to the top level takes its sub-manuals with it",
      moveUp.status === 200 && afterUp.get(micro)?.depth === 0 && afterUp.get(idnow)?.path === "Heywood Microbiology › HH Abbott ID NOW",
      JSON.stringify({ s: moveUp.status, micro: afterUp.get(micro)?.path, idnow: afterUp.get(idnow)?.path }));
    const moved = sqlite.prepare("SELECT details FROM policy_audit_log WHERE lab_id = ? AND action = 'manual_moved' ORDER BY id DESC LIMIT 1").get(A.labId) as any;
    const md = JSON.parse(moved?.details || "{}");
    check("5. the move is audited with from and to", md.manual_id === micro && md.from_parent_id === hh && md.to_parent_id === null, moved?.details);
    const moveBack = await put(micro, { parentId: hh });
    const rename = await put(micro, { name: "Heywood Microbiology Dept" });
    const afterRename = new Map((await list(A)).map((m) => [m.id, m]));
    check("5. a move back in, then a rename without parentId, leaves it where it is",
      moveBack.status === 200 && rename.status === 200 && afterRename.get(micro)?.parent_id === hh && afterRename.get(micro)?.path === "Heywood Hospital › Heywood Microbiology Dept",
      afterRename.get(micro)?.path);

    // 6. Archive
    const del = (id: number) => call("DELETE", `${M(A)}/${id}`, undefined, A.token);
    const parentDel = await del(micro);
    check("6. a manual with sub-manuals can't be archived", parentDel.status === 409 && parentDel.body.code === "MANUAL_HAS_SUBMANUALS", JSON.stringify(parentDel.body));
    // 7 setup: a made-up document in the leaf before the leaf is archived, and one in the ID NOW sub-manual
    const insDoc = sqlite.prepare(
      `INSERT INTO policy_documents (lab_id, manual_id, title, status, owner_user_id, review_interval_months, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', ?, 24, datetime('now'), datetime('now'))`
    );
    const docIdNow = Number(insDoc.run(A.labId, idnow, "Made-up ID NOW procedure", A.userId).lastInsertRowid);
    const docEq = Number(insDoc.run(A.labId, eqA, "Made-up equipment log", A.userId).lastInsertRowid);
    const leafDel = await del(eqA);
    const archivedRow = sqlite.prepare("SELECT 1 FROM policy_audit_log WHERE lab_id = ? AND action = 'manual_archived' AND details LIKE ?").get(A.labId, `%"manual_id":${eqA}%`);
    check("6. a leaf manual archives, and that is audited", leafDel.status === 200 && !!archivedRow, String(leafDel.status));

    // 7. Documents list
    const docs = (await call("GET", `/api/labs/${A.labId}/veritapolicy/documents`, undefined, A.token)).body.documents as any[];
    const d1 = docs.find((d) => d.id === docIdNow);
    const d2 = docs.find((d) => d.id === docEq);
    check("7. the documents list names a document's manual by full path",
      d1?.manual_path === "Heywood Hospital › Heywood Microbiology Dept › HH Abbott ID NOW" && d1?.manual_name === "HH Abbott ID NOW", JSON.stringify(d1 && { p: d1.manual_path, n: d1.manual_name }));
    check("7. a document whose manual was archived still comes back", !!d2 && d2.manual_name === "Equipment", JSON.stringify(d2 && { p: d2.manual_path, n: d2.manual_name }));

    // 8. Delegation picker
    const deleg = (await call("GET", `/api/labs/${A.labId}/veritapolicy/delegations`, undefined, A.token)).body;
    const names = (deleg.manuals || []).map((m: any) => m.name);
    check("8. the delegation picker lists manuals by full path in tree order",
      names.includes("Heywood Hospital › Heywood Microbiology Dept › HH Abbott ID NOW") && names.indexOf("Heywood Hospital") < names.indexOf("Heywood Hospital › Heywood Microbiology Dept"),
      `${names.length} manuals`);

    // 9. Compliance dashboard: tree order, paths, and an archived manual that still holds a document keeps its row
    const docMicro = Number(insDoc.run(A.labId, micro, "Made-up gram stain procedure", A.userId).lastInsertRowid);
    const docHh = Number(insDoc.run(A.labId, hh, "Made-up critical results policy", A.userId).lastInsertRowid);
    const comp = (await call("GET", `/api/labs/${A.labId}/veritapolicy/compliance`, undefined, A.token)).body;
    const pm = (comp.perManual || []) as any[];
    const rowOf = (id: number) => pm.find((m) => m.manual_id === id);
    const pmAt = (id: number) => pm.findIndex((m) => m.manual_id === id);
    check("9. the compliance rollup comes in tree order with full paths and depth",
      pmAt(hh) >= 0 && pmAt(hh) < pmAt(micro) && pmAt(micro) < pmAt(idnow) && rowOf(idnow)?.manual_path === "Heywood Hospital › Heywood Microbiology Dept › HH Abbott ID NOW" && rowOf(idnow)?.manual_depth === 2,
      pm.map((m) => `${m.manual_path}:${m.total}`).join(" | "));
    const total = pm.reduce((s, m) => s + Number(m.total || 0), 0);
    check("9. a manual archived while holding a document keeps a marked row, so the rows add up to the headline",
      rowOf(eqA)?.manual_name === "Equipment (archived manual)" && rowOf(eqA)?.total === 1 && total === Number(comp.headline?.doc_total),
      `rows ${total} headline ${comp.headline?.doc_total} :: ${JSON.stringify(rowOf(eqA))}`);

    // 10. The compliance workbook names manuals by path in the same order
    const xr = await fetch(`${base}/api/labs/${A.labId}/veritapolicy/compliance/xlsx`, { headers: { Authorization: `Bearer ${A.token}` } });
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await xr.arrayBuffer()) as any);
    const sheet = wb.getWorksheet("Per Manual");
    const col1: string[] = [];
    sheet?.getColumn(1).eachCell((c, n) => { if (n > 1) col1.push(String(c.value ?? "")); });
    const xi = (p: string) => col1.indexOf(p);
    check("10. the workbook's Per Manual sheet lists full paths in tree order",
      xr.status === 200 && xi("Heywood Hospital") >= 0 && xi("Heywood Hospital") < xi("Heywood Hospital › Heywood Microbiology Dept") &&
        xi("Heywood Hospital › Heywood Microbiology Dept") < xi("Heywood Hospital › Heywood Microbiology Dept › HH Abbott ID NOW"),
      `${xr.status} :: ${col1.slice(0, 8).join(" | ")}`);

    // 11. Inspector link: approved documents in tree order under full paths
    sqlite.prepare("UPDATE policy_documents SET status = 'approved' WHERE id IN (?, ?, ?)").run(docIdNow, docMicro, docHh);
    const link = await call("POST", `/api/labs/${A.labId}/veritapolicy/surveyor-links`, { label: "Made-up inspection", expiresInDays: 1 }, A.token);
    const sv = (await call("GET", `/api/surveyor/${link.body.token}/policies`)).body.documents as any[];
    const svIds = (sv || []).map((d) => d.id);
    check("11. the inspector link lists documents in tree order with full paths",
      link.status === 201 && svIds.indexOf(docHh) < svIds.indexOf(docMicro) && svIds.indexOf(docMicro) < svIds.indexOf(docIdNow) &&
        sv.find((d) => d.id === docIdNow)?.manual_path === "Heywood Hospital › Heywood Microbiology Dept › HH Abbott ID NOW",
      `${link.status} :: ${(sv || []).map((d) => d.manual_path).join(" | ")}`);

    // 12. Pending attestations and search carry the path
    const vId = Number(sqlite.prepare("INSERT INTO policy_versions (document_id, version_number, file_path, file_format, file_size_bytes, file_hash_sha256, uploaded_by, uploaded_at) VALUES (?, 1, 'made-up.docx', 'docx', 1, 'x', ?, datetime('now'))").run(docIdNow, A.userId).lastInsertRowid);
    sqlite.prepare("UPDATE policy_documents SET current_version_id = ? WHERE id = ?").run(vId, docIdNow);
    sqlite.prepare("INSERT INTO policy_attestations (document_id, version_id, assigned_to_user_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?, datetime('now'))").run(docIdNow, vId, A.userId, A.userId);
    const pend = (await call("GET", `/api/labs/${A.labId}/veritapolicy/pending-attestations`, undefined, A.token)).body.pending as any[];
    const srch = (await call("GET", `/api/labs/${A.labId}/veritapolicy/search?q=ID%20NOW`, undefined, A.token)).body.results as any[];
    const one = (await call("GET", `/api/labs/${A.labId}/veritapolicy/documents/${docIdNow}`, undefined, A.token)).body.document;
    const P = "Heywood Hospital › Heywood Microbiology Dept › HH Abbott ID NOW";
    check("12. pending attestations, search and the document view name the manual by full path",
      pend?.find((p) => p.document_id === docIdNow)?.manual_path === P && srch?.find((s) => s.id === docIdNow)?.manual_path === P && one?.manual_path === P,
      JSON.stringify({ pend: pend?.find((p) => p.document_id === docIdNow)?.manual_path, srch: srch?.find((s) => s.id === docIdNow)?.manual_path, one: one?.manual_path }));
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
