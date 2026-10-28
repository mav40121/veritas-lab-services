// shared/competencyChecklist.ts
//
// The non-technical competency checklist (VeritaComp). A program of type "nontechnical" carries an
// ordered list of items (competency_checklist_items); each assessment snapshots the items it was done
// on (competency_assessment_items.nt_item_label / nt_item_description), so changing a program's
// checklist never rewrites a saved assessment. Used by the client editor and re-checked on the server.

import { isQuizImage, QUIZ_IMAGE_MAX_CHARS, QUIZ_IMAGES_TOTAL_MAX_CHARS } from "./quizImages";

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

export type ChecklistItemInput = { label?: string; description?: string; stage?: string | null; image?: string | null; imageId?: number | null } | string;

// A checklist item may carry ONE picture (2026-10-28, BUG-114: Gram stain slides on a MediaLab checklist). Same rules
// as a quiz picture (shared/quizImages.ts): an uploaded PNG/JPEG/GIF/WebP data URL, never a link, no patient
// identifiers. On save an item sends either `image` (a new picture) or `imageId` (the picture it already has, so an
// unchanged picture is not sent again); the server checks the id belongs to the lab.
export type ChecklistItemPicture = { image: string | null; imageId: number | null };

// New-hire evaluation stages (2026-10-19, Natalie Lamb, Sampson Regional: her forms list different items for the
// 30, 60 and 90-day evaluations, "I would need them separately"). An item of an evaluation program may belong to one
// stage; null means every stage. A 30-day evaluation shows the 30-day items plus the every-stage items, and so on.
// Competency programs never carry a stage.
export const CHECKLIST_STAGES = ["30day", "60day", "90day"] as const;
export type ChecklistStage = (typeof CHECKLIST_STAGES)[number];
export function isChecklistStage(v: unknown): v is ChecklistStage {
  return typeof v === "string" && (CHECKLIST_STAGES as readonly string[]).includes(v);
}
// The items an assessment of this type shows. Only the 30, 60 and 90-day types filter; every other type (and an
// unknown one) sees the whole checklist, so a competency program is never affected.
export function checklistItemsForType<T extends { stage?: string | null }>(items: T[], assessmentType: string | null | undefined): T[] {
  if (!isChecklistStage(assessmentType)) return items;
  return items.filter((it) => !it.stage || it.stage === assessmentType);
}

// Clean a checklist for saving: trims each description, keeps line breaks (detailed items), re-letters
// by position, and rejects an empty list, a blank item, or an oversized one. A stage is kept only when it is one of
// the three evaluation stages; anything else that is not empty is refused rather than guessed.
export function normalizeChecklistItems(raw: unknown): { items: ({ label: string; description: string; stage: ChecklistStage | null } & ChecklistItemPicture)[] } | { error: string } {
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
  const stages = raw.map((it: any) => (it && typeof it === "object" && it.stage != null && it.stage !== "" ? it.stage : null));
  const badStage = stages.findIndex((s) => s !== null && !isChecklistStage(s));
  if (badStage >= 0) return { error: `Item ${checklistLabel(badStage)} has an unknown stage. Use 30-Day, 60-Day, 90-Day or every stage.` };
  const pictures: ChecklistItemPicture[] = [];
  let newPictureChars = 0;
  for (let i = 0; i < raw.length; i++) {
    const it: any = raw[i];
    const img = it && typeof it === "object" ? it.image : null;
    const id = it && typeof it === "object" ? it.imageId : null;
    if (img !== undefined && img !== null && img !== "") {
      if (typeof img !== "string" || !img.startsWith("data:image/")) return { error: `Item ${checklistLabel(i)}: the picture must be an uploaded image (PNG, JPEG, GIF or WebP), not a link.` };
      if (img.length > QUIZ_IMAGE_MAX_CHARS) return { error: `Item ${checklistLabel(i)}: the picture is too large; use a smaller image.` };
      if (!isQuizImage(img)) return { error: `Item ${checklistLabel(i)}: the picture must be a PNG, JPEG, GIF or WebP image.` };
      newPictureChars += img.length;
      pictures.push({ image: img, imageId: null });
    } else if (id !== undefined && id !== null && id !== "") {
      if (!Number.isInteger(id) || id <= 0) return { error: `Item ${checklistLabel(i)}: unknown picture.` };
      pictures.push({ image: null, imageId: id });
    } else {
      pictures.push({ image: null, imageId: null });
    }
  }
  if (newPictureChars > QUIZ_IMAGES_TOTAL_MAX_CHARS) return { error: "Too many new pictures to save at once. Save a few, then add the rest." };
  return { items: descriptions.map((description, i) => ({ label: checklistLabel(i), description, stage: stages[i] as ChecklistStage | null, ...pictures[i] })) };
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
