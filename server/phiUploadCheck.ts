// server/phiUploadCheck.ts
//
// PHI guard for uploaded documents (Q56 item 4, 2026-10-16). Reads the text of an uploaded Word, Excel, text or web
// file and returns the labels of any patient identifiers it appears to contain (shared/phiPatterns.ts). The upload
// still saves: policy and form templates legitimately carry labeled blanks, so this WARNS the person who uploaded it
// rather than blocking. PDFs and images are not read (no text extractor here); the warning says so plainly.

import { detectPhiInDocumentText } from "../shared/phiPatterns";
import { canonicalFormatFromMimeAndName } from "./veritapolicyApproval";

const MAX_TEXT = 2_000_000;

export async function documentText(buffer: Buffer, format: string): Promise<string | null> {
  try {
    if (format === "docx") {
      const mammoth: any = require("mammoth");
      const r = await mammoth.extractRawText({ buffer });
      return String(r?.value || "").slice(0, MAX_TEXT);
    }
    if (format === "xlsx") {
      const { default: ExcelJS } = await import("exceljs");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as any);
      const parts: string[] = [];
      wb.eachSheet((ws: any) => ws.eachRow((row: any) => row.eachCell((c: any) => { const t = c.text; if (t) parts.push(t); })));
      return parts.join("\n").slice(0, MAX_TEXT);
    }
    if (format === "txt" || format === "html") {
      return buffer.toString("utf-8").replace(/<[^>]+>/g, " ").slice(0, MAX_TEXT);
    }
  } catch {
    return null;
  }
  return null; // pdf, png, jpg, xls: not read
}

export interface PhiUploadWarning {
  checked: boolean;          // false for formats we cannot read (PDF, images, old .xls)
  found: string[];           // labels of what looked like patient information
  message: string | null;    // what to show the person, or null when nothing to say
}

export async function checkUploadForPhi(buffer: Buffer, format: string): Promise<PhiUploadWarning> {
  const text = await documentText(buffer, format);
  if (text == null) return { checked: false, found: [], message: null };
  const found = detectPhiInDocumentText(text);
  return {
    checked: true,
    found,
    message: found.length
      ? `This file appears to contain patient information (${found.join(", ")}). VeritaAssure is not for patient information: please remove it from the document and upload the corrected version.`
      : null,
  };
}

// Every other route that stores an uploaded file (system repository, VeritaLab certificate documents, VeritaStock
// recall documents): the format is decided from the file's own bytes, then checked the same way.
export async function checkUploadedFileForPhi(file: { buffer?: Buffer; mimetype?: string; originalname?: string } | undefined): Promise<PhiUploadWarning> {
  if (!file?.buffer) return { checked: false, found: [], message: null };
  const format = canonicalFormatFromMimeAndName(String(file.mimetype || ""), String(file.originalname || ""), file.buffer);
  return format ? checkUploadForPhi(file.buffer, format) : { checked: false, found: [], message: null };
}
