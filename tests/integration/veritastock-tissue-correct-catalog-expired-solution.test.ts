// tests/integration/veritastock-tissue-correct-catalog-expired-solution.test.ts
//
// Receipt for parking lot #115's two record fixes on VeritaStock tissue (Michael Veri 2026-11-15, Q335 = 1). Real routes on a
// scratch database with made-up data. Proves:
//   1. a correction can move a unit to another catalog product: type, supplier and vendor change together; the history names the
//      type and supplier before and after (never the ids); an audit row; a retired product, another lab's product and the same
//      product are refused; the same tissue ID already on the log under the new supplier is refused (409) and nothing changes
//   2. an implant whose solution expired before the implant date is refused without a note (400 SOLUTION_EXPIRED_NOTE_REQUIRED,
//      the unit stays issued, no event), and records with one: the note on the row, in the implant event, the flag on the unit
//   3. a solution good through the implant date needs no note and keeps none; no reconstitution keeps none; the note is PHI-checked
//   4. a correction that makes the solution expired needs the note in the same correction; clearing a needed note is refused;
//      a unit saved before the rule (expired, no note) still takes an unrelated correction, and reads flagged with no note
//   5. undo of the implant clears the note
//   6. the record PDF's HTML prints the note, and "Expired; no note on file" for a unit saved before the rule
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { labLocalDate, labTimeZoneById } = await import("../../server/dateLocal");
  const { buildTissueRecordHTML, loadTissueRecord } = await import("../../server/tissueRecordPdf");
  const { SOLUTION_EXPIRED_NOTE_LABEL } = await import("../../shared/tissueRules");
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = (method: string, p: string, body?: unknown, token?: string) =>
    fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = async (r: Response) => { try { return await r.json(); } catch { return {}; } };
  const stamp = Date.now();
  const reg = await j(await call("POST", "/api/auth/register", { email: `tissue-115-${stamp}@example.com`, password: "Testpass123", name: "Made Up Director", hipaa_acknowledged: true }));
  const token = reg.token as string;
  const mkLab = async (name: string) => (await j(await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: `tissue-115-${stamp}@example.com`, labName: name, plan: "hospital" }))).labId as number;
  const labA = await mkLab("Tissue 115 Main");
  const labB = await mkLab("Tissue 115 Annex");
  check("labs provisioned", !!labA && !!labB && !!token);
  const T = `/api/labs/${labA}/veritastock/tissue`;
  const today = labLocalDate(new Date().toISOString(), false, labTimeZoneById(sqlite, labA));
  const shift = (d: number) => { const x = new Date(today + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
  const FUTURE = shift(400);
  const post = (p: string, body: unknown) => call("POST", `${T}${p}`, body, token);
  const get = async (id: number) => j(await call("GET", `${T}/units/${id}`, undefined, token));
  const rowOf = (id: number) => sqlite.prepare("SELECT * FROM tissue_units WHERE id = ?").get(id) as any;
  const eventsOf = (id: number, type?: string) => (sqlite.prepare("SELECT * FROM tissue_unit_events WHERE unit_id = ? ORDER BY id").all(id) as any[]).filter((e) => !type || e.event_type === type);
  const auditCount = (id: number) => (sqlite.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity_type LIKE '%tissue%' AND entity_id = ?").get(String(id)) as any)?.n ?? 0;

  const mkCat = async (lab: number, type: string, supplier: string) => (await j(await call("POST", `/api/labs/${lab}/veritastock/tissue/catalog`, { tissue_type: type, supplier_name: supplier }, token))).id as number;
  const catA = await mkCat(labA, "Made-up Bone Putty", "Made-up Supplier One");
  const catB = await mkCat(labA, "Made-up Cortical Strut", "Made-up Supplier Two");
  const catRetired = await mkCat(labA, "Made-up Old Graft", "Made-up Supplier Two");
  await call("PUT", `${T}/catalog/${catRetired}`, { active: "no" }, token);
  const catOtherLab = await mkCat(labB, "Made-up Annex Graft", "Made-up Supplier Three");
  check("catalog set up (two products, one retired, one in another lab)", !!catA && !!catB && !!catRetired && !!catOtherLab);
  const tu = Number(sqlite.prepare("INSERT INTO temp_log_units (lab_id, name, unit_type, min_value, max_value, scale) VALUES (?, 'Made-up Freezer', 'freezer', -30, -18, 'C')").run(labA).lastInsertRowid);

  let n = 0;
  const receive = async (over: Record<string, unknown> = {}) => {
    n++;
    return j(await post("/units", {
      catalog_id: catA, source_id: `T115-${n}`, quantity_or_size: "5 cc", expiration_date: FUTURE,
      received_mm_date: shift(-6), received_mm_time: "09:00", received_mm_by: "M. Handler",
      receive_bb: { received_bb_date: shift(-6), received_bb_time: "10:00", received_bb_by: "B. Tech", transport_temp_ok: "yes", package_ok: "yes", storage_unit_id: tu, storage_location: "Shelf 2" },
      ...over,
    }));
  };
  const issue = (id: number) => post(`/units/${id}/issue`, {
    issued_date: shift(-3), issued_time: "08:00", requesting_physician: "Dr. Made Up", issued_to: "C. Courier", issued_by_tech: "B. Tech", delivered_to: "OR 4",
    readback_id: "yes", readback_expiration: "yes", readback_integrity: "yes",
  });
  const recon = (expiration: string, over: Record<string, unknown> = {}) => ({
    implanted_date: shift(-2), implanted_time: "11:00", implanted_by: "Dr. Surgeon",
    reconstituted_time: "10:30", reconstituted_by: "R. Tech", reconstitution_solution: "Made-up Saline", reconstitution_lot: "LOT-9", reconstitution_expiration: expiration, ...over,
  });
  const implant = (id: number, body: Record<string, unknown>) => post(`/units/${id}/implant`, body);
  const correct = (id: number, changes: Record<string, unknown>, reason = "Entered under the wrong value") => post(`/units/${id}/correct`, { reason, changes });

  // 1. Correct the catalog product.
  const U = await receive();
  check("setup: a unit received under product A", U.catalog_id === catA && U.tissue_type === "Made-up Bone Putty" && U.supplier_name === "Made-up Supplier One");
  const unitView = await get(U.id);
  check("the unit offers the catalog product as correctable", (unitView.correctable_fields || []).includes("catalog_id") && !(unitView.correctable_fields || []).includes("tissue_type"));
  const auditBefore = auditCount(U.id);
  const moved = await correct(U.id, { catalog_id: catB }, "Received under the wrong product");
  const movedBody = await j(moved);
  const row = rowOf(U.id);
  const catBRow = sqlite.prepare("SELECT vendor_id FROM tissue_catalog WHERE id = ?").get(catB) as any;
  check("a catalog correction succeeds (200)", moved.status === 200, `${moved.status} ${JSON.stringify(movedBody).slice(0, 200)}`);
  check("type, supplier, catalog and vendor change together", row.catalog_id === catB && row.tissue_type === "Made-up Cortical Strut" && row.supplier_name === "Made-up Supplier Two" && row.vendor_id === catBRow.vendor_id);
  const ev = eventsOf(U.id, "corrected").pop();
  const detail = JSON.parse(ev?.detail_json || "{}");
  const fields = (detail.changes || []).map((c: any) => c.field).sort().join(",");
  check("the history names the type and supplier before and after, not the ids", fields === "supplier_name,tissue_type"
    && detail.changes.some((c: any) => c.field === "tissue_type" && c.from === "Made-up Bone Putty" && c.to === "Made-up Cortical Strut")
    && detail.changes.some((c: any) => c.field === "supplier_name" && c.from === "Made-up Supplier One" && c.to === "Made-up Supplier Two")
    && detail.reason === "Received under the wrong product", ev?.detail_json);
  check("an audit row is written", auditCount(U.id) === auditBefore + 1, `${auditBefore} -> ${auditCount(U.id)}`);
  const before = JSON.stringify(rowOf(U.id));
  const retired = await correct(U.id, { catalog_id: catRetired });
  check("a retired product is refused (400)", retired.status === 400 && /retired/.test((await j(retired)).error || ""));
  const other = await correct(U.id, { catalog_id: catOtherLab });
  check("another lab's product is refused (400)", other.status === 400 && /from your catalog/.test((await j(other)).error || ""));
  const same = await correct(U.id, { catalog_id: catB });
  check("the same product is nothing to correct (400)", same.status === 400 && /Nothing changed/.test((await j(same)).error || ""));
  check("the refused corrections changed nothing", JSON.stringify(rowOf(U.id)) === before);
  // The same tissue ID already on the log under the other supplier.
  const X = await receive({ catalog_id: catB, source_id: "DUP-115" });
  const Y = await receive({ source_id: "DUP-115" });
  check("setup: one tissue ID under two suppliers is allowed at receipt", !!X.id && !!Y.id && X.supplier_name !== Y.supplier_name);
  const yBefore = JSON.stringify(rowOf(Y.id));
  const dup = await correct(Y.id, { catalog_id: catB });
  check("moving it to the supplier that already has that ID is refused (409 DUPLICATE_TISSUE_ID)", dup.status === 409 && (await j(dup)).code === "DUPLICATE_TISSUE_ID");
  check("and nothing changed", JSON.stringify(rowOf(Y.id)) === yBefore);
  const viaPhi = await correct(U.id, { catalog_id: catA }, "MRN: 1234567");
  check("a correction reason is PHI-checked (400)", viaPhi.status === 400);

  // 2. An implant with an expired solution.
  const E = await receive();
  await issue(E.id);
  const eBefore = JSON.stringify(rowOf(E.id));
  const noNote = await implant(E.id, recon(shift(-3)));
  const noNoteBody = await j(noNote);
  check("an expired solution with no note is refused (400 SOLUTION_EXPIRED_NOTE_REQUIRED)", noNote.status === 400 && noNoteBody.code === "SOLUTION_EXPIRED_NOTE_REQUIRED" && /still recorded/.test(noNoteBody.error || ""), JSON.stringify(noNoteBody));
  check("the unit stays issued with nothing written", JSON.stringify(rowOf(E.id)) === eBefore && eventsOf(E.id, "implanted").length === 0);
  const blankNote = await implant(E.id, recon(shift(-3), { reconstitution_expired_note: "   " }));
  check("a blank note is no note (400)", blankNote.status === 400);
  const phiNote = await implant(E.id, recon(shift(-3), { reconstitution_expired_note: "patient: Pat Example" }));
  check("the note is PHI-checked (400)", phiNote.status === 400 && rowOf(E.id).state === "issued");
  const NOTE = "Surgeon informed before use; documented in the OR record";
  const withNote = await implant(E.id, recon(shift(-3), { reconstitution_expired_note: NOTE }));
  const eAfter = await j(withNote);
  check("with the note the implant records (200)", withNote.status === 200 && eAfter.state === "implanted", JSON.stringify(eAfter).slice(0, 200));
  check("the note is on the row and the unit is flagged", rowOf(E.id).reconstitution_expired_note === NOTE && eAfter.flags?.solution_expired === true);
  const implEv = JSON.parse(eventsOf(E.id, "implanted").pop()?.detail_json || "{}");
  check("the implant event holds the note and the expiration", implEv.reconstitution_expired_note === NOTE && implEv.reconstitution_expiration === shift(-3));

  // 3. In date, or no reconstitution: no note needed and none kept.
  const G = await receive();
  await issue(G.id);
  const sameDay = await implant(G.id, recon(shift(-2), { reconstitution_expired_note: "Not needed" }));
  check("a solution good through the implant date records without a note (200)", sameDay.status === 200);
  check("and a note sent with it isn't kept; not flagged", rowOf(G.id).reconstitution_expired_note === null && (await get(G.id)).flags?.solution_expired === false);
  const H = await receive();
  await issue(H.id);
  const plain = await implant(H.id, { implanted_date: shift(-2), implanted_time: "11:00", implanted_by: "Dr. Surgeon", reconstitution_expired_note: "stray" });
  check("an implant with no reconstitution records, keeping no note", plain.status === 200 && rowOf(H.id).reconstitution_expired_note === null);

  // 4. Corrections keep the rule.
  const noteless = await correct(G.id, { reconstitution_expiration: shift(-4) });
  const nlBody = await j(noteless);
  check("correcting the expiration to before the implant without a note is refused (400)", noteless.status === 400 && nlBody.code === "SOLUTION_EXPIRED_NOTE_REQUIRED", JSON.stringify(nlBody));
  const withFix = await correct(G.id, { reconstitution_expiration: shift(-4), reconstitution_expired_note: "Found on review; surgeon informed" });
  check("with the note in the same correction it saves (200)", withFix.status === 200 && rowOf(G.id).reconstitution_expiration === shift(-4) && rowOf(G.id).reconstitution_expired_note === "Found on review; surgeon informed");
  const clear = await correct(G.id, { reconstitution_expired_note: "" });
  check("clearing a needed note is refused (400)", clear.status === 400 && rowOf(G.id).reconstitution_expired_note === "Found on review; surgeon informed");
  const laterImplant = await correct(H.id, { implanted_date: shift(-1) });
  check("an implant with no solution moves freely (200)", laterImplant.status === 200);
  // A unit saved before the rule: expired solution, no note.
  const O = await receive();
  await issue(O.id);
  await implant(O.id, recon(shift(-2)));
  sqlite.prepare("UPDATE tissue_units SET reconstitution_expiration = ?, reconstitution_expired_note = NULL WHERE id = ?").run(shift(-5), O.id);
  const oView = await get(O.id);
  check("a unit saved before the rule reads flagged, with no note", oView.flags?.solution_expired === true && oView.reconstitution_expired_note === null);
  const unrelated = await correct(O.id, { implanted_by: "Dr. Other Surgeon" });
  check("it still takes an unrelated correction (200)", unrelated.status === 200 && rowOf(O.id).implanted_by === "Dr. Other Surgeon");
  const addNote = await correct(O.id, { reconstitution_expired_note: "Noted on review" });
  check("and a note can be added by correction (200)", addNote.status === 200 && rowOf(O.id).reconstitution_expired_note === "Noted on review");

  // 5. Undo of the implant clears the note.
  const undo = await post(`/units/${E.id}/undo`, { reason: "Implant recorded on the wrong unit" });
  check("undo of the implant succeeds and clears the note", undo.status === 200 && rowOf(E.id).state === "issued" && rowOf(E.id).reconstitution_expired_note === null && rowOf(E.id).reconstitution_expiration === null);

  // 6. The record PDF's HTML.
  await implant(E.id, recon(shift(-3), { reconstitution_expired_note: NOTE }));
  const rec = loadTissueRecord(sqlite, labA, E.id)!;
  const html = buildTissueRecordHTML(rec.unit, rec.events, rec.ctx);
  check("the record prints the note under the implant", html.includes(SOLUTION_EXPIRED_NOTE_LABEL) && html.includes(NOTE));
  check("the step history says the solution was past its expiration", /solution past its expiration/.test(html));
  const recG = loadTissueRecord(sqlite, labA, H.id)!;
  check("a unit with no expired solution prints no such line", !buildTissueRecordHTML(recG.unit, recG.events, recG.ctx).includes(SOLUTION_EXPIRED_NOTE_LABEL));
  sqlite.prepare("UPDATE tissue_units SET reconstitution_expired_note = NULL WHERE id = ?").run(O.id);
  const recO = loadTissueRecord(sqlite, labA, O.id)!;
  check("a unit saved before the rule prints that no note is on file", buildTissueRecordHTML(recO.unit, recO.events, recO.ctx).includes("Expired; no note on file"));
  const recU = loadTissueRecord(sqlite, labA, U.id)!;
  const htmlU = buildTissueRecordHTML(recU.unit, recU.events, recU.ctx);
  check("the record shows the corrected type and supplier, and the correction's before and after", htmlU.includes("Made-up Cortical Strut") && /Type of tissue: Made-up Bone Putty to Made-up Cortical Strut/.test(htmlU));

  server.close();
  console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
