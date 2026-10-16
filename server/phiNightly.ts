// server/phiNightly.ts
//
// Nightly PHI scan (Q56 item 4, 2026-10-16). Runs the database scan (server/phiScan.ts) once a day, records the
// result in phi_scan_log (the evidence a customer's IT review can be shown), and emails info@ if anything is found.
// Until now the scan only ran when Veritas called /api/admin/phi-scan by hand. Never throws.

import { scanPhi } from "./phiScan";

const NOTIFY_TO = "info@veritaslabservices.com";

export async function runNightlyPhiScan(sqlite: any): Promise<{ findingCount: number; tablesScanned: number }> {
  let result: any;
  try {
    result = scanPhi(sqlite, { maxFindings: 50 });
  } catch (err: any) {
    console.error("[phi-scan] Nightly scan failed:", err?.message || err);
    return { findingCount: -1, tablesScanned: 0 };
  }
  try {
    sqlite.prepare(
      "INSERT INTO phi_scan_log (scanned_at, tables_scanned, columns_scanned, rows_scanned, finding_count, by_detector_json) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(result.scannedAt, result.tablesScanned, result.columnsScanned, result.rowsScanned, result.findingCount, JSON.stringify(result.byDetector || {}));
  } catch (err: any) {
    console.error("[phi-scan] Log write failed:", err?.message || err);
  }
  console.log(`[phi-scan] Nightly: ${result.findingCount} finding(s) across ${result.tablesScanned} tables, ${result.rowsScanned} rows`);
  if (result.findingCount > 0 && process.env.RESEND_API_KEY) {
    try {
      const { Resend } = await import("resend");
      const resend = new Resend(process.env.RESEND_API_KEY);
      // Table, column, row and a REDACTED preview only; the matched value is never sent.
      const rows = (result.findings || []).slice(0, 50)
        .map((f: any) => `<tr><td style="padding:4px 8px;border:1px solid #ddd">${f.table}.${f.column}</td><td style="padding:4px 8px;border:1px solid #ddd">${f.rowId ?? ""}</td><td style="padding:4px 8px;border:1px solid #ddd">${f.label}</td><td style="padding:4px 8px;border:1px solid #ddd">${String(f.preview).replace(/</g, "&lt;")}</td></tr>`)
        .join("");
      await resend.emails.send({
        from: "VeritaAssure System <info@veritaslabservices.com>",
        to: NOTIFY_TO,
        subject: `[VeritaAssure] Nightly PHI scan: ${result.findingCount} possible patient identifier(s)`,
        html: `<p>The nightly scan found text that looks like patient information. Matched values are redacted below. Review each row and contact the lab to remove it.</p>
               <table style="border-collapse:collapse;font-size:12px"><tr style="background:#f0f0f0"><th>Where</th><th>Row</th><th>Looks like</th><th>Context (redacted)</th></tr>${rows}</table>`,
      });
    } catch (err: any) {
      console.error("[phi-scan] Alert send failed:", err?.message || err);
    }
  }
  return { findingCount: result.findingCount, tablesScanned: result.tablesScanned };
}
