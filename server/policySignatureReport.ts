// server/policySignatureReport.ts
//
// LHF-7: one combined, surveyor-ready signature report per policy. Fuses the
// director sign-off (policy_signoffs) with the full attestation roster (writer
// attestations + Staff Portal signatures) into a single "director approved and
// here is everyone who signed" proof for one policy. Closes the competitive gap
// where the who-has-and-has-not-signed picture was split across two views and
// not exportable. Follows the customer-facing workbook standard in CLAUDE.md
// (About sheet first, lab identity in three layers, brand colors, protection).
//
// The pure roster join (buildSignatureReportRows) is unit-tested by
// scripts/verify-policy-signature-report.mts.

export interface SignatureRosterRow {
  name: string;
  detail: string;      // email (writer) or title (staff)
  kind: string;        // "Writer attestation" | "Staff sign (kiosk)"
  assignedAt: string;  // yyyy-mm-dd or ""
  signedAt: string;    // yyyy-mm-dd or ""
  status: string;      // "Signed" | "Pending"
  note: string;        // e.g. "Signed an earlier version" for stale writer attestations
}

const ymd = (s: string | null | undefined): string => {
  if (!s) return "";
  const str = String(s);
  // Accept ISO or "yyyy-mm-dd ..." forms; take the date portion.
  const m = str.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : str.slice(0, 10);
};

export function buildSignatureReportRows(input: {
  attestations: Array<{ assignee_name?: string | null; assignee_email?: string | null; assigned_at?: string | null; completed_at?: string | null; is_stale_version?: boolean }>;
  staffSignatures: Array<{ signer_name?: string | null; signer_title?: string | null; signed_at?: string | null }>;
}): SignatureRosterRow[] {
  const rows: SignatureRosterRow[] = [];
  for (const a of input.attestations || []) {
    const signed = !!a.completed_at;
    rows.push({
      name: a.assignee_name || "(unknown)",
      detail: a.assignee_email || "",
      kind: "Writer attestation",
      assignedAt: ymd(a.assigned_at),
      signedAt: signed ? ymd(a.completed_at) : "",
      status: signed ? "Signed" : "Pending",
      note: signed && a.is_stale_version ? "Signed an earlier version" : "",
    });
  }
  for (const s of input.staffSignatures || []) {
    rows.push({
      name: s.signer_name || "(staff member)",
      detail: s.signer_title || "",
      kind: "Staff sign (kiosk)",
      assignedAt: "",
      signedAt: ymd(s.signed_at),
      status: "Signed",
      note: "",
    });
  }
  // Pending first (that is what a surveyor and a director chase), then signed,
  // each block alphabetical by name.
  rows.sort((a, b) => {
    if (a.status !== b.status) return a.status === "Pending" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return rows;
}

export function signatureReportSummary(rows: SignatureRosterRow[]): { total: number; signed: number; pending: number; writers: number; staff: number } {
  const writers = rows.filter((r) => r.kind.startsWith("Writer"));
  return {
    total: rows.length,
    signed: rows.filter((r) => r.status === "Signed").length,
    pending: rows.filter((r) => r.status === "Pending").length,
    writers: writers.length,
    staff: rows.length - writers.length,
  };
}

export async function generatePolicySignatureReportExcel(
  data: {
    doc: { title: string; policy_number?: string | null; status?: string | null };
    versionNumber: string | number | null;
    effectiveDate: string | null;
    signoffs: Array<{ user_name?: string | null; action?: string | null; step_name?: string | null; signed_at?: string | null; comment?: string | null }>;
    attestations: any[];
    staffSignatures: any[];
  },
  identity: { labName: string; cliaNumber: string },
): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "Veritas Lab Services";
  wb.created = new Date();

  const teal = "FF01696F", tealLight = "FFE6F2F2", accent = "FF0A3A3D", ink = "FF28251D", alt = "FFEBF3F8";
  const labName = identity.labName || "Laboratory";
  const cliaNumber = identity.cliaNumber || "Not on file";
  const exportPwd = process.env.EXCEL_PROTECT_PASSWORD || "veritaassure-export";

  // ── About sheet (sheet 1) ──
  const about = wb.addWorksheet("About");
  about.getColumn(1).width = 110;
  const t = about.getCell("A1");
  t.value = "VeritaDC Policy Signature Report";
  t.font = { name: "Calibri", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: teal } };
  t.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  about.getRow(1).height = 30;
  const idc = about.getCell("A2");
  idc.value = `Prepared for: ${labName}    CLIA: ${cliaNumber}`;
  idc.font = { name: "Calibri", bold: true, size: 11, color: { argb: accent } };
  idc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tealLight } };
  idc.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
  about.getRow(2).height = 24;
  let r = 3;
  const section = (text: string) => {
    const c = about.getCell(`A${r}`);
    c.value = text;
    c.font = { name: "Calibri", bold: true, size: 12, color: { argb: accent } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tealLight } };
    c.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
    about.getRow(r).height = 22; r += 1;
  };
  const body = (text: string) => {
    const c = about.getCell(`A${r}`);
    c.value = text;
    c.font = { name: "Calibri", size: 11, color: { argb: ink } };
    c.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
    about.getRow(r).height = Math.max(2, Math.ceil(String(text).length / 88)) * 16 + 4; r += 1;
  };
  const blank = () => { about.getRow(r).height = 8; r += 1; };
  section("About this report");
  body(`This report is the combined signature record for a single policy: ${data.doc.title}${data.doc.policy_number ? ` (${data.doc.policy_number})` : ""}. It shows the director or designee approval and the full roster of everyone assigned to attest, who has signed, who is still pending, and the bench staff who read and signed at the kiosk. It is a point-in-time proof a surveyor can review in one place.`);
  blank();
  section("How to read it");
  body("The Director Approval block lists each approval sign-off on the current version. The Signature Roster lists every assigned writer attestation and every Staff Portal signature, pending first so open items are obvious. 'Signed an earlier version' flags a signature captured before the current version, which usually needs a fresh attestation.");
  blank();
  section("Disclaimer");
  body("This is a snapshot, not the authoritative record. The live VeritaAssure record is audit-grade. The laboratory director or designee is responsible for resolving any pending signature and for keeping the underlying data current.");
  blank();
  section("Questions");
  body("Questions about this report: info@veritaslabservices.com.");
  await about.protect(exportPwd, {
    selectLockedCells: false, selectUnlockedCells: false, formatCells: false,
    formatColumns: false, formatRows: false, insertRows: false, insertColumns: false,
    insertHyperlinks: false, deleteRows: false, deleteColumns: false,
    sort: false, autoFilter: false, pivotTables: false,
  });

  // ── Signature Report sheet ──
  const sheet = wb.addWorksheet("Signature Report", {
    headerFooter: {
      oddHeader: `&R${labName}    CLIA: ${cliaNumber}`,
      oddFooter: `&L${labName}    CLIA: ${cliaNumber}`,
    },
  });
  sheet.getColumn(1).width = 30; sheet.getColumn(2).width = 34; sheet.getColumn(3).width = 20;
  sheet.getColumn(4).width = 14; sheet.getColumn(5).width = 14; sheet.getColumn(6).width = 12; sheet.getColumn(7).width = 26;

  const rows = buildSignatureReportRows({ attestations: data.attestations, staffSignatures: data.staffSignatures });
  const sum = signatureReportSummary(rows);

  const label = (row: number, k: string, v: string) => {
    const a = sheet.getCell(`A${row}`); a.value = k; a.font = { name: "Calibri", bold: true, color: { argb: accent } };
    const b = sheet.getCell(`B${row}`); b.value = v; b.font = { name: "Calibri", color: { argb: ink } };
  };
  sheet.getCell("A1").value = "Policy Signature Report";
  sheet.getCell("A1").font = { name: "Calibri", bold: true, size: 13, color: { argb: "FFFFFFFF" } };
  sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: teal } };
  sheet.getRow(1).height = 24;
  label(2, "Policy", `${data.doc.title}${data.doc.policy_number ? ` (${data.doc.policy_number})` : ""}`);
  label(3, "Current version", data.versionNumber != null ? String(data.versionNumber) : "n/a");
  label(4, "Effective date", ymd(data.effectiveDate) || "n/a");
  label(5, "Status", data.doc.status || "n/a");
  label(6, "Signed", `${sum.signed} of ${sum.total} (${sum.pending} pending)`);

  let rr = 8;
  const hdrBar = (text: string) => {
    const c = sheet.getCell(`A${rr}`); c.value = text;
    c.font = { name: "Calibri", bold: true, color: { argb: accent } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tealLight } };
    sheet.getRow(rr).height = 20; rr += 1;
  };
  hdrBar("Director approval");
  if (!data.signoffs || data.signoffs.length === 0) {
    sheet.getCell(`A${rr}`).value = "No director sign-off recorded on the current version.";
    sheet.getCell(`A${rr}`).font = { name: "Calibri", italic: true, color: { argb: "FF7A7974" } };
    rr += 1;
  } else {
    const sh = sheet.getRow(rr); sh.values = ["Approver", "Action", "Step", "Date"];
    sh.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" } };
    sh.fill = { type: "pattern", pattern: "solid", fgColor: { argb: teal } }; rr += 1;
    for (const s of data.signoffs) {
      const row = sheet.getRow(rr);
      row.values = [s.user_name || "", s.action || "", s.step_name || "", ymd(s.signed_at)];
      rr += 1;
    }
  }
  rr += 1;

  hdrBar(`Signature roster (${sum.writers} writer attestations, ${sum.staff} staff signatures)`);
  const head = sheet.getRow(rr);
  head.values = ["Name", "Email / Title", "Type", "Assigned", "Signed", "Status", "Note"];
  head.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: teal } };
  head.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  const headRowNum = rr;
  rr += 1;
  let band = false;
  for (const row of rows) {
    const x = sheet.getRow(rr);
    x.values = [row.name, row.detail, row.kind, row.assignedAt, row.signedAt, row.status, row.note];
    if (band) x.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: alt } }; });
    const statusCell = x.getCell(6);
    statusCell.font = { name: "Calibri", bold: true, color: { argb: row.status === "Signed" ? "FF437A22" : "FF964219" } };
    band = !band; rr += 1;
  }
  if (rows.length === 0) {
    sheet.getCell(`A${rr}`).value = "No attestations assigned and no staff signatures on file.";
    sheet.getCell(`A${rr}`).font = { name: "Calibri", italic: true, color: { argb: "FF7A7974" } };
    rr += 1;
  } else {
    sheet.autoFilter = { from: { row: headRowNum, column: 1 }, to: { row: headRowNum, column: 7 } };
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
