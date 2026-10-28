// server/competencyChecklistImages.ts
//
// Pictures on VeritaComp non-technical checklist items (2026-10-28, BUG-114: RFGH's MediaLab Gram stain checklist
// carries the slides the tech describes). A picture is stored once per lab, keyed by its SHA-256, in
// competency_checklist_images; a checklist item points at it (competency_checklist_items.image_id) and every assessment
// that snapshots the item points at the same row (competency_assessment_items.nt_item_image_id). Stored pictures are
// never changed or deleted, so a saved assessment always shows the picture it was done on, even after the program's
// checklist gets a new one. Picture rules (data URL, type, size) are in shared/quizImages.ts and are checked in
// shared/competencyChecklist.ts normalizeChecklistItems before anything here runs.
import { createHash } from "crypto";
import { isQuizImage } from "@shared/quizImages";

/** Store a picture for a lab (or find the identical one already stored) and return its id. */
export function storeChecklistImage(client: any, labId: number, dataUrl: string): number {
  const sha = createHash("sha256").update(dataUrl).digest("hex");
  client.prepare("INSERT OR IGNORE INTO competency_checklist_images (lab_id, sha256, data_url, created_at) VALUES (?, ?, ?, ?)")
    .run(labId, sha, dataUrl, new Date().toISOString());
  return Number((client.prepare("SELECT id FROM competency_checklist_images WHERE lab_id = ? AND sha256 = ?").get(labId, sha) as any).id);
}

/** True when the picture id is one of this lab's stored pictures. */
export function labOwnsChecklistImage(client: any, labId: number, imageId: number): boolean {
  return !!client.prepare("SELECT 1 FROM competency_checklist_images WHERE id = ? AND lab_id = ?").get(imageId, labId);
}

/** Why a checklist's kept pictures cannot be saved (an id that is not this lab's), or null. Checked before any write. */
export function checklistImageIdProblem(client: any, labId: number, items: { label: string; imageId?: number | null }[]): string | null {
  for (const it of items) {
    if (it.imageId != null && !labOwnsChecklistImage(client, labId, it.imageId)) return `Item ${it.label}: that picture is not in this lab. Add it again.`;
  }
  return null;
}

/** The image_id each item saves with: a new picture is stored, a kept one is used when it is this lab's. */
export function checklistItemImageIds(client: any, labId: number, items: { image?: string | null; imageId?: number | null }[]): (number | null)[] {
  return items.map((it) =>
    it.image ? storeChecklistImage(client, labId, it.image)
      : it.imageId != null && labOwnsChecklistImage(client, labId, it.imageId) ? it.imageId
      : null,
  );
}

/** A checklist for the audit log: the picture as a short note, never the picture itself. */
export function checklistForAudit(items: any[]): any[] {
  return items.map(({ image, imageId, image_id, ...rest }) => ({
    ...rest,
    picture: image ? "new picture" : (imageId ?? image_id) != null ? `picture #${imageId ?? image_id}` : null,
  }));
}

/** id -> data URL for the given picture ids (unknown and empty ids are skipped). */
export function checklistImageMap(client: any, ids: Iterable<number | null | undefined>): Record<number, string> {
  const want = Array.from(new Set(Array.from(ids).filter((v): v is number => Number.isInteger(v) && (v as number) > 0)));
  const out: Record<number, string> = {};
  if (!want.length) return out;
  const rows = client.prepare(`SELECT id, data_url FROM competency_checklist_images WHERE id IN (${want.map(() => "?").join(",")})`).all(...want) as any[];
  for (const r of rows) if (isQuizImage(r.data_url)) out[r.id] = r.data_url;
  return out;
}

/**
 * Add the picture itself to rows that point at one: `image` for a checklist item (image_id), `nt_item_image` for an
 * assessment item (nt_item_image_id). Used where a whole record is rendered (the competency PDF); the app's program
 * view gets one id -> picture map instead (checklistImageMap) so a picture shared by many assessments is sent once.
 */
export function withChecklistImages<T extends Record<string, any>>(client: any, rows: T[]): T[] {
  const map = checklistImageMap(client, rows.flatMap((r) => [r.image_id, r.nt_item_image_id]));
  return rows.map((r) => ({
    ...r,
    ...(r.image_id != null ? { image: map[r.image_id] ?? null } : {}),
    ...(r.nt_item_image_id != null ? { nt_item_image: map[r.nt_item_image_id] ?? null } : {}),
  }));
}

/**
 * After an assessment's items are written, point each non-technical item at the picture its program checklist item
 * has now (same letter and wording first, then same wording), so the record keeps that picture from then on. Items
 * the client sent are matched, never trusted for an id. Technical and waived items have no nt_item_label and are
 * left alone.
 */
export function snapshotChecklistItemImages(client: any, assessmentId: number | string): void {
  const rows = client.prepare(
    "SELECT id, nt_item_label, nt_item_description FROM competency_assessment_items WHERE assessment_id = ? AND nt_item_label IS NOT NULL",
  ).all(assessmentId) as Array<{ id: number; nt_item_label: string; nt_item_description: string | null }>;
  if (!rows.length) return;
  const programId = (client.prepare("SELECT program_id FROM competency_assessments WHERE id = ?").get(assessmentId) as any)?.program_id;
  const items = client.prepare("SELECT label, description, image_id FROM competency_checklist_items WHERE program_id = ? ORDER BY sort_order")
    .all(programId) as Array<{ label: string; description: string; image_id: number | null }>;
  const upd = client.prepare("UPDATE competency_assessment_items SET nt_item_image_id = ? WHERE id = ?");
  for (const r of rows) {
    const match = items.find((c) => c.label === r.nt_item_label && c.description === r.nt_item_description)
      ?? items.find((c) => c.description === r.nt_item_description);
    upd.run(match?.image_id ?? null, r.id);
  }
}
