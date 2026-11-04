// tests/integration/veritadc-doc-numbers.test.ts
//
// VeritaDC document numbers and major.minor versions (Michael 2026-11-03, Q151/Q154; parity plan Phase 1 item 2, for
// Heywood's MediaLab library: numbers like "183079.624" / "AH 12", versions 1.0, 1.1, 2.0). Boots the REAL routes on a
// scratch DB and pins:
//   1. boot adds policy_documents.doc_number and policy_versions.version_major / version_minor
//   2. an upload can carry the lab's document number (trimmed); the list shows it and the version as 1.0
//   3. a number is unique among the lab's ACTIVE documents, case-insensitively: a second "ah 12" is refused (409), a
//      too-long number is refused (400), another lab may use the same number, and an archived document's number can
//      be used again
//   4. a new version adds .1 (1.1, 1.2); a major revision moves to the next whole number (2.0), then 2.1; the
//      internal version_number keeps counting 1..5; the default change summary names the label
//   5. a document whose versions were saved before these columns reads 1.0, 2.0 and continues 2.1 / 3.0
//   6. editing the number: a taken number is refused, a new one is saved and audited (from/to), blank clears it, and an
//      edit that doesn't send the number leaves it alone
//   7. moving a document into another lab's manual is refused (400); into this lab's manual works
//   8. search finds a document by its number; the inspector link shows the number and the version label
// Every lab, person and document here is made up; the database and policy storage are scratch folders.
// Run: npm run test:veritadc-doc-numbers

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
    const email = `docnum-${tag}-${Date.now()}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: "Testpass123", name: `Doc ${tag}`, hipaa_acknowledged: true });
    const prov = await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `Doc Lab ${tag}`, plan: "hospital", isWarehouse: true });
    return { token: reg.body.token as string, labId: prov.body.labId as number };
  };
  const upload = async (L: { token: string; labId: number }, fields: Record<string, string>, p = `/api/labs/${L.labId}/veritapolicy/documents`) => {
    const fd = new FormData();
    fd.append("file", new Blob([Buffer.from(`Made-up procedure text ${Math.random()}\n`)], { type: "text/plain" }), "made-up.txt");
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    const r = await fetch(base + p, { method: "POST", headers: { Authorization: `Bearer ${L.token}` }, body: fd });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };

  try {
    const cols = (t: string) => (sqlite.prepare(`PRAGMA table_info(${t})`).all() as any[]).map((c) => c.name);
    check("1. boot adds doc_number and version_major / version_minor",
      cols("policy_documents").includes("doc_number") && cols("policy_versions").includes("version_major") && cols("policy_versions").includes("version_minor"));

    const A = await mkLab("A");
    const B = await mkLab("B");
    check("two labs provisioned", !!A.labId && !!B.labId && !!A.token && !!B.token);
    const list = async (L = A) => (await call("GET", `/api/labs/${L.labId}/veritapolicy/documents`, undefined, L.token)).body.documents as any[];

    // 2. Upload with a number
    const u1 = await upload(A, { title: "Made-up corrected report policy", doc_number: "  AH   12 " });
    const d1 = (await list()).find((d) => d.id === u1.body.id);
    check("2. an upload carries the lab's number (spaces cleaned) and starts at 1.0",
      u1.status === 201 && d1?.doc_number === "AH 12" && d1?.current_version_label === "1.0", JSON.stringify({ s: u1.status, n: d1?.doc_number, v: d1?.current_version_label }));

    // 3. Uniqueness
    const dup = await upload(A, { title: "Made-up duplicate", doc_number: "ah 12" });
    check("3. the same number again in the lab is refused, whatever the case", dup.status === 409 && dup.body.code === "DOC_NUMBER_TAKEN", JSON.stringify(dup.body));
    const long = await upload(A, { title: "Made-up long", doc_number: "X".repeat(61) });
    check("3. a number longer than 60 characters is refused", long.status === 400 && long.body.code === "DOC_NUMBER_TOO_LONG", String(long.status));
    const other = await upload(B, { title: "Made-up other lab", doc_number: "AH 12" });
    check("3. another lab can use the same number", other.status === 201, String(other.status));
    const toArchive = await upload(A, { title: "Made-up retiring", doc_number: "183079.624" });
    const arch = await call("POST", `/api/labs/${A.labId}/veritapolicy/documents/${toArchive.body.id}/archive`, {}, A.token);
    const reuse = await upload(A, { title: "Made-up replacement", doc_number: "183079.624" });
    check("3. an archived document's number can be used again", arch.status === 200 && reuse.status === 201, `${arch.status} ${reuse.status}`);

    // 4. Versions
    const V = `/api/labs/${A.labId}/veritapolicy/documents/${u1.body.id}/versions`;
    const v11 = await upload(A, {}, V);
    const v12 = await upload(A, {}, V);
    const v20 = await upload(A, { is_major_revision: "true" }, V);
    const v21 = await upload(A, {}, V);
    check("4. minor, minor, major, minor: 1.1, 1.2, 2.0, 2.1",
      [v11, v12, v20, v21].map((r) => r.body.version_label).join(" ") === "1.1 1.2 2.0 2.1" && [v11, v12, v20, v21].map((r) => r.body.version_number).join(" ") === "2 3 4 5",
      [v11, v12, v20, v21].map((r) => `${r.status}:${r.body.version_label}/${r.body.version_number}`).join(" "));
    const detail = (await call("GET", `/api/labs/${A.labId}/veritapolicy/documents/${u1.body.id}`, undefined, A.token)).body;
    check("4. the document view lists every version's label and the current one is 2.1",
      detail.document?.current_version_label === "2.1" && (detail.versions || []).map((v: any) => v.version_label).join(" ") === "2.1 2.0 1.2 1.1 1.0",
      `${detail.document?.current_version_label} :: ${(detail.versions || []).map((v: any) => v.version_label).join(" ")}`);
    const summary = sqlite.prepare("SELECT change_summary FROM policy_versions WHERE id = ?").get(v11.body.version_id) as any;
    check("4. the default change summary names the label", summary?.change_summary === "Version 1.1", summary?.change_summary);

    // 5. Legacy versions (saved before the columns)
    const legacy = Number(sqlite.prepare("INSERT INTO policy_documents (lab_id, title, status, owner_user_id, review_interval_months, created_at, updated_at) VALUES (?, 'Made-up legacy policy', 'draft', 1, 24, datetime('now'), datetime('now'))").run(A.labId).lastInsertRowid);
    const insV = sqlite.prepare("INSERT INTO policy_versions (document_id, version_number, file_path, file_format, file_size_bytes, file_hash_sha256, uploaded_by, uploaded_at) VALUES (?, ?, 'made-up.txt', 'txt', 1, 'x', 1, datetime('now'))");
    insV.run(legacy, 1);
    const lv2 = Number(insV.run(legacy, 2).lastInsertRowid);
    sqlite.prepare("UPDATE policy_documents SET current_version_id = ? WHERE id = ?").run(lv2, legacy);
    const before = (await list()).find((d) => d.id === legacy);
    const L = `/api/labs/${A.labId}/veritapolicy/documents/${legacy}/versions`;
    const l21 = await upload(A, {}, L);
    const l30 = await upload(A, { is_major_revision: "1" }, L);
    check("5. a document versioned before this reads 2.0 and continues 2.1, then 3.0",
      before?.current_version_label === "2.0" && l21.body.version_label === "2.1" && l30.body.version_label === "3.0",
      `${before?.current_version_label} ${l21.body.version_label} ${l30.body.version_label}`);

    // 6. Editing the number
    const P = (id: number, body: any) => call("PATCH", `/api/labs/${A.labId}/veritapolicy/documents/${id}`, body, A.token);
    const taken = await P(legacy, { docNumber: "AH 12" });
    check("6. editing to a number already used is refused", taken.status === 409 && taken.body.code === "DOC_NUMBER_TAKEN", String(taken.status));
    const set = await P(legacy, { docNumber: "HH122" });
    const audit = sqlite.prepare("SELECT details FROM policy_audit_log WHERE document_id = ? AND action = 'edited' ORDER BY id DESC LIMIT 1").get(legacy) as any;
    const ad = JSON.parse(audit?.details || "{}");
    check("6. a new number is saved and audited from/to", set.status === 200 && ad.doc_number_from === null && ad.doc_number_to === "HH122", audit?.details);
    const keep = await P(legacy, { title: "Made-up legacy policy, retitled" });
    const afterKeep = (await list()).find((d) => d.id === legacy);
    check("6. an edit that doesn't send the number leaves it", keep.status === 200 && afterKeep?.doc_number === "HH122", afterKeep?.doc_number);
    const clear = await P(legacy, { docNumber: "" });
    const afterClear = (await list()).find((d) => d.id === legacy);
    check("6. a blank number clears it", clear.status === 200 && afterClear?.doc_number === null, String(afterClear?.doc_number));

    // 7. Moving into another lab's manual
    const bManual = ((await call("GET", `/api/labs/${B.labId}/veritapolicy/manuals`, undefined, B.token)).body.manuals || [])[0];
    const aManual = ((await call("GET", `/api/labs/${A.labId}/veritapolicy/manuals`, undefined, A.token)).body.manuals || [])[0];
    const cross = await P(u1.body.id, { manualId: bManual.id });
    const own = await P(u1.body.id, { manualId: aManual.id });
    check("7. a document can't be moved into another lab's manual; its own lab's works",
      cross.status === 400 && cross.body.code === "BAD_MANUAL" && own.status === 200, `${cross.status} ${own.status}`);

    // 8. Search and the inspector link
    const srch = (await call("GET", `/api/labs/${A.labId}/veritapolicy/search?q=AH%2012`, undefined, A.token)).body.results as any[];
    check("8. search finds a document by its number", (srch || []).some((s) => s.id === u1.body.id && s.doc_number === "AH 12"), JSON.stringify((srch || []).map((s) => s.doc_number)));
    sqlite.prepare("UPDATE policy_documents SET status = 'approved' WHERE id = ?").run(u1.body.id);
    const link = await call("POST", `/api/labs/${A.labId}/veritapolicy/surveyor-links`, { label: "Made-up inspection", expiresInDays: 1 }, A.token);
    const sv = (await call("GET", `/api/surveyor/${link.body.token}/policies`)).body.documents as any[];
    const svd = (sv || []).find((d) => d.id === u1.body.id);
    check("8. the inspector link shows the number and the version label", svd?.doc_number === "AH 12" && svd?.current_version_label === "2.1", JSON.stringify(svd && { n: svd.doc_number, v: svd.current_version_label }));
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
