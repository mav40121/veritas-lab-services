// server/systemRepository.ts
//
// System repository: a shared document space for a system/organization. URL-pointer
// model (consistent with VeritaScan, HIPAA-free): a row is a link to a document the
// system hosts elsewhere (SharePoint, Drive, etc.), with a title, category, and
// description. No file storage, no PHI surface.
//
// The pure validator is mirrored by scripts/verify-system-repository.mjs.

export type SystemDocInput = { title?: unknown; url?: unknown; category?: unknown; description?: unknown };
export type SystemDocValue = { title: string; url: string; category: string | null; description: string | null };

// Pure: validate + normalize a submitted shared-document pointer.
//  - title required, non-empty, <= 300 chars
//  - url required, must be http(s) (blocks javascript:, data:, relative), <= 2048
//  - category / description optional, trimmed, length-capped, empty -> null
export function validateSystemDocument(input: SystemDocInput): { ok: true; value: SystemDocValue } | { ok: false; error: string } {
  const title = typeof input?.title === "string" ? input.title.trim() : "";
  if (!title) return { ok: false, error: "title is required" };
  if (title.length > 300) return { ok: false, error: "title is too long (max 300)" };

  const url = typeof input?.url === "string" ? input.url.trim() : "";
  if (!url) return { ok: false, error: "url is required" };
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: "url must start with http:// or https://" };
  if (url.length > 2048) return { ok: false, error: "url is too long (max 2048)" };

  const category = typeof input?.category === "string" && input.category.trim() ? input.category.trim().slice(0, 100) : null;
  const description = typeof input?.description === "string" && input.description.trim() ? input.description.trim().slice(0, 2000) : null;
  return { ok: true, value: { title, url, category, description } };
}
