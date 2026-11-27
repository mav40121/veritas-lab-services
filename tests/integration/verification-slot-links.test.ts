// tests/integration/verification-slot-links.test.ts
//
// BUG-200: a VeritaCheck verification links only its own laboratory's records (server/verificationLinks.ts). Boots the REAL routes on
// a scratch SQLite file with made-up labs and people and proves:
//   1. a slot takes a study of its own laboratory, and one with no laboratory by the owner rule; any other id is answered exactly as
//      one that doesn't exist, and the slot is as it was
//   2. an analyte is one on that verification
//   3. a new verification takes an analyzer of its own laboratory's VeritaMap
//   4. a slot already holding another laboratory's study reads as not linked: the detail, the counts, the package PDF, the survey
//      bundle, the records export, a person's studies; its own laboratory's slots read exactly as before
//   5. reading changes nothing stored; unlinking or linking another study doesn't keep that result
//   6. an analyzer saved with a study prints as saved unless it is the laboratory's own
//   7. GET /api/admin/veritacheck/foreign-slot-counts: header only, counts and lab ids
//   8. the guard: an id a slot can hold has its check, and no reader joins a slot's study any other way
// Run: npm run test:verification-slot-links
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { inspectionWorld } from "./inspectionFixture";

async function main() {
  const w = await inspectionWorld("vsl");
  const { sqlite, base, call, check, seed, member, seat, login, one, all, A, B, X, OWNER, OTHER, EDITOR, ADMIN, now } = w;
  const links = await import("../../server/verificationLinks");
  const { buildVerificationBlockHtml } = await import("../../server/veritacheck_verification");
  const { selectRecords, exportContext } = await import("../../server/exportAll");
  const { resolveInstrumentDisplay } = await import("../../server/studyPdf");
  const NONE = 987654;
  sqlite.prepare("UPDATE users SET lab_id = ?, default_lab_id = ? WHERE id = ?").run(A, A, OWNER.id);

  // Someone who edits both of OWNER's labs
  const BOTH = await login("both", "Bo Both"); member(A, BOTH); seat(OWNER.id, BOTH, A); member(B, BOTH); seat(OWNER.id, BOTH, B);
  const study = (lab: number | null, user: number, name: string, more: Record<string, any> = {}) => seed("studies", {
    user_id: user, lab_id: lab, test_name: name, instrument: "Made-up analyzer", analyst: "Ann Alyst", date: "2026-10-15", study_type: "precision", clia_allowable_error: 0.1,
    data_points: JSON.stringify([{ level: 1, levelName: "Level 1", values: [1, 1.01, 1.02] }]), instruments: '["x"]', status: "pass", created_at: now, ...more,
  });
  const verification = (lab: number | null, user: number, name: string, more: Record<string, any> = {}) => seed("veritacheck_verifications", { user_id: user, lab_id: lab, instrument_name: name, trigger_type: "new_instrument", elements: '["precision","accuracy"]', ...more });
  const slot = (v: number, more: Record<string, any> = {}) => seed("veritacheck_verification_studies", { verification_id: v, element: "precision", ...more });
  const analyte = (v: number, name = "Sodium") => seed("veritacheck_verification_analytes", { verification_id: v, analyte_name: name, created_at: now, updated_at: now });
  const row = (id: number) => JSON.stringify(one("SELECT * FROM veritacheck_verification_studies WHERE id = ?", id));
  const save = (who: any, v: number, s: number, body: unknown, lab?: number) => call(who, "PATCH", `/api/veritacheck/verifications/${v}/studies/${s}`, body, lab);

  const sA = study(A, OWNER.id, "Sodium in A"), sA2 = study(A, w.ADMIN_A.id, "Potassium in A"), sB = study(B, OWNER.id, "Sodium in B"), sX = study(X, OTHER.id, "Sodium in X");
  const sNone = study(null, OWNER.id, "Sodium with no lab"), sNoneOther = study(null, OTHER.id, "Another account's, no lab");
  const vA = verification(A, OWNER.id, "Analyzer A"), vB = verification(B, OWNER.id, "Analyzer B"), vX = verification(X, OTHER.id, "Analyzer X"), vNone = verification(null, OWNER.id, "Analyzer, no lab");

  // ── 1. A slot's study ─────────────────────────────────────────────────────
  const s1 = slot(vA), gone = await save(EDITOR, vA, s1, { study_id: NONE }, A);
  check("1a. a study that doesn't exist is 409", gone.s === 409 && gone.text === JSON.stringify(links.LINK_NOT_FOUND), `${gone.s} ${gone.text}`);
  const r0 = row(s1);
  for (const [who, u, lab] of [["the lab's editor", EDITOR, A], ["the owner of both labs", OWNER, A], ["who edits both labs, working here", BOTH, A], ["who edits both labs, working there", BOTH, B]] as const) {
    for (const [what, id] of [["a sister lab's", sB], ["another customer's", sX], ["another account's with no lab", sNoneOther], ["a sister lab's, as text", String(sB)]] as const) {
      const r = await save(u, vA, s1, { study_id: id, passed: 1 }, lab);
      check(`1b. ${who}: ${what} study is answered as one that doesn't exist, and nothing is saved`, r.s === 409 && r.text === gone.text && row(s1) === r0, `${r.s}`);
    }
  }
  for (const bad of [0, -1, 1.5, "", "x", true, [sA], { id: sA }]) {
    const r = await save(EDITOR, vA, s1, { study_id: bad }, A);
    check(`1c. ${JSON.stringify(bad)} is too`, r.s === 409 && r.text === gone.text && row(s1) === r0, `${r.s}`);
  }
  for (const [what, u, id] of [["its own", EDITOR, sA], ["its own, as text", EDITOR, String(sA)], ["its own, made by the lab's admin", OWNER, sA2], ["one with no lab, its owner", OWNER, sNone], ["one with no lab, a seat of its owner's", EDITOR, sNone]] as const) {
    const r = await save(u, vA, s1, { study_id: id, passed: 1 }, A);
    check(`1d. ${what}: saved`, r.s === 200 && one("SELECT study_id, passed FROM veritacheck_verification_studies WHERE id = ?", s1).study_id === Number(id), `${r.s} ${r.text}`);
  }
  const adminNone = await save(w.ADMIN_A, vA, s1, { study_id: sNone }, A);
  check("1e. one with no lab isn't another account's to link", adminNone.s === 409 && adminNone.text === gone.text, `${adminNone.s}`);
  const cleared = await save(EDITOR, vA, s1, { study_id: null, passed: null }, A);
  check("1f. unlinking is saved", cleared.s === 200 && one("SELECT study_id FROM veritacheck_verification_studies WHERE id = ?", s1).study_id === null);
  const sn = slot(vNone);
  check("1g. a verification with no lab: its owner's studies, no one else's", (await save(OWNER, vNone, sn, { study_id: sA }, A)).s === 200 && (await save(OWNER, vNone, sn, { study_id: sNone }, A)).s === 200 && (await save(OWNER, vNone, sn, { study_id: sX }, A)).s === 409);
  const theirs = slot(vB), t0 = row(theirs);
  check("1h. another lab's verification isn't this editor's", [403, 404].includes((await save(EDITOR, vB, theirs, { study_id: sA }, A)).s) && row(theirs) === t0);

  // ── 2. A slot's analyte ───────────────────────────────────────────────────
  const aA = analyte(vA), aA2 = analyte(verification(A, OWNER.id, "Another in A")), aB = analyte(vB);
  for (const [what, id] of [["another verification's in the lab", aA2], ["a sister lab's", aB], ["one that doesn't exist", NONE]] as const) {
    const r = await save(EDITOR, vA, s1, { analyte_id: id }, A);
    check(`2a. ${what}: the same answer, nothing saved`, r.s === 409 && r.text === gone.text && one("SELECT analyte_id FROM veritacheck_verification_studies WHERE id = ?", s1).analyte_id === null, `${r.s}`);
  }
  check("2b. its own: saved, and cleared", (await save(EDITOR, vA, s1, { analyte_id: aA }, A)).s === 200 && (await save(EDITOR, vA, s1, { analyte_id: null }, A)).s === 200);

  // ── 3. A verification's analyzer ──────────────────────────────────────────
  const analyzer = (lab: number | null, user: number, name: string) => {
    const id = seed("veritamap_instruments", { map_id: seed("veritamap_maps", { user_id: user, lab_id: lab, name: "Map", instruments: "[]" }), instrument_name: name, role: "Primary", category: "Chemistry", nickname: `nick ${name}`, serial_number: `SN ${name}` });
    seed("veritamap_instrument_tests", { instrument_id: id, map_id: one("SELECT map_id FROM veritamap_instruments WHERE id = ?", id).map_id, analyte: `Analyte of ${name}`, specialty: "Chemistry", complexity: "MODERATE", active: 1 });
    return id;
  };
  const iA = analyzer(A, OWNER.id, "Unit A"), iB = analyzer(B, OWNER.id, "Unit B"), iX = analyzer(X, OTHER.id, "Unit X"), iNone = analyzer(null, OWNER.id, "Unit no lab");
  const make = (u: any, p: string, id: unknown, lab?: number) => call(u, "POST", p, { instrument_name: "New", trigger_type: "new_instrument", map_instrument_id: id }, lab);
  const scoped = `/api/labs/${A}/veritacheck/verifications`, older = "/api/veritacheck/verifications";
  const n0 = one("SELECT COUNT(*) AS n FROM veritacheck_verifications").n, noUnit = await make(OWNER, scoped, NONE);
  check("3a. an analyzer that doesn't exist is 404, nothing made", noUnit.s === 404 && one("SELECT COUNT(*) AS n FROM veritacheck_verifications").n === n0, `${noUnit.s}`);
  for (const p of [scoped, older]) for (const [what, id] of [["a sister lab's", iB], ["another customer's", iX], ["no number", "x"]] as const) {
    const r = await make(OWNER, p, id, A);
    check(`3b. ${p === scoped ? "the lab's route" : "the older route"}: ${what} analyzer is answered as one that doesn't exist`, r.s === 404 && r.text === noUnit.text && one("SELECT COUNT(*) AS n FROM veritacheck_verifications").n === n0, `${r.s}`);
  }
  for (const [what, u, p, id, want] of [["its own", EDITOR, scoped, iA, iA], ["its own, older route", OWNER, older, String(iA), iA], ["one with no lab, its owner's", OWNER, scoped, iNone, iNone], ["none", OWNER, scoped, null, null]] as const) {
    const r = await make(u, p, id, A);
    check(`3c. ${what}: made`, r.s === 200 && one("SELECT map_instrument_id FROM veritacheck_verifications WHERE id = ?", r.j?.id)?.map_instrument_id === want, `${r.s} ${r.text}`);
  }

  // ── 4. A slot already holding another laboratory's study ──────────────────
  const vF = verification(A, OWNER.id, "Package F", { map_instrument_id: iA, elements: '["precision","accuracy","method_comparison","carryover"]' });
  const own = slot(vF, { element: "accuracy", study_id: sA, passed: 1, result_summary: "own summary", sample_count: 12, analyte: "Sodium" });
  const foreign = slot(vF, { element: "precision", study_id: sX, passed: 1, result_summary: "a result from X", sample_count: 44, design_rationale: "the lab's own words", analyte: "Sodium" });
  const sister = slot(vF, { element: "method_comparison", study_id: sB, passed: 0, result_summary: "a result from B" });
  const manual = slot(vF, { element: "carryover", study_id: sX, passed: 1, manual_method: 1, manual_note: "attested here" });
  const stored = () => JSON.stringify(all("SELECT * FROM veritacheck_verification_studies ORDER BY id")) + JSON.stringify(all("SELECT * FROM veritacheck_verifications ORDER BY id"));
  const st0 = stored();
  for (const [who, u] of [["the lab's editor", EDITOR], ["the owner", OWNER]] as const) {
    const d = (await call(u, "GET", `/api/veritacheck/verifications/${vF}`, undefined, A)).j;
    const by = (id: number) => d.studies.find((x: any) => x.id === id);
    const f = by(foreign), s = by(sister), m = by(manual), o = by(own), raw = one("SELECT * FROM veritacheck_verification_studies WHERE id = ?", own);
    check(`4a. ${who}: its own slot reads exactly as before`, JSON.stringify(o) === JSON.stringify({ ...raw, testName: "Sodium in A", studyType: "precision" }), JSON.stringify(o));
    for (const [what, x] of [["another customer's", f], ["a sister lab's", s]] as const)
      check(`4b. ${who}: ${what} study isn't available, with no name, type, result or id`, x.linked_study_unavailable === true && x.study_id === null && x.testName === null && x.studyType === null && x.passed === null && x.result_summary === null && x.sample_count === null, JSON.stringify(x));
    check(`4c. ${who}: the lab's own words stay`, f.design_rationale === "the lab's own words" && f.analyte === "Sodium");
    check(`4d. ${who}: an attestation by manual method stays the lab's`, m.linked_study_unavailable === true && m.passed === 1 && m.manual_note === "attested here" && m.study_id === null);
    check(`4e. ${who}: nothing of either study anywhere in it`, !/Sodium in (X|B)|a result from/.test(JSON.stringify(d)));
  }
  const inList = async (p: string, lab?: number) => (await call(OWNER, "GET", p, undefined, lab)).j.find((x: any) => x.id === vF);
  for (const [what, v] of [["the older list", await inList(older, A)], ["the lab's list", await inList(scoped)], ["the survey bundle preview", (await call(OWNER, "GET", `/api/labs/${A}/veritacheck/map-instruments/${iA}/survey-bundle`)).j.verifications.find((x: any) => x.id === vF)]] as const)
    check(`4f. ${what} counts only its own and the attestation`, v.passed_count === 2 && v.failed_count === 0, JSON.stringify([v.passed_count, v.failed_count]));
  // The printed package
  const cols = "s.test_name AS testName, s.study_type AS studyType, s.data_points AS studyDataPoints, s.instrument AS studyInstrument, s.analyst AS studyAnalyst";
  const html = buildVerificationBlockHtml(one("SELECT * FROM veritacheck_verifications WHERE id = ?", vF), [], links.verificationSlots(sqlite, vF, cols));
  check("4g. the package's page says so, pending, with nothing of the study", (html.match(/Linked study not available/g) || []).length === 2 && !/Sodium in (X|B)|a result from|n=44/.test(html) && /Linked Study:<\/strong> Sodium in A/.test(html) && (html.match(/Pending evaluation/g) || []).length === 2, String((html.match(/Linked study not available/g) || []).length));
  const pdfText = async (p: string) => {
    const r = await call(OWNER, "POST", p, {}, A);
    const file = path.join(os.tmpdir(), `vsl-${w.stamp}-${Math.random().toString(36).slice(2)}.pdf`);
    fs.writeFileSync(file, r.buf);
    try { return execFileSync("python", ["-E", "-c", "import sys, fitz\nsys.stdout.reconfigure(encoding='utf-8')\nprint(' '.join(p.get_text() for p in fitz.open(sys.argv[1])))", file]).toString("utf-8").replace(/\s+/g, " "); } finally { fs.unlinkSync(file); }
  };
  for (const [what, p] of [["the package PDF", `/api/veritacheck/verifications/${vF}/pdf`], ["the survey bundle PDF", `/api/labs/${A}/veritacheck/map-instruments/${iA}/survey-bundle-pdf`]] as const) {
    const t = await pdfText(p);
    check(`4h. ${what}: the same`, (t.match(/Linked study not available/g) || []).length === 2 && !/Sodium in (X|B)|a result from/.test(t) && /Linked Study: Sodium in A/.test(t), t.slice(0, 200));
  }
  // Download all records
  const rec = selectRecords(sqlite, "veritacheck_verification_studies", exportContext(sqlite, A)!)!.rows;
  const ex = (id: number) => rec.find((x: any) => x.id === id);
  check("4i. the records export says so and has no result", ex(foreign).study_id === "Linked study not available" && ex(foreign).passed === null && ex(foreign).result_summary === null && ex(sister).study_id === "Linked study not available" && ex(manual).passed === 1 && !("linked_study_unavailable" in ex(foreign)), JSON.stringify(ex(foreign)));
  check("4j. and its own slot's row is the stored row", JSON.stringify(ex(own)) === row(own));
  // A person's studies in X: the study was used by X's own package, not A's
  const staffLabX = Number(one("SELECT id FROM staff_labs WHERE tier2_lab_id = ?", X)?.id ?? seed("staff_labs", { user_id: OTHER.id, tier2_lab_id: X, lab_name: "Made-up Lab X", clia_number: "22D0000779" }));
  const ann = seed("staff_employees", { user_id: OTHER.id, lab_id: staffLabX, tier2_lab_id: X, first_name: "Ann", last_name: "Alyst", status: "active" });
  const mine = async () => (await call(OTHER, "GET", `/api/labs/${X}/staff/employees/${ann}/veritacheck-studies`)).j.studies.filter((x: any) => x.study_id === sX);
  const before = await mine();
  check("4k. a person's study names no other lab's package", before.length === 1 && before[0].verification_id === null && before[0].verification_passed === null && before[0].verification_instrument_name === null, JSON.stringify(before));
  const ownX = slot(vX, { study_id: sX, passed: 1 });
  const after = await mine();
  check("4l. and names its own", after.length === 1 && after[0].verification_id === vX && after[0].verification_passed === 1, JSON.stringify(after));
  sqlite.prepare("DELETE FROM veritacheck_verification_studies WHERE id = ?").run(ownX);
  // The analyzer's menu
  const vMenu = verification(A, OWNER.id, "Menu", { map_instrument_id: iX }), vMenuOwn = verification(A, OWNER.id, "Menu own", { map_instrument_id: iA });
  const menu = async (v: number) => (await call(OWNER, "GET", `/api/veritacheck/verifications/${v}/map-analytes`, undefined, A)).j.analytes.map((a: any) => a.analyte).join();
  check("4m. an analyzer of another lab has no menu here; its own does", (await menu(vMenu)) === "" && (await menu(vMenuOwn)) === "Analyte of Unit A");
  sqlite.prepare("DELETE FROM veritacheck_verifications WHERE id IN (?, ?)").run(vMenu, vMenuOwn);

  // ── 5. Nothing stored changes; a new link doesn't keep the result ─────────
  check("5a. reading changed nothing stored", stored() === st0);
  const keep = await save(EDITOR, vF, foreign, { design_rationale: "changed words" }, A);
  check("5b. another field saves and leaves the link as it is", keep.s === 200 && one("SELECT study_id, passed, design_rationale FROM veritacheck_verification_studies WHERE id = ?", foreign).study_id === sX);
  const relink = await save(EDITOR, vF, foreign, { study_id: sA2 }, A), rr = one("SELECT study_id, passed, result_summary, sample_count FROM veritacheck_verification_studies WHERE id = ?", foreign);
  check("5c. linking one of its own doesn't keep that result", relink.s === 200 && rr.study_id === sA2 && rr.passed === null && rr.result_summary === null && rr.sample_count === null, JSON.stringify(rr));
  const undo = await save(EDITOR, vF, sister, { study_id: null }, A), ru = one("SELECT study_id, passed FROM veritacheck_verification_studies WHERE id = ?", sister);
  check("5d. nor does unlinking", undo.s === 200 && ru.study_id === null && ru.passed === null);
  const s5 = slot(vF, { element: "reference_interval", study_id: sA, passed: 1, result_summary: "kept" });
  await save(EDITOR, vF, s5, { study_id: null }, A);
  check("5e. unlinking its own keeps what it did before", one("SELECT passed, result_summary FROM veritacheck_verification_studies WHERE id = ?", s5).passed === 1 && one("SELECT result_summary FROM veritacheck_verification_studies WHERE id = ?", s5).result_summary === "kept");
  const vD = verification(A, OWNER.id, "Package D"), d1 = analyte(vD), d2 = analyte(vD, "Potassium"), d3 = analyte(vD, "Chloride");
  const linkedOwn = slot(vD, { analyte_id: d1, study_id: sA }), linkedElse = slot(vD, { analyte_id: d2, study_id: sX });
  const del = (a: number) => call(EDITOR, "DELETE", `/api/veritacheck/verifications/${vD}/analytes/${a}`, undefined, A);
  check("5f. an analyte with its own study linked isn't deleted", (await del(d1)).s === 409 && !!one("SELECT id FROM veritacheck_verification_studies WHERE id = ?", linkedOwn));
  check("5g. one whose study isn't available is, with its slot", (await del(d2)).s === 200 && !one("SELECT id FROM veritacheck_verification_studies WHERE id = ?", linkedElse) && !!one("SELECT id FROM studies WHERE id = ?", sX) && !!d3);

  // ── 6. Analyzers saved with a study ───────────────────────────────────────
  const meta = (id: number) => JSON.stringify({ 0: { instrument_id: id, model: "Saved model", nickname: "saved nick", serial_number: "SAVED" } });
  const shown = (id: number, of: any) => resolveInstrumentDisplay(sqlite, meta(id), of)![0];
  check("6a. its own lab's analyzer prints as it is named now", shown(iA, { lab_id: A, user_id: OWNER.id }).model === "Unit A");
  check("6b. any other prints as it was saved", [[iB, A], [iX, A], [NONE, A], [iA, X], [iA, null]].every(([i, l]) => { const d = shown(i as number, { lab_id: l, user_id: l == null ? null : OTHER.id }); return d.model === "Saved model" && d.nickname === "saved nick" && d.serial_number === "SAVED"; }));
  check("6c. with no lab, the owner's", shown(iNone, { lab_id: null, user_id: OWNER.id }).model === "Unit no lab" && shown(iNone, { lab_id: null, user_id: OTHER.id }).model === "Saved model");

  // ── 7. Counts ─────────────────────────────────────────────────────────────
  slot(vF, { element: "x1", study_id: sX, passed: 1 }); slot(vF, { element: "x2", study_id: sB, passed: 1 }); slot(vB, { element: "x3", study_id: sX, analyte_id: aA });
  verification(B, OWNER.id, "Foreign analyzer", { map_instrument_id: iX });
  const st7 = stored();
  const counts = async (h: Record<string, string>) => { const r = await fetch(`${base}/api/admin/veritacheck/foreign-slot-counts`, { headers: h }); return { s: r.status, t: await r.text() }; };
  check("7a. 403 without the header", (await counts({})).s === 403 && (await counts({ "x-admin-secret": "no" })).s === 403);
  const c = await counts({ "x-admin-secret": ADMIN }), j = JSON.parse(c.t);
  // Left on file: the attestation's slot and the three just made.
  check("7b. the counts", c.s === 200 && j.foreignSlots === 4 && j.otherOwner === 3 && j.sameOwner === 1 && j.foreignAnalyzers === 1 && j.analytesNotOnPackage === 1 && j.missingStudies === 0, c.t);
  check("7c. by lab", j.byLab[A].foreignSlots === 3 && j.byLab[A].sameOwner === 1 && j.byLab[A].otherOwner === 2 && j.byLab[B].foreignSlots === 1 && j.byLab[B].foreignAnalyzers === 1 && j.byLab[B].analytesNotOnPackage === 1 && !j.byLab[X], c.t);
  const strings: string[] = []; JSON.stringify(j, (_k, v) => { if (typeof v === "string") strings.push(v); return v; });
  check("7d. numbers and lab ids only, and nothing written", strings.length === 0 && stored() === st7, strings.join());

  // ── 8. The guard ──────────────────────────────────────────────────────────
  const ids = links.SLOT_COLUMNS.filter(links.isIdColumn);
  check("8a. every id a slot can hold has its check", ids.length > 0 && ids.every((k) => typeof links.SLOT_LINKS[k] === "function"), ids.join());
  check("8b. one with no check is refused, its own or not", !links.linkIsOwn(sqlite, { userId: OWNER.id }, one("SELECT * FROM veritacheck_verifications WHERE id = ?", vA), "reviewer_id", 1) && links.isIdColumn("reviewer_id") && links.isIdColumn("studyIds") && !links.isIdColumn("passed"));
  const inTable = (all("PRAGMA table_info(veritacheck_verification_studies)") as any[]).map((x) => x.name);
  check("8c. every column a save can set is in the table", links.SLOT_COLUMNS.every((k) => inTable.includes(k)));
  const read = (f: string) => fs.readFileSync(new URL(`../../server/${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const src = read("veritacheck_verification.ts");
  // Ids taken from a request's body there: the slot's columns, and the new verification's analyzer.
  const fromBody = new Set<string>();
  for (const m of src.matchAll(/const \{([^}]*)\} = req\.body/g)) for (const k of m[1].split(",")) fromBody.add(k.trim().split(/[:=]/)[0].trim());
  for (const m of src.matchAll(/req\.body\??\.(\w+)/g)) fromBody.add(m[1]);
  for (const m of src.matchAll(/const allowed = \[([^\]]*)\]/g)) for (const k of m[1].matchAll(/"(\w+)"/g)) fromBody.add(k[1]);
  const bodyIds = [...fromBody].filter(links.isIdColumn).sort();
  check("8d. no other id is taken from a request's body", bodyIds.join() === "map_instrument_id,study_id" && src.includes("ownMapInstrument(sqlite, { lab_id: labIdOrNull, user_id: userId }, map_instrument_id)"), bodyIds.join());
  check("8e. the slot save goes through the list and the check", /for \(const key of SLOT_COLUMNS\)[\s\S]{0,400}isIdColumn\(key\) && !linkIsOwn\(/.test(src) && (src.match(/UPDATE veritacheck_verification_studies SET/g) || []).length === 1);
  const joins = fs.readdirSync(new URL("../../server/", import.meta.url)).filter((f) => f.endsWith(".ts") && f !== "verificationLinks.ts").flatMap((f) => [...read(f).matchAll(/JOIN studies \w+ ON[^\n]*study_id[^\n]*|JOIN veritacheck_verification_studies \w+ ON[^\n]*\n[^\n]*/g)].map((m) => [f, m[0]]));
  check("8f. no reader joins a slot's study any other way", joins.every(([, t]) => /sameLabOrOwnerSql|slotLinkedSql/.test(t)), JSON.stringify(joins));

  w.finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
