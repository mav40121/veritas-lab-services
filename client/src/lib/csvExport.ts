// Minimal CSV serializer. RFC 4180 quoting. UTF-8 BOM so Excel opens cleanly
// on Windows without a separate "import wizard" step.

export interface CsvColumn<T> {
  key: keyof T | string;
  header: string;
  // Optional formatter for cells that are not a direct property lookup
  // (e.g. derived values, formatted dates).
  format?: (row: T) => unknown;
}

export function toCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && !Number.isFinite(value)) return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function toCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: CsvColumn<T>[],
): string {
  const headerLine = columns.map((c) => toCsvCell(c.header)).join(",");
  const dataLines = rows.map((row) =>
    columns
      .map((c) => {
        const v = c.format ? c.format(row) : (row as Record<string, unknown>)[c.key as string];
        return toCsvCell(v);
      })
      .join(","),
  );
  return [headerLine, ...dataLines].join("\r\n");
}

// Triggers a browser download of a CSV string. Adds a UTF-8 BOM so Excel
// renders non-ASCII characters correctly on Windows.
export function downloadCsv(csvContent: string, filename: string): void {
  const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Convenience: serialize a single section (with a leading section header row)
// and concatenate. Useful for studies that need two tables in one file
// (e.g. sensitivity: blanks + low-level groups).
export function toCsvMultiSection(
  sections: Array<{ title: string; columns: CsvColumn<any>[]; rows: Array<Record<string, unknown>> }>,
): string {
  const blocks: string[] = [];
  for (const section of sections) {
    blocks.push(toCsvCell(section.title));
    blocks.push(toCsv(section.rows, section.columns));
  }
  return blocks.join("\r\n\r\n");
}
