// VeritaPolicy Requirements Index Excel export.
//
// Surfaces the lab's full requirement set (CFR + the lab's accreditation
// bodies on file) as a one-row-per-citation Excel workbook. Includes the
// pilot plain-language summary column (CfrRequirement.summary) next to
// the verbatim regulatory text so a lab director can scan without parsing
// the regulator-voice description. PARKING_LOT #30 follow-up to PR #309.
//
// About-sheet content is hand-written for THIS product per CLAUDE.md
// Section 6. Brand colors only. Em-dash ban applies to every cell.
// Lab identity stamped on About row 2 + every sheet's pageSetup header
// and footer. Data sheet locks all cells except Notes.

export interface RequirementRow {
  id?: number | string;
  source?: string;             // 'cfr' | 'tjc' | 'cap' | 'cola' | 'aabb'
  standard?: string;           // citation, e.g. "42 CFR §493.1253" or "QSA.02.01.01"
  name?: string;               // section title
  description?: string;        // verbatim text
  summary?: string;            // plain-language gloss (CFR only for the pilot)
  service_line?: string;
  chapter?: string;
  chapter_label?: string;
  cap_ids?: string[];
  tjc_ids?: string[];
  cola_ids?: string[];
  aabb_ids?: string[];
}

export interface RequirementsLabContext {
  labName: string;
  cliaNumber: string;
  accreditationLabel: string;
  exportPassword: string;
}

const TEAL = 'FF01696F';
const TEAL_TINT = 'FFE6F2F2';
const TEXT_DARK = 'FF28251D';
const TEXT_HEADER = 'FF0A3A3D';
const ROW_ALT = 'FFEBF3F8';
const WHITE = 'FFFFFFFF';
const GREY_BORDER = 'FFD0D0D0';

const thinBorder = {
  top:    { style: 'thin', color: { argb: GREY_BORDER } },
  bottom: { style: 'thin', color: { argb: GREY_BORDER } },
  left:   { style: 'thin', color: { argb: GREY_BORDER } },
  right:  { style: 'thin', color: { argb: GREY_BORDER } },
};

function sourceLabel(s?: string): string {
  switch ((s || '').toLowerCase()) {
    case 'cfr':  return 'CFR';
    case 'tjc':  return 'TJC';
    case 'cap':  return 'CAP';
    case 'cola': return 'COLA';
    case 'aabb': return 'AABB';
    default:     return s || '';
  }
}

export async function generateRequirementsIndexExcel(
  reqs: RequirementRow[],
  ctx: RequirementsLabContext,
): Promise<Buffer> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'VeritaAssure';
  wb.created = new Date();

  const labName = ctx.labName || 'Laboratory';
  const cliaNumber = ctx.cliaNumber || 'Not on file';
  const aoLabel = ctx.accreditationLabel || 'CLIA only';

  // ===== About sheet (sheet 1, hand-written for Requirements Index) =====
  const about = wb.addWorksheet('About');
  about.getColumn(1).width = 110;

  const aboutTitle = about.getCell('A1');
  aboutTitle.value = 'VeritaPolicy Requirements Index';
  aboutTitle.font = { name: 'Calibri', bold: true, size: 14, color: { argb: WHITE } };
  aboutTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } };
  aboutTitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  about.getRow(1).height = 30;

  const aboutIdentity = about.getCell('A2');
  aboutIdentity.value = `Prepared for: ${labName}    CLIA: ${cliaNumber}`;
  aboutIdentity.font = { name: 'Calibri', bold: true, size: 11, color: { argb: TEXT_HEADER } };
  aboutIdentity.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL_TINT } };
  aboutIdentity.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
  aboutIdentity.border = thinBorder as any;
  about.getRow(2).height = 24;

  let aboutRow = 3;
  const aboutSection = (text: string) => {
    const c = about.getCell(`A${aboutRow}`);
    c.value = text;
    c.font = { name: 'Calibri', bold: true, size: 12, color: { argb: TEXT_HEADER } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL_TINT } };
    c.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
    c.border = thinBorder as any;
    about.getRow(aboutRow).height = 22; aboutRow += 1;
  };
  const aboutBody = (text: string) => {
    const c = about.getCell(`A${aboutRow}`);
    c.value = text;
    c.font = { name: 'Calibri', size: 11, color: { argb: TEXT_DARK } };
    c.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
    c.border = thinBorder as any;
    const segs = String(text || '').split(/\r?\n/);
    let estLines = 0;
    for (const seg of segs) estLines += Math.max(1, Math.ceil(seg.length / 88));
    about.getRow(aboutRow).height = Math.max(2, estLines) * 16 + 4; aboutRow += 1;
  };
  const aboutBlank = () => { about.getRow(aboutRow).height = 8; aboutRow += 1; };

  aboutSection('About this product');
  aboutBody('The VeritaPolicy Requirements Index is the full requirement set that applies to this laboratory, one row per citation. It combines 42 CFR Part 493 (CLIA), the additional federal regulations the laboratory must meet (21 CFR, 29 CFR, 45 CFR, and 42 CFR 482 to 485 where applicable), and the published standards of the accreditation bodies on file for this lab. Each citation row carries the verbatim regulatory text plus, where authored, a plain-language summary written for the laboratory director. Verbatim text is authoritative. The summary is a reading aid, not a substitute for the citation.');
  aboutBlank();

  aboutSection('How to use this workbook');
  aboutBody('Requirements tab contains every citation that applies to this lab. Use the column filters at the top of each column to narrow by Source, Service Line, or Chapter. Search by citation number or section title with the column filter on the Citation or Section Title columns.');
  aboutBody('Verbatim Text: the regulatory text as it appears in the eCFR or the accreditor manual. This is the authoritative source. Do not paraphrase or summarize for inspection responses.');
  aboutBody('Plain-Language Summary: an optional column carrying a laboratory-director-facing paraphrase. Where present, the summary is a curated reading aid. Where blank, the verbatim text is the only authored content for that row. The summary does not replace the citation and is not itself authoritative.');
  aboutBody('Notes: an unlocked column for laboratory annotations. Use it to record which SOP, training record, or QC procedure satisfies the citation. The other columns are locked to preserve the integrity of the citation set.');
  aboutBlank();

  aboutSection('Disclaimer');
  aboutBody('This workbook is a working draft and a self-assessment tool, not an audit-grade compliance attestation, not a regulatory submission, and not a substitute for the laboratory\'s actual policies, SOPs, or the accrediting body\'s published manual. The requirement set is a curated crosswalk from VeritaAssure\'s master citation index as of the file generation date; standards from TJC, CAP, COLA, AABB, CMS / CFR 493, OSHA, NRC, FDA, and state agencies change, and the laboratory director is responsible for confirming the requirement set against the most recent published manual or letter of correction before relying on it.');
  aboutBody('Plain-language summaries are operator voice and are not regulatory text. They paraphrase the cited regulation as a reading aid. The verbatim Verbatim Text column is the only column suitable for citation or inspection response.');
  aboutBody('VeritaAssure / Veritas Lab Services does not: certify accreditation readiness; act as a Business Associate or HIPAA-covered entity for the contents of this workbook; file, renew, or correspond with TJC, CAP, AABB, COLA, CMS, OSHA, NRC, FDA, or any state agency on the laboratory\'s behalf; perform mock inspections or gap analyses unless separately engaged; warrant that meeting every citation in this workbook will result in a passing inspection; or provide legal, regulatory, or clinical advice. This workbook is an informational and operational planning aid only.');
  aboutBlank();

  aboutSection('Lab identity');
  aboutBody(`This workbook was prepared for ${labName} (CLIA ${cliaNumber}). The accreditation body on file for this lab is ${aoLabel}. The lab name and CLIA appear on every printed page header and footer.`);
  aboutBlank();

  aboutSection('Source');
  aboutBody('Citations are derived from the VeritaAssure master citation index, which crosswalks 42 CFR Part 493 (CLIA), 21 CFR (FDA), 29 CFR (OSHA), 45 CFR 164 (HIPAA Security Rule), and 42 CFR 482 to 485 (CMS Conditions of Participation) against the published standards of TJC, CAP, COLA, and AABB.');
  aboutBody('CFR text is sourced verbatim from the eCFR XML at https://www.ecfr.gov/api/versioner. Plain-language summaries are authored in operator voice for laboratory-director scannability; they cover a curated subset of high-traffic citations and are not yet comprehensive.');
  aboutBlank();

  aboutSection('Coverage gaps');
  aboutBody('Every laboratory operates in a slightly different context. If your laboratory identifies a citation that should be carried here but is missing, or a plain-language summary that needs revision, please email info@veritaslabservices.com so the change can be evaluated for inclusion in a future revision.');

  about.headerFooter.oddHeader = `&L&"Calibri,Regular"&10VeritaPolicy Requirements Index&R&"Calibri,Regular"&10${labName}    CLIA: ${cliaNumber}`;
  about.headerFooter.oddFooter = `&L&"Calibri,Regular"&9${labName}    CLIA: ${cliaNumber}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9VeritaAssure`;
  await about.protect(ctx.exportPassword, {
    selectLockedCells: false, selectUnlockedCells: false,
    formatCells: false, formatColumns: false, formatRows: false,
    insertRows: false, insertColumns: false, insertHyperlinks: false,
    deleteRows: false, deleteColumns: false,
    sort: false, autoFilter: false, pivotTables: false,
  });

  // ===== Requirements sheet =====
  const ws = wb.addWorksheet('Requirements');
  const headers = [
    { label: 'Source',                   width: 9  },
    { label: 'Citation',                 width: 22 },
    { label: 'Section Title',            width: 38 },
    { label: 'Verbatim Text',            width: 60 },
    { label: 'Plain-Language Summary',   width: 60 },
    { label: 'Service Line',             width: 14 },
    { label: 'Chapter',                  width: 36 },
    { label: 'CAP Cross-Refs',           width: 24 },
    { label: 'TJC Cross-Refs',           width: 22 },
    { label: 'COLA Cross-Refs',          width: 18 },
    { label: 'AABB Cross-Refs',          width: 18 },
    { label: 'Notes',                    width: 40 },
  ];
  ws.columns = headers.map((h, i) => ({ header: h.label, key: `col${i}`, width: h.width }));

  for (const r of reqs) {
    ws.addRow([
      sourceLabel(r.source),
      r.standard || '',
      r.name || '',
      r.description || '',
      r.summary || '',
      r.service_line || '',
      r.chapter_label || r.chapter || '',
      (r.cap_ids || []).join(', '),
      (r.tjc_ids || []).join(', '),
      (r.cola_ids || []).join(', '),
      (r.aabb_ids || []).join(', '),
      '',
    ]);
  }

  // Header row styling
  const headerRow = ws.getRow(1);
  headerRow.height = 36;
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Calibri', bold: true, color: { argb: WHITE }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = thinBorder as any;
  });

  // Data rows: zebra-stripe + lock all cells except Notes
  const notesColIdx = headers.findIndex((h) => h.label === 'Notes') + 1;
  const totalRows = reqs.length + 1;
  for (let r = 2; r <= totalRows; r += 1) {
    const row = ws.getRow(r);
    const isEven = r % 2 === 0;
    const bg = isEven ? ROW_ALT : WHITE;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.font = { name: 'Calibri', color: { argb: TEXT_DARK }, size: 10 };
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.border = thinBorder as any;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      if (colNumber === notesColIdx) {
        cell.protection = { locked: false };
      } else {
        cell.protection = { locked: true };
      }
    });
  }

  ws.views = [{ state: 'frozen' as const, xSplit: 2, ySplit: 1, topLeftCell: 'C2' }];
  const lastColNum = headers.length;
  const lastColLetter = lastColNum <= 26
    ? String.fromCharCode(64 + lastColNum)
    : String.fromCharCode(64 + Math.floor((lastColNum - 1) / 26)) + String.fromCharCode(65 + ((lastColNum - 1) % 26));
  ws.autoFilter = { from: 'A1', to: `${lastColLetter}1` };
  ws.headerFooter.oddHeader = `&L&"Calibri,Regular"&10VeritaPolicy Requirements Index&R&"Calibri,Regular"&10${labName}    CLIA: ${cliaNumber}`;
  ws.headerFooter.oddFooter = `&L&"Calibri,Regular"&9${labName}    CLIA: ${cliaNumber}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9VeritaAssure`;
  await ws.protect(ctx.exportPassword, {
    selectLockedCells: true, selectUnlockedCells: true,
    formatCells: false, formatColumns: false, formatRows: false,
    insertRows: false, insertColumns: false, insertHyperlinks: false,
    deleteRows: false, deleteColumns: false,
    sort: false, autoFilter: true, pivotTables: false,
  });

  wb.views = [{ x: 0, y: 0, width: 10000, height: 20000,
                firstSheet: 0, activeTab: 0, visibility: 'visible' }];

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
