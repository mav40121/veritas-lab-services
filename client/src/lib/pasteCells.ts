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

// Writes values into cells from start on, adding `empty` cells at the end when the paste runs past the last one.
export function fillCellsFrom<T>(cells: T[], start: number, values: T[], empty: T): T[] {
  const out = cells.slice();
  while (out.length < start + values.length) out.push(empty);
  values.forEach((v, i) => { out[start + i] = v; });
  return out;
}
