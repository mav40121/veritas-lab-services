// tests/integration/veritastock-tissue-record-pdf.test.ts
//
// Receipt for the per-unit tissue record PDF (Michael Veri 2026-11-09: "The tissue tracking module needs a pdf print out. Use the
// heywood mock up for it."). Real routes on a scratch database with made-up data. The route's PDF is checked as a file (type,
// filename, author, pages); its words are checked on the HTML the route renders (buildTissueRecordHTML), since pdf-lib can't read
// text. Proves:
//   1. GET .../units/:id/pdf: 200 application/pdf for the lab's own unit, with the filename and author; 404 for a missing unit, for
//      another lab's unit through this lab's path and through a sister lab's path; 403 for another owner; a Staff seat reads it
//      as it reads the unit; 404 on veritastock.com; 403 without a suite plan
//   2. the header from the live lab record (name, CLIA or "Not on file", generated date), the tissue ID and status
//   3. the sections in the mock's order, the patient-chart line, the closing line, the footer, no em dash, no patient field
//   4. the Issue section is the CURRENT issue; Returned unused counts the returns still standing and shows the last one's checks
//   5. the step history: every event oldest first, a return with who brought it, who received it, both checks, where it went
//      and the issue it came back from (the first issue stays in the history); an undone step marked and its undo with the
//      reason; a correction with its reason and both values
//   6. a unit with no returns shows None; an undone return shows as undone and counts as none; text is escaped
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
  const {
    buildTissueRecordHTML, loadTissueRecord, tissueHistoryRows, TISSUE_RECORD_CHART_LINE, TISSUE_RECORD_CLOSING_LINE, TISSUE_RECORD_FOOTER_TEMPLATE, TISSUE_RECORD_SECTIONS,
  } = await import("../../server/tissueRecordPdf");
  const { PDFDocument } = await import("pdf-lib");
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
  const mkOwner = async (tag: string) => {
    const email = `tissue-pdf-${tag}-${stamp}@example.com`;
    const reg = await j(await call("POST", "/api/auth/register", { email, password: "Testpass123", name: `Made Up ${tag}`, hipaa_acknowledged: true }));
    return { email, token: reg.token as string, id: Number(reg.user?.id) };
  };
  const mkLab = async (ownerEmail: string, name: string, plan = "hospital") =>
    (await j(await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: name, plan }))).labId as number;
  const OA = await mkOwner("A");
  const OB = await mkOwner("B");
  const labA = await mkLab(OA.email, "Record Main");
  const labA2 = await mkLab(OA.email, "Record Annex");
  const labB = await mkLab(OB.email, "Record Other Owner");
  sqlite.prepare("UPDATE labs SET clia_number = '99D9999991' WHERE id = ?").run(labA);
  sqlite.prepare("UPDATE labs SET clia_number = NULL WHERE id = ?").run(labA2);
  check("labs provisioned", !!labA && !!labA2 && !!labB);
  const T = (lab: number) => `/api/labs/${lab}/veritastock/tissue`;
  const today = labLocalDate(new Date().toISOString(), false, labTimeZoneById(sqlite, labA));
  const shift = (d: number) => { const x = new Date(today + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
  const post = (p: string, body: unknown, lab = labA, token = OA.token) => call("POST", `${T(lab)}${p}`, body, token);

  const cat = (await j(await post("/catalog", { tissue_type: "Made-up Bone Putty", supplier_name: "Made-up Tissue Bank" }))).id as number;
  const tu = Number(sqlite.prepare("INSERT INTO temp_log_units (lab_id, name, unit_type, min_value, max_value, scale) VALUES (?, 'Made-up Freezer A', 'freezer', -30, -18, 'C')").run(labA).lastInsertRowid);
  const receive = async (sourceId: string, lab = labA, catalogId = cat, token = OA.token, storage: Record<string, unknown> = { storage_unit_id: tu, storage_location: "Shelf 2" }) => j(await post("/units", {
    catalog_id: catalogId, source_id: sourceId, quantity_or_size: "5 cc", expiration_date: shift(400),
    received_mm_date: shift(-5), received_mm_time: "09:00", received_mm_by: "M. Handler",
    receive_bb: { received_bb_date: shift(-5), received_bb_time: "10:00", received_bb_by: "B. Tech", transport_temp_ok: "yes", package_ok: "yes", ...storage },
  }, lab, token));
  const issueBody = (over: Record<string, unknown> = {}) => ({
    issued_date: shift(-2), issued_time: "08:00", requesting_physician: "Dr. Made Up", issued_to: "C. Courier", issued_by_tech: "B. Tech", delivered_to: "OR 4",
    readback_id: "yes", readback_expiration: "yes", readback_integrity: "yes", ...over,
  });
  const retBody = (over: Record<string, unknown> = {}) => ({
    returned_date: shift(-2), returned_time: "12:00", returned_by: "C. Courier", received_back_by: "R. Tech", storage_ok: "yes", package_ok_on_return: "yes",
    storage_unit_id: tu, storage_location: "Shelf 3", ...over,
  });

  // The full unit: receive, issue, return unused, a wrong issue undone, issue again, a correction, implant, usage card.
  const R = await receive("REC-1");
  await post(`/units/${R.id}/issue`, issueBody());
  await post(`/units/${R.id}/return-unused`, retBody());
  await post(`/units/${R.id}/issue`, issueBody({ issued_time: "13:00", delivered_to: "OR 9" }));
  await post(`/units/${R.id}/undo`, { reason: "Issued on the wrong unit" });
  await post(`/units/${R.id}/issue`, issueBody({ issued_date: shift(-1), issued_time: "09:00", requesting_physician: "Dr. Second", issued_to: "D. Courier", issued_by_tech: "S. Tech", delivered_to: "OR 7" }));
  await post(`/units/${R.id}/correct`, { reason: "Size misread", changes: { quantity_or_size: "6 cc" } });
  await post(`/units/${R.id}/implant`, { implanted_date: shift(-1), implanted_time: "10:00", implanted_by: "Dr. Surgeon", reconstituted_time: "09:50", reconstituted_by: "N. Nurse", reconstitution_solution: "Made-up Saline", reconstitution_lot: "SOL-1", reconstitution_expiration: shift(300) });
  const rFinal = await j(await post(`/units/${R.id}/usage-card`, { usage_card_returned: "yes", usage_card_returned_on: today }));
  check("setup: the full unit is implanted with its card back", rFinal.state === "implanted" && rFinal.usage_card_returned === 1, JSON.stringify(rFinal).slice(0, 200));

  // 1. The route.
  const pdfPath = (lab: number, id: number) => `${T(lab)}/units/${id}/pdf`;
  const own = await call("GET", pdfPath(labA, R.id), undefined, OA.token);
  const ownBytes = Buffer.from(await own.arrayBuffer());
  const cd = own.headers.get("content-disposition") || "";
  check("own lab: 200 application/pdf", own.status === 200 && /^application\/pdf/.test(own.headers.get("content-type") || ""), `${own.status} ${own.headers.get("content-type")}`);
  check("a real PDF", ownBytes.slice(0, 5).toString() === "%PDF-" && ownBytes.length > 5000, String(ownBytes.length));
  check("the filename names the tissue ID and the day", cd.includes(`filename="VeritaStock_Tissue_Record_REC-1_${today}.pdf"`), cd);
  const ownDoc = await PDFDocument.load(ownBytes);
  check("author metadata", ownDoc.getAuthor() === "Perplexity Computer", String(ownDoc.getAuthor()));
  check("the full unit, ten history rows, fits on at most two pages", ownDoc.getPageCount() <= 2, String(ownDoc.getPageCount()));
  console.log(`      (the full unit prints on ${ownDoc.getPageCount()} page${ownDoc.getPageCount() === 1 ? "" : "s"})`);
  const P = await receive("REC-PLAIN");
  const plainDoc = await PDFDocument.load(Buffer.from(await (await call("GET", pdfPath(labA, P.id), undefined, OA.token)).arrayBuffer()));
  check("a unit in storage prints on one page", plainDoc.getPageCount() === 1, String(plainDoc.getPageCount()));
  // PDF_OUT=<dir> keeps the two files, to look at them.
  if (process.env.PDF_OUT) {
    const fs = await import("node:fs");
    const path = await import("node:path");
    fs.writeFileSync(path.join(process.env.PDF_OUT, "record-full.pdf"), ownBytes);
    fs.writeFileSync(path.join(process.env.PDF_OUT, "record-plain.pdf"), Buffer.from(await plainDoc.save()));
  }
  check("a unit that doesn't exist: 404", (await call("GET", pdfPath(labA, 99999999), undefined, OA.token)).status === 404);
  const catB = (await j(await post("/catalog", { tissue_type: "Made-up Other Item", supplier_name: "Made-up Other Bank" }, labB, OB.token))).id as number;
  const B1 = await receive("REC-B", labB, catB, OB.token, { storage_location: "Other shelf" });
  check("setup: another owner's unit", !!B1.id);
  check("another lab's unit through this lab's path: 404", (await call("GET", pdfPath(labA, B1.id), undefined, OA.token)).status === 404);
  check("this lab's unit through a sister lab's path: 404", (await call("GET", pdfPath(labA2, R.id), undefined, OA.token)).status === 404);
  check("another owner on this lab's path: 403", (await call("GET", pdfPath(labA, R.id), undefined, OB.token)).status === 403);
  check("signed out: refused", [401, 403].includes((await call("GET", pdfPath(labA, R.id))).status));
  const seatEmail = `tissue-pdf-seat-${stamp}@example.com`;
  const seat = await j(await call("POST", "/api/auth/register", { email: seatEmail, password: "Testpass123", name: "Made Up Staff", hipaa_acknowledged: true }));
  sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status) VALUES (?, ?, 'staff', 'active')").run(labA, seat.user.id);
  sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_user_id, seat_email, lab_id, seat_type, status, permissions, invite_token) VALUES (?, ?, ?, ?, 'staff_portal', 'active', '{}', ?)")
    .run(OA.id, seat.user.id, seatEmail, labA, `tok-pdf-${stamp}`);
  const seatUnit = await call("GET", `${T(labA)}/units/${R.id}`, undefined, seat.token);
  const seatPdf = await call("GET", pdfPath(labA, R.id), undefined, seat.token);
  check("a Staff seat reads the unit, so it gets the PDF (200)", seatUnit.status === 200 && seatPdf.status === 200 && /^application\/pdf/.test(seatPdf.headers.get("content-type") || ""), `${seatUnit.status} ${seatPdf.status}`);
  check("a Staff seat in this lab can't get it through the sister lab (403)", (await call("GET", pdfPath(labA2, R.id), undefined, seat.token)).status === 403);
  process.env.VITE_STOCK_DEPLOYMENT = "true";
  check("veritastock.com: 404", (await call("GET", pdfPath(labA, R.id), undefined, OA.token)).status === 404);
  delete process.env.VITE_STOCK_DEPLOYMENT;
  const free = await mkOwner("Free");
  const freeLab = await mkLab(free.email, "Record No Plan");
  sqlite.prepare("UPDATE labs SET plan = 'free' WHERE id = ?").run(freeLab);
  check("no suite plan: 403", (await call("GET", pdfPath(freeLab, 1), undefined, free.token)).status === 403);

  // 2-5. The words, from the HTML the route renders.
  const rec = loadTissueRecord(sqlite, labA, R.id)!;
  const html = buildTissueRecordHTML(rec.unit, rec.events, rec.ctx);
  const apos = (s: string) => s.replace(/'/g, "&#39;");
  check("the route's loader stays in its lab", loadTissueRecord(sqlite, labA2, R.id) === null && loadTissueRecord(sqlite, labA, B1.id) === null);
  check("header: title, lab name, CLIA and the generated date from the live lab record",
    html.includes("VeritaStock&trade; Tissue Record") && html.includes("<b>Record Main</b>") && html.includes("CLIA: 99D9999991") && html.includes(`Generated ${today}`));
  check("tissue ID and status", html.includes(`<span class="id">REC-1</span>`) && /Status: Implanted<\/span>/.test(html) && html.includes("color:#437A22"));
  const at = TISSUE_RECORD_SECTIONS.map((t) => html.indexOf(`<div class="st">${t}</div>`));
  check("every section, in the mock's order", at.every((i) => i > 0) && at.every((i, k) => k === 0 || i > at[k - 1]), JSON.stringify(at));
  check("the sections are the ones asked for", TISSUE_RECORD_SECTIONS.join("|") === "Unit|Received, Materials Management|Received, blood bank|Issue|Implant|Tissue usage and information card|Returned unused to blood bank|Other disposition (wasted, returned to supplier, expired)|Step history");
  check("the patient-chart line, inside the Issue section", TISSUE_RECORD_CHART_LINE === "The recipient is recorded in the patient's chart, never in VeritaAssure®. A lookback runs from the tissue ID to this record, then to the chart." && html.indexOf(apos(TISSUE_RECORD_CHART_LINE)) > at[3] && html.indexOf(apos(TISSUE_RECORD_CHART_LINE)) < at[4]);
  check("the closing line", TISSUE_RECORD_CLOSING_LINE === "Recorded in VeritaStock™ by the laboratory's staff. Corrections and undone steps stay in the step history with their reason. Internal use: this is the laboratory's tissue record, not a signed report." && html.includes(apos(TISSUE_RECORD_CLOSING_LINE)));
  check("the footer on every page", TISSUE_RECORD_FOOTER_TEMPLATE.includes("VeritaAssure&reg; | VeritaStock&trade; | Confidential, For Internal Lab Use Only") && TISSUE_RECORD_FOOTER_TEMPLATE.includes(`Page <span class="pageNumber"></span> of <span class="totalPages"></span>`));
  const EM = String.fromCharCode(0x2014);
  check("no em dash in the page or the footer", !html.includes(EM) && !TISSUE_RECORD_FOOTER_TEMPLATE.includes(EM) && !html.includes("&mdash;"));
  const labels = [...html.matchAll(/<div class="f"[^>]*><span>([^<]*)<\/span>/g), ...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
  check("no field or column names a patient", labels.length > 30 && !labels.some((l) => /recipient|patient|medical record|mrn|birth/i.test(l)), labels.join("|"));
  check("no literal null or undefined", !/>(null|undefined)</.test(html) && !/\bundefined\b/.test(html));
  const section = (k: number) => html.slice(at[k], at[k + 1] ?? html.length);
  const issueSec = section(3);
  check("Issue is the current issue, not the first", issueSec.includes("Dr. Second") && issueSec.includes("OR 7") && issueSec.includes("S. Tech") && !issueSec.includes("Dr. Made Up") && issueSec.includes(`<b>${shift(-1)}</b>`));
  check("Issue carries the three read-backs", (issueSec.match(/<b>Yes<\/b>/g) || []).length === 3);
  check("Received, blood bank: the checks, None needed, and where it is now", section(2).includes("<b>B. Tech</b>") && section(2).includes("None needed") && section(2).includes("Made-up Freezer A, Shelf 3"));
  check("Implant and the usage card", section(4).includes("Dr. Surgeon") && section(4).includes("Made-up Saline") && section(4).includes("SOL-1") && section(5).includes(`<b>Yes</b>`) && section(5).includes(today));
  check("Unit shows the corrected size", section(0).includes("<b>6 cc</b>"));
  const retSec = section(6);
  check("Returned unused: the count and the last return with both checks", retSec.includes("1 (see step history)") && retSec.includes(`${shift(-2)} 12:00`) && (retSec.match(/<b>Yes<\/b>/g) || []).length === 2);

  // The step history.
  const rows = tissueHistoryRows(rec.events, rec.ctx);
  const htmlRows = [...html.matchAll(/<tr class="hist"><td>([^<]*)<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><\/tr>/g)].map((m) => ({ recorded: m[1], step: m[2], by: m[3], detail: m[4] }));
  check("every event is a row, oldest first", rows.length === rec.events.length && rows.length === 10 && htmlRows.length === 10 && htmlRows[0].step === "Received in Materials Management" && htmlRows[9].step === "Tissue usage card returned", htmlRows.map((r) => r.step).join(" | "));
  check("the order is the event order", rec.events.map((e) => e.event_type).join(",") === "received_mm,received_bb,issued,returned_unused,issued,undone,issued,corrected,implanted,usage_card");
  const bbRow = htmlRows[1];
  check("history: the blood bank receipt with its checks and where it was stored, in the mock's words", bbRow.step === "Received in blood bank and stored" && bbRow.detail === "Transport temperature acceptable; package acceptable; Made-up Freezer A, Shelf 2", bbRow.detail);
  check("history: the first issue stays, with its own time and place", htmlRows[2].step === "Issued" && htmlRows[2].recorded === `${shift(-2)} 08:00` && htmlRows[2].by === "B. Tech" && htmlRows[2].detail === "To OR 4; read-backs acceptable", JSON.stringify(htmlRows[2]));
  const retRow = htmlRows[3];
  check("history: the return, who brought it, who received it, both checks, where it went, and the issue it came back from",
    retRow.step === "Returned unused to blood bank" && retRow.recorded === `${shift(-2)} 12:00` && retRow.by === "Brought by C. Courier; received by R. Tech"
      && retRow.detail.startsWith("Storage conditions maintained: Yes; package acceptable: Yes; back to Made-up Freezer A, Shelf 3")
      && retRow.detail.includes(`Issue it came back from: ${shift(-2)} 08:00 to OR 4, requested by Dr. Made Up`), JSON.stringify(retRow));
  check("history: the wrong issue is marked undone", htmlRows[4].step === "Issued (undone)" && htmlRows[4].detail.startsWith("To OR 9"), JSON.stringify(htmlRows[4]));
  check("history: the undo names the step and gives its reason, with who entered it and when", htmlRows[5].step === "Step undone: Issued" && htmlRows[5].detail === "Reason: Issued on the wrong unit; back to In blood bank storage" && htmlRows[5].by === "Made Up A" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(htmlRows[5].recorded), JSON.stringify(htmlRows[5]));
  check("history: the second issue", htmlRows[6].step === "Issued" && htmlRows[6].by === "S. Tech" && htmlRows[6].detail === "To OR 7; read-backs acceptable", JSON.stringify(htmlRows[6]));
  check("history: the correction with its reason and both values", htmlRows[7].step === "Corrected" && htmlRows[7].detail === "Reason: Size misread; Quantity or size: 5 cc to 6 cc" && htmlRows[7].by === "Made Up A", JSON.stringify(htmlRows[7]));
  check("history: the implant with its reconstitution", htmlRows[8].step === "Implanted" && htmlRows[8].by === "Dr. Surgeon" && htmlRows[8].detail === "Reconstituted 09:50 with Made-up Saline, lot SOL-1", JSON.stringify(htmlRows[8]));
  check("history: the card", htmlRows[9].recorded === today);

  // 6. No returns, an undone return, a disposition, no CLIA, escaping.
  const plain = loadTissueRecord(sqlite, labA, P.id)!;
  const pHtml = buildTissueRecordHTML(plain.unit, plain.events, plain.ctx);
  const pAt = TISSUE_RECORD_SECTIONS.map((t) => pHtml.indexOf(`<div class="st">${t}</div>`));
  check("no returns: Returned unused says None", pHtml.slice(pAt[6], pAt[7]).includes("<b>None</b>") && !pHtml.slice(pAt[6], pAt[7]).includes("see step history"));
  check("nothing issued: the Issue fields are blank and the chart line still prints", !/<b>[^&<]/.test(pHtml.slice(pAt[3], pAt[4]).replace(/<b>Yes<\/b>|<b>No<\/b>/g, "")) && pHtml.slice(pAt[3], pAt[4]).includes(apos(TISSUE_RECORD_CHART_LINE)));
  check("in storage: status reads amber", /Status: In blood bank storage<\/span>/.test(pHtml) && pHtml.includes("color:#964219"));
  const Q = await receive("REC-UNDONE-RETURN");
  await post(`/units/${Q.id}/issue`, issueBody());
  await post(`/units/${Q.id}/return-unused`, retBody());
  await post(`/units/${Q.id}/undo`, { reason: "Return recorded on the wrong unit" });
  const q = loadTissueRecord(sqlite, labA, Q.id)!;
  const qHtml = buildTissueRecordHTML(q.unit, q.events, q.ctx);
  const qRows = tissueHistoryRows(q.events, q.ctx);
  const qAt = TISSUE_RECORD_SECTIONS.map((t) => qHtml.indexOf(`<div class="st">${t}</div>`));
  check("an undone return counts as none", qHtml.slice(qAt[6], qAt[7]).includes("<b>None</b>"));
  check("an undone return is marked, and its undo gives the reason and the issue it restored",
    qRows.some((r) => r.step === "Returned unused to blood bank (undone)") && qRows.some((r) => r.step === "Step undone: Returned unused to blood bank" && r.detail === `Reason: Return recorded on the wrong unit; issue restored: ${shift(-2)} 08:00 to OR 4; back to Issued`), JSON.stringify(qRows.slice(-2)));
  check("the restored issue is the Issue section", qHtml.slice(qAt[3], qAt[4]).includes("Dr. Made Up") && /Status: Issued<\/span>/.test(qHtml));
  const W = await receive("REC-WASTED");
  await post(`/units/${W.id}/dispose`, { kind: "wasted", disposition_date: today, disposition_time: "13:00", disposition_description: "Dropped <in> OR & discarded", disposition_by: "B. Tech" });
  const w = loadTissueRecord(sqlite, labA, W.id)!;
  const wHtml = buildTissueRecordHTML(w.unit, w.events, w.ctx);
  const wAt = TISSUE_RECORD_SECTIONS.map((t) => wHtml.indexOf(`<div class="st">${t}</div>`));
  check("Other disposition: date, time, description escaped, by", wHtml.slice(wAt[7], wAt[8]).includes("Dropped &lt;in&gt; OR &amp; discarded") && wHtml.slice(wAt[7], wAt[8]).includes("<b>13:00</b>") && !wHtml.includes("<in>"));
  check("wasted: the status and its history row", /Status: Wasted<\/span>/.test(wHtml) && wHtml.includes("color:#7A7974") && tissueHistoryRows(w.events, w.ctx).some((r) => r.step === "Other disposition: Wasted"));
  const S = await receive("REC-SUPPLIER");
  await post(`/units/${S.id}/dispose`, { kind: "returned", disposition_date: today, disposition_time: "13:00", disposition_description: "Supplier asked for it back", disposition_by: "B. Tech" });
  const s = loadTissueRecord(sqlite, labA, S.id)!;
  check("returned to the supplier reads so", /Status: Returned to supplier<\/span>/.test(buildTissueRecordHTML(s.unit, s.events, s.ctx)) && tissueHistoryRows(s.events, s.ctx).some((r) => r.step === "Other disposition: Returned to supplier"));
  const catA2 = (await j(await post("/catalog", { tissue_type: "Made-up Annex Item", supplier_name: "Made-up Tissue Bank" }, labA2))).id as number;
  const A2u = await receive("REC-ANNEX", labA2, catA2, OA.token, { storage_location: "Annex shelf" });
  const a2 = loadTissueRecord(sqlite, labA2, A2u.id)!;
  const a2Html = buildTissueRecordHTML(a2.unit, a2.events, a2.ctx);
  check("no CLIA on file says so, with the lab's own name", a2Html.includes("CLIA: Not on file - enter in account settings") && a2Html.includes("<b>Record Annex</b>"));

  server.close();
  console.log(failures ? `${failures} FAILED` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
