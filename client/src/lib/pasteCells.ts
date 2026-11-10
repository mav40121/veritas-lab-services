// Paste from a spreadsheet into a row of entry cells (BUG-149, SCAHC 2026-11-09: a tech pasting a column of normal
// PTs from Excel into PT/INR Module 1 got only the first value, in the first of 20 fixed cells).
//
// Excel copies a column as one value per line ("11.4\r\n11.8\r\n"), a row as tab-separated values, and a block as
// both. splitPastedCells returns the cells in reading order, row by row. A single value returns [] so the caller
// leaves that paste to the browser, as before. A blank cell inside the range stays blank (it clears its cell); the
// line break Excel adds after the last row is dropped. Each cell is parsed by the caller, with the same parser typing
// uses, so "<9.0" means the same pasted as typed.
export function splitPastedCells(text: string): string[] {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  const cells = lines.flatMap((line) => line.split("\t")).map((c) => c.trim());
  return cells.length > 1 ? cells : [];
}

// The pasted range as rows of cells (one per line, cells split by tab), for a grid with columns. A single value returns []
// so the caller leaves that paste to the browser; the line break Excel adds after the last row is dropped.
export function splitPastedRows(text: string): string[][] {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  const rows = lines.map((line) => line.split("\t").map((c) => c.trim()));
  return rows.length > 1 || (rows[0]?.length ?? 0) > 1 ? rows : [];
}

// A pair of results in PT/INR Module 2 (instrument 1 vs instrument 2) or Module 3 (old lot vs new lot).
export type PairRow = { id: string; x: number | null; y: number | null };
export const pairRowId = (i: number) => `S${String(i + 1).padStart(5, "0")}`;

// BUG-162: a paste into a PT/INR Module 2 or 3 cell. Starting in the X column, a range two or more columns wide fills each
// row's X and Y; one column, or a start in the Y column, fills that column only. Rows are added, numbered on, when the
// paste runs past the last one, so a comparison isn't held to 20 pairs. `parse` turns a cell into a number or null.
export function fillPairsFrom(rows: PairRow[], start: number, col: "x" | "y", pasted: string[][], parse: (s: string) => number | null): PairRow[] {
  const out = rows.slice();
  while (out.length < start + pasted.length) out.push({ id: pairRowId(out.length), x: null, y: null });
  pasted.forEach((cells, i) => {
    const r = { ...out[start + i] };
    if (col === "x" && cells.length >= 2) { r.x = parse(cells[0]); r.y = parse(cells[1]); }
    else r[col] = parse(cells[0] ?? "");
    out[start + i] = r;
  });
  return out;
}

// A pasted cell as a number, or null when it is blank or not a number (thousands commas are dropped).
export function parsePairCell(s: string): number | null {
  const t = String(s ?? "").replace(/,/g, "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// Writes values into cells from start on, adding `empty` cells at the end when the paste runs past the last one.
export function fillCellsFrom<T>(cells: T[], start: number, values: T[], empty: T): T[] {
  const out = cells.slice();
  while (out.length < start + values.length) out.push(empty);
  values.forEach((v, i) => { out[start + i] = v; });
  return out;
}
