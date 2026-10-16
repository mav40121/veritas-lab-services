// shared/competencyChecklist.ts
//
// The non-technical competency checklist (VeritaComp). A program of type "nontechnical" carries an
// ordered list of items (competency_checklist_items); each assessment snapshots the items it was done
// on (competency_assessment_items.nt_item_label / nt_item_description), so changing a program's
// checklist never rewrites a saved assessment. Used by the client editor and re-checked on the server.

export const CHECKLIST_MAX_ITEMS = 200;
export const CHECKLIST_MAX_DESCRIPTION = 2000;

// Item letters: A..Z, then AA, AB, ... A detailed checklist (a lab's own paper or MediaLab checklist)
// can run past 26 items; String.fromCharCode(65 + i) turned item 27 into "[".
export function checklistLabel(index: number): string {
  let n = Math.max(0, Math.floor(index));
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export type ChecklistItemInput = { label?: string; description?: string } | string;

// Clean a checklist for saving: trims each description, keeps line breaks (detailed items), re-letters
// by position, and rejects an empty list, a blank item, or an oversized one.
export function normalizeChecklistItems(raw: unknown): { items: { label: string; description: string }[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: "The checklist must be a list of items." };
  if (raw.length === 0) return { error: "A non-technical checklist needs at least one item." };
  if (raw.length > CHECKLIST_MAX_ITEMS) return { error: `A checklist can have up to ${CHECKLIST_MAX_ITEMS} items.` };
  const descriptions = raw.map((it: any) =>
    String((it && typeof it === "object" ? it.description : it) ?? "")
      .replace(/\r\n?/g, "\n")
      .split("\n").map((line) => line.trimEnd()).join("\n")
      .trim(),
  );
  const blank = descriptions.findIndex((d) => !d);
  if (blank >= 0) return { error: `Item ${checklistLabel(blank)} is blank. Type the item or remove it.` };
  const long = descriptions.findIndex((d) => d.length > CHECKLIST_MAX_DESCRIPTION);
  if (long >= 0) return { error: `Item ${checklistLabel(long)} is longer than ${CHECKLIST_MAX_DESCRIPTION} characters.` };
  return { items: descriptions.map((description, i) => ({ label: checklistLabel(i), description })) };
}

// Match a saved assessment's checklist rows to the program's current checklist when an unsigned
// assessment is reopened for editing: same wording first (survives a reorder), then the same letter
// for an item that was only reworded. Each saved row is used once. Returns saved row index per item.
export function matchSavedChecklistRows(
  current: { label: string; description: string }[],
  saved: { label: string; description: string }[],
): (number | null)[] {
  const norm = (s: string) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const used = new Set<number>();
  const out: (number | null)[] = current.map(() => null);
  current.forEach((c, i) => {
    const j = saved.findIndex((s, k) => !used.has(k) && norm(s.description) === norm(c.description));
    if (j >= 0) { out[i] = j; used.add(j); }
  });
  current.forEach((c, i) => {
    if (out[i] != null) return;
    const j = saved.findIndex((s, k) => !used.has(k) && s.label === c.label);
    if (j >= 0) { out[i] = j; used.add(j); }
  });
  return out;
}
