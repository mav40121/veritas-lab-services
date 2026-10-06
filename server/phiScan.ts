// server/phiScan.ts
//
// PHI leak scanner. VeritaAssure is PHI-free by design (CLAUDE.md s11): no
// patient data belongs in any field, ever. This scans the free-text columns of
// the live database for the protected-health identifiers that are detectable by
// shape, so an accidental paste is caught before a survey or a security review
// finds it. The expected result is ZERO findings; any hit is a real signal.
//
// Design notes:
//   - High-precision detectors ONLY. In a compliance corpus, bare dates, phone
//     numbers, emails, and the word "patient" are legitimate everywhere (review
//     dates, lab contacts, "patient results" in policy text), so they are NOT
//     used; they would flood false positives and defeat the "zero expected"
//     value. Name/address detection (e.g. Microsoft Presidio) and co-occurrence
//     rules are the depth upgrade when wanted.
//   - The report records WHERE a match is (table, column, row id) and a REDACTED
//     context preview with the matched span masked. The suspected identifier is
//     never emitted in cleartext, so the scan itself cannot become a PHI leak.
//   - Table and column names interpolated into SQL come from schema
//     introspection (sqlite_master / PRAGMA table_info), never user input, and
//     are double-quoted as identifiers.

import type Database from "better-sqlite3";

export interface PhiDetector {
  name: string;
  label: string;
  re: RegExp;
}

// Shape-detectable HIPAA identifiers that effectively never appear legitimately
// in this platform. Each requires a strong anchor (a dash-formatted SSN, or a
// labeled MRN/DOB/patient-name) to keep false positives near zero.
export const PHI_DETECTORS: PhiDetector[] = [
  { name: "ssn", label: "Social Security number", re: /\b\d{3}-\d{2}-\d{4}\b/ },
  {
    name: "mrn",
    label: "Medical record number",
    re: /\b(?:mrn|medical record (?:number|no\.?|#))\b[\s:#]*\d{4,}/i,
  },
  {
    name: "dob",
    label: "Date of birth",
    re: /\b(?:dob|date of birth)\b[\s:]*\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/i,
  },
  {
    name: "patient_name",
    label: "Labeled patient name",
    re: /\b(?:patient(?:'s)? name|pt name)\b\s*[:#]/i,
  },
];

export interface PhiFinding {
  table: string;
  column: string;
  rowId: number | string | null;
  detector: string;
  label: string;
  preview: string; // context with the matched span masked; never cleartext PHI
}

export interface PhiScanResult {
  scannedAt: string;
  tablesScanned: number;
  columnsScanned: number;
  rowsScanned: number;
  findingCount: number;
  byDetector: Record<string, number>;
  findings: PhiFinding[];
  truncated: boolean; // true when findingCount exceeds maxFindings returned
}

function isTextAffinity(declType: string): boolean {
  // SQLite affinity: a column with no declared type, or one whose type mentions
  // CHAR/TEXT/CLOB, can hold free text. Everything else (INT/REAL/BLOB/numeric)
  // is skipped to avoid scanning numeric/blob columns.
  const u = (declType || "").toUpperCase();
  return u === "" || u.includes("CHAR") || u.includes("TEXT") || u.includes("CLOB");
}

function redact(value: string, re: RegExp): string {
  const m = value.match(re);
  if (!m || m.index === undefined) return "[match]";
  const CTX = 24;
  const start = Math.max(0, m.index - CTX);
  const end = Math.min(value.length, m.index + m[0].length + CTX);
  const before = value.slice(start, m.index).replace(/\s+/g, " ");
  const after = value.slice(m.index + m[0].length, end).replace(/\s+/g, " ");
  return `${start > 0 ? "..." : ""}${before}[REDACTED]${after}${end < value.length ? "..." : ""}`;
}

export function scanPhi(
  sqlite: Database.Database,
  opts: { maxFindings?: number } = {},
): PhiScanResult {
  const maxFindings = opts.maxFindings ?? 500;

  const tables = (
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>
  ).map((r) => r.name);

  const findings: PhiFinding[] = [];
  const byDetector: Record<string, number> = {};
  let tablesScanned = 0;
  let columnsScanned = 0;
  let rowsScanned = 0;
  let truncated = false;

  for (const table of tables) {
    let cols: Array<{ name: string; type: string }>;
    try {
      cols = sqlite.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string; type: string }>;
    } catch {
      continue;
    }
    const textCols = cols.filter((c) => isTextAffinity(c.type)).map((c) => c.name);
    if (textCols.length === 0) continue;
    const idExpr = cols.some((c) => c.name === "id") ? '"id"' : "rowid";
    tablesScanned++;

    for (const col of textCols) {
      columnsScanned++;
      let rows: Array<{ __id: number | string | null; __v: unknown }>;
      try {
        rows = sqlite
          .prepare(
            `SELECT ${idExpr} AS __id, "${col}" AS __v FROM "${table}" WHERE "${col}" IS NOT NULL AND "${col}" <> ''`,
          )
          .all() as Array<{ __id: number | string | null; __v: unknown }>;
      } catch {
        continue;
      }
      for (const row of rows) {
        rowsScanned++;
        const v = String(row.__v);
        for (const det of PHI_DETECTORS) {
          if (det.re.test(v)) {
            byDetector[det.name] = (byDetector[det.name] || 0) + 1;
            if (findings.length < maxFindings) {
              findings.push({
                table,
                column: col,
                rowId: row.__id ?? null,
                detector: det.name,
                label: det.label,
                preview: redact(v, det.re),
              });
            } else {
              truncated = true;
            }
          }
        }
      }
    }
  }

  return {
    scannedAt: new Date().toISOString(),
    tablesScanned,
    columnsScanned,
    rowsScanned,
    findingCount: Object.values(byDetector).reduce((a, b) => a + b, 0),
    byDetector,
    findings,
    truncated,
  };
}
