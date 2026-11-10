// tests/integration/veritadc-surveyor-revision.test.ts
//
// STANDING integration test for BUG-152 (server/policyApprovedVersion.ts surveyorReads / surveyorReadVersionId /
// surveyorReadVersionSql; routes.ts "Phase 8"; the carried face page in server/veritadcBulkLoad.ts). Uploading a new version
// sets a VeritaDC document back to draft, and before this fix an inspector's surveyor link then dropped the document from
// the list and refused its render, timeline and face page until the revision was approved, though the earlier version was
// still the approved procedure.
//   1. v1 approved: the link lists it at 1.0 with no flag; the render is v1; the timeline has v1's approval.
//   2. v2 uploaded (draft): the link still lists it, at 1.0 and flagged; the render is v1 byte for byte, never v2; the
//      timeline still opens, with v1's approval.
//   3. v2 in review, then rejected back to draft: the same, and the rejection on v2 isn't in the timeline.
//   4. v2 approved: listed at 1.1 with no flag; the render is v2; the timeline has both approvals.
//   5. Unchanged: a draft never approved, a revision over no recorded approved version, a retired document and a
//      review-overdue ('expired') document aren't listed and their render and timeline are refused; another lab's document is
//      "Wrong lab"; a revoked link is refused.
//   6. A document carried over from a prior system keeps its face page on the link while a revision is in progress.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:veritadc-surveyor-revision

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
  const PW = ["Surveyor", "revision", "152!"].join("-");
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
  const raw = async (p: string) => {
    const r = await fetch(base + p);
    return { status: r.status, buf: Buffer.from(await r.arrayBuffer()), ctype: r.headers.get("content-type") || "" };
  };
  const currentOf = (docId: number) => (sqlite.prepare("SELECT current_version_id AS v FROM policy_documents WHERE id = ?").get(docId) as any).v as number;
  const statusOf = (docId: number) => (sqlite.prepare("SELECT status FROM policy_documents WHERE id = ?").get(docId) as any).status as string;

  const owner = async (tag: string, labName: string) => {
    const email = `surveyrev-${tag}-${stamp}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: `Owner ${tag} Made Up`, hipaa_acknowledged: true });
    const prov = await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName, plan: "hospital", isWarehouse: true });
    return { token: reg.body.token as string, labId: prov.body.labId as number, userId: Number(reg.body.user?.id ?? reg.body.id) };
  };
  const A = await owner("a", "Surveyor Revision Lab");
  const B = await owner("b", "Other Made Up Lab");
  const P = `/api/labs/${A.labId}/veritapolicy`;

  const signerEmail = `surveyrev-signer-${stamp}@example.com`;
  const signerReg = await call("POST", "/api/auth/register", { email: signerEmail, password: PW, name: "Made Up Signer", hipaa_acknowledged: true });
  const signerId = Number(signerReg.body.user?.id ?? signerReg.body.id);
  sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?, 'staff','active',1,?,?,?)").run(A.labId, signerId, now, now, now);
  sqlite.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(A.labId, signerId);
  sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, seat_type, lab_id, permissions) VALUES (?, ?, ?, ?, ?, 'active', 'active', ?, '{\"mode\":\"edit_all\"}')")
    .run(A.userId, signerEmail, signerId, now, now, A.labId);
  sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(signerId);
  const signerToken = issueSession(sqlite, signerId, { headers: { "user-agent": "surveyor-revision-test" }, ip: "127.0.0.1" }).token as string;

  const upload = async (labPath: string, token: string, title: string, pdf: Buffer, docNumber: string) => {
    const fd = new FormData();
    fd.append("file", new Blob([pdf], { type: "application/pdf" }), "made-up.pdf");
    fd.append("title", title);
    fd.append("doc_number", docNumber);
    const r = await fetch(`${base}${labPath}/documents`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
    return ((await r.json().catch(() => ({}))) as any).id as number;
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
    const wf = await call("POST", `${P}/workflows`, { name: "Made-up route" }, A.token);
    await call("POST", `${P}/workflows/${wf.body.id}/steps`, { stepName: "Made-up approval", requiredRole: "specific_user", specificUserId: signerId }, A.token);
    const submit = (id: number) => call("POST", `${P}/documents/${id}/submit`, { workflowId: wf.body.id }, A.token);
    const decide = (id: number, verb: "approve" | "reject") => call("POST", `${P}/documents/${id}/${verb}`, { typedSignature: "Made Up Signer", password: PW, comment: verb === "reject" ? "Made-up rejection" : undefined }, signerToken);
    const approve = async (id: number) => { await submit(id); return (await decide(id, "approve")).body.status as string; };

    const link = await call("POST", `${P}/surveyor-links`, { label: "Made-up inspection", expiresInDays: 14 }, A.token);
    const S = `/api/surveyor/${link.body.token}`;
    check("0. setup: a surveyor link", link.status === 201 && typeof link.body.token === "string", `HTTP ${link.status}`);

    const V1 = madeUpPdf(["Made-up Specimen Collection Manual", "MADEUP-MARKER-V1"]);
    const V2 = madeUpPdf(["Made-up Specimen Collection Manual", "MADEUP-MARKER-V2"]);
    const doc = await upload(P, A.token, "Made-up Specimen Collection Manual", V1, "SC 152");
    check("1. setup: v1 approved through the real route", (await approve(doc)) === "approved");
    const v1 = currentOf(doc);

    const listed = async () => ((await call("GET", `${S}/policies`)).body.documents || []).find((d: any) => d.id === doc);
    const timeline = async () => call("GET", `${S}/policies/${doc}/signoffs`);
    // The sign-off ids the timeline should hold: the named versions' rows (null = every row on the document).
    const signoffIds = (versionIds: number[] | null) =>
      (sqlite.prepare("SELECT id, version_id FROM policy_signoffs WHERE document_id = ? ORDER BY id").all(doc) as any[])
        .filter((s) => versionIds == null || versionIds.includes(s.version_id)).map((s) => s.id as number);
    const expectReads = async (label: string, file: Buffer, versionLabel: string, inRevision: boolean, timelineOf: number[] | null) => {
      const row = await listed();
      check(`${label}: the link lists it`, !!row, row ? "" : "not in the list");
      check(`${label}: listed at ${versionLabel}, PDF`, row?.current_version_label === versionLabel && row?.current_file_format === "pdf", JSON.stringify({ l: row?.current_version_label, f: row?.current_file_format }));
      check(`${label}: ${inRevision ? "flagged as a revision in progress" : "no revision flag"}`, inRevision ? row?.revision_in_progress === true : row?.revision_in_progress === false, JSON.stringify(row?.revision_in_progress));
      const render = await raw(`${S}/policies/${doc}/render`);
      check(`${label}: the render is the ${versionLabel} file, byte for byte`, render.status === 200 && render.buf.equals(file), `HTTP ${render.status}`);
      const t = await timeline();
      const got = (t.body.signoffs || []).map((s: any) => s.id as number).sort((a: number, b: number) => a - b);
      const want = signoffIds(timelineOf);
      check(`${label}: the timeline opens with ${timelineOf ? "only the approved version's sign-offs" : "every sign-off, as before"}`, t.status === 200 && want.length > 0 && JSON.stringify(got) === JSON.stringify(want), `HTTP ${t.status} got ${JSON.stringify((t.body.signoffs || []).map((s: any) => s.action))} want ${want.length}`);
      return { row, render, t };
    };

    // 1. v1 approved
    await expectReads("1. v1 approved", V1, "1.0", false, null);
    check("1. v1's timeline holds its approval", ((await timeline()).body.signoffs || []).some((s: any) => s.action === "approved"));

    // 2. v2 uploaded: draft
    const rev = await newVersion(doc, V2);
    const v2 = rev.version_id as number;
    check("2. setup: v2 uploaded, the document is a draft at v2", !!v2 && statusOf(doc) === "draft" && currentOf(doc) === v2 && v2 !== v1);
    const inDraft = await expectReads("2. v2 in draft", V1, "1.0", true, [v1]);
    check("2. v2 in draft: the render never carries the draft's file", !inDraft.render.buf.equals(V2));

    // 3. In review, then rejected back to draft
    check("3. setup: v2 submitted", (await submit(doc)).status === 200 && statusOf(doc) === "in_review");
    await expectReads("3. v2 in review", V1, "1.0", true, [v1]);
    check("3. setup: v2 rejected back to draft", (await decide(doc, "reject")).body.status === "draft");
    const onV2 = signoffIds([v2]).length;
    check("3. setup: the rejection is a sign-off row on v2", onV2 >= 1, String(onV2));
    const rejected = await expectReads("3. v2 rejected", V1, "1.0", true, [v1]);
    check("3. v2 rejected: the rejection isn't in the inspector's timeline", !(rejected.t.body.signoffs || []).some((s: any) => s.action === "rejected"));

    // 4. v2 approved: every sign-off, as before (v1's approval, v2's rejection and approval)
    check("4. setup: v2 approved", (await approve(doc)) === "approved");
    const after = await expectReads("4. v2 approved", V2, "1.1", false, null);
    check("4. v2 approved: the timeline holds v2's rejection again, as before", (after.t.body.signoffs || []).some((s: any) => s.action === "rejected"));

    // 5. Unchanged
    const gone = async (label: string, id: number) => {
      const inList = ((await call("GET", `${S}/policies`)).body.documents || []).some((d: any) => d.id === id);
      check(`5. ${label}: not listed`, !inList);
      const r = await raw(`${S}/policies/${id}/render`);
      check(`5. ${label}: render refused`, r.status === 403 || r.status === 404, `HTTP ${r.status}`);
      const t = await call("GET", `${S}/policies/${id}/signoffs`);
      check(`5. ${label}: timeline refused`, t.status === 403 || t.status === 404, `HTTP ${t.status}`);
    };
    const never = await upload(P, A.token, "Made-up Never Approved", madeUpPdf(["MADEUP-NEVER"]), "NA 152");
    await gone("a draft never approved", never);
    const legacy = await upload(P, A.token, "Made-up Legacy Procedure", madeUpPdf(["MADEUP-LEGACY-V1"]), "LG 152");
    sqlite.prepare("UPDATE policy_documents SET status = 'approved', approved_version_id = NULL WHERE id = ?").run(legacy);
    check("5. setup: an approved document with no recorded approved version is listed", ((await call("GET", `${S}/policies`)).body.documents || []).some((d: any) => d.id === legacy));
    await newVersion(legacy, madeUpPdf(["MADEUP-LEGACY-V2"]));
    await gone("a revision over no recorded approved version", legacy);
    const retire = await upload(P, A.token, "Made-up Retire Me", madeUpPdf(["MADEUP-RETIRE-V1"]), "RT 152");
    await approve(retire);
    await newVersion(retire, madeUpPdf(["MADEUP-RETIRE-V2"]));
    await call("POST", `${P}/documents/${retire}/archive`, {}, A.token);
    await gone("a retired document with a revision in progress", retire);
    const overdue = await upload(P, A.token, "Made-up Overdue", madeUpPdf(["MADEUP-OVERDUE"]), "OV 152");
    await approve(overdue);
    sqlite.prepare("UPDATE policy_documents SET status = 'expired' WHERE id = ?").run(overdue);
    await gone("a review-overdue document (unchanged)", overdue);
    const other = await upload(`/api/labs/${B.labId}/veritapolicy`, B.token, "Made-up Other Lab", madeUpPdf(["MADEUP-OTHER"]), "OT 152");
    sqlite.prepare("UPDATE policy_documents SET status = 'approved', approved_version_id = current_version_id WHERE id = ?").run(other);
    const otherRender = await call("GET", `${S}/policies/${other}/render`);
    check("5. another lab's document: render is Wrong lab", otherRender.status === 403 && otherRender.body.error === "Wrong lab", `HTTP ${otherRender.status}`);
    const otherT = await call("GET", `${S}/policies/${other}/signoffs`);
    check("5. another lab's document: timeline is Wrong lab", otherT.status === 403 && otherT.body.error === "Wrong lab", `HTTP ${otherT.status}`);

    // 6. Carried over from a prior system, with a revision in progress
    const face = Buffer.from("<html><body><h1>MU 152 Made-up carried</h1><p>Made-up face page.</p></body></html>");
    const fd = new FormData();
    fd.append("meta", JSON.stringify({
      labId: A.labId, expectedLabName: "Surveyor Revision Lab", ownerUserId: A.userId, batch: "made-up-152", loadedBy: "Made Up Loader",
      sourceSystem: "OldSystem", sourceStatus: "approved and current", docNumber: "MU 152", title: "Made-up carried procedure",
      titleAsExported: "Made-up carried procedure", version: "3.0", effectiveDate: "2024-03-15", lastApprovalOrReview: "2026-01-20",
      nextReviewDue: "2027-01-20", reviewIntervalMonths: 12, remindersStartOn: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10),
      author: "Made Up Author", approvalRows: 1, reviewRows: 0, versionCount: 3, manualPath: ["Made Up Manual"], alsoFiledIn: [],
    }));
    fd.append("document", new Blob([Buffer.from("Made-up carried procedure text\n")]), "made-up.txt");
    fd.append("face_page", new Blob([face]), "face-page.html");
    const loaded = await fetch(`${base}/api/admin/veritadc/bulk-load/document`, { method: "POST", headers: { "x-admin-secret": ADMIN }, body: fd });
    const carriedId = Number(((await loaded.json().catch(() => ({}))) as any).documentId);
    check("6. setup: the bulk load creates an approved carried document", loaded.status < 300 && Number.isInteger(carriedId) && statusOf(carriedId) === "approved", `HTTP ${loaded.status}`);
    const faceBefore = await raw(`${S}/policies/${carriedId}/carried/face-page`);
    check("6. approved: the link opens its face page", faceBefore.status === 200, `HTTP ${faceBefore.status}`);
    await newVersion(carriedId, madeUpPdf(["MADEUP-CARRIED-REVISION"]));
    check("6. setup: a revision of the carried document is a draft", statusOf(carriedId) === "draft");
    const carriedRow = ((await call("GET", `${S}/policies`)).body.documents || []).find((d: any) => d.id === carriedId);
    check("6. revision in progress: the carried document is still listed, flagged", carriedRow?.revision_in_progress === true, JSON.stringify(carriedRow?.revision_in_progress));
    const faceDuring = await raw(`${S}/policies/${carriedId}/carried/face-page`);
    check("6. revision in progress: the link still opens its face page", faceDuring.status === 200 && faceDuring.buf.length > 0, `HTTP ${faceDuring.status}`);
    check("6. revision in progress: its timeline opens", (await call("GET", `${S}/policies/${carriedId}/signoffs`)).status === 200);

    // A revoked link reads nothing (unchanged).
    await call("DELETE", `${P}/surveyor-links/${link.body.id}`, undefined, A.token);
    check("5. a revoked link: the list is refused", (await call("GET", `${S}/policies`)).status === 410);
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
