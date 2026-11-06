// server/maintainReviewReport.ts
//
// One month of VeritaMaintain records with their review, as a workbook a lab can hand to an inspector (Michael 2026-11-04, Q161 = 1). Customer-facing workbook standard:
// About sheet first, lab identity in three layers, brand colors, sheets protected.
import { CODE_LABELS } from "../shared/stainLogRules";

const TEAL = "FF01696F", TINT = "FFE6F2F2", ACCENT = "FF0A3A3D", INK = "FF28251D", ALT = "FFEBF3F8", GRID = "FFD0D0D0";
const GREEN = "FF437A22", AMBER = "FF964219", RED = "FFA12C7B";

const EVENT_LABEL: Record<string, string> = {
  calibration: "Calibration", preventive_maintenance: "Preventive maintenance", pm: "Preventive maintenance", service: "Service", repair: "Repair",
  function_check: "Function check", troubleshooting: "Troubleshooting", solution_change: "Solution change",
};

// The stain log's sheets appear only in a month that has stain log entries, so a lab without one sees the workbook it always did.
const ITEM_TYPE_LABEL: Record<string, string> = { equipment: "Instrument", temp_unit: "Temperature", stain_manual: "Manual stain log" };

export async function generateMaintainReviewReport(
  data: { month: string; items: any[]; readings: any[]; events: any[]; stainEntries?: any[]; manualEntries?: any[] },
  identity: { labName: string; cliaNumber: string },
): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "Veritas Lab Services";
  wb.created = new Date();
  const { labName, cliaNumber } = identity;
  const pwd = process.env.EXCEL_PROTECT_PASSWORD || "veritaassure-export";
  const protection = { selectLockedCells: true, selectUnlockedCells: true, formatCells: false, formatColumns: true, formatRows: false, insertRows: false, insertColumns: false, insertHyperlinks: false, deleteRows: false, deleteColumns: false, sort: true, autoFilter: true, pivotTables: false };

  // About (sheet 1)
  const about = wb.addWorksheet("About");
  about.getColumn(1).width = 110;
  const title = about.getCell("A1");
  title.value = "VeritaMaintain Monthly Record Review";
  title.font = { name: "Calibri", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
  title.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  about.getRow(1).height = 30;
  const idc = about.getCell("A2");
  idc.value = `Prepared for: ${labName}    CLIA: ${cliaNumber}`;
  idc.font = { name: "Calibri", bold: true, size: 11, color: { argb: ACCENT } };
  idc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TINT } };
  idc.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
  about.getRow(2).height = 24;
  let r = 3;
  const section = (text: string) => {
    const c = about.getCell(`A${r}`);
    c.value = text;
    c.font = { name: "Calibri", bold: true, size: 12, color: { argb: ACCENT } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TINT } };
    c.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
    about.getRow(r).height = 22; r += 1;
  };
  const body = (text: string) => {
    const c = about.getCell(`A${r}`);
    c.value = text;
    c.font = { name: "Calibri", size: 11, color: { argb: INK } };
    c.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
    about.getRow(r).height = Math.max(2, Math.ceil(text.length / 88)) * 16 + 4; r += 1;
  };
  section("About this report");
  body(`This workbook is one month of equipment and temperature records for ${labName}, ${data.month}, with who reviewed each record and when. It is a point-in-time copy. The live VeritaAssure record is the record of authority.`);
  section("How to use it");
  const stainEntries = data.stainEntries ?? [];
  const manualEntries = data.manualEntries ?? [];
  body(`Monthly Review lists each instrument and temperature unit, what the records show, any problem found, the corrective action the reviewer recorded, and the signature. Temperature Readings and Equipment Entries are the underlying records for the month.${stainEntries.length ? " Stain Log lists each coded entry, with the lot number and expiration on a change; a voided entry stays listed with its reason." : ""}${manualEntries.length ? " Manual Stain Log lists each manual stain; it holds no specimen number, and the link to a patient stays in the lab's LIS." : ""} An entry added after a review was signed is called out on the Monthly Review sheet.`);
  section("Source");
  body("Every line comes from what this lab recorded in VeritaMaintain. Ranges, schedules and corrective actions are the lab's own. Nothing here is calculated beyond counting those records against the readings per day the lab set.");
  section("Coverage gaps");
  body("This report covers records kept in VeritaMaintain. Records kept on paper or elsewhere are not included. Questions or gaps: info@veritaslabservices.com.");
  await about.protect(pwd, { ...protection, selectLockedCells: false, selectUnlockedCells: false, sort: false, autoFilter: false, formatColumns: false });

  const sheetFor = async (name: string, headers: string[], widths: number[], rows: any[][], decorate?: (row: any, values: any[]) => void) => {
    const ws = wb.addWorksheet(name, {
      headerFooter: { oddHeader: `&R${labName}    CLIA: ${cliaNumber}`, oddFooter: `&L${labName}    CLIA: ${cliaNumber}` },
      views: [{ state: "frozen", xSplit: 1, ySplit: 1 }],
    });
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    const head = ws.getRow(1);
    head.values = headers;
    head.height = 20;
    head.eachCell((c: any) => {
      c.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
      c.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    });
    rows.forEach((values, i) => {
      const row = ws.getRow(i + 2);
      row.values = values;
      for (let col = 1; col <= headers.length; col += 1) {
        const c = row.getCell(col);
        c.font = { name: "Calibri", size: 10, color: { argb: INK } };
        c.alignment = { vertical: "middle", wrapText: true };
        c.border = { top: { style: "thin", color: { argb: GRID } }, bottom: { style: "thin", color: { argb: GRID } }, left: { style: "thin", color: { argb: GRID } }, right: { style: "thin", color: { argb: GRID } } };
        if (i % 2) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ALT } };
      }
      decorate?.(row, values);
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
    await ws.protect(pwd, protection);
    return ws;
  };

  await sheetFor(
    "Monthly Review",
    ["Record", "Type", "What the records show", "Problems found", "Status", "Reviewed by", "Signed as", "Signed", "Corrective action", "Added after review"],
    [30, 14, 36, 36, 12, 24, 30, 12, 40, 12],
    data.items.map((i) => [
      i.name, ITEM_TYPE_LABEL[i.type] ?? "Record", (i.review?.summary?.notes ?? i.notes ?? []).join("; "),
      (i.review ? i.review.problems : i.problems).join("; "), i.review ? "Reviewed" : "Not reviewed",
      i.review?.typed_signature ?? "", i.review?.capacity_label ?? "", i.review ? String(i.review.signed_at).slice(0, 10) : "", i.review?.corrective_action ?? "", i.entries_after_review || "",
    ]),
    (row, v) => {
      row.getCell(5).font = { name: "Calibri", size: 10, bold: true, color: { argb: v[4] === "Reviewed" ? GREEN : AMBER } };
      if (v[9]) row.getCell(10).font = { name: "Calibri", size: 10, bold: true, color: { argb: AMBER } };
    },
  );
  await sheetFor(
    "Temperature Readings",
    ["Unit", "Date", "Time", "Reading", "Scale", "In range", "Initials", "Corrective action"],
    [30, 12, 8, 10, 8, 10, 10, 50],
    data.readings.map((x) => [x.unit, x.reading_date, x.reading_time ?? "", x.value, x.scale === "RH" ? "%RH" : `°${x.scale}`, x.in_range ? "Yes" : "No", x.initials ?? "", x.corrective_action ?? ""]),
    (row, v) => { if (v[5] === "No") row.getCell(6).font = { name: "Calibri", size: 10, bold: true, color: { argb: RED } }; },
  );
  await sheetFor(
    "Equipment Entries",
    ["Instrument", "Date", "Entry", "Performed by", "Notes"],
    [30, 12, 22, 20, 60],
    data.events.map((x) => [x.instrument_name, x.event_date, EVENT_LABEL[x.event_type] || x.event_type, x.performed_by ?? "", x.notes ?? ""]),
  );
  const voidedText = (x: any) => (x.voided_at ? `Voided ${String(x.voided_at).slice(0, 10)}: ${x.void_reason ?? ""}` : "");
  const flagVoided = (col: number) => (row: any, v: any[]) => { if (v[col - 1]) row.getCell(col).font = { name: "Calibri", size: 10, bold: true, color: { argb: RED } }; };
  if (stainEntries.length) {
    await sheetFor(
      "Stain Log",
      ["Instrument", "Row", "Date", "Code", "Meaning", "Lot number", "Expiration", "Initials", "Corrective action", "Voided"],
      [26, 22, 12, 8, 20, 16, 12, 10, 40, 30],
      stainEntries.map((x) => [x.instrument_name, x.row_name, x.log_date, x.code, CODE_LABELS[x.code] ?? "", x.lot_number ?? "", x.expiration_date ?? "", x.initials ?? "", x.corrective_action ?? "", voidedText(x)]),
      flagVoided(10),
    );
  }
  if (manualEntries.length) {
    await sheetFor(
      "Manual Stain Log",
      ["Date", "Specimen type", "Result", "Test slide", "Initials", "Comments or corrective action", "Voided"],
      [12, 26, 10, 10, 10, 50, 30],
      manualEntries.map((x) => [x.log_date, x.specimen_type, x.result === "problem" ? "Problem" : "Good", x.test_slide ? "Yes" : "No", x.initials ?? "", x.comments ?? "", voidedText(x)]),
      (row, v) => {
        if (v[2] === "Problem") row.getCell(3).font = { name: "Calibri", size: 10, bold: true, color: { argb: RED } };
        flagVoided(7)(row, v);
      },
    );
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
