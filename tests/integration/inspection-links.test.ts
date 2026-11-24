// tests/integration/inspection-links.test.ts
//
// STANDING integration test for VeritaDC documents linked to inspection work (B8, 2026-11-24;
// server/inspectionLinks.ts, shared/sopSuggest.ts).
//   1. A VeritaScan item's evidence: pick a document with an approved version, refuse any other, unlink; audit rows.
//   2. How a linked document stands (current, past review, not approved, archived, a revision in progress) and what opens.
//   3. A VeritaResponse finding: link, unlink, history, suggested SOPs with reasons, never linked by themselves.
//   4. Both ways: the document says what links to it.
//   5. Refusals: another lab, a view-only reviewer, a Staff login; a Staff login sees only documents it can read.
//   6. Deletes, "Download all of this lab's records", and the per-customer delete.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows and files only). Run: npm run test:inspection-links
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

process.env.POLICY_STORAGE_ROOT ||= ".tmp-insplinks-policies";
process.env.CUSTOMER_PURGE_ENABLED = "1";
import { inspectionWorld } from "./inspectionFixture";

async function main() {
  const w = await inspectionWorld("links");
  const { A, X, call, check, one, all, seed, sqlite } = w;
  const { OWNER, OTHER, EDITOR, SCAN_ONLY, VIEWER, STAFF, SUPPORT } = w;
  const { EXPORT_TABLES } = await import("../../server/exportAllTables");
  const { exportContext, selectRecords } = await import("../../server/exportAll");
  const ROOT = process.env.POLICY_STORAGE_ROOT!;

  const version = (doc: number, n: number, text: string) => {
    const rel = `b8/${doc}/v${n}/document.html`, abs = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const buf = Buffer.from(`<p>${text}</p>`);
    fs.writeFileSync(abs, buf);
    return seed("policy_versions", { document_id: doc, version_number: n, file_path: rel, file_format: "html", file_size_bytes: buf.length, file_hash_sha256: createHash("sha256").update(buf).digest("hex"), uploaded_by: OWNER.id });
  };
  const doc = (lab: number, title: string, status: string, extra: any = {}) => seed("policy_documents", { lab_id: lab, title, status, owner_user_id: OWNER.id, ...extra });
  const approve = (id: number, v: number) => sqlite.prepare("UPDATE policy_documents SET current_version_id = ?, approved_version_id = ? WHERE id = ?").run(v, v, id);
  const dOk = doc(A, "Refrigerator Temperature Monitoring", "approved", { doc_number: "LAB-101", next_review_date: "2099-01-01", description: "Daily readings and out of range action" });
  approve(dOk, version(dOk, 1, "Made-up approved text"));
  const dLate = doc(A, "Hemolysis Index", "expired", { next_review_date: "2026-01-15" }); approve(dLate, version(dLate, 1, "Made-up late text"));
  const dLateSoon = doc(A, "Critical Value Notification", "approved", { next_review_date: "2026-02-01" }); approve(dLateSoon, version(dLateSoon, 1, "Made-up")); // the nightly sweep hasn't reached it
  const dRev = doc(A, "Analyzer Checkout", "draft", { next_review_date: "2099-01-01", description: "Meets 42 CFR 493.1253" });
  const rv1 = version(dRev, 1, "Made-up approved one"), rv2 = version(dRev, 2, "Made-up draft two");
  sqlite.prepare("UPDATE policy_documents SET current_version_id = ?, approved_version_id = ? WHERE id = ?").run(rv2, rv1, dRev);
  const dDraft = doc(A, "Secret Draft Procedure", "draft"); const dv = version(dDraft, 1, "Made-up draft"); sqlite.prepare("UPDATE policy_documents SET current_version_id = ? WHERE id = ?").run(dv, dDraft);
  const dGone = doc(A, "Old Archived Procedure", "approved", { archived_at: w.now }); approve(dGone, version(dGone, 1, "Made-up old"));
  const dX = doc(X, "Lab X Procedure", "approved", { next_review_date: "2099-01-01" }); approve(dX, version(dX, 1, "Made-up X"));

  // ── 1. A VeritaScan item ──────────────────────────────────────────────────
  const I = (item: number, link?: number, lab = A) => `/api/labs/${lab}/veritascan/checklist/items/${item}/policy-links${link ? `/${link}` : ""}`;
  const cand = await call(SCAN_ONLY, "GET", `/api/labs/${A}/veritascan/policy-candidates`);
  check("1a. the picker offers every document with an approved version, and no other", cand.s === 200 && cand.j.map((d: any) => d.document_id).sort((a: number, b: number) => a - b).join() === [dOk, dLate, dLateSoon, dRev].sort((a, b) => a - b).join(), cand.text.slice(0, 300));
  check("1b. it searches title, number and description", (await call(SCAN_ONLY, "GET", `/api/labs/${A}/veritascan/policy-candidates?q=lab-101`)).j.map((d: any) => d.document_id).join() === String(dOk) && (await call(SCAN_ONLY, "GET", `/api/labs/${A}/veritascan/policy-candidates?q=${encodeURIComponent("%")}`)).j.length === 0);
  const l1 = await call(SCAN_ONLY, "POST", I(12), { document_id: dOk });
  check("1c. linking one", l1.s === 201 && l1.j.document_id === dOk && l1.j.state === "current" && one("SELECT * FROM veritascan_item_policy_links WHERE id = ?", l1.j.link_id)?.lab_id === A, l1.text);
  check("1d. the same one again is refused", (await call(SCAN_ONLY, "POST", I(12), { document_id: dOk })).j?.code === "ALREADY_LINKED");
  for (const [what, id, want, code] of [["one never approved", dDraft, 409, "NO_APPROVED_VERSION"], ["an archived one", dGone, 404, undefined], ["another lab's", dX, 404, undefined], ["no such document", 999999, 404, undefined], ["rubbish", "abc", 404, undefined]] as const) {
    const r = await call(SCAN_ONLY, "POST", I(12), { document_id: id });
    check(`1e. ${what}: refused`, r.s === want && r.j?.code === code, `${r.s} ${r.text}`);
  }
  check("1f. an item that isn't on the checklist: refused", (await call(SCAN_ONLY, "POST", I(99999), { document_id: dOk })).s === 404);
  for (const d of [dLate, dLateSoon, dRev]) await call(EDITOR, "POST", I(13), { document_id: d });
  check("1g. each link and unlink writes an audit row in the lab owner's trail", w.audits("policy_link", l1.j.link_id).length === 1 && w.audits("policy_link", l1.j.link_id)[0].owner_user_id === OWNER.id && w.audits("policy_link", l1.j.link_id)[0].action === "create");
  check("1h. the web-address evidence beside it still works", await (async () => {
    const d = await call(EDITOR, "POST", `/api/labs/${A}/veritascan/documents`, { title: "Made-up web evidence", document_type: "policy", external_url: "https://example.test/made-up", effective_date: "2026-01-01", review_due_date: "2099-01-01", storage_provider: "sharepoint", owner_user_id: OWNER.id, owner_attested: true });
    const id = Number(d.j?.id ?? seed("lab_documents", { lab_id: A, title: "Made-up web evidence", document_type: "policy", external_url: "https://example.test/made-up", linked_by_user_id: OWNER.id, status: "active" }));
    const l = await call(EDITOR, "POST", `/api/labs/${A}/veritascan/documents/${id}/links`, { checklist_item_id: 12 });
    const cov = await call(EDITOR, "GET", `/api/labs/${A}/veritascan/coverage`);
    return l.s === 200 && cov.j.length === 1 && cov.j[0].checklist_item_id === 12 && cov.j[0].external_url === "https://example.test/made-up";
  })());
  const up = await call(EDITOR, "POST", I(12), { document_id: dOk, file: "data:text/plain;base64,QQ==", external_url: "https://example.test" });
  check("1i. no file or address rides along on an item's link", up.s === 409 && !(sqlite.prepare("PRAGMA table_info(veritascan_item_policy_links)").all() as any[]).some((c) => /file|url|blob/i.test(c.name)));

  // ── 2. How it stands, and what opens ──────────────────────────────────────
  const links = async (u: any) => (await call(u, "GET", `/api/labs/${A}/veritascan/policy-links`)).j as any[];
  const by = (rows: any[], id: number) => rows.find((r) => r.document_id === id);
  let rows = await links(VIEWER);
  check("2a. current, past review (swept or not), and a revision in progress over an approved version", by(rows, dOk).state === "current" && by(rows, dLate).state === "past_review" && by(rows, dLateSoon).state === "past_review" && by(rows, dRev).state === "current" && by(rows, dRev).revision_in_progress === true, JSON.stringify(rows));
  check("2b. what opens is the approved version, not the draft over it", by(rows, dRev).open_version_id === rv1 && by(rows, dRev).current_version_id === rv2 && by(rows, dOk).open_version_id === by(rows, dOk).current_version_id);
  check("2c. an editor opens it through VeritaDC", /Made-up approved one/.test((await call(EDITOR, "GET", `/api/labs/${A}/veritapolicy/documents/${dRev}/versions/${rv1}/render`)).j?.html ?? ""));
  // Anyone who reads the document opens the approved version a link names; every other earlier version stays closed to them.
  const rv0 = version(dRev, 3, "Made-up another draft");
  const asReviewer = (v: number) => call(VIEWER, "GET", `/api/labs/${A}/veritapolicy/documents/${dRev}/versions/${v}/render`);
  const rOk = await asReviewer(rv1), rOther = await asReviewer(rv0);
  check("2c2. a view-only reviewer opens it too, with no other version and no added label", rOk.s === 200 && /Made-up approved one/.test(rOk.j?.html ?? "") && rOk.j.standing === undefined && rOther.s === 403 && rOther.j?.code === "EARLIER_VERSION" && !/another draft/.test(rOther.text), `${rOk.s} ${rOther.s}`);
  sqlite.prepare("UPDATE policy_documents SET status = 'approved', approved_version_id = ?, current_version_id = ? WHERE id = ?").run(rv2, rv2, dRev);
  check("2c3. once the revision is approved, the version it replaced is closed to the reviewer", (await asReviewer(rv2)).s === 200 && (await asReviewer(rv1)).j?.code === "EARLIER_VERSION");
  sqlite.prepare("UPDATE policy_documents SET status = 'draft', approved_version_id = ? WHERE id = ?").run(rv1, dRev);
  sqlite.prepare("DELETE FROM policy_versions WHERE id = ?").run(rv0);
  check("2d. a Staff login opens the approved version through the document's own render", /Made-up approved one/.test((await call(STAFF, "GET", `/api/labs/${A}/veritapolicy/documents/${dRev}/render`)).j?.html ?? ""));
  sqlite.prepare("UPDATE policy_documents SET status = 'draft', approved_version_id = NULL WHERE id = ?").run(dLateSoon);
  sqlite.prepare("UPDATE policy_documents SET archived_at = ? WHERE id = ?").run(w.now, dLate);
  rows = await links(VIEWER);
  check("2e. one that loses its approval reads not approved; one archived reads archived; neither opens", by(rows, dLateSoon).state === "not_approved" && by(rows, dLateSoon).open_version_id === null && by(rows, dLate).state === "archived" && by(rows, dLate).open_version_id === null);
  const edRow = by(await links(EDITOR), dLate), reRow = by(rows, dLate);
  check("2e2. an archived one keeps its name for a VeritaDC editor only", edRow.title === "Hemolysis Index" && reRow.title === "Archived document" && reRow.doc_number === null && !JSON.stringify(rows).includes("Hemolysis"));
  const staffRows = await links(STAFF);
  check("2f. a Staff login sees only the linked documents it can read", staffRows.map((r) => r.document_id).sort((a, b) => a - b).join() === [dOk, dRev].sort((a, b) => a - b).join(), JSON.stringify(staffRows.map((r) => r.title)));
  // A new approved version opens on the same link.
  const ok2 = version(dOk, 2, "Made-up second approved"); approve(dOk, ok2);
  check("2g. a newly approved version opens on the same link", by(await links(EDITOR), dOk).open_version_id === ok2);

  // ── 3. A finding ──────────────────────────────────────────────────────────
  const f = Number((await call(EDITOR, "POST", `/api/labs/${A}/findings`, { accreditor: "CMS", anchor_date: "2026-11-01", standard_ref: "42 CFR 493.1253(b)(1)", finding_number: "D5411", description: "Made-up: the refrigerator temperature was not recorded on two days" })).j.id);
  const fX = Number((await call(OTHER, "POST", `/api/labs/${X}/findings`, { accreditor: "CMS", anchor_date: "2026-11-01", standard_ref: "42 CFR 493.1253" })).j.id);
  const D = (id = f, lab = A, rest = "") => `/api/labs/${lab}/findings/${id}/${rest || "documents"}`;
  const opt = await call(EDITOR, "GET", D(f, A, "document-options"));
  const sug = (opt.j?.suggested ?? []) as any[];
  check("3a. suggested: the one naming the standard first, and the one sharing the topic, each with its reason", sug[0]?.document_id === dRev && sug[0].reasons.includes("Names 493.1253") && sug.find((s) => s.document_id === dOk)?.reasons.join() === "Title shares: refrigerator, temperature", JSON.stringify(sug.map((s) => [s.title, s.reasons])));
  check("3b. never an archived document or another lab's, and nothing is linked by itself", !sug.some((s) => [dGone, dX, dLate].includes(s.document_id)) && one("SELECT COUNT(*) AS n FROM finding_policy_links").n === 0);
  // Through the lab's own policy list: a requirement that cites the standard, with the lab's name for its document.
  const { VERITAPOLICY_MASTER_LIST } = await import("../../server/veritapolicyMasterList");
  const reqt = VERITAPOLICY_MASTER_LIST.find((p) => /493\.1253/.test(p.cfr_citations))!;
  sqlite.prepare("INSERT INTO veritapolicy_master_status (user_id, lab_id, policy_id, status, our_policy_name) VALUES (?, ?, ?, 'complete', 'Secret Draft Procedure')").run(OWNER.id, A, reqt.policy_id);
  const sug2 = (await call(EDITOR, "GET", D(f, A, "document-options"))).j.suggested as any[];
  check("3c. and the document the lab's policy list gives for a requirement citing it", sug2.find((s) => s.document_id === dDraft)?.reasons[0] === `Your policy list gives it for "${reqt.policy_name}", which cites 493.1253`, JSON.stringify(sug2.map((s) => [s.title, s.reasons])));
  check("3d. the search lists every document in use, a draft included", (await call(EDITOR, "GET", `${D(f, A, "document-options")}?q=secret`)).j.documents.map((d: any) => d.document_id).join() === String(dDraft));
  const fl = await call(EDITOR, "POST", D(), { document_id: dRev }), fl2 = await call(EDITOR, "POST", D(), { document_id: dDraft });
  check("3e. linking two, one of them a draft", fl.s === 201 && fl2.s === 201 && fl2.j.state === "not_approved" && (await call(VIEWER, "GET", D())).j.documents.length === 2);
  check("3f. a linked document stops being suggested", !(await call(EDITOR, "GET", D(f, A, "document-options"))).j.suggested.some((s: any) => [dRev, dDraft].includes(s.document_id)));
  for (const [what, id, want] of [["the same one again", dRev, 409], ["an archived one", dGone, 404], ["another lab's", dX, 404]] as const) check(`3g. ${what}: refused`, (await call(EDITOR, "POST", D(), { document_id: id })).s === want);
  const hist = () => all("SELECT event, by_user_id, payload FROM finding_history WHERE finding_id = ? AND event LIKE 'document_%' ORDER BY id", f).map((h) => ({ ...h, payload: JSON.parse(h.payload) }));
  await call(EDITOR, "DELETE", `${D()}/${fl2.j.link_id}`);
  check("3h. link and unlink are in the finding's history with the document", hist().map((h) => `${h.event}:${h.payload.document_id}`).join() === `document_linked:${dRev},document_linked:${dDraft},document_unlinked:${dDraft}` && hist().every((h) => h.by_user_id === EDITOR.id));
  await call(EDITOR, "POST", D(), { document_id: dDraft });
  check("3i. a Staff login sees only the linked documents it can read", (await call(STAFF, "GET", D())).j.documents.map((d: any) => d.document_id).join() === String(dRev) && !(await call(STAFF, "GET", D())).text.includes("Secret Draft"));

  // ── 4. Both ways ──────────────────────────────────────────────────────────
  const from = await call(EDITOR, "GET", `/api/labs/${A}/veritapolicy/documents/${dRev}/linked-from`);
  check("4a. the document names the finding and the checklist item that link to it", from.s === 200 && from.j.findings.map((x: any) => x.id).join() === String(f) && from.j.scanItems.map((x: any) => x.item_id).join() === "13" && !!from.j.scanItems[0].question, from.text);
  check("4b. one nothing links to says so", (await call(EDITOR, "GET", `/api/labs/${A}/veritapolicy/documents/${dGone}/linked-from`)).j?.findings.length === 0);
  check("4c. a Staff login doesn't read that list; another lab's document isn't found", (await call(STAFF, "GET", `/api/labs/${A}/veritapolicy/documents/${dRev}/linked-from`)).j?.code === "STAFF_OWN_ONLY" && (await call(EDITOR, "GET", `/api/labs/${A}/veritapolicy/documents/${dX}/linked-from`)).s === 404);

  // ── 5. Refusals ───────────────────────────────────────────────────────────
  const counts = () => `${one("SELECT COUNT(*) AS n FROM veritascan_item_policy_links").n}/${one("SELECT COUNT(*) AS n FROM finding_policy_links").n}`;
  const c0 = counts();
  for (const [who, u] of [["a Staff login", STAFF], ["a view-only reviewer", VIEWER], ["another customer", OTHER]] as const) {
    const r = await Promise.all([
      call(u, "POST", I(20), { document_id: dOk }), call(u, "DELETE", I(12, l1.j.link_id)), call(u, "GET", `/api/labs/${A}/veritascan/policy-candidates`),
      call(u, "POST", D(), { document_id: dOk }), call(u, "DELETE", `${D()}/${fl.j.link_id}`), call(u, "GET", D(f, A, "document-options")),
    ]);
    check(`5a. ${who} can't pick, link or unlink anywhere`, r.every((x) => x.s === 403) && !r.some((x) => x.text.includes("Secret Draft")), r.map((x) => x.s).join());
  }
  check("5b. another customer reads none of it", (await call(OTHER, "GET", `/api/labs/${A}/veritascan/policy-links`)).s === 403 && (await call(OTHER, "GET", D())).s === 403);
  check("5c. an editor of VeritaScan only can't link to a finding", (await call(SCAN_ONLY, "POST", D(), { document_id: dOk })).s === 403 && (await call(SCAN_ONLY, "GET", D(f, A, "document-options"))).s === 403);
  check("5d. another lab's finding and link aren't found through this lab", (await call(EDITOR, "POST", D(fX), { document_id: dOk })).s === 404 && (await call(EDITOR, "GET", D(fX))).s === 404 && (await call(OTHER, "DELETE", I(12, l1.j.link_id, X))).s === 404 && (await call(OTHER, "DELETE", `${D(fX, X)}/${fl.j.link_id}`)).s === 404);
  check("5e. nothing was written by any refusal", counts() === c0, counts());
  check("5f. Veritas support sets links up, as it does the evidence library", (await call(SUPPORT, "POST", I(21), { document_id: dOk })).s === 201 && (await call(SUPPORT, "POST", D(), { document_id: dOk })).s === 201);

  // ── 6. Deletes, the records export, the per-customer delete ───────────────
  check("6a. both tables are in the export, by lab", (EXPORT_TABLES as any).veritascan_item_policy_links?.scope.kind === "lab" && (EXPORT_TABLES as any).finding_policy_links?.scope.kind === "lab");
  await call(OTHER, "POST", I(12, undefined, X), { document_id: dX }); await call(OTHER, "POST", D(fX, X), { document_id: dX });
  const ctxA = exportContext(sqlite, A)!, ctxX = exportContext(sqlite, X)!;
  for (const t of ["veritascan_item_policy_links", "finding_policy_links"]) {
    const a = selectRecords(sqlite, t, ctxA)!.rows, x = selectRecords(sqlite, t, ctxX)!.rows;
    check(`6b. ${t}: each lab's records hand back its own rows and no other's`, a.length === one(`SELECT COUNT(*) AS n FROM ${t} WHERE lab_id = ?`, A).n && a.length > 0 && a.every((r) => r.lab_id === A) && x.length === 1 && x[0].lab_id === X);
  }
  check("6c. the new columns of findings and scan items go with them", selectRecords(sqlite, "findings", ctxA)!.columns.includes("assignee_user_id") && selectRecords(sqlite, "findings", ctxA)!.columns.includes("study_id") && selectRecords(sqlite, "veritascan_items", ctxA)!.columns.includes("carried_status"));
  const fTemp = Number((await call(EDITOR, "POST", `/api/labs/${A}/findings`, { accreditor: "CMS", anchor_date: "2026-11-01" })).j.id);
  await call(EDITOR, "POST", D(fTemp), { document_id: dOk });
  check("6d. deleting a finding takes its document links, through either route", (await call(EDITOR, "DELETE", `/api/labs/${A}/findings/${fTemp}`)).s === 200 && one("SELECT COUNT(*) AS n FROM finding_policy_links WHERE finding_id = ?", fTemp).n === 0 && await (async () => {
    const g = Number((await call(OWNER, "POST", `/api/labs/${A}/findings`, { accreditor: "CMS", anchor_date: "2026-11-01" })).j.id); await call(OWNER, "POST", D(g), { document_id: dOk });
    return (await call(OWNER, "DELETE", `/api/findings/${g}`)).s === 200 && one("SELECT COUNT(*) AS n FROM finding_policy_links WHERE finding_id = ?", g).n === 0;
  })());
  const delDoc = await call(OWNER, "DELETE", `/api/labs/${A}/veritapolicy/documents/${dOk}`);
  check("6e. deleting a document takes its links from items and findings", delDoc.s === 200 && one("SELECT COUNT(*) AS n FROM veritascan_item_policy_links WHERE document_id = ?", dOk).n === 0 && one("SELECT COUNT(*) AS n FROM finding_policy_links WHERE document_id = ?", dOk).n === 0 && (await call(EDITOR, "GET", D())).s === 200, delDoc.text);
  // The other customer, purged: a dry run that counts them, then the real thing on this scratch file.
  const purge = async (body: any) => { const r = await fetch(`${w.base}/api/admin/customer-purge`, { method: "POST", headers: { "Content-Type": "application/json", "x-admin-secret": w.ADMIN }, body: JSON.stringify(body) }); return { s: r.status, j: (await r.json()) as any }; };
  const dry = await purge({ ownerUserId: OTHER.id });
  const plan = dry.j.plan ?? dry.j;
  check("6f. the per-customer delete plans both tables' rows", dry.s === 200 && plan.rowsByTable?.veritascan_item_policy_links === 1 && plan.rowsByTable?.finding_policy_links === 1, JSON.stringify(dry.j).slice(0, 300));
  const before = counts();
  const done = await purge({ ownerUserId: OTHER.id, dryRun: false, confirm: plan.confirmPhrase, expectedTotal: plan.totalRows });
  check("6g. and takes exactly them, leaving the other customer's", done.s === 200 && one("SELECT COUNT(*) AS n FROM veritascan_item_policy_links WHERE lab_id = ?", X).n === 0 && one("SELECT COUNT(*) AS n FROM finding_policy_links WHERE lab_id = ?", X).n === 0 && counts() === before.split("/").map((n) => Number(n) - 1).join("/"), `${done.s} ${JSON.stringify(done.j).slice(0, 300)} ${before} ${counts()}`);

  w.finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
