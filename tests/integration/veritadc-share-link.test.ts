// tests/integration/veritadc-share-link.test.ts
//
// STANDING integration test for the VeritaDC document share link (Michael 2026-11-09; server/policyShareLinks.ts):
//   0.  The table and its migration columns exist.
//   1.  Creating a link needs VeritaDC edit on the document's own lab: a Staff seat, a view-only seat and another lab's
//       owner are refused; an edit seat may. A draft-only or in-review document is refused 409, with a plain message.
//   2.  The public read, with no login: the CURRENT approved version's lab name, CLIA, number, title, version, effective
//       and approved dates, and nothing else (no signature, sign-off, audit or staff field); noindex and no-store headers.
//   3.  The file route streams that version's file inline; ?download=1 sends it as an attachment. Only the metadata read
//       counts a view.
//   4.  A revision: while it is a draft or in review the link keeps showing the approved version, flagged (BUG-151, as a
//       Staff login's read does); once it is approved, the SAME token shows the new version and its file.
//   5.  Not active, one identical 404 body: unknown, malformed, revoked, retired. Review-overdue still shows.
//   6.  A token for document A never reaches document B, by any parameter, path or header, in its lab or another.
//   7.  The editor's list: active and revoked links with views; revoke keeps the row; only editors read it.
//   8.  Audit rows for create and revoke; deleting the document removes its links; the token is masked in logs.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:veritadc-share-link

import http from "node:http";
import crypto from "node:crypto";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { issueSession } from "../../server/sessionAuth";
import { redactPath } from "../../server/logRedact";
import { maskTokenInAddress } from "../../shared/sentryDataCollection";

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
  const PW = ["Share", "link", "77!"].join("-");
  const now = new Date().toISOString();
  const stamp = Date.now();
  const NOT_ACTIVE = JSON.stringify({ error: "This link is not active. Contact the laboratory." });

  const call = async (method: string, p: string, body?: unknown, token?: string, extra: Record<string, string> = {}) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch {}
    return { status: r.status, body: json, text, headers: r.headers };
  };
  const raw = async (p: string, extra: Record<string, string> = {}) => {
    const r = await fetch(base + p, { headers: extra });
    return { status: r.status, headers: r.headers, buf: Buffer.from(await r.arrayBuffer()) };
  };
  const mkLab = async (tag: string) => {
    const email = `sharelink-${tag}-${stamp}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: `Owner ${tag}`, hipaa_acknowledged: true });
    const prov = await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `Share Link Lab ${tag}`, plan: "hospital", isWarehouse: true });
    const labId = prov.body.labId as number;
    sqlite.prepare("UPDATE labs SET clia_number = ? WHERE id = ?").run(`22D000${tag === "a" ? "0777" : "0778"}`, labId);
    return { email, token: reg.body.token as string, labId, userId: Number(reg.body.user?.id ?? reg.body.id) };
  };
  // A made-up person in the lab with a seat of the given kind.
  const addSeat = async (L: { labId: number; userId: number }, tag: string, seatType: string, permissions: string, name: string) => {
    const email = `sharelink-${tag}-${stamp}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name, hipaa_acknowledged: true });
    const userId = Number(reg.body.user?.id ?? reg.body.id);
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?, 'staff','active',1,?,?,?)").run(L.labId, userId, now, now, now);
    sqlite.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(L.labId, userId);
    let emp: number | null = null;
    if (seatType === "staff_portal") {
      const staffLab = (sqlite.prepare("SELECT id FROM staff_labs WHERE tier2_lab_id = ?").get(L.labId) as any)?.id
        ?? Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Share Link Lab', '22D0000777', ?, ?, ?)").run(L.userId, L.labId, now, now).lastInsertRowid);
      emp = Number(sqlite.prepare("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, title, status, created_at, updated_at) VALUES (?, ?, ?, 'Zorblatt', 'Quinn', 'Medical Technologist', 'active', ?, ?)").run(staffLab, L.labId, L.userId, now, now).lastInsertRowid);
    }
    sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, seat_type, lab_id, staff_employee_id, permissions) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)")
      .run(L.userId, email, userId, now, now, seatType, L.labId, emp, permissions);
    sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(userId);
    const token = issueSession(sqlite, userId, { headers: { "user-agent": "share-link-test" }, ip: "127.0.0.1" }).token as string;
    return { email, userId, token, name };
  };
  const upload = async (L: { token: string; labId: number }, title: string, pdf: Buffer, docNumber: string) => {
    const fd = new FormData();
    fd.append("file", new Blob([pdf], { type: "application/pdf" }), "made-up.pdf");
    fd.append("title", title);
    fd.append("doc_number", docNumber);
    const r = await fetch(`${base}/api/labs/${L.labId}/veritapolicy/documents`, { method: "POST", headers: { Authorization: `Bearer ${L.token}` }, body: fd });
    return (await r.json().catch(() => ({}))) as any;
  };
  const newVersion = async (L: { token: string; labId: number }, docId: number, pdf: Buffer, major: boolean) => {
    const fd = new FormData();
    fd.append("file", new Blob([pdf], { type: "application/pdf" }), "made-up-v2.pdf");
    fd.append("is_major_revision", major ? "1" : "0");
    fd.append("change_summary", "Made-up revision");
    const r = await fetch(`${base}/api/labs/${L.labId}/veritapolicy/documents/${docId}/versions`, { method: "POST", headers: { Authorization: `Bearer ${L.token}` }, body: fd });
    return (await r.json().catch(() => ({}))) as any;
  };

  try {
    // 0. The table
    const cols = (sqlite.prepare("PRAGMA table_info(policy_share_links)").all() as any[]).map((c) => c.name);
    check("0. policy_share_links has every column", ["id", "lab_id", "document_id", "token", "label", "created_by", "created_at", "revoked_at", "revoked_by", "view_count", "last_viewed_at"].every((c) => cols.includes(c)), cols.join(","));
    const idx = (sqlite.prepare("PRAGMA index_list(policy_share_links)").all() as any[]);
    check("0. the token is unique", idx.some((i) => i.unique === 1));

    const A = await mkLab("a");
    const B = await mkLab("b");
    const P = `/api/labs/${A.labId}/veritapolicy`;
    const signer = await addSeat(A, "signer", "active", '{"mode":"edit_all"}', "Made Up Signer");
    const viewer = await addSeat(A, "viewer", "view_only", '{"mode":"view_all"}', "View Only Person");
    const staff = await addSeat(A, "staff", "staff_portal", '{"mode":"view_all"}', "Quinn Zorblatt");

    // An approval route the signer signs, built through VeritaDC's own screens.
    const wf = await call("POST", `${P}/workflows`, { name: "Made-up share route" }, A.token);
    await call("POST", `${P}/workflows/${wf.body.id}/steps`, { stepName: "Made-up approval", requiredRole: "specific_user", specificUserId: signer.userId }, A.token);
    const approve = async (docId: number) => {
      const sub = await call("POST", `${P}/documents/${docId}/submit`, { workflowId: wf.body.id }, A.token);
      const ok = await call("POST", `${P}/documents/${docId}/approve`, { typedSignature: "Made Up Signer", password: PW }, signer.token);
      return { sub: sub.status, ok: ok.status, status: ok.body.status };
    };

    const V1 = madeUpPdf(["Made-up Specimen Collection Manual", "MADEUP-MARKER-V1"]);
    const V2 = madeUpPdf(["Made-up Specimen Collection Manual", "MADEUP-MARKER-V2"]);
    const docA = (await upload(A, "Made-up Specimen Collection Manual", V1, "SC 1")).id as number;
    const firstApproval = await approve(docA);
    check("setup. the document is approved through the real route", firstApproval.status === "approved", JSON.stringify(firstApproval));
    // Version 1.0's approval reads as a month ago, so the revision's approval date is told apart from it below.
    const v1Id = (sqlite.prepare("SELECT current_version_id AS v FROM policy_documents WHERE id = ?").get(docA) as any).v;
    sqlite.prepare("UPDATE policy_signoffs SET signed_at = '2026-10-09 15:00:00' WHERE document_id = ? AND version_id = ?").run(docA, v1Id);
    const docB = (await upload(A, "Made-up SECRETDOC Other Procedure", madeUpPdf(["MADEUP-MARKER-OTHERDOC"]), "SC 2")).id as number;
    await approve(docB);
    const draftOnly = (await upload(A, "Made-up Draft Only", madeUpPdf(["draft"]), "SC 3")).id as number;
    const inReview = (await upload(A, "Made-up In Review", madeUpPdf(["review"]), "SC 4")).id as number;
    await call("POST", `${P}/documents/${inReview}/submit`, { workflowId: wf.body.id }, A.token);
    const docBVersion = (sqlite.prepare("SELECT current_version_id AS v FROM policy_documents WHERE id = ?").get(docB) as any).v;

    // 1. Who may create
    const made = await call("POST", `${P}/documents/${docA}/share-links`, { label: "  Nursing intranet  " }, A.token);
    const tokenA = made.body.token as string;
    check("1. the owner creates a link: 201 with id, token and url", made.status === 201 && Number.isInteger(made.body.id) && typeof tokenA === "string", `HTTP ${made.status}`);
    check("1. the token is a random UUID", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(tokenA), tokenA);
    check("1. the url is FRONTEND_URL/policy/<token>", typeof made.body.url === "string" && made.body.url.endsWith(`/policy/${tokenA}`), made.body.url);
    check("1. the label is stored trimmed", (sqlite.prepare("SELECT label FROM policy_share_links WHERE id = ?").get(made.body.id) as any).label === "Nursing intranet");
    const byStaff = await call("POST", `${P}/documents/${docA}/share-links`, {}, staff.token);
    check("1. a Staff seat is refused", byStaff.status === 403, `HTTP ${byStaff.status}`);
    const byViewer = await call("POST", `${P}/documents/${docA}/share-links`, {}, viewer.token);
    check("1. a view-only seat is refused", byViewer.status === 403, `HTTP ${byViewer.status}`);
    const byOtherOwner = await call("POST", `${P}/documents/${docA}/share-links`, {}, B.token);
    check("1. another lab's owner is refused on this lab's path", byOtherOwner.status === 403, `HTTP ${byOtherOwner.status}`);
    const byOtherOwnPath = await call("POST", `/api/labs/${B.labId}/veritapolicy/documents/${docA}/share-links`, {}, B.token);
    check("1. and through their own lab's path the document isn't found", byOtherOwnPath.status === 404, `HTTP ${byOtherOwnPath.status}`);
    const bySigner = await call("POST", `${P}/documents/${docA}/share-links`, { label: "Made-up second" }, signer.token);
    check("1. an edit seat on VeritaDC may create one", bySigner.status === 201, `HTTP ${bySigner.status}`);
    const onDraft = await call("POST", `${P}/documents/${draftOnly}/share-links`, {}, A.token);
    check("1. a draft-only document is refused 409 with a plain message", onDraft.status === 409 && onDraft.body.code === "NO_APPROVED_VERSION" && /Only an approved document can be shared\. This document is a draft/.test(onDraft.body.error), `HTTP ${onDraft.status} ${onDraft.body.error}`);
    const onReview = await call("POST", `${P}/documents/${inReview}/share-links`, {}, A.token);
    check("1. a document in review is refused 409", onReview.status === 409 && /is in review/.test(onReview.body.error), `HTTP ${onReview.status} ${onReview.body.error}`);
    check("1. no row was written for a refusal", (sqlite.prepare("SELECT COUNT(*) AS n FROM policy_share_links WHERE document_id IN (?, ?)").get(draftOnly, inReview) as any).n === 0);
    check("1. a refused create writes no audit row", (sqlite.prepare("SELECT COUNT(*) AS n FROM policy_audit_log WHERE action = 'share_link_created' AND document_id IN (?, ?)").get(draftOnly, inReview) as any).n === 0);

    // 2. The public read
    const pub = await call("GET", `/api/public/policy-share/${tokenA}`);
    const KEYS = ["approved_date", "clia_number", "doc_number", "effective_date", "lab_name", "revision_in_progress", "title", "version"];
    check("2. the public read answers with no login", pub.status === 200, `HTTP ${pub.status}`);
    check("2. it carries exactly the lab, CLIA, number, title, version, dates and the revision flag", JSON.stringify(Object.keys(pub.body).sort()) === JSON.stringify(KEYS), Object.keys(pub.body).join(","));
    check("2. with no revision in progress the flag is false", pub.body.revision_in_progress === false);
    check("2. the values are the document's", pub.body.lab_name === "Share Link Lab a" && pub.body.clia_number === "22D0000777" && pub.body.doc_number === "SC 1" && pub.body.title === "Made-up Specimen Collection Manual" && pub.body.version === "1.0", JSON.stringify(pub.body));
    check("2. the effective date is set and the approved date is version 1.0's approval", !!pub.body.effective_date && pub.body.approved_date === "2026-10-09 15:00:00", JSON.stringify(pub.body));
    const forbidden = /Made Up Signer|View Only|Zorblatt|Quinn|Owner a|sharelink-|signoff|signature|audit|hash|staff|token|email|user/i;
    check("2. no signature, sign-off, audit or staff field or value", !forbidden.test(pub.text), pub.text);
    check("2. noindex header on the read", pub.headers.get("x-robots-tag") === "noindex, nofollow", String(pub.headers.get("x-robots-tag")));
    check("2. no-store header on the read", pub.headers.get("cache-control") === "no-store", String(pub.headers.get("cache-control")));
    check("2. a signed-in caller gets the same answer, nothing more", (await call("GET", `/api/public/policy-share/${tokenA}`, undefined, A.token)).text === pub.text);
    // A document carried over from a prior system has no approval signature here: its date is that system's last approval or review.
    const carriedDoc = (await upload(A, "Made-up Carried Procedure", madeUpPdf(["carried"]), "SC 7")).id as number;
    const carriedVer = (sqlite.prepare("SELECT current_version_id AS v FROM policy_documents WHERE id = ?").get(carriedDoc) as any).v;
    sqlite.prepare("UPDATE policy_documents SET status = 'approved' WHERE id = ?").run(carriedDoc);
    sqlite.prepare("INSERT INTO policy_carried_records (lab_id, document_id, version_id, source_system, source_number, last_approval_or_review) VALUES (?, ?, ?, 'MediaLab', 'SC 7', '2026-01-20')").run(A.labId, carriedDoc, carriedVer);
    const carriedTok = (await call("POST", `${P}/documents/${carriedDoc}/share-links`, {}, A.token)).body.token;
    check("2. a carried-over document's approved date is its prior system's last approval or review", (await call("GET", `/api/public/policy-share/${carriedTok}`)).body.approved_date === "2026-01-20");
    sqlite.prepare("DELETE FROM policy_carried_records WHERE document_id = ?").run(carriedDoc);
    check("2. with neither, the approved date is empty, never made up", (await call("GET", `/api/public/policy-share/${carriedTok}`)).body.approved_date === null);

    // 3. The file
    const file = await raw(`/api/public/policy-share/${tokenA}/file`);
    check("3. the file streams inline as a PDF", file.status === 200 && file.headers.get("content-type") === "application/pdf" && /^inline/.test(file.headers.get("content-disposition") || ""), `${file.status} ${file.headers.get("content-type")} ${file.headers.get("content-disposition")}`);
    check("3. it is the approved version's file, byte for byte", file.buf.equals(V1));
    check("3. noindex and no-store on the file", file.headers.get("x-robots-tag") === "noindex, nofollow" && file.headers.get("cache-control") === "no-store");
    const dl = await raw(`/api/public/policy-share/${tokenA}/file?download=1`);
    check("3. ?download=1 sends it as an attachment named for the document", dl.status === 200 && /^attachment; filename="SC 1 Made-up Specimen Collection Manual v1\.0\.pdf"$/.test(dl.headers.get("content-disposition") || "") && dl.buf.equals(V1), String(dl.headers.get("content-disposition")));
    const viewsOf = (id: number) => sqlite.prepare("SELECT view_count, last_viewed_at FROM policy_share_links WHERE id = ?").get(id) as any;
    check("3. the metadata reads counted views; the file reads didn't", viewsOf(made.body.id).view_count === 2 && !!viewsOf(made.body.id).last_viewed_at, JSON.stringify(viewsOf(made.body.id)));
    await call("GET", `/api/public/policy-share/${tokenA}`);
    check("3. view_count increments on each read", viewsOf(made.body.id).view_count === 3);

    // 4. A revision on the same link
    const rev = await newVersion(A, docA, V2, false);
    check("4. setup: a revision is uploaded", !!rev.version_id, JSON.stringify(rev));
    // BUG-151: while the revision is a draft or in review, the link keeps showing the approved version (1.0), flagged.
    const inDraft = await call("GET", `/api/public/policy-share/${tokenA}`);
    check("4. while the revision is a draft, the link shows the approved version 1.0, flagged", inDraft.status === 200 && inDraft.body.version === "1.0" && inDraft.body.revision_in_progress === true && inDraft.body.approved_date === "2026-10-09 15:00:00", `${inDraft.status} ${inDraft.text}`);
    const draftFile = await raw(`/api/public/policy-share/${tokenA}/file`);
    check("4. and streams the approved file; the draft's file is never served", draftFile.status === 200 && draftFile.buf.equals(V1) && !draftFile.buf.equals(V2));
    const listDraft = await call("GET", `${P}/documents/${docA}/share-links`, undefined, A.token);
    check("4. the editor's list says the links show 1.0", listDraft.body.shareable === true && listDraft.body.shows_version === "1.0" && listDraft.body.links.filter((l: any) => !l.revoked_at).every((l: any) => l.status === "active"), JSON.stringify({ v: listDraft.body.shows_version, s: listDraft.body.links?.map((l: any) => l.status) }));
    await call("POST", `${P}/documents/${docA}/submit`, { workflowId: wf.body.id }, A.token);
    const inReviewRead = await call("GET", `/api/public/policy-share/${tokenA}`);
    check("4. while it is in review, still the approved version 1.0", inReviewRead.status === 200 && inReviewRead.body.version === "1.0" && inReviewRead.body.revision_in_progress === true, inReviewRead.text);
    check("4. and still its file", (await raw(`/api/public/policy-share/${tokenA}/file`)).buf.equals(V1));
    const second = await call("POST", `${P}/documents/${docA}/approve`, { typedSignature: "Made Up Signer", password: PW }, signer.token);
    check("4. setup: the revision is approved", second.body.status === "approved", JSON.stringify(second.body));
    const afterRev = await call("GET", `/api/public/policy-share/${tokenA}`);
    check("4. the SAME token now shows the new version, unflagged", afterRev.status === 200 && afterRev.body.version === "1.1" && afterRev.body.revision_in_progress === false, JSON.stringify(afterRev.body));
    const fileV2 = await raw(`/api/public/policy-share/${tokenA}/file`);
    check("4. and streams the new version's file", fileV2.buf.equals(V2) && !fileV2.buf.equals(V1));
    const v2Approved = (sqlite.prepare("SELECT MAX(signed_at) AS at FROM policy_signoffs WHERE document_id = ? AND version_id = ? AND action = 'approved'").get(docA, rev.version_id) as any).at;
    check("4. its approved date is the new version's approval, not 1.0's", afterRev.body.approved_date === v2Approved && v2Approved !== "2026-10-09 15:00:00", `${afterRev.body.approved_date} vs ${v2Approved}`);

    // 5. Not active: one body for every case
    const unknown = await call("GET", `/api/public/policy-share/${crypto.randomUUID()}`);
    const garbage = await call("GET", "/api/public/policy-share/not-a-real-token");
    const longOne = await call("GET", `/api/public/policy-share/${"x".repeat(300)}`);
    check("5. an unknown token: 404, the not-active body", unknown.status === 404 && unknown.text === NOT_ACTIVE, `${unknown.status} ${unknown.text}`);
    check("5. a malformed or overlong token: the same", garbage.status === 404 && garbage.text === NOT_ACTIVE && longOne.status === 404 && longOne.text === NOT_ACTIVE);
    check("5. the not-active answer carries noindex and no-store", unknown.headers.get("x-robots-tag") === "noindex, nofollow" && unknown.headers.get("cache-control") === "no-store");
    const revokeId = bySigner.body.id as number;
    const revoked = await call("DELETE", `${P}/documents/${docA}/share-links/${revokeId}`, undefined, A.token);
    check("5. revoking answers ok", revoked.status === 200 && revoked.body.ok === true, `HTTP ${revoked.status}`);
    const revRow = sqlite.prepare("SELECT revoked_at, revoked_by FROM policy_share_links WHERE id = ?").get(revokeId) as any;
    check("5. the row stays, with who revoked it and when", !!revRow?.revoked_at && revRow.revoked_by === A.userId, JSON.stringify(revRow));
    const revRead = await call("GET", `/api/public/policy-share/${bySigner.body.token}`);
    const revFile = await call("GET", `/api/public/policy-share/${bySigner.body.token}/file`);
    check("5. a revoked token: 404, the identical body, on the read and the file", revRead.status === 404 && revRead.text === NOT_ACTIVE && revFile.status === 404 && revFile.text === NOT_ACTIVE, `${revRead.status} ${revRead.text}`);
    check("5. revoking twice is harmless", (await call("DELETE", `${P}/documents/${docA}/share-links/${revokeId}`, undefined, A.token)).body.alreadyRevoked === true);
    check("5. a revoked link counts no views", (viewsOf(revokeId).view_count) === 0);
    check("5. the live link still works beside it", (await call("GET", `/api/public/policy-share/${tokenA}`)).status === 200);
    // Review overdue still shows (the read rule a limited Staff login follows); retired doesn't.
    sqlite.prepare("UPDATE policy_documents SET status = 'expired' WHERE id = ?").run(docA);
    check("5. a review-overdue document still shows", (await call("GET", `/api/public/policy-share/${tokenA}`)).status === 200);
    sqlite.prepare("UPDATE policy_documents SET status = 'approved' WHERE id = ?").run(docA);
    const docC = (await upload(A, "Made-up To Retire", madeUpPdf(["retire"]), "SC 5")).id as number;
    await approve(docC);
    const tokenC = (await call("POST", `${P}/documents/${docC}/share-links`, {}, A.token)).body.token as string;
    check("5. setup: the soon-retired document's link works", (await call("GET", `/api/public/policy-share/${tokenC}`)).status === 200);
    await call("POST", `${P}/documents/${docC}/archive`, {}, A.token);
    const retired = await call("GET", `/api/public/policy-share/${tokenC}`);
    const retiredFile = await call("GET", `/api/public/policy-share/${tokenC}/file`);
    check("5. a retired document: 404, the identical body", retired.status === 404 && retired.text === NOT_ACTIVE && retiredFile.text === NOT_ACTIVE, `${retired.status} ${retired.text}`);
    const onRetired = await call("POST", `${P}/documents/${docC}/share-links`, {}, A.token);
    check("5. a retired document can't get a new link", onRetired.status === 409 && /is retired/.test(onRetired.body.error), `HTTP ${onRetired.status} ${onRetired.body.error}`);
    check("5. unknown, revoked and retired read exactly alike", unknown.text === revRead.text && revRead.text === retired.text && unknown.status === revRead.status && revRead.status === retired.status);

    // 6. A token for A never reaches B
    const otherLabDoc = (await upload(B, "Made-up OTHERLAB Procedure", madeUpPdf(["MADEUP-MARKER-OTHERLAB"]), "OL 1")).id as number;
    sqlite.prepare("UPDATE policy_documents SET status = 'approved' WHERE id = ?").run(otherLabDoc);
    const otherLabVersion = (sqlite.prepare("SELECT current_version_id AS v FROM policy_documents WHERE id = ?").get(otherLabDoc) as any).v;
    const probes = [
      `/api/public/policy-share/${tokenA}?id=${docB}`, `/api/public/policy-share/${tokenA}?document_id=${docB}`, `/api/public/policy-share/${tokenA}?documentId=${docB}`,
      `/api/public/policy-share/${tokenA}?version_id=${docBVersion}`, `/api/public/policy-share/${tokenA}?versionId=${docBVersion}`, `/api/public/policy-share/${tokenA}?labId=${B.labId}`,
      `/api/public/policy-share/${tokenA}/file?id=${docB}`, `/api/public/policy-share/${tokenA}/file?document_id=${docB}`, `/api/public/policy-share/${tokenA}/file?version_id=${docBVersion}`,
      `/api/public/policy-share/${tokenA}/file?versionId=${otherLabVersion}&id=${otherLabDoc}`, `/api/public/policy-share/${tokenA}/file/${docB}`, `/api/public/policy-share/${tokenA}/${docB}`,
      `/api/public/policy-share/${tokenA}/${docB}/file`, `/api/public/policy-share/${tokenA}%2F..%2F${docB}`, `/api/public/policy-share/${docB}`, `/api/public/policy-share/${docB}/file`,
    ];
    const leaks: string[] = [];
    for (const p of probes) {
      for (const hdr of [{}, { "X-Active-Lab-Id": String(B.labId) }]) {
        const r = await raw(p, hdr);
        const text = r.buf.toString("latin1");
        if (/SECRETDOC|MADEUP-MARKER-OTHERDOC|OTHERLAB|MADEUP-MARKER-OTHERLAB/.test(text)) leaks.push(`${r.status} ${p}`);
        if (r.status === 200 && !/Made-up Specimen Collection Manual|MADEUP-MARKER-V2/.test(text)) leaks.push(`200 not doc A: ${p}`);
      }
    }
    check(`6. no parameter, path or header takes a token for A to B (${probes.length * 2} tries)`, leaks.length === 0, leaks.join(" | "));
    const tokenOtherLab = (await call("POST", `/api/labs/${B.labId}/veritapolicy/documents/${otherLabDoc}/share-links`, {}, B.token)).body.token as string;
    const otherLabRead = await call("GET", `/api/public/policy-share/${tokenOtherLab}?id=${docA}&document_id=${docA}`);
    check("6. another lab's token reads only its own document", otherLabRead.body.title === "Made-up OTHERLAB Procedure" && otherLabRead.body.lab_name === "Share Link Lab b", JSON.stringify(otherLabRead.body));
    check("6. another lab can't read or revoke this document's links", (await call("GET", `${P}/documents/${docA}/share-links`, undefined, B.token)).status === 403
      && (await call("GET", `/api/labs/${B.labId}/veritapolicy/documents/${docA}/share-links`, undefined, B.token)).status === 404
      && (await call("DELETE", `/api/labs/${B.labId}/veritapolicy/documents/${docA}/share-links/${made.body.id}`, undefined, B.token)).status === 404);
    const crossRevoke = await call("DELETE", `${P}/documents/${docB}/share-links/${made.body.id}`, undefined, A.token);
    check("6. a link can't be revoked through another document's path", crossRevoke.status === 404 && !viewsOf(made.body.id).revoked_at, `HTTP ${crossRevoke.status}`);

    // 7. The editor's list
    const list = await call("GET", `${P}/documents/${docA}/share-links`, undefined, A.token);
    const live = list.body.links?.find((l: any) => l.id === made.body.id);
    const dead = list.body.links?.find((l: any) => l.id === revokeId);
    check("7. the list has the active and the revoked link", list.status === 200 && list.body.shareable === true && live?.status === "active" && dead?.status === "revoked", JSON.stringify(list.body.links?.map((l: any) => [l.id, l.status])));
    check("7. with label, created date, views and who made it", live.label === "Nursing intranet" && !!live.created_at && live.view_count === viewsOf(made.body.id).view_count && live.created_by_name === "Owner a" && live.path === `/policy/${tokenA}`, JSON.stringify(live));
    check("7. the revoked row says who revoked it", dead.revoked_by_name === "Owner a" && !!dead.revoked_at);
    check("7. active links list first", list.body.links[0].status !== "revoked");
    check("7. a Staff seat can't read the list", (await call("GET", `${P}/documents/${docA}/share-links`, undefined, staff.token)).status === 403);
    check("7. a view-only seat can't read the list", (await call("GET", `${P}/documents/${docA}/share-links`, undefined, viewer.token)).status === 403);
    check("7. a Staff seat or view-only seat can't revoke", (await call("DELETE", `${P}/documents/${docA}/share-links/${made.body.id}`, undefined, staff.token)).status === 403
      && (await call("DELETE", `${P}/documents/${docA}/share-links/${made.body.id}`, undefined, viewer.token)).status === 403);
    check("7. an edit seat reads the list", (await call("GET", `${P}/documents/${docA}/share-links`, undefined, signer.token)).status === 200);

    // 8. Audit, delete, logs
    const audits = sqlite.prepare("SELECT action, document_id, user_id, details FROM policy_audit_log WHERE lab_id = ? AND action LIKE 'share_link_%' ORDER BY id").all(A.labId) as any[];
    const created = audits.filter((a) => a.action === "share_link_created");
    const revokedAudit = audits.filter((a) => a.action === "share_link_revoked");
    check("8. each create is audited, on the document, by who did it", created.length === 4 && created.some((a) => a.document_id === docA && a.user_id === signer.userId && JSON.parse(a.details).link_id === bySigner.body.id), JSON.stringify(created.map((a) => [a.document_id, a.user_id])));
    check("8. the create audit keeps the label", created.some((a) => JSON.parse(a.details).label === "Nursing intranet"));
    check("8. the revoke is audited once", revokedAudit.length === 1 && revokedAudit[0].document_id === docA && JSON.parse(revokedAudit[0].details).link_id === revokeId && revokedAudit[0].user_id === A.userId, JSON.stringify(revokedAudit));
    check("8. the public reads write no audit row", (sqlite.prepare("SELECT COUNT(*) AS n FROM policy_audit_log WHERE lab_id = ? AND action LIKE '%view%' AND document_id = ?").get(A.labId, docA) as any).n === 0);
    const del = await call("DELETE", `${P}/documents/${docB}`, undefined, A.token);
    const tokenB = (sqlite.prepare("SELECT COUNT(*) AS n FROM policy_share_links WHERE document_id = ?").get(docB) as any).n;
    check("8. setup: document B deletes", del.status === 200 && tokenB === 0);
    const docDelLink = (await call("POST", `${P}/documents/${docA}/share-links`, { label: "Made-up temp" }, A.token)).body.token as string;
    const docD = (await upload(A, "Made-up Delete Me", madeUpPdf(["delete"]), "SC 6")).id as number;
    await approve(docD);
    const tokenD = (await call("POST", `${P}/documents/${docD}/share-links`, {}, A.token)).body.token as string;
    await call("DELETE", `${P}/documents/${docD}`, undefined, A.token);
    check("8. deleting a document removes its links, and its token reads not active", (sqlite.prepare("SELECT COUNT(*) AS n FROM policy_share_links WHERE document_id = ?").get(docD) as any).n === 0 && (await call("GET", `/api/public/policy-share/${tokenD}`)).text === NOT_ACTIVE);
    check("8. other documents' links are untouched", (await call("GET", `/api/public/policy-share/${docDelLink}`)).status === 200);
    check("8. the request log masks the token", redactPath(`/api/public/policy-share/${tokenA}/file`) === "/api/public/policy-share/[REDACTED]/file");
    check("8. error reports mask the page and API addresses", maskTokenInAddress(`https://x/policy/${tokenA}`) === "https://x/policy/[REDACTED]" && maskTokenInAddress(`https://x/api/public/policy-share/${tokenA}`) === "https://x/api/public/policy-share/[REDACTED]");
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
