// server/veritascanCounts.ts
//
// A VeritaScan scan's items by status, as the scan list (GET /api/labs/:labId/veritascan/scans) shows them. Moved out of
// routes.ts (2026-11-11) so the compliance digest (server/digestCounts.ts) counts a scan the way the list does; the
// route's answer is unchanged. A scan with no item rows yet reads as the full 173-item checklist, all not assessed.

export const SCAN_STATUSES = ["Compliant", "Needs Attention", "Immediate Action", "N/A", "Not Assessed"] as const;

// Marks VeritaCheck and VeritaComp made themselves (BUG-135; server/integrations.ts). Every other completion_source
// (manual, the study evidence link, an admin correction) is a staff mark, or no mark at all.
export const AUTOMATIC_MARK_SOURCES = new Set(["veritacheck_auto", "veritacomp_auto"]);

export function scanStatusCounts(items: Array<{ status: string }>) {
  const total = items.length || 173;
  const notAssessed = items.filter((i) => i.status === "Not Assessed").length;
  const assessed = items.length - notAssessed;
  const compliant = items.filter((i) => i.status === "Compliant").length;
  const needsAttention = items.filter((i) => i.status === "Needs Attention").length;
  const immediateAction = items.filter((i) => i.status === "Immediate Action").length;
  const na = items.filter((i) => i.status === "N/A").length;
  const issues = needsAttention + immediateAction;
  return { total, notAssessed, assessed, compliant, needsAttention, immediateAction, na, issues };
}
