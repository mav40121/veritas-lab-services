// tests/integration/veritadc-bulk-load.test.ts
//
// VeritaDC bulk load (Step E of Heywood's move out of MediaLab, 2026-11-06). Boots the REAL routes on a scratch DB and runs
// the REAL load script against them. Every lab, person and document here is made up; no customer file is read.
//   1. boot creates policy_carried_records
//   2. the route refuses no secret, a bad record, the wrong lab name, an owner who isn't on the lab, a file VeritaDC refuses,
//      a missing face page, a converted file with no original; each refusal leaves nothing behind
//   3. a loaded document keeps its number, version and real dates, in the right nested manual, under the named owner
//   4. it never reads as approved today: no signoff, no attestation, no staff signature, no "approved" audit row
//   5. carried history: the record says it was carried over and is served to the lab; the face page and the original come
//      back, sandboxed, not to another lab, and an edited file is flagged
//   6. rerun: the same number is recognized and not duplicated, even after archiving; a number the lab added itself is left alone
//   7. no notice: reminders stay held to the start date; then they run; other documents are unaffected
//   8. past due: stays approved and overdue with its real date, gets an overdue notice, gets 60 days from arrival, then expires
//   9. a full volume stops the load with nothing written
//  10. the inspector link shows the history and the face page; a document in another lab is refused
//  11. the signature report says who signed where; recertify and a new version still work and the history stays
//  12. the load script: dry run writes nothing and sends no POST; a real run loads, one bad file doesn't stop the others, the
//      result file has one row per document, a rerun duplicates nothing, a .doc that can't convert and a missing file are reported
//  13. the owner's documents in another lab stay out of it; the Download all records table list includes the new table
// Run: npm run test:veritadc-bulk-load

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { runPolicyAutoExpire, runPolicyReviewReminders } from "../../server/veritapolicyReminders";
import { hashBuffer } from "../../server/veritapolicyApproval";
import { EXPORT_TABLES } from "../../server/exportAllTables";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 864e5).toISOString().slice(0, 10);
const FACE = (number: string, title: string) =>
  `<html><head><title>x</title><style>h1{color:#111}</style></head><body><h1>${number} ${title}</h1><p>Made-up signature face page.</p><img src="data:image/png;base64,iVBORw0KGgo="></body></html>`;
const TEXT_DOC = (s: string) => Buffer.from(`Made-up procedure text ${s}\n`);

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
  const ROOT = process.env.POLICY_STORAGE_ROOT!;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vdc-load-test-"));

  const call = async (method: string, p: string, body?: unknown, token?: string, extra: Record<string, string> = {}) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch { /* a file */ }
    return { status: r.status, body: json, text, headers: r.headers };
  };
  const mkLab = async (tag: string, labName: string) => {
    const email = `load-${tag}-${Date.now()}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: "Testpass123", name: `Owner ${tag}`, hipaa_acknowledged: true });
    const prov = await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName, plan: "hospital", isWarehouse: true });
    return { token: reg.body.token as string, labId: prov.body.labId as number, userId: reg.body.user?.id as number, email };
  };
  const mainLab = await mkLab("a", "Made Up Hospital");
  const otherLab = await mkLab("b", "Made Up Clinic");
  const ownerId = Number((sqlite.prepare("SELECT owner_user_id AS o FROM labs WHERE id = ?").get(mainLab.labId) as any).o);
  const baseMeta = (over: Record<string, unknown> = {}) => ({
    labId: mainLab.labId,
    expectedLabName: "Made Up Hospital",
    ownerUserId: ownerId,
    batch: "made-up-batch",
    loadedBy: "Made Up Loader",
    sourceSystem: "OldSystem",
    sourceStatus: "approved and current",
    docNumber: "MU 1",
    title: "Made-up procedure",
    titleAsExported: "Made-up procedure (2)",
    version: "2.1",
    effectiveDate: "2024-03-15",
    lastApprovalOrReview: "2026-01-20",
    nextReviewDue: "2027-01-20",
    reviewIntervalMonths: 12,
    remindersStartOn: iso(3),
    author: "Made Up Author",
    approvalRows: 2,
    reviewRows: 1,
    versionCount: 3,
    manualPath: ["Made Up Hospital", "Chemistry", "Analyzer A"],
    alsoFiledIn: ["Made Up Hospital"],
    ...over,
  });
  const post = async (meta: unknown, files: { document?: [Buffer, string]; face_page?: [Buffer, string]; original?: [Buffer, string] } = {}, secret: string | null = ADMIN) => {
    const fd = new FormData();
    fd.append("meta", typeof meta === "string" ? meta : JSON.stringify(meta));
    for (const [k, v] of Object.entries(files)) if (v) fd.append(k, new Blob([v[0]]), v[1]);
    const r = await fetch(`${base}/api/admin/veritadc/bulk-load/document`, { method: "POST", headers: secret ? { "x-admin-secret": secret } : {}, body: fd });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const stdFiles = (number = "MU 1", title = "Made-up procedure") => ({
    document: [TEXT_DOC(number), "made-up.txt"] as [Buffer, string],
    face_page: [Buffer.from(FACE(number, title)), "face-page.html"] as [Buffer, string],
  });
  const n = (sql: string, ...args: unknown[]) => Number((sqlite.prepare(sql).get(...args) as any).n);
  const docRow = (id: number) => sqlite.prepare("SELECT * FROM policy_documents WHERE id = ?").get(id) as any;
  const filesUnder = (dir: string): string[] => {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  };

  try {
    // 1. Schema
    const cols = (sqlite.prepare("PRAGMA table_info(policy_carried_records)").all() as any[]).map((c) => c.name);
    check("1. boot creates policy_carried_records with its columns", ["document_id", "source_number", "effective_date", "face_page_path", "original_path", "reminders_start_on"].every((c) => cols.includes(c)));

    // 2. Refusals
    const before = n("SELECT COUNT(*) AS n FROM policy_documents WHERE lab_id = ?", mainLab.labId);
    const filesBefore = filesUnder(ROOT).length;
    check("2a. no secret is refused", (await post(baseMeta(), stdFiles(), null)).status === 403);
    check("2b. the wrong secret is refused", (await post(baseMeta(), stdFiles(), "wrong")).status === 403);
    check("2c. the status route also needs the secret", (await call("GET", `/api/admin/veritadc/bulk-load/status?labId=${mainLab.labId}`)).status === 403);
    check("2d. meta that isn't JSON is refused", (await post("not json", stdFiles())).body.code === "BAD_META");
    const noDate = await post(baseMeta({ effectiveDate: null }), stdFiles());
    check("2e. a document with no effective date is refused", noDate.status === 400 && noDate.body.problems?.includes("effectiveDate"), JSON.stringify(noDate.body));
    check("2f. no reminder start date is refused", (await post(baseMeta({ remindersStartOn: null }), stdFiles())).body.problems?.includes("remindersStartOn") === true);
    const wrongLab = await post(baseMeta({ expectedLabName: "Somebody Else" }), stdFiles());
    check("2g. a lab id that doesn't match the lab name is refused", wrongLab.status === 409 && wrongLab.body.code === "LAB_MISMATCH", JSON.stringify(wrongLab.body));
    const notOwner = await post(baseMeta({ ownerUserId: 99999999 }), stdFiles());
    check("2h. an owner who isn't on the lab is refused", notOwner.status === 400 && notOwner.body.code === "OWNER_NOT_ON_LAB");
    const noLab = await post(baseMeta({ labId: 99999999 }), stdFiles());
    check("2i. a lab that doesn't exist is refused", noLab.status === 404);
    const oleDoc = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    const badFormat = await post(baseMeta(), { ...stdFiles(), document: [oleDoc, "made-up.doc"] });
    check("2j. a .doc is refused, as VeritaDC refuses it", badFormat.status === 400 && badFormat.body.code === "BAD_FORMAT");
    const noFile = await post(baseMeta(), { face_page: stdFiles().face_page });
    check("2k. no document file is refused", noFile.status === 400 && noFile.body.code === "NO_FILE");
    const noFace = await post(baseMeta(), { document: stdFiles().document });
    check("2l. no face page is refused", noFace.status === 400 && noFace.body.code === "NO_FACE_PAGE");
    const badFace = await post(baseMeta(), { ...stdFiles(), face_page: [oleDoc, "face.doc"] });
    check("2m. a face page that isn't HTML is refused", badFace.status === 400 && badFace.body.code === "BAD_FACE_PAGE");
    const noOriginal = await post(baseMeta({ convertedFrom: "doc" }), stdFiles());
    check("2n. a converted file with no original is refused", noOriginal.status === 400 && noOriginal.body.code === "NO_ORIGINAL");
    check("2o. the refusals left no document and no file behind",
      n("SELECT COUNT(*) AS n FROM policy_documents WHERE lab_id = ?", mainLab.labId) === before && filesUnder(ROOT).length === filesBefore && n("SELECT COUNT(*) AS n FROM policy_carried_records") === 0);
    check("2p. the refusals created no manual either", n("SELECT COUNT(*) AS n FROM policy_manuals WHERE lab_id = ? AND name = 'Analyzer A'", mainLab.labId) === 0);

    // 3. A loaded document
    const original = Buffer.from("legacy made-up bytes");
    const loaded = await post(baseMeta({ convertedFrom: "doc", originalFilename: "made-up.doc" }), {
      ...stdFiles(),
      original: [original, "made-up.doc"],
    });
    check("3a. a document loads", loaded.status === 201 && loaded.body.result === "loaded" && !!loaded.body.documentId, JSON.stringify(loaded.body));
    const id = loaded.body.documentId as number;
    const d1 = docRow(id);
    check("3b. approved, with its number and its real dates", d1.status === "approved" && d1.doc_number === "MU 1" && d1.effective_date === "2024-03-15" && d1.next_review_date === "2027-01-20" && d1.review_interval_months === 12, JSON.stringify(d1));
    check("3c. owned by the named owner", d1.owner_user_id === ownerId);
    check("3c2. the Updated column reads the last approval or review, not today", d1.updated_at === "2026-01-20", d1.updated_at);
    const list = (await call("GET", `/api/labs/${mainLab.labId}/veritapolicy/documents`, undefined, mainLab.token)).body.documents as any[];
    const listed = list.find((x) => x.id === id);
    check("3d. the list shows version 2.1, the full manual path and a carried-over flag",
      listed?.current_version_label === "2.1" && listed?.manual_path === "Made Up Hospital › Chemistry › Analyzer A" && listed?.carried_over === 1, JSON.stringify({ v: listed?.current_version_label, p: listed?.manual_path, c: listed?.carried_over }));
    const second = await post(baseMeta({ docNumber: "MU 2", manualPath: ["Made Up Hospital", "Chemistry", "Analyzer A"] }), stdFiles("MU 2"));
    check("3e. a second document reuses the same manuals", second.status === 201 && second.body.manualId === loaded.body.manualId);
    check("3f. the nested manuals exist once each", n("SELECT COUNT(*) AS n FROM policy_manuals WHERE lab_id = ? AND name = 'Chemistry' AND archived_at IS NULL", mainLab.labId) === 1);
    check("3g. a brand-new lab's default manuals don't appear next to them", n("SELECT COUNT(*) AS n FROM policy_manuals WHERE lab_id = ? AND name = 'Quality Assurance'", mainLab.labId) === 0);
    const noReview = await post(baseMeta({ docNumber: "MU 3", title: "Made-up form", nextReviewDue: null, reviewIntervalMonths: 0, lastApprovalOrReview: null }), stdFiles("MU 3"));
    const d3 = docRow(noReview.body.documentId);
    check("3h. a document with no review date stays that way", d3.next_review_date === null && d3.review_interval_months === 0);

    // 4. Never newly approved
    check("4a. no signoff", n("SELECT COUNT(*) AS n FROM policy_signoffs WHERE document_id = ?", id) === 0);
    check("4b. no read-and-sign assignment", n("SELECT COUNT(*) AS n FROM policy_attestations WHERE document_id = ?", id) === 0);
    check("4c. no staff signature", n("SELECT COUNT(*) AS n FROM staff_portal_policy_signatures WHERE document_id = ?", id) === 0);
    const audits = sqlite.prepare("SELECT action, details, user_id FROM policy_audit_log WHERE document_id = ?").all(id) as any[];
    check("4d. the audit trail says carried over, not approved", audits.length === 1 && audits[0].action === "carried_over", JSON.stringify(audits.map((a) => a.action)));
    const details = JSON.parse(audits[0].details);
    check("4e. the audit row names who ran the load first, then the original dates", Object.keys(details)[0] === "loaded_by" && details.loaded_by === "Made Up Loader" && details.effective_date === "2024-03-15");
    const trail = (await call("GET", `/api/labs/${mainLab.labId}/veritapolicy/documents/${id}/audit-trail`, undefined, mainLab.token)).body;
    check("4f. the merged audit trail carries no signature event", (trail.events || []).every((e: any) => e.kind !== "signoff"));
    const signoffs = (await call("GET", `/api/labs/${mainLab.labId}/veritapolicy/documents/${id}/signoffs`, undefined, mainLab.token)).body;
    check("4g. the signature history is empty rather than showing these people", (signoffs.signoffs || []).length === 0);
    const compliance = (await call("GET", `/api/labs/${mainLab.labId}/veritapolicy/compliance`, undefined, mainLab.token)).body;
    check("4h. the dashboard counts it as approved", Number(compliance.headline?.approved_total) >= 1, JSON.stringify(compliance.headline));

    // 5. The carried history
    const detail = (await call("GET", `/api/labs/${mainLab.labId}/veritapolicy/documents/${id}`, undefined, mainLab.token)).body;
    const c = detail.carried;
    check("5a. the record carries the original numbers and dates",
      c?.source_system === "OldSystem" && c?.source_number === "MU 1" && c?.source_version === "2.1" && c?.effective_date === "2024-03-15" && c?.last_approval_or_review === "2026-01-20" && c?.next_review_due === "2027-01-20",
      JSON.stringify(c));
    check("5b. the record names the owner and the loader, and the title as it was", c?.owner_name?.startsWith("Owner") && c?.loaded_by === "Made Up Loader" && c?.title_as_exported === "Made-up procedure (2)");
    check("5c. the record holds no file location", !JSON.stringify(c).includes("carried/"));
    const fp = await call("GET", `/api/labs/${mainLab.labId}/veritapolicy/documents/${id}/carried/face-page`, undefined, mainLab.token);
    check("5d. the face page comes back as the file loaded", fp.status === 200 && fp.text === FACE("MU 1", "Made-up procedure"));
    check("5e. the face page can't run script, even opened directly", /sandbox/.test(fp.headers.get("content-security-policy") || ""), fp.headers.get("content-security-policy") || "");
    const og = await fetch(`${base}/api/labs/${mainLab.labId}/veritapolicy/documents/${id}/carried/original`, { headers: { Authorization: `Bearer ${mainLab.token}` } });
    check("5f. the original comes back byte for byte under its own name", og.status === 200 && Buffer.from(await og.arrayBuffer()).equals(original) && /made-up\.doc/.test(og.headers.get("content-disposition") || ""));
    check("5g. another lab can't read the face page", (await call("GET", `/api/labs/${otherLab.labId}/veritapolicy/documents/${id}/carried/face-page`, undefined, otherLab.token)).status === 403);
    check("5h. someone with no sign-in can't read it", (await call("GET", `/api/labs/${mainLab.labId}/veritapolicy/documents/${id}/carried/face-page`)).status === 401);
    const noOrig = await call("GET", `/api/labs/${mainLab.labId}/veritapolicy/documents/${second.body.documentId}/carried/original`, undefined, mainLab.token);
    check("5i. a document with no kept original says so", noOrig.status === 404);
    const rec = sqlite.prepare("SELECT * FROM policy_carried_records WHERE document_id = ?").get(id) as any;
    check("5j. hashes of the face page and the original are stored", rec.face_page_sha256 === hashBuffer(Buffer.from(FACE("MU 1", "Made-up procedure"))) && rec.original_sha256 === hashBuffer(original));
    fs.writeFileSync(path.join(ROOT, rec.face_page_path), "changed");
    const tampered = await call("GET", `/api/labs/${mainLab.labId}/veritapolicy/documents/${id}/carried/face-page`, undefined, mainLab.token);
    check("5k. an edited face page is flagged and logged", tampered.headers.get("x-veritapolicy-tamper") === "yes" && n("SELECT COUNT(*) AS n FROM policy_audit_log WHERE document_id = ? AND action = 'tamper_detected'", id) === 1);
    fs.writeFileSync(path.join(ROOT, rec.face_page_path), FACE("MU 1", "Made-up procedure"));

    // 6. Rerun
    const docsBefore = n("SELECT COUNT(*) AS n FROM policy_documents WHERE lab_id = ?", mainLab.labId);
    const filesBeforeRerun = filesUnder(ROOT).length;
    const again = await post(baseMeta({ docNumber: "mu  1" }), stdFiles());
    check("6a. the same number, in any case, is recognized", again.status === 200 && again.body.result === "already_loaded" && again.body.documentId === id, JSON.stringify(again.body));
    check("6b. a rerun adds no document and no file", n("SELECT COUNT(*) AS n FROM policy_documents WHERE lab_id = ?", mainLab.labId) === docsBefore && filesUnder(ROOT).length === filesBeforeRerun);
    const other = await post(baseMeta({ labId: otherLab.labId, expectedLabName: "Made Up Clinic", ownerUserId: Number((sqlite.prepare("SELECT owner_user_id AS o FROM labs WHERE id = ?").get(otherLab.labId) as any).o), docNumber: "MU 1" }), stdFiles());
    check("6c. another lab can hold the same number (a system-wide document goes in both)", other.status === 201 && other.body.documentId !== id);
    const fdPlain = new FormData();
    fdPlain.append("file", new Blob([TEXT_DOC("the lab's own")]), "own.txt");
    fdPlain.append("doc_number", "OWN 7");
    fdPlain.append("title", "The lab's own document");
    const own = await fetch(`${base}/api/labs/${mainLab.labId}/veritapolicy/documents`, { method: "POST", headers: { Authorization: `Bearer ${mainLab.token}` }, body: fdPlain });
    const ownId = ((await own.json()) as any).id;
    const taken = await post(baseMeta({ docNumber: "OWN 7" }), stdFiles("OWN 7"));
    check("6d. a number the lab added itself is left alone and reported", taken.status === 409 && taken.body.code === "NUMBER_TAKEN" && taken.body.documentId === ownId && docRow(ownId).status === "draft");
    const archived = await post(baseMeta({ docNumber: "MU 4" }), stdFiles("MU 4"));
    sqlite.prepare("UPDATE policy_documents SET archived_at = datetime('now') WHERE id = ?").run(archived.body.documentId);
    const reArchived = await post(baseMeta({ docNumber: "MU 4" }), stdFiles("MU 4"));
    check("6e. a rerun never brings back a document the lab archived", reArchived.body.result === "already_loaded");

    // 7. No notice until the start date
    const dueSoonHeld = (await post(baseMeta({ docNumber: "MU 5", nextReviewDue: iso(7), remindersStartOn: iso(2) }), stdFiles("MU 5"))).body.documentId;
    const reminderRows = (docId: number) => sqlite.prepare("SELECT reminder_type FROM policy_review_reminders WHERE document_id = ?").all(docId) as any[];
    await runPolicyReviewReminders();
    check("7a. a document due in a week sends nothing before its start date", reminderRows(dueSoonHeld).length === 0);
    check("7b. the load itself wrote no reminder", n("SELECT COUNT(*) AS n FROM policy_review_reminders") === 0);
    const statusHeld = (await call("GET", `/api/admin/veritadc/bulk-load/status?labId=${mainLab.labId}`, undefined, undefined, { "x-admin-secret": ADMIN })).body;
    check("7c. the status route counts it all, and shows no signature, assignment or reminder",
      statusHeld.documents?.carried >= 5 && statusHeld.forCarried?.signoffs === 0 && statusHeld.forCarried?.attestations === 0 && statusHeld.forCarried?.reminders === 0 && statusHeld.carriedNumbers?.includes("MU 1"),
      JSON.stringify(statusHeld.forCarried));
    check("7d. the status route reports free space and the database size", Number(statusHeld.volume?.freeBytes) > 0 && Number(statusHeld.databaseBytes) > 0);
    sqlite.prepare("UPDATE policy_carried_records SET reminders_start_on = ? WHERE document_id = ?").run(iso(-1), dueSoonHeld);
    await runPolicyReviewReminders();
    check("7e. on its start date the usual notice runs", reminderRows(dueSoonHeld).map((r) => r.reminder_type).join() === "30_day_warning", JSON.stringify(reminderRows(dueSoonHeld)));
    await runPolicyReviewReminders();
    check("7f. the notice is sent once", reminderRows(dueSoonHeld).length === 1);
    const plainOverdue = Number(sqlite.prepare("INSERT INTO policy_documents (lab_id, title, status, owner_user_id, next_review_date, review_interval_months) VALUES (?, 'Plain made-up policy', 'approved', ?, ?, 12)").run(mainLab.labId, ownerId, iso(10)).lastInsertRowid);
    await runPolicyReviewReminders();
    check("7g. a document that wasn't carried over isn't held", reminderRows(plainOverdue).map((r) => r.reminder_type).join() === "30_day_warning");

    // 8. Past due on arrival
    const pastLong = (await post(baseMeta({ docNumber: "MU 6", nextReviewDue: iso(-180), remindersStartOn: iso(-1) }), stdFiles("MU 6"))).body.documentId;
    const pastRecent = (await post(baseMeta({ docNumber: "MU 7", nextReviewDue: iso(-57), remindersStartOn: iso(-1) }), stdFiles("MU 7"))).body.documentId;
    const expire1 = runPolicyAutoExpire();
    check("8a. past due by months: stays approved on the first night", docRow(pastLong).status === "approved", JSON.stringify(expire1));
    check("8b. its real date stays", docRow(pastLong).next_review_date === iso(-180));
    const cmp = (await call("GET", `/api/labs/${mainLab.labId}/veritapolicy/compliance`, undefined, mainLab.token)).body;
    check("8c. it shows on the overdue list", (cmp.overdueList || cmp.overdue || []).some((o: any) => o.id === pastLong), Object.keys(cmp).join(","));
    await runPolicyReviewReminders();
    check("8d. it gets the overdue notice instead of no notice at all", reminderRows(pastLong).map((r) => r.reminder_type).join() === "overdue", JSON.stringify(reminderRows(pastLong)));
    check("8e. past due by weeks: the same", reminderRows(pastRecent).map((r) => r.reminder_type).join() === "overdue");
    sqlite.prepare("UPDATE policy_carried_records SET loaded_at = datetime('now', '-61 days') WHERE document_id = ?").run(pastLong);
    const expire2 = runPolicyAutoExpire();
    check("8f. 60 days after it arrived, the usual rule expires it", docRow(pastLong).status === "expired" && n("SELECT COUNT(*) AS n FROM policy_audit_log WHERE document_id = ? AND action = 'auto_expired'", pastLong) === 1, JSON.stringify(expire2));
    const ordinaryOld = Number(sqlite.prepare("INSERT INTO policy_documents (lab_id, title, status, owner_user_id, next_review_date, review_interval_months) VALUES (?, 'Plain old made-up policy', 'approved', ?, ?, 12)").run(mainLab.labId, ownerId, iso(-61)).lastInsertRowid);
    runPolicyAutoExpire();
    check("8g. an ordinary document past 60 days still expires as before", docRow(ordinaryOld).status === "expired");

    // 9. Full volume
    const docsBeforeFull = n("SELECT COUNT(*) AS n FROM policy_documents WHERE lab_id = ?", mainLab.labId);
    const full = await post(baseMeta({ docNumber: "MU 8", minFreeBytes: 9e15 }), stdFiles("MU 8"));
    check("9a. a volume too full stops the document with 507", full.status === 507 && full.body.code === "VOLUME_LOW", JSON.stringify(full.body));
    check("9b. nothing was written for it", n("SELECT COUNT(*) AS n FROM policy_documents WHERE lab_id = ?", mainLab.labId) === docsBeforeFull && n("SELECT COUNT(*) AS n FROM policy_carried_records WHERE source_number = 'MU 8'") === 0);

    // 10. Inspector link
    const link = await call("POST", `/api/labs/${mainLab.labId}/veritapolicy/surveyor-links`, { label: "Made-up visit", expiresInDays: 7 }, mainLab.token);
    const token = link.body.token as string;
    check("10a. an inspector link is made", !!token, JSON.stringify(link.body).slice(0, 200));
    const sv = (await call("GET", `/api/surveyor/${token}/policies/${id}/signoffs`)).body;
    check("10b. the inspector sees the carried-over history and no signature in VeritaAssure", sv.carried?.source_system === "OldSystem" && (sv.signoffs || []).length === 0);
    const svFace = await call("GET", `/api/surveyor/${token}/policies/${id}/carried/face-page`);
    check("10c. the inspector can open the face page", svFace.status === 200 && svFace.text === FACE("MU 1", "Made-up procedure"));
    const otherDoc = other.body.documentId as number;
    check("10d. a link can't open another lab's document", (await call("GET", `/api/surveyor/${token}/policies/${otherDoc}/carried/face-page`)).status === 403);
    check("10e. a bad link is refused", (await call("GET", `/api/surveyor/not-a-real-token-at-all-000000/policies/${id}/carried/face-page`)).status === 404);

    // 11. The signature report, recertify and revise
    const xlsx = await fetch(`${base}/api/labs/${mainLab.labId}/veritapolicy/documents/${id}/signature-report.xlsx`, { headers: { Authorization: `Bearer ${mainLab.token}` } });
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await xlsx.arrayBuffer()) as any);
    let reportText = "";
    wb.getWorksheet("Signature Report")?.eachRow((row) => row.eachCell((cell) => { reportText += ` ${cell.text}`; }));
    check("11a. the signature report says the approval was in the prior system", /approved and reviewed in OldSystem, the prior system, not in VeritaAssure/.test(reportText), reportText.slice(0, 300));
    check("11b. the report doesn't say nobody approved it", !/No director sign-off recorded/.test(reportText));
    const recert = await call("POST", `/api/labs/${mainLab.labId}/veritapolicy/documents/${id}/recertify`, { typedSignature: "Owner A", password: "Testpass123" }, mainLab.token);
    const afterRecert = docRow(id);
    check("11c. the review can be completed in VeritaDC, which moves the date on", recert.status === 200 && afterRecert.next_review_date !== "2027-01-20", `${recert.status} ${JSON.stringify(recert.body)} ${afterRecert.next_review_date}`);
    check("11d. that review is signed in VeritaAssure, the carried dates stay put", n("SELECT COUNT(*) AS n FROM policy_signoffs WHERE document_id = ? AND action = 'recertified'", id) === 1 && (sqlite.prepare("SELECT next_review_due FROM policy_carried_records WHERE document_id = ?").get(id) as any).next_review_due === "2027-01-20");
    const fdV = new FormData();
    fdV.append("file", new Blob([TEXT_DOC("revised")]), "revised.txt");
    const rev = await fetch(`${base}/api/labs/${mainLab.labId}/veritapolicy/documents/${id}/versions`, { method: "POST", headers: { Authorization: `Bearer ${mainLab.token}` }, body: fdV });
    const revBody = (await rev.json()) as any;
    check("11e. a revision continues the real version number", rev.status === 201 && revBody.version_label === "2.2", JSON.stringify(revBody));
    const afterRev = (await call("GET", `/api/labs/${mainLab.labId}/veritapolicy/documents/${id}`, undefined, mainLab.token)).body.carried;
    check("11f. after a revision the history stays and says it belongs to the earlier version", afterRev?.is_current_version === false && afterRev?.source_version === "2.1");
    const del = await post(baseMeta({ docNumber: "MU 9" }), stdFiles("MU 9"));
    const delOut = await call("DELETE", `/api/labs/${mainLab.labId}/veritapolicy/documents/${del.body.documentId}`, undefined, mainLab.token);
    check("11g. deleting a document removes its carried record", delOut.status === 200 && n("SELECT COUNT(*) AS n FROM policy_carried_records WHERE document_id = ?", del.body.documentId) === 0);

    // 12. The load script, against this server
    const runLoad = (args: string[]) =>
      new Promise<{ code: number | null; out: string }>((resolve) => {
        const script = path.resolve("scripts/veritadc-bulk-load.mts");
        // Node directly, no shell, so a document number with a space stays one argument on every platform.
        const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", script, ...args], {
          env: { ...process.env, ADMIN_SECRET: ADMIN, DB_PATH: path.join(tmp, "never-used.db") },
        });
        let out = "";
        child.stdout.on("data", (x) => (out += x));
        child.stderr.on("data", (x) => (out += x));
        child.on("close", (code) => resolve({ code, out }));
      });
    const exportRoot = path.join(tmp, "export");
    const work = path.join(tmp, "work");
    const put = (rel: string, data: string | Buffer) => { const f = path.join(exportRoot, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file("word/document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Made-up procedure body.</w:t></w:r></w:p></w:body></w:document>');
    const docx = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
    const legacy = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.from("made-up legacy bytes")]);
    const legacyConverted = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.from("a second made-up legacy file")]);
    const legacySlides = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.from("a made-up legacy slide file")]);
    const { PDFDocument } = await import("pdf-lib");
    const onePagePdf = await PDFDocument.create();
    onePagePdf.addPage();
    const slidesPdf = Buffer.from(await onePagePdf.save());
    const faces = "All Signature Face Pages";
    put(`North/Chem/ZZ 1_Plain Policy (1).docx`, docx);
    put(`${faces}/ZZ 1_Plain Policy.html`, FACE("ZZ 1", "Plain Policy (1)"));
    put(`North/Chem/ZZ 2_Filed Twice.docx`, docx);
    put(`South/Spec/ZZ 2_Filed Twice.docx`, docx);
    put(`${faces}/ZZ 2_Filed Twice.html`, FACE("ZZ 2", "Filed Twice"));
    put(`North/Chem/ZZ 3_Legacy Fails.doc`, legacy);
    put(`${faces}/ZZ 3_Legacy Fails.html`, FACE("ZZ 3", "Legacy Fails"));
    put(`North/Chem/ZZ 4_Legacy Converted.doc`, legacyConverted);
    put(`${faces}/ZZ 4_Legacy Converted.html`, FACE("ZZ 4", "Legacy Converted"));
    put(`North/Chem/ZZ 5_Bad Bytes.docx`, Buffer.from("this is not a word file"));
    put(`${faces}/ZZ 5_Bad Bytes.html`, FACE("ZZ 5", "Bad Bytes"));
    put(`${faces}/ZZ 6_No File.html`, FACE("ZZ 6", "No File"));
    put(`North/Chem/ZZ 7_Past Due.docx`, docx);
    put(`${faces}/ZZ 7_Past Due.html`, FACE("ZZ 7", "Past Due"));
    put(`North/Chem/ZZ 8_Retired.docx`, docx);
    put(`${faces}/ZZ 8_Retired.html`, FACE("ZZ 8", "Retired"));
    put(`Shared/ZZ 9_Everywhere.docx`, docx);
    put(`${faces}/ZZ 9_Everywhere.html`, FACE("ZZ 9", "Everywhere"));
    put(`North/Chem/ZZ 10_Has A Label.txt`, "A made-up example label: DOB 01/02/1950.\n");
    put(`${faces}/ZZ 10_Has A Label.html`, FACE("ZZ 10", "Has A Label"));
    put(`North/Chem/ZZ 11_Slides.ppt`, legacySlides);
    put(`${faces}/ZZ 11_Slides.html`, FACE("ZZ 11", "Slides"));
    // A cached conversion stands in for Word so this runs on any machine.
    const sha = (b: Buffer) => hashBuffer(b);
    fs.mkdirSync(path.join(work, "converted"), { recursive: true });
    fs.writeFileSync(path.join(work, "converted", `${sha(legacyConverted)}.docx`), docx);
    fs.writeFileSync(path.join(work, "converted", `${sha(legacyConverted)}.json`), JSON.stringify({ kind: "doc", before: { pages: 2, words: 10 }, after: { pages: 3, words: 10 } }));
    fs.writeFileSync(path.join(work, "converted", `${sha(legacySlides)}.pdf`), slidesPdf);
    fs.writeFileSync(path.join(work, "converted", `${sha(legacySlides)}.json`), JSON.stringify({ kind: "ppt", before: { slides: 1 }, after: {} }));
    const manifestRows = [
      ["number", "title", "version", "status", "effective_date", "last_approval_or_review", "next_review_due", "author", "signature_rows", "approval_rows", "review_rows", "versions", "face_page", "manual_paths", "files"],
      ["ZZ 1", "Plain Policy-file", "1.0", "approved and current", "1/15/2024", "1/15/2026", "1/15/2027", "Made Up", "2", "1", "1", "1", `${faces}/ZZ 1_Plain Policy.html`, "North / Chem", "ZZ 1_Plain Policy (1).docx"],
      ["ZZ 2", "Filed Twice", "2.1", "approved and current", "2/1/2024", "2/1/2026", "2/1/2027", "Made Up", "1", "1", "0", "3", `${faces}/ZZ 2_Filed Twice.html`, "North / Chem || South / Spec", "ZZ 2_Filed Twice.docx || ZZ 2_Filed Twice.docx"],
      ["ZZ 3", "Legacy Fails", "1.0", "approved and current", "3/1/2024", "3/1/2026", "3/1/2027", "Made Up", "1", "1", "0", "1", `${faces}/ZZ 3_Legacy Fails.html`, "North / Chem", "ZZ 3_Legacy Fails.doc"],
      ["ZZ 4", "Legacy Converted", "1.1", "approved and current", "4/1/2024", "4/1/2026", "4/1/2027", "Made Up", "1", "1", "0", "2", `${faces}/ZZ 4_Legacy Converted.html`, "North / Chem", "ZZ 4_Legacy Converted.doc"],
      ["ZZ 5", "Bad Bytes", "1.0", "approved and current", "5/1/2024", "5/1/2026", "5/1/2027", "Made Up", "1", "1", "0", "1", `${faces}/ZZ 5_Bad Bytes.html`, "North / Chem", "ZZ 5_Bad Bytes.docx"],
      ["ZZ 6", "No File", "1.0", "approved and current", "6/1/2024", "6/1/2026", "6/1/2027", "Made Up", "1", "1", "0", "1", `${faces}/ZZ 6_No File.html`, "", ""],
      ["ZZ 7", "Past Due", "1.0", "past periodic review date (5/8/2026", "5/8/2025", "5/8/2025", "5/8/2026", "Made Up", "1", "1", "0", "1", `${faces}/ZZ 7_Past Due.html`, "North / Chem", "ZZ 7_Past Due.docx"],
      ["ZZ 8", "Retired", "1.0", "retired", "", "", "", "Made Up", "0", "0", "0", "1", `${faces}/ZZ 8_Retired.html`, "North / Chem", "ZZ 8_Retired.docx"],
      ["ZZ 9", "Everywhere", "1.0", "approved and current", "7/1/2024", "7/1/2026", "7/1/2027", "Made Up", "1", "1", "0", "1", `${faces}/ZZ 9_Everywhere.html`, "Shared", "ZZ 9_Everywhere.docx"],
      ["ZZ 10", "Has A Label", "1.0", "approved and current", "8/1/2024", "8/1/2026", "8/1/2027", "Made Up", "1", "1", "0", "1", `${faces}/ZZ 10_Has A Label.html`, "North / Chem", "ZZ 10_Has A Label.txt"],
      ["ZZ 11", "Slides", "1.0", "approved and current", "9/1/2024", "9/1/2026", "9/1/2027", "Made Up", "1", "1", "0", "1", `${faces}/ZZ 11_Slides.html`, "North / Chem", "ZZ 11_Slides.ppt"],
    ];
    const manifest = path.join(tmp, "manifest.csv");
    fs.writeFileSync(manifest, "﻿" + manifestRows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n") + "\n");
    const scriptLabOne = await mkLab("c", "Made Up North");
    const scriptLabTwo = await mkLab("d", "Made Up South");
    // One owner on both labs, the way one customer's system works.
    const scriptOwner = Number((sqlite.prepare("SELECT owner_user_id AS o FROM labs WHERE id = ?").get(scriptLabOne.labId) as any).o);
    sqlite.prepare("UPDATE labs SET owner_user_id = ? WHERE id = ?").run(scriptOwner, scriptLabTwo.labId);
    const config = path.join(tmp, "config.json");
    fs.writeFileSync(config, JSON.stringify({
      batch: "made-up-script", sourceSystem: "OldSystem", loadedBy: "Made Up Loader", ownerUserId: scriptOwner, reviewIntervalMonths: 12,
      labs: { [scriptLabOne.labId]: { expectedLabName: "Made Up North" }, [scriptLabTwo.labId]: { expectedLabName: "Made Up South" } },
      topLevel: { North: [scriptLabOne.labId], South: [scriptLabTwo.labId], Shared: [scriptLabOne.labId, scriptLabTwo.labId] },
      noManualLabByPrefix: { "ZZ ": scriptLabOne.labId },
    }));
    const argsFor = (labs: string, url: string) => ["--manifest", manifest, "--export-root", exportRoot, "--config", config, "--work-dir", work, "--confirm-labs", labs, "--base-url", url, "--no-convert", "--pause-ms", "0", "--include-past-due"];
    const common = argsFor(`${scriptLabOne.labId},${scriptLabTwo.labId}`, base);
    const latest =(prefix: string) => path.join(work, fs.readdirSync(work).filter((f) => f.startsWith(prefix)).sort().pop()!);
    const parse = async (file: string) => (await import("../../scripts/veritadc-load-plan.mts")).parseCsv(fs.readFileSync(file, "utf8"));

    const wrongLabs = await runLoad(argsFor("46", base));
    check("12a. labs that don't match the config stop it before anything", wrongLabs.code === 1 && /doesn't match the labs/.test(wrongLabs.out), wrongLabs.out.slice(0, 200));

    const docsBeforeDry = n("SELECT COUNT(*) AS n FROM policy_documents WHERE lab_id IN (?, ?)", scriptLabOne.labId, scriptLabTwo.labId);
    const manualsBeforeDry = n("SELECT COUNT(*) AS n FROM policy_manuals WHERE lab_id IN (?, ?)", scriptLabOne.labId, scriptLabTwo.labId);
    const auditsBeforeDry = n("SELECT COUNT(*) AS n FROM policy_audit_log");
    const viewsBeforeDry = n("SELECT COUNT(*) AS n FROM record_views");
    const dry = await runLoad(common);
    check("12b. the dry run finishes", dry.code === 0, dry.out.slice(-300));
    check("12c. the dry run wrote nothing to the server",
      n("SELECT COUNT(*) AS n FROM policy_documents WHERE lab_id IN (?, ?)", scriptLabOne.labId, scriptLabTwo.labId) === docsBeforeDry
      && n("SELECT COUNT(*) AS n FROM policy_manuals WHERE lab_id IN (?, ?)", scriptLabOne.labId, scriptLabTwo.labId) === manualsBeforeDry
      && n("SELECT COUNT(*) AS n FROM policy_audit_log") === auditsBeforeDry
      && n("SELECT COUNT(*) AS n FROM record_views") === viewsBeforeDry);
    const drySummary = JSON.parse(fs.readFileSync(latest("dryrun_summary_"), "utf8"));
    check("12d. the dry run prints no document contents", !dry.out.includes("Made-up procedure body") && !dry.out.includes("Made-up signature face page"));
    const dryRows = await parse(latest("dryrun_results_"));
    const dryBy = (num: string) => dryRows.filter((r) => r.number === num);
    check("12e. the plan: would load, with one row per lab", dryBy("ZZ 2").length === 2 && dryBy("ZZ 2").every((r) => r.result === "would_load") && dryBy("ZZ 9").length === 2, JSON.stringify(drySummary.outcome));
    check("12f. a .doc with no converter is reported, not skipped", dryBy("ZZ 3")[0]?.result === "not_loaded" && /conversion_failed/.test(dryBy("ZZ 3")[0]?.detail) && /converter_unavailable/.test(dryBy("ZZ 3")[0]?.convert_check));
    check("12g. a conversion that changed something is flagged", /differs: pages 2 to 3/.test(dryBy("ZZ 4")[0]?.convert_check), dryBy("ZZ 4")[0]?.convert_check);
    check("12g2. a slide file reused from the work folder compares slides to PDF pages and reads clean", dryBy("ZZ 11")[0]?.convert_check === "clean" && dryBy("ZZ 11")[0]?.file_loaded === "pdf", JSON.stringify(dryBy("ZZ 11")[0]));
    check("12h. a file whose contents don't match its type is reported", dryBy("ZZ 5")[0]?.result === "not_loaded" && /bad_format/.test(dryBy("ZZ 5")[0]?.detail));
    check("12i. a document with no file is reported against its lab", dryBy("ZZ 6")[0]?.result === "not_loaded" && /missing_file/.test(dryBy("ZZ 6")[0]?.detail) && dryBy("ZZ 6")[0]?.lab === String(scriptLabOne.labId));
    check("12j. retired stays out of the results", dryBy("ZZ 8").length === 0 && drySummary.tally.manifest_retired === 1);
    check("12k. past due loads with the flag", dryBy("ZZ 7")[0]?.result === "would_load" && dryBy("ZZ 7")[0]?.next_review_due === "2026-05-08");
    check("12k2. a document the patient-information check flags is held, and the file names only the label", dryBy("ZZ 10")[0]?.result === "not_loaded" && /phi_flag_held/.test(dryBy("ZZ 10")[0]?.detail) && dryBy("ZZ 10")[0]?.phi_labels === "Date of birth" && !fs.readFileSync(latest("dryrun_results_"), "utf8").includes("01/02/1950"));
    const noFlag = await runLoad(common.filter((a) => a !== "--include-past-due"));
    const noFlagRows = await parse(latest("dryrun_results_"));
    check("12l. without the flag it stays out and is listed", noFlag.code === 0 && noFlagRows.filter((r) => r.number === "ZZ 7").length === 0 && fs.readFileSync(latest("dryrun_left_out_"), "utf8").includes("ZZ 7"));
    const titleRows = await parse(latest("dryrun_titles_changed_"));
    check("12m. the face page's own title is the source, and each title changed is listed", titleRows.some((t) => t.number === "ZZ 1" && t.title_in_prior_system === "Plain Policy (1)" && t.title_loaded === "Plain Policy"), JSON.stringify(titleRows));

    const refusedGo = await runLoad([...argsFor(`${scriptLabOne.labId},${scriptLabTwo.labId}`, "https://www.veritaslabservices.com"), "--apply"]);
    check("12n. a real load against production without the go is refused before anything", refusedGo.code === 1 && /needs --go/.test(refusedGo.out), refusedGo.out.slice(0, 200));

    const real = await runLoad([...common, "--apply", "--reminders-start-on", iso(5)]);
    const realRows = await parse(latest("load_results_"));
    const realBy = (num: string) => realRows.filter((r) => r.number === num);
    check("12o. the real run ends non-zero only if something failed to send; here all sendable ones loaded", real.code === 0, real.out.slice(-400));
    check("12p. one result row per document, per lab", realRows.length === 1 + 2 + 1 + 1 + 1 + 1 + 1 + 2 + 1 + 1, String(realRows.length));
    check("12q. the good ones loaded, the bad and held ones didn't stop them",
      ["ZZ 1", "ZZ 4", "ZZ 7", "ZZ 11"].every((x) => realBy(x)[0]?.result === "loaded") && realBy("ZZ 2").every((r) => r.result === "loaded") && realBy("ZZ 9").every((r) => r.result === "loaded") && ["ZZ 3", "ZZ 5", "ZZ 6", "ZZ 10"].every((x) => realBy(x)[0]?.result === "not_loaded"),
      JSON.stringify(realRows.map((r) => [r.number, r.result])));
    const north = (await call("GET", `/api/admin/veritadc/bulk-load/status?labId=${scriptLabOne.labId}`, undefined, undefined, { "x-admin-secret": ADMIN })).body;
    const south = (await call("GET", `/api/admin/veritadc/bulk-load/status?labId=${scriptLabTwo.labId}`, undefined, undefined, { "x-admin-secret": ADMIN })).body;
    check("12r. the right number landed in each lab", north.documents.carried === 6 && south.documents.carried === 2, `${north.documents.carried} ${south.documents.carried}`);
    check("12s. every loaded document has its face page", north.documents.carriedWithFacePage === 6 && south.documents.carriedWithFacePage === 2);
    check("12t. the converted ones kept their originals", north.documents.carriedWithOriginal === 2);
    check("12u. no signature, assignment or reminder came of it", [north, south].every((s) => s.forCarried.signoffs === 0 && s.forCarried.attestations === 0 && s.forCarried.staffSignatures === 0 && s.forCarried.reminders === 0));
    const conv = sqlite.prepare("SELECT c.converted_from, c.original_filename, v.file_format, v.version_major, v.version_minor FROM policy_carried_records c JOIN policy_versions v ON v.id = c.version_id WHERE c.lab_id = ? AND c.source_number = 'ZZ 4'").get(scriptLabOne.labId) as any;
    check("12v. the converted file is the Word file, version 1.1, and names its original", conv.converted_from === "doc" && conv.file_format === "docx" && conv.original_filename === "ZZ 4_Legacy Converted.doc" && conv.version_major === 1 && conv.version_minor === 1, JSON.stringify(conv));
    const filed = sqlite.prepare("SELECT d.title, c.source_manual, c.also_filed_in, c.title_as_exported FROM policy_carried_records c JOIN policy_documents d ON d.id = c.document_id WHERE c.lab_id = ? AND c.source_number = 'ZZ 1'").get(scriptLabOne.labId) as any;
    check("12w. the cleaned title loads and the raw title is kept", filed.title === "Plain Policy" && filed.title_as_exported === "Plain Policy (1)" && filed.source_manual === "North / Chem", JSON.stringify(filed));
    const twice = sqlite.prepare("SELECT also_filed_in FROM policy_carried_records WHERE lab_id = ? AND source_number = 'ZZ 2'").get(scriptLabOne.labId) as any;
    check("12x. a document in two labs names the other filing", JSON.parse(twice.also_filed_in).includes("South / Spec"));
    const startOn = (sqlite.prepare("SELECT DISTINCT reminders_start_on AS s FROM policy_carried_records WHERE lab_id = ?").all(scriptLabOne.labId) as any[]).map((r) => r.s);
    check("12y. the start date given holds every document", startOn.join() === iso(5), startOn.join());

    const filesBeforeRerunScript = filesUnder(ROOT).length;
    const rerun = await runLoad([...common, "--apply", "--reminders-start-on", iso(5)]);
    const rerunRows = await parse(latest("load_results_"));
    check("12z. a rerun recognizes all of them and adds nothing",
      rerun.code === 0 && rerunRows.filter((r) => r.result === "already_loaded").length === 8 && filesUnder(ROOT).length === filesBeforeRerunScript
      && (await call("GET", `/api/admin/veritadc/bulk-load/status?labId=${scriptLabOne.labId}`, undefined, undefined, { "x-admin-secret": ADMIN })).body.documents.carried === 6,
      JSON.stringify(rerunRows.map((r) => [r.number, r.result])));
    const dryAfter = await runLoad(common);
    const dryAfterRows = await parse(latest("dryrun_results_"));
    check("12aa. a dry run after the load says they would be skipped", dryAfter.code === 0 && dryAfterRows.filter((r) => r.result === "would_skip_already_loaded").length === 8);
    const cleared = await runLoad([...common, "--apply", "--reminders-start-on", iso(5), "--clear-phi", "ZZ 10"]);
    const clearedRows = await parse(latest("load_results_"));
    check("12ab. once a person clears it by number, a later run loads it and leaves the rest", cleared.code === 0 && clearedRows.find((r) => r.number === "ZZ 10")?.result === "loaded" && clearedRows.filter((r) => r.result === "already_loaded").length === 8, JSON.stringify(clearedRows.map((r) => [r.number, r.result])));

    // 13. Containment
    check("13a. the load left the other lab alone", n("SELECT COUNT(*) AS n FROM policy_documents WHERE lab_id = ?", otherLab.labId) === 1);
    check("13b. the new table is in the Download all records list", (EXPORT_TABLES as any).policy_carried_records?.scope?.kind === "lab");
    const src = fs.readFileSync("server/veritadcBulkLoad.ts", "utf8");
    check("13c. the loader has no way to email anyone", !/resend|sendEmail|emails\.send/i.test(src));
    check("13d. the loader has no way to assign read-and-sign", !/INSERT INTO policy_attestations|INSERT INTO staff_portal_policy_signatures|INSERT INTO policy_signoffs/.test(src));
    check("13e. no real customer name is in the load code", !/heywood|athol|medialab/i.test(fs.readFileSync("scripts/veritadc-load-plan.mts", "utf8")));
  } catch (err: any) {
    check("test body ran to the end", false, String(err?.stack || err));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    server.close();
  }

  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
