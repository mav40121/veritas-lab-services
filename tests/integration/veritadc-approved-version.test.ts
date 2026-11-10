// tests/integration/veritadc-approved-version.test.ts
//
// STANDING integration test for BUG-151 (server/policyApprovedVersion.ts): uploading a new version sets a VeritaDC document
// back to draft, and before this fix a limited Staff login and the share link then read nothing until the revision was
// approved, though the earlier version was still the approved procedure.
//   0.  policy_documents.approved_version_id exists.
//   1.  Approving v1 through the real route records v1 as the approved version.
//   2.  v2 uploaded (draft): the editor reads v2 (detail, render, version list) as before. A limited Staff login reads v1 on
//       every read (detail, render, download, the version render, the main-app lookup), never v2, and the staff portal
//       (lookup, document, render) reads v1 too; each says a revision is in progress. The share link shows v1 with the flag.
//       Signing and the sign lists don't change: a revision in progress is read-only, as a review-overdue document is.
//   3.  The same while v2 is in review, and after v2 is rejected back to draft.
//   4.  v2 approved: v2 is recorded, and Staff and the share link read v2 with no flag.
//   5.  No recorded approved version behaves exactly as before: approved reads current; a revision over it reads nothing;
//       a draft never approved reads nothing; a retired document reads nothing.
//   6.  The other approval paths record it: the bulk load from a prior system, and a completed IQCP's document.
//   7.  The backfill rule, by its function and by a real boot of server/db.ts on an old-schema database: approved and
//       review-overdue documents record their current version; draft and in-review ones are only counted; a second boot
//       changes nothing.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:veritadc-approved-version

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import express from "express";
import Database from "better-sqlite3";
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

const NOTE = "A revision is in progress. This is the approved version.";

// A small made-up PDF with one line of text per entry.
function madeUpPdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const stream = `BT /F1 16 Tf 72 720 Td 22 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
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
  const PW = ["Approved", "version", "151!"].join("-");
  const now = new Date().toISOString();
  const stamp = Date.now();

  const call = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch {}
    return { status: r.status, body: json, text };
  };
  const raw = async (p: string, token?: string) => {
    const r = await fetch(base + p, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { status: r.status, buf: Buffer.from(await r.arrayBuffer()), ctype: r.headers.get("content-type") || "" };
  };
  // Reads the new column, or undefined when it doesn't exist (the code before the fix), so the test reports FAIL, not a crash.
  const approvedOf = (docId: number): number | null | undefined => {
    try { return (sqlite.prepare("SELECT approved_version_id AS a FROM policy_documents WHERE id = ?").get(docId) as any)?.a ?? null; } catch { return undefined; }
  };
  const currentOf = (docId: number) => (sqlite.prepare("SELECT current_version_id AS v FROM policy_documents WHERE id = ?").get(docId) as any).v as number;
  const statusOf = (docId: number) => (sqlite.prepare("SELECT status FROM policy_documents WHERE id = ?").get(docId) as any).status as string;

  const email = `approvedver-owner-${stamp}@example.com`;
  const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "Owner Made Up", hipaa_acknowledged: true });
  const prov = await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Approved Version Lab", plan: "hospital", isWarehouse: true });
  const A = { token: reg.body.token as string, labId: prov.body.labId as number, userId: Number(reg.body.user?.id ?? reg.body.id) };
  const P = `/api/labs/${A.labId}/veritapolicy`;
  const addSeat = async (tag: string, seatType: string, name: string) => {
    const e = `approvedver-${tag}-${stamp}@example.com`;
    const r = await call("POST", "/api/auth/register", { email: e, password: PW, name, hipaa_acknowledged: true });
    const userId = Number(r.body.user?.id ?? r.body.id);
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?, 'staff','active',1,?,?,?)").run(A.labId, userId, now, now, now);
    sqlite.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(A.labId, userId);
    let emp: number | null = null;
    if (seatType === "staff_portal") {
      const staffLab = (sqlite.prepare("SELECT id FROM staff_labs WHERE tier2_lab_id = ?").get(A.labId) as any)?.id
        ?? Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Approved Version Lab', '22D0000151', ?, ?, ?)").run(A.userId, A.labId, now, now).lastInsertRowid);
      emp = Number(sqlite.prepare("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, title, status, created_at, updated_at) VALUES (?, ?, ?, 'Quillby', 'Rowan', 'Medical Technologist', 'active', ?, ?)").run(staffLab, A.labId, A.userId, now, now).lastInsertRowid);
    }
    sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, seat_type, lab_id, staff_employee_id, permissions) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)")
      .run(A.userId, e, userId, now, now, seatType, A.labId, emp, seatType === "staff_portal" ? '{"mode":"view_all"}' : '{"mode":"edit_all"}');
    sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(userId);
    const token = issueSession(sqlite, userId, { headers: { "user-agent": "approved-version-test" }, ip: "127.0.0.1" }).token as string;
    return { userId, token, emp, name };
  };
  const upload = async (title: string, pdf: Buffer, docNumber: string) => {
    const fd = new FormData();
    fd.append("file", new Blob([pdf], { type: "application/pdf" }), "made-up.pdf");
    fd.append("title", title);
    fd.append("doc_number", docNumber);
    const r = await fetch(`${base}${P}/documents`, { method: "POST", headers: { Authorization: `Bearer ${A.token}` }, body: fd });
    return (await r.json().catch(() => ({}))) as any;
  };
  const newVersion = async (docId: number, pdf: Buffer) => {
    const fd = new FormData();
    fd.append("file", new Blob([pdf], { type: "application/pdf" }), "made-up-v2.pdf");
    fd.append("is_major_revision", "0");
    fd.append("change_summary", "Made-up revision");
    const r = await fetch(`${base}${P}/documents/${docId}/versions`, { method: "POST", headers: { Authorization: `Bearer ${A.token}` }, body: fd });
    return (await r.json().catch(() => ({}))) as any;
  };

  try {
    // 0. The column
    const cols = (sqlite.prepare("PRAGMA table_info(policy_documents)").all() as any[]).map((c) => c.name);
    check("0. policy_documents has approved_version_id", cols.includes("approved_version_id"), cols.join(","));

    const signer = await addSeat("signer", "active", "Made Up Signer");
    const staff = await addSeat("staff", "staff_portal", "Rowan Quillby");
    const wf = await call("POST", `${P}/workflows`, { name: "Made-up route" }, A.token);
    await call("POST", `${P}/workflows/${wf.body.id}/steps`, { stepName: "Made-up approval", requiredRole: "specific_user", specificUserId: signer.userId }, A.token);
    const submit = (id: number) => call("POST", `${P}/documents/${id}/submit`, { workflowId: wf.body.id }, A.token);
    const decide = (id: number, verb: "approve" | "reject") => call("POST", `${P}/documents/${id}/${verb}`, { typedSignature: "Made Up Signer", password: PW }, signer.token);
    const approve = async (id: number) => { await submit(id); return (await decide(id, "approve")).body.status as string; };

    // 1. v1 approved through the real route
    const V1 = madeUpPdf(["Made-up Specimen Collection Manual", "MADEUP-MARKER-V1"]);
    const V2 = madeUpPdf(["Made-up Specimen Collection Manual", "MADEUP-MARKER-V2"]);
    const doc = (await upload("Made-up Specimen Collection Manual", V1, "SC 151")).id as number;
    await call("POST", `${P}/read-sign`, { scope: "document", id: doc, everyone: true }, A.token);
    check("1. setup: v1 is approved through the real route", (await approve(doc)) === "approved");
    const v1 = currentOf(doc);
    check("1. the approval records v1 as the approved version", approvedOf(doc) === v1, `approved=${approvedOf(doc)} v1=${v1}`);
    const link = await call("POST", `${P}/documents/${doc}/share-links`, { label: "Made-up nursing" }, A.token);
    const token = link.body.token as string;
    check("1. setup: a share link for it", link.status === 201 && typeof token === "string", `HTTP ${link.status}`);
    const sharedBefore = await call("GET", `/api/public/policy-share/${token}`);
    check("1. the link shows v1 with no revision flag", sharedBefore.status === 200 && sharedBefore.body.version === "1.0" && sharedBefore.body.revision_in_progress === false, JSON.stringify(sharedBefore.body));

    // What a limited Staff login and the share link read, all at once.
    const staffReads = async () => {
      const detail = await call("GET", `${P}/documents/${doc}`, undefined, staff.token);
      const render = await raw(`${P}/documents/${doc}/render`, staff.token);
      const download = await raw(`${P}/documents/${doc}/download`, staff.token);
      const search = await call("GET", `${P}/search?q=${encodeURIComponent("Specimen Collection")}`, undefined, staff.token);
      const portalLookup = await call("GET", `/api/staff-portal-session/policies/lookup?q=${encodeURIComponent("Specimen Collection")}`, undefined, staff.token);
      const portalOne = await call("GET", `/api/staff-portal-session/policies/${doc}`, undefined, staff.token);
      const portalRender = await raw(`/api/staff-portal-session/policies/${doc}/render`, staff.token);
      const shared = await call("GET", `/api/public/policy-share/${token}`);
      const sharedFile = await raw(`/api/public/policy-share/${token}/file`);
      return { detail, render, download, search: (search.body.results || []).find((r: any) => r.id === doc), portalLookup: (portalLookup.body.results || []).find((r: any) => r.document_id === doc), portalOne, portalRender, shared, sharedFile };
    };
    const expectApprovedReads = async (label: string, file: Buffer, versionId: number, versionLabel: string, inRevision: boolean) => {
      const r = await staffReads();
      check(`${label}: Staff detail reads the approved version`, r.detail.status === 200 && r.detail.body.document?.current_version_id === versionId && r.detail.body.document?.current_version_label === versionLabel, `HTTP ${r.detail.status} ${JSON.stringify({ v: r.detail.body.document?.current_version_id, l: r.detail.body.document?.current_version_label })}`);
      check(`${label}: Staff detail lists only that version`, r.detail.body.versions?.length === 1 && r.detail.body.versions[0].id === versionId, JSON.stringify(r.detail.body.versions?.map((v: any) => v.id)));
      check(`${label}: Staff detail ${inRevision ? "says a revision is in progress and reads as approved" : "has no revision flag"}`, inRevision ? r.detail.body.document?.revision_in_progress === true && r.detail.body.document?.status === "approved" : !r.detail.body.document?.revision_in_progress, JSON.stringify({ s: r.detail.body.document?.status, f: r.detail.body.document?.revision_in_progress }));
      check(`${label}: Staff render is the approved file, byte for byte`, r.render.status === 200 && r.render.buf.equals(file), `HTTP ${r.render.status}`);
      check(`${label}: Staff download is the approved file`, r.download.status === 200 && r.download.buf.equals(file), `HTTP ${r.download.status}`);
      check(`${label}: Staff lookup finds it at the approved version`, !!r.search && r.search.current_version_id === versionId && r.search.current_version_label === versionLabel && !!r.search.revision_in_progress === inRevision, JSON.stringify(r.search ?? null));
      check(`${label}: staff portal lookup finds it at the approved version`, !!r.portalLookup && r.portalLookup.version_id === versionId && r.portalLookup.version_label === versionLabel && !!r.portalLookup.revision_in_progress === inRevision, JSON.stringify(r.portalLookup ?? null));
      check(`${label}: staff portal document is the approved version`, r.portalOne.status === 200 && r.portalOne.body.version_id === versionId && !!r.portalOne.body.revision_in_progress === inRevision, `HTTP ${r.portalOne.status} ${JSON.stringify({ v: r.portalOne.body.version_id, f: r.portalOne.body.revision_in_progress })}`);
      check(`${label}: staff portal render is the approved file`, r.portalRender.status === 200 && r.portalRender.buf.equals(file), `HTTP ${r.portalRender.status}`);
      check(`${label}: the share link shows the approved version`, r.shared.status === 200 && r.shared.body.version === versionLabel && r.shared.body.revision_in_progress === inRevision, `HTTP ${r.shared.status} ${JSON.stringify(r.shared.body)}`);
      check(`${label}: the share link's file is the approved file`, r.sharedFile.status === 200 && r.sharedFile.buf.equals(file), `HTTP ${r.sharedFile.status}`);
      return r;
    };

    // 2. v2 uploaded: draft
    const rev = await newVersion(doc, V2);
    const v2 = rev.version_id as number;
    check("2. setup: v2 is uploaded and the document is a draft", !!v2 && statusOf(doc) === "draft" && currentOf(doc) === v2);
    check("2. the approved version is still v1", approvedOf(doc) === v1, String(approvedOf(doc)));
    const inDraft = await expectApprovedReads("2. v2 in draft", V1, v1, "1.0", true);
    check("2. v2 in draft: the version render of v1 opens for Staff", (await raw(`${P}/documents/${doc}/versions/${v1}/render`, staff.token)).status === 200);
    check("2. v2 in draft: the version render of v2 is refused to Staff", (await raw(`${P}/documents/${doc}/versions/${v2}/render`, staff.token)).status === 403);
    check("2. v2 in draft: no Staff read carries the draft's file", ![inDraft.render, inDraft.download, inDraft.portalRender, inDraft.sharedFile].some((x) => x.buf.equals(V2)));
    // Editors see the working revision, as before.
    const ed = await call("GET", `${P}/documents/${doc}`, undefined, A.token);
    check("2. the editor's detail reads v2, a draft, with every version", ed.body.document?.current_version_id === v2 && ed.body.document?.status === "draft" && !ed.body.document?.revision_in_progress && ed.body.versions?.length === 2, JSON.stringify({ v: ed.body.document?.current_version_id, s: ed.body.document?.status, n: ed.body.versions?.length }));
    check("2. the editor's render is v2", (await raw(`${P}/documents/${doc}/render`, A.token)).buf.equals(V2));
    check("2. the editor's download is v2", (await raw(`${P}/documents/${doc}/download`, A.token)).buf.equals(V2));
    const edList = ((await call("GET", `${P}/documents`, undefined, A.token)).body.documents || []).find((d: any) => d.id === doc);
    check("2. the editor's list shows v2 as a draft", edList?.status === "draft" && edList?.current_version_id === v2, JSON.stringify({ s: edList?.status, v: edList?.current_version_id }));
    const shareList = await call("GET", `${P}/documents/${doc}/share-links`, undefined, A.token);
    check("2. the editor's share-link list says the link shows v1.0", shareList.body.shareable === true && shareList.body.shows_version === "1.0" && shareList.body.links?.[0]?.status === "active", JSON.stringify({ s: shareList.body.shareable, v: shareList.body.shows_version }));
    // Signing and the sign lists are unchanged: a revision in progress is read-only, like a review-overdue document.
    const signDraft = await call("POST", `/api/staff-portal-session/policies/${doc}/sign`, { employee_id: staff.emp, version_id: v1, typed_signature: staff.name, content_hash: "madeup" }, staff.token);
    check("2. v2 in draft: Staff can't sign (unchanged)", signDraft.status === 404, `HTTP ${signDraft.status}`);
    const portalList = (await call("GET", `/api/staff-portal-session/policies?employee_id=${staff.emp}`, undefined, staff.token)).body.policies || [];
    check("2. v2 in draft: My sign-offs doesn't list it (unchanged)", !portalList.some((p: any) => p.document_id === doc));
    const staffList = (await call("GET", `${P}/documents`, undefined, staff.token)).body.documents || [];
    check("2. v2 in draft: the Staff document list doesn't list it (unchanged)", !staffList.some((d: any) => d.id === doc));
    check("2. the note wording is the shared constant", (await import("../../shared/policyApprovedVersion").then((m) => m.REVISION_IN_PROGRESS_NOTE).catch(() => null)) === NOTE);

    // 3. In review, then rejected back to draft
    check("3. setup: v2 submitted", (await submit(doc)).status === 200 && statusOf(doc) === "in_review");
    await expectApprovedReads("3. v2 in review", V1, v1, "1.0", true);
    check("3. setup: v2 rejected back to draft", (await decide(doc, "reject")).body.status === "draft");
    check("3. a rejection leaves v1 as the approved version", approvedOf(doc) === v1);
    await expectApprovedReads("3. v2 rejected", V1, v1, "1.0", true);

    // 4. v2 approved
    check("4. setup: v2 approved", (await approve(doc)) === "approved");
    check("4. the approval records v2", approvedOf(doc) === v2, String(approvedOf(doc)));
    await expectApprovedReads("4. v2 approved", V2, v2, "1.1", false);
    check("4. the editor's share-link list no longer names a version", (await call("GET", `${P}/documents/${doc}/share-links`, undefined, A.token)).body.shows_version === null);

    // 5. No recorded approved version: exactly as before
    const legacy = (await upload("Made-up Legacy Procedure", madeUpPdf(["MADEUP-LEGACY-V1"]), "LG 1")).id as number;
    sqlite.prepare("UPDATE policy_documents SET status = 'approved' WHERE id = ?").run(legacy); // approved before the column, none recorded
    check("5. setup: an approved document with no recorded approved version", approvedOf(legacy) === null);
    const legacyTok = (await call("POST", `${P}/documents/${legacy}/share-links`, {}, A.token)).body.token as string;
    check("5. approved with none recorded: Staff reads the current version", (await call("GET", `${P}/documents/${legacy}`, undefined, staff.token)).body.document?.current_version_id === currentOf(legacy));
    check("5. approved with none recorded: the link shows it", (await call("GET", `/api/public/policy-share/${legacyTok}`)).status === 200);
    await newVersion(legacy, madeUpPdf(["MADEUP-LEGACY-V2"]));
    check("5. a revision over none recorded: Staff reads nothing, as before", (await call("GET", `${P}/documents/${legacy}`, undefined, staff.token)).status === 404 && (await raw(`${P}/documents/${legacy}/render`, staff.token)).status === 404);
    check("5. a revision over none recorded: the staff portal reads nothing, as before", (await call("GET", `/api/staff-portal-session/policies/${legacy}`, undefined, staff.token)).status === 404 && (await raw(`/api/staff-portal-session/policies/${legacy}/render`, staff.token)).status === 404);
    check("5. a revision over none recorded: lookups don't find it, as before", !((await call("GET", `${P}/search?q=Legacy`, undefined, staff.token)).body.results || []).some((r: any) => r.id === legacy)
      && !((await call("GET", `/api/staff-portal-session/policies/lookup?q=Legacy`, undefined, staff.token)).body.results || []).some((r: any) => r.document_id === legacy));
    check("5. a revision over none recorded: the link reads not active, as before", (await call("GET", `/api/public/policy-share/${legacyTok}`)).status === 404);
    const neverApproved = (await upload("Made-up Never Approved", madeUpPdf(["MADEUP-NEVER"]), "NA 1")).id as number;
    check("5. a draft never approved: Staff reads nothing", (await call("GET", `${P}/documents/${neverApproved}`, undefined, staff.token)).status === 404);
    check("5. a draft never approved: no share link", (await call("POST", `${P}/documents/${neverApproved}/share-links`, {}, A.token)).status === 409);
    // Retired with a recorded approved version and a revision in progress: nothing.
    const retire = (await upload("Made-up Retire Me", madeUpPdf(["MADEUP-RETIRE-V1"]), "RT 1")).id as number;
    await approve(retire);
    const retireTok = (await call("POST", `${P}/documents/${retire}/share-links`, {}, A.token)).body.token as string;
    await newVersion(retire, madeUpPdf(["MADEUP-RETIRE-V2"]));
    check("5. setup: the retiring document's link shows its approved version during the revision", (await call("GET", `/api/public/policy-share/${retireTok}`)).status === 200);
    await call("POST", `${P}/documents/${retire}/archive`, {}, A.token);
    check("5. retired: Staff reads nothing", (await call("GET", `${P}/documents/${retire}`, undefined, staff.token)).status === 404 && (await call("GET", `/api/staff-portal-session/policies/${retire}`, undefined, staff.token)).status === 404);
    check("5. retired: the link reads not active", (await call("GET", `/api/public/policy-share/${retireTok}`)).status === 404);

    // 6. The other approval paths
    const face = Buffer.from("<html><body><h1>MU 151 Made-up carried</h1><p>Made-up face page.</p></body></html>");
    const fd = new FormData();
    fd.append("meta", JSON.stringify({
      labId: A.labId, expectedLabName: "Approved Version Lab", ownerUserId: A.userId, batch: "made-up-151", loadedBy: "Made Up Loader",
      sourceSystem: "OldSystem", sourceStatus: "approved and current", docNumber: "MU 151", title: "Made-up carried procedure",
      titleAsExported: "Made-up carried procedure", version: "3.0", effectiveDate: "2024-03-15", lastApprovalOrReview: "2026-01-20",
      nextReviewDue: "2027-01-20", reviewIntervalMonths: 12, remindersStartOn: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10),
      author: "Made Up Author", approvalRows: 1, reviewRows: 0, versionCount: 3, manualPath: ["Made Up Manual"], alsoFiledIn: [],
    }));
    fd.append("document", new Blob([Buffer.from("Made-up carried procedure text\n")]), "made-up.txt");
    fd.append("face_page", new Blob([face]), "face-page.html");
    const loaded = await fetch(`${base}/api/admin/veritadc/bulk-load/document`, { method: "POST", headers: { "x-admin-secret": ADMIN }, body: fd });
    const loadedBody = (await loaded.json().catch(() => ({}))) as any;
    const carriedId = Number(loadedBody.documentId);
    check("6. setup: the bulk load creates an approved document", loaded.status < 300 && Number.isInteger(carriedId) && statusOf(carriedId) === "approved", `HTTP ${loaded.status} ${JSON.stringify(loadedBody).slice(0, 200)}`);
    check("6. the bulk load records its version as the approved one", Number.isInteger(carriedId) && approvedOf(carriedId) === currentOf(carriedId), `approved=${Number.isInteger(carriedId) ? approvedOf(carriedId) : "?"}`);
    const plan = await call("POST", `/api/labs/${A.labId}/iqcp/plans`, { instrumentName: "Made-up Analyzer 151", screen: { nonwaived: "yes", reduce_intent: "yes", mfr_less_strict: "yes" } }, A.token);
    const done = await call("PATCH", `/api/labs/${A.labId}/iqcp/plans/${plan.body.id}`, { status: "complete" }, A.token);
    const iqcpDoc = Number(done.body.document_id);
    check("6. setup: a completed IQCP registers an approved document", done.status === 200 && Number.isInteger(iqcpDoc) && iqcpDoc > 0 && statusOf(iqcpDoc) === "approved", `HTTP ${done.status} document_id=${done.body.document_id}`);
    check("6. the IQCP document records version 1 as the approved one", iqcpDoc > 0 && approvedOf(iqcpDoc) === currentOf(iqcpDoc), `approved=${iqcpDoc > 0 ? approvedOf(iqcpDoc) : "?"}`);

    // 7a. The backfill rule, by its function, on this database
    const mod: any = await import("../../server/policyApprovedVersion").catch(() => null);
    check("7a. the backfill function exists", typeof mod?.backfillApprovedVersions === "function");
    if (typeof mod?.backfillApprovedVersions === "function") {
      const expiredDoc = (await upload("Made-up Overdue", madeUpPdf(["MADEUP-OVERDUE"]), "OV 1")).id as number;
      sqlite.prepare("UPDATE policy_documents SET status = 'expired' WHERE id = ?").run(expiredDoc);
      const reviewDoc = (await upload("Made-up In Review", madeUpPdf(["MADEUP-REVIEW"]), "IR 1")).id as number;
      await submit(reviewDoc);
      // As the column found them: nothing recorded anywhere yet.
      sqlite.prepare("UPDATE policy_documents SET approved_version_id = NULL").run();
      const before = sqlite.prepare("SELECT id, status, current_version_id, archived_at FROM policy_documents").all() as any[];
      const out = mod.backfillApprovedVersions(sqlite);
      const after = new Map((sqlite.prepare("SELECT id, approved_version_id FROM policy_documents").all() as any[]).map((r) => [r.id, r.approved_version_id]));
      const wrong = before.filter((d) => {
        const want = ["approved", "expired"].includes(d.status) && d.current_version_id != null ? d.current_version_id : null;
        return after.get(d.id) !== want;
      });
      check("7a. approved and review-overdue documents record their current version; nothing else is recorded", wrong.length === 0, JSON.stringify(wrong.slice(0, 5)));
      check("7a. the overdue document recorded its current version", approvedOf(expiredDoc) === currentOf(expiredDoc));
      check("7a. the draft revision (legacy) and the one in review stay unrecorded", approvedOf(legacy) === null && approvedOf(reviewDoc) === null && approvedOf(neverApproved) === null);
      const draftOrReview = before.filter((d) => ["draft", "in_review"].includes(d.status) && !d.archived_at);
      const withEarlier = draftOrReview.filter((d) => (sqlite.prepare("SELECT COUNT(*) AS n FROM policy_versions WHERE document_id = ?").get(d.id) as any).n > 1);
      check("7a. it counts the drafts and reviews it left, and those with an earlier version", out.recorded === before.filter((d) => ["approved", "expired"].includes(d.status) && d.current_version_id != null).length
        && out.inRevision === draftOrReview.length && out.withEarlierVersion === withEarlier.length && out.withEarlierVersion >= 1, JSON.stringify(out));
      check("7a. run again, it records nothing more", mod.backfillApprovedVersions(sqlite).recorded === 0);
    }

    // 7b. The backfill on a real boot of server/db.ts, on a database from before the column (made-up rows only).
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vdc-approved-boot-"));
    const oldDb = path.join(tmp, "old.db");
    const o = new Database(oldDb);
    o.exec(`CREATE TABLE policy_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT, lab_id INTEGER NOT NULL, manual_id INTEGER, title TEXT NOT NULL, description TEXT,
      current_version_id INTEGER, status TEXT NOT NULL DEFAULT 'draft', owner_user_id INTEGER NOT NULL, effective_date TEXT,
      next_review_date TEXT, review_interval_months INTEGER NOT NULL DEFAULT 24, workflow_id INTEGER, archived_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    o.exec(`CREATE TABLE policy_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL, version_number INTEGER NOT NULL, file_path TEXT NOT NULL,
      file_format TEXT NOT NULL, file_size_bytes INTEGER NOT NULL, file_hash_sha256 TEXT NOT NULL, change_summary TEXT,
      uploaded_by INTEGER NOT NULL, uploaded_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    const insDoc = o.prepare("INSERT INTO policy_documents (id, lab_id, title, status, owner_user_id, current_version_id, archived_at) VALUES (?, 1, ?, ?, 1, ?, ?)");
    const insVer = o.prepare("INSERT INTO policy_versions (id, document_id, version_number, file_path, file_format, file_size_bytes, file_hash_sha256, uploaded_by) VALUES (?, ?, ?, 'x', 'pdf', 1, 'h', 1)");
    insDoc.run(1, "Made-up approved", "approved", 11, null); insVer.run(11, 1, 1);
    insDoc.run(2, "Made-up overdue", "expired", 22, null); insVer.run(21, 2, 1); insVer.run(22, 2, 2);
    insDoc.run(3, "Made-up revision in draft", "draft", 32, null); insVer.run(31, 3, 1); insVer.run(32, 3, 2);
    insDoc.run(4, "Made-up first draft in review", "in_review", 41, null); insVer.run(41, 4, 1);
    insDoc.run(5, "Made-up retired draft", "draft", 52, "2026-01-01"); insVer.run(51, 5, 1); insVer.run(52, 5, 2);
    insDoc.run(6, "Made-up approved with no version", "approved", null, null);
    o.close();
    const boot = () => spawnSync(process.execPath, ["--import", "tsx", "-e", `import(${JSON.stringify(pathToFileURL(path.resolve("server/db.ts")).href)}).then(() => process.exit(0), (e) => { console.error(e); process.exit(1); })`], {
      env: { ...process.env, DB_PATH: oldDb, POLICY_STORAGE_ROOT: path.join(tmp, "policies") }, encoding: "utf8", timeout: 180000,
    });
    const first = boot();
    const line = (first.stdout || "").split(/\r?\n/).find((l) => l.includes("approved_version_id added")) || "";
    check("7b. the first boot on an old database adds the column and logs counts only", first.status === 0 && line === "[migration] VeritaDC approved_version_id added: 2 approved or review-overdue document(s) recorded their current version; 2 in draft or review left unrecorded (1 of them with an earlier version)", `exit ${first.status} :: ${line || (first.stderr || "").slice(-400)}`);
    const readBack = () => {
      const r = new Database(oldDb, { readonly: true });
      try { return new Map((r.prepare("SELECT id, approved_version_id AS a FROM policy_documents").all() as any[]).map((x) => [x.id, x.a])); } catch { return new Map(); } finally { r.close(); }
    };
    const got = readBack();
    const want = new Map<number, number | null>([[1, 11], [2, 22], [3, null], [4, null], [5, null], [6, null]]);
    check("7b. approved and review-overdue record their current version; draft, in review, retired drafts and no-version rows stay empty", [...want].every(([id, a]) => got.get(id) === a), JSON.stringify([...got]));
    const second = boot();
    check("7b. a second boot logs no backfill and changes nothing", second.status === 0 && !(second.stdout || "").includes("approved_version_id added") && [...want].every(([id, a]) => readBack().get(id) === a), `exit ${second.status}`);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
