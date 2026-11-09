// server/tissueRecordPdf.ts
//
// One tissue unit's record as a PDF (Michael 2026-11-09: "The tissue tracking module needs a pdf print out. Use the heywood mock
// up for it."). Laid out as the mock he approved (vls-ops/mock_tissue_record_pdf.mjs, VeritaStock_Tissue_Record_MOCK_2026-11-09.pdf),
// which follows Heywood's blood bank tissue form: receipt in Materials Management, receipt in the blood bank, issue with
// read-backs, implant, usage card, returned unused, other disposition, then every step in the unit's history.
// No recipient name or medical record number (Michael Q152 = 1): the form's two patient boxes are replaced by a line saying the
// recipient is in the chart. Section 5: CLIA on the header (from the live lab record), the footer on every page, author metadata.
// It's the lab's internal record, not a signed report, so it carries an internal-use line and no signature block, like the log.

import { getBrowser } from "./pdfReport";
import { stampPdfAuthor } from "./pdfMeta";
import { setPdfContent } from "./pdfContent";
import { labLocalDate, labTimeZoneById, labToday } from "./dateLocal";
import {
  OTHER_DISPOSITION_LABELS, TISSUE_FIELD_LABELS, TISSUE_STATE_LABELS, liveSteps, type OtherDisposition, type TissueState,
} from "../shared/tissueRules";

export interface TissueRecordContext {
  labName: string | null;
  cliaNumber: string | null;
  /** The lab's today, the day the record was generated. */
  generated: string;
  /** The lab's time zone, for the time a correction or undo was entered (those have no step date of their own). */
  tz: string;
  /** temp_log_units id to name, for this lab: where a unit was stored when a step named the unit. */
  storageNames: Record<number, string>;
}

export interface TissueEventRow {
  id: number;
  event_type: string;
  event_date?: string | null;
  event_time?: string | null;
  performed_by?: string | null;
  checks_json?: string | null;
  detail_json?: string | null;
  recorded_by_name?: string | null;
  created_at?: string | null;
}

export interface TissueHistoryRow { recorded: string; step: string; by: string; detail: string }

/** The line that stands where the paper form has its recipient name and medical record number boxes. */
export const TISSUE_RECORD_CHART_LINE = "The recipient is recorded in the patient's chart, never in VeritaAssure®. A lookback runs from the tissue ID to this record, then to the chart.";
export const TISSUE_RECORD_CLOSING_LINE = "Recorded in VeritaStock™ by the laboratory's staff. Corrections and undone steps stay in the step history with their reason. Internal use: this is the laboratory's tissue record, not a signed report.";
/** Section titles, in the order they print. */
export const TISSUE_RECORD_SECTIONS = [
  "Unit", "Received, Materials Management", "Received, blood bank", "Issue", "Implant", "Tissue usage and information card",
  "Returned unused to blood bank", "Other disposition (wasted, returned to supplier, expired)", "Step history",
] as const;

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const yn = (v: unknown) => (v === 1 ? "Yes" : v === 0 ? "No" : "");
const dt = (d: string | null | undefined, t: string | null | undefined) => [d, t].filter(Boolean).join(" ");
const json = (s: string | null | undefined): any => { try { return JSON.parse(s || "{}") || {}; } catch { return {}; } };
const stateLabel = (s: string | null | undefined) => (s ? TISSUE_STATE_LABELS[s as TissueState] || s : "");
const storedAt = (ctx: TissueRecordContext, unitId: unknown, location: unknown) =>
  [unitId != null && unitId !== "" ? ctx.storageNames[Number(unitId)] : null, location].filter(Boolean).join(", ");
const join = (parts: (string | null | undefined | false)[], sep = "; ") => parts.filter(Boolean).join(sep);

function statusColor(state: string): string {
  if (state === "implanted") return "#437A22";
  if (state === "expired") return "#A12C7B";
  if (state === "wasted" || state === "returned") return "#7A7974";
  return "#964219"; // open: pending
}

/** What an undo took back, in the words of the step's own row. */
function undoneWhat(d: any): string {
  if (d.undid === "returned_unused") return "Returned unused to blood bank";
  switch (d.from_state) {
    case "stored": return "Received in blood bank";
    case "issued": return "Issued";
    case "implanted": return "Implanted";
    case "wasted": case "returned": case "expired": return `Other disposition: ${OTHER_DISPOSITION_LABELS[d.from_state as OtherDisposition]}`;
    default: return "";
  }
}

function correctionValue(field: string, v: unknown, ctx: TissueRecordContext): string {
  if (v === null || v === undefined || v === "") return "blank";
  if (field === "transport_temp_ok" || field === "package_ok") return yn(v) || String(v);
  if (field === "storage_unit_id") return ctx.storageNames[Number(v)] || `storage unit ${v}`;
  return String(v);
}

/** Every event on the unit, oldest first, as the record's step history reads it. A step an undo took back says so. */
export function tissueHistoryRows(events: TissueEventRow[], ctx: TissueRecordContext): TissueHistoryRow[] {
  const ordered = [...events].sort((a, b) => a.id - b.id);
  const standing = new Set(liveSteps(ordered).map((e) => e.id));
  const STEPS = new Set(["received_mm", "received_bb", "issued", "implanted", "other_disposition", "returned_unused"]);
  return ordered.map((e) => {
    const d = json(e.detail_json);
    const c = json(e.checks_json);
    const recorded = e.event_date ? dt(e.event_date, e.event_time) : labLocalDate(e.created_at, true, ctx.tz);
    let step = e.event_type;
    let by = e.performed_by || "";
    let detail = "";
    switch (e.event_type) {
      case "received_mm":
        step = "Received in Materials Management";
        break;
      case "received_bb":
        step = "Received in blood bank and stored";
        // The mock's wording, short so a unit's history stays on its page. The receipt section above carries the full fields.
        detail = join([
          c.transport_temp_ok === 1 ? "Transport temperature acceptable" : c.transport_temp_ok === 0 ? "Transport temperature not acceptable" : null,
          c.package_ok === 1 ? "package acceptable" : c.package_ok === 0 ? "package not acceptable" : null,
          d.transport_action && `action taken: ${d.transport_action}`,
          storedAt(ctx, d.storage_unit_id, d.storage_location),
        ]);
        break;
      case "issued":
        // Who asked for it and who carried it are in the Issue section for the current issue, and in the return's row for one that came back.
        step = "Issued";
        detail = join([d.delivered_to && `To ${d.delivered_to}`, c.readback_id === 1 && c.readback_expiration === 1 && c.readback_integrity === 1 && "read-backs acceptable"]);
        break;
      case "implanted":
        step = "Implanted";
        detail = join([
          d.reconstituted_time && `Reconstituted ${d.reconstituted_time}${d.reconstitution_solution ? ` with ${d.reconstitution_solution}` : ""}${d.reconstitution_lot ? `, lot ${d.reconstitution_lot}` : ""}`,
          d.usage_card_returned === 1 && `tissue usage card returned ${d.usage_card_returned_on || ""}`.trim(),
        ]);
        break;
      case "usage_card":
        step = c.usage_card_returned === 1 ? "Tissue usage card returned" : "Tissue usage card: not returned";
        break;
      case "other_disposition":
        step = `Other disposition: ${OTHER_DISPOSITION_LABELS[d.kind as OtherDisposition] || d.kind || ""}`;
        detail = d.description || "";
        break;
      case "returned_unused": {
        step = "Returned unused to blood bank";
        by = join([d.returned_by && `Brought by ${d.returned_by}`, (d.received_back_by || e.performed_by) && `received by ${d.received_back_by || e.performed_by}`]);
        const back = storedAt(ctx, d.storage_unit_id, d.storage_location);
        const issue = d.cleared_issue || {};
        detail = join([
          `Storage conditions maintained: ${yn(d.storage_ok)}`, `package acceptable: ${yn(d.package_ok_on_return)}`, back && `back to ${back}`,
        ]) + (issue.issued_date ? `. Issue it came back from: ${dt(issue.issued_date, issue.issued_time)}${issue.delivered_to ? ` to ${issue.delivered_to}` : ""}${issue.requesting_physician ? `, requested by ${issue.requesting_physician}` : ""}` : "")
          + (d.note ? `. Note: ${d.note}` : "");
        break;
      }
      case "corrected":
        step = "Corrected";
        by = e.recorded_by_name || "";
        detail = join([
          d.reason && `Reason: ${d.reason}`,
          ...(Array.isArray(d.changes) ? d.changes.map((ch: any) => `${TISSUE_FIELD_LABELS[ch.field] || ch.field}: ${correctionValue(ch.field, ch.from, ctx)} to ${correctionValue(ch.field, ch.to, ctx)}`) : []),
        ]);
        break;
      case "undone": {
        const what = undoneWhat(d);
        step = what ? `Step undone: ${what}` : "Step undone";
        by = e.recorded_by_name || "";
        const r = d.restored || {};
        detail = join([
          d.reason && `Reason: ${d.reason}`,
          d.undid === "returned_unused" && r.issued_date && `issue restored: ${dt(r.issued_date, r.issued_time)}${r.delivered_to ? ` to ${r.delivered_to}` : ""}`,
          d.to_state && `back to ${stateLabel(d.to_state)}`,
        ]);
        break;
      }
    }
    if (STEPS.has(e.event_type) && !standing.has(e.id)) step += " (undone)";
    return { recorded, step, by, detail };
  });
}

const f = (label: string, value: unknown, flex = 0) =>
  `<div class="f"${flex ? ` style="flex:${flex}"` : ""}><span>${esc(label)}</span><b>${value === null || value === undefined || value === "" ? "&nbsp;" : esc(value)}</b></div>`;
const sec = (title: (typeof TISSUE_RECORD_SECTIONS)[number], body: string) => `<div class="sec"><div class="st">${esc(title)}</div><div class="sb">${body}</div></div>`;

/** The record as HTML: the mock's layout, filled from the unit's row and its events. Pure, so the tests read it directly. */
export function buildTissueRecordHTML(u: any, events: TissueEventRow[], ctx: TissueRecordContext): string {
  const cliaLine = ctx.cliaNumber ? `CLIA: ${esc(ctx.cliaNumber)}` : "CLIA: Not on file - enter in account settings";
  const ordered = [...events].sort((a, b) => a.id - b.id);
  const returns = liveSteps(ordered).filter((e) => e.event_type === "returned_unused");
  const lastReturn = returns.length ? { e: returns[returns.length - 1], d: json(returns[returns.length - 1].detail_json) } : null;
  const action = u.received_bb_date ? (u.transport_action || (u.transport_temp_ok === 1 && u.package_ok === 1 ? "None needed" : "")) : "";
  const history = tissueHistoryRows(ordered, ctx);
  const stateText = stateLabel(u.state);

  const body = [
    sec("Unit", f("Type of tissue", u.tissue_type, 2) + f("Source of tissue (supplier)", u.supplier_name, 2) + f("Quantity or size", u.quantity_or_size) + f("Expiration date", u.expiration_date)),
    sec("Received, Materials Management", f("Date", u.received_mm_date) + f("Time", u.received_mm_time) + f("By", u.received_mm_by, 2)),
    sec("Received, blood bank", f("Date", u.received_bb_date) + f("Time", u.received_bb_time) + f("By", u.received_bb_by, 2)
      + f("Transport temperature acceptable", yn(u.transport_temp_ok)) + f("Action taken", action) + f("Package integrity acceptable", yn(u.package_ok))
      + f("Stored at", u.received_bb_date ? storedAt(ctx, u.storage_unit_id, u.storage_location) : "", 2)),
    sec("Issue", f("Date", u.issued_date) + f("Time", u.issued_time) + f("Requesting physician", u.requesting_physician, 2) + f("Issued to", u.issued_to, 2)
      + f("Tech issuing", u.issued_by_tech) + f("Delivered to", u.delivered_to)
      + f("Source ID read back and acceptable", yn(u.readback_id_ok)) + f("Unit expiration date acceptable", yn(u.readback_expiration_ok)) + f("Integrity at issue acceptable", yn(u.readback_integrity_ok))
      + `<div class="note">${esc(TISSUE_RECORD_CHART_LINE)}</div>`),
    sec("Implant", f("Date implanted", u.implanted_date) + f("Time implanted", u.implanted_time) + f("Implanted by", u.implanted_by, 2)
      + f("Reconstituted: time", u.reconstituted_time) + f("Reconstituted: by", u.reconstituted_by, 2) + f("Reconstituting solution", u.reconstitution_solution, 2)
      + f("Solution lot", u.reconstitution_lot) + f("Solution expiration", u.reconstitution_expiration)),
    sec("Tissue usage and information card", f("Completed and returned", u.state === "implanted" ? (u.usage_card_returned === 1 ? "Yes" : "No") : "") + f("Date returned", u.usage_card_returned_on)),
    sec("Returned unused to blood bank", lastReturn
      ? f("Returns", `${returns.length} (see step history)`) + f("Last returned", dt(lastReturn.e.event_date, (lastReturn.e as any).event_time))
        + f("Storage conditions maintained", yn(lastReturn.d.storage_ok)) + f("Package acceptable on return", yn(lastReturn.d.package_ok_on_return))
      : f("Returns", "None")),
    sec("Other disposition (wasted, returned to supplier, expired)", f("Date", u.disposition_date) + f("Time", u.disposition_time) + f("Description", u.disposition_description, 3) + f("Performed by", u.disposition_by)),
    `<div class="sec hist-sec"><div class="st">${esc("Step history")}</div><div style="padding:6px 8px;"><table><thead><tr><th style="width:17%">Recorded</th><th style="width:26%">Step</th><th style="width:17%">By</th><th>Detail</th></tr></thead><tbody>
      ${history.map((h) => `<tr class="hist"><td>${esc(h.recorded)}</td><td>${esc(h.step)}</td><td>${esc(h.by)}</td><td>${esc(h.detail)}</td></tr>`).join("")}
    </tbody></table></div></div>`,
  ].join("\n  ");

  return `<!doctype html><html><head><meta charset="utf-8"><title>VeritaStock&trade; Tissue Record ${esc(u.source_id)}</title><style>
  * { box-sizing:border-box; } body { margin:0; font-family:Arial,Helvetica,sans-serif; font-size:10px; color:#28251D; }
  .band { background:#01696F; color:#fff; padding:10px 12px; border-radius:4px 4px 0 0; display:flex; justify-content:space-between; }
  .band h1 { margin:0; font-size:15px; } .band .sub { font-size:9px; opacity:.9; margin-top:2px; } .band .lab { text-align:right; font-size:9.5px; } .band .lab b { display:block; font-size:11px; }
  .idbar { border:1px solid #D0D0D0; border-top:none; padding:8px 12px; display:flex; gap:14px; align-items:baseline; }
  .idbar .id { font-size:14px; font-weight:700; color:#0A3A3D; word-break:break-all; } .idbar .status { margin-left:auto; font-weight:700; white-space:nowrap; }
  .sec { border:1px solid #D0D0D0; margin-top:8px; page-break-inside:avoid; } .sec .st { background:#E6F2F2; color:#01696F; font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:.4px; padding:4px 8px; }
  .sb { padding:6px 8px; display:flex; flex-wrap:wrap; gap:6px 12px; } .f { flex:1; min-width:110px; } .f span { display:block; font-size:8px; color:#6b6b6b; text-transform:uppercase; letter-spacing:.3px; } .f b { font-size:10px; font-weight:600; word-break:break-word; }
  .note { font-size:8.5px; color:#6b6b6b; padding:0 8px 6px; flex-basis:100%; }
  table { width:100%; border-collapse:collapse; font-size:9px; } thead { display:table-header-group; } th, td { border:1px solid #D0D0D0; padding:3px 5px; text-align:left; vertical-align:top; word-break:break-word; } th { background:#E6F2F2; color:#01696F; font-size:8px; text-transform:uppercase; }
  tr { page-break-inside:avoid; } .reg { font-size:8.5px; color:#6b6b6b; margin:8px 2px 0; }
  .hist-sec { page-break-inside:auto; } .hist-sec .st { break-after:avoid; page-break-after:avoid; }
</style></head><body>
  <div class="band"><div><h1>VeritaStock&trade; Tissue Record</h1><div class="sub">One unit, receipt to final disposition, as recorded in VeritaStock&trade;</div></div>
    <div class="lab"><b>${esc(ctx.labName || "Lab name not on file")}</b>${cliaLine}<br>Generated ${esc(ctx.generated)}</div></div>
  <div class="idbar"><span>Tissue ID</span><span class="id">${esc(u.source_id)}</span><span class="status" style="color:${statusColor(String(u.state))}">Status: ${esc(stateText)}</span></div>
  ${body}
  <div class="reg">${esc(TISSUE_RECORD_CLOSING_LINE)}</div>
</body></html>`;
}

export const TISSUE_RECORD_FOOTER_TEMPLATE = `<div style="font-size:7px;width:100%;padding:0 15mm;display:flex;justify-content:space-between;color:#555;font-family:Arial,Helvetica,sans-serif;"><span>VeritaAssure&reg; | VeritaStock&trade; | Confidential, For Internal Lab Use Only</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;

/** The unit, its events and the lab's identity from the live records, or null when the unit isn't on this lab's log. */
export function loadTissueRecord(sqlite: any, labId: number, unitId: number): { unit: any; events: TissueEventRow[]; ctx: TissueRecordContext } | null {
  const unit = sqlite.prepare("SELECT * FROM tissue_units WHERE id = ? AND lab_id = ?").get(unitId, labId) as any;
  if (!unit) return null;
  const lab = sqlite.prepare("SELECT lab_name, clia_number FROM labs WHERE id = ?").get(labId) as any;
  const events = sqlite.prepare(
    "SELECT id, event_type, event_date, event_time, performed_by, checks_json, detail_json, recorded_by_name, created_at FROM tissue_unit_events WHERE unit_id = ? ORDER BY id ASC"
  ).all(unit.id) as TissueEventRow[];
  const storageNames: Record<number, string> = {};
  for (const s of sqlite.prepare("SELECT id, name FROM temp_log_units WHERE lab_id = ?").all(labId) as any[]) storageNames[Number(s.id)] = s.name;
  const tz = labTimeZoneById(sqlite, labId);
  return { unit, events, ctx: { labName: lab?.lab_name ?? null, cliaNumber: lab?.clia_number ?? null, generated: labToday(tz), tz, storageNames } };
}

export async function generateTissueRecordPDF(u: any, events: TissueEventRow[], ctx: TissueRecordContext): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await setPdfContent(page, buildTissueRecordHTML(u, events, ctx));
    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: TISSUE_RECORD_FOOTER_TEMPLATE,
      margin: { top: "14mm", right: "15mm", bottom: "18mm", left: "15mm" },
    });
    return stampPdfAuthor(pdf);
  } finally {
    await page.close();
  }
}
