// server/stockRecallLogic.ts
//
// Pure helpers for the VeritaStock recall tracker (server/stockRecalls.ts).
// No DB, no clock: every function takes its inputs explicitly so
// scripts/verify-stock-recall-logic.mts can exercise each branch on a fixed
// input set. Copy rule: nothing here may carry lab wording (VeritaStock is
// sold as general supply inventory).

export const RECALL_NOTICE_TYPES = ["recall", "product_notification", "device_correction", "other"] as const;
export type RecallNoticeType = typeof RECALL_NOTICE_TYPES[number];

export const RECALL_NOTICE_TYPE_LABELS: Record<RecallNoticeType, string> = {
  recall: "Recall",
  product_notification: "Product Notification",
  device_correction: "Device Correction",
  other: "Other",
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isYmd(s: unknown): s is string {
  if (typeof s !== "string" || !YMD.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Due date for a new recall case: 1 business day after the day it was opened.
// Opened Mon-Thu -> next day; Fri -> Mon; Sat -> Mon; Sun -> Mon. Holidays are
// not modeled (the due date stays editable on the case).
export function nextBusinessDay(openedYmd: string): string {
  if (!isYmd(openedYmd)) throw new Error("openedYmd must be YYYY-MM-DD");
  let d = addDaysYmd(openedYmd, 1);
  for (;;) {
    const dow = new Date(d + "T00:00:00Z").getUTCDay(); // 0 Sun .. 6 Sat
    if (dow !== 0 && dow !== 6) return d;
    d = addDaysYmd(d, 1);
  }
}

// The opener's local calendar date, sent by the browser, is trusted only when it
// sits within one day of the server's UTC date (every real timezone does). A
// missing or implausible value falls back to the UTC date.
export function resolveOpenedDate(clientLocalYmd: unknown, nowUtcYmd: string): string {
  if (!isYmd(clientLocalYmd)) return nowUtcYmd;
  const diff = Math.round((Date.parse(clientLocalYmd + "T00:00:00Z") - Date.parse(nowUtcYmd + "T00:00:00Z")) / 86400000);
  return Math.abs(diff) <= 1 ? clientLocalYmd : nowUtcYmd;
}

// Lot numbers typed or pasted on intake: split on commas, semicolons or line
// breaks, trimmed, de-duplicated case-insensitively, order kept.
export function parseLotNumbers(input: unknown): string[] {
  const raw: string[] = Array.isArray(input)
    ? input.map((x) => String(x ?? ""))
    : String(input ?? "").split(/[,;\n\r]+/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const t = r.trim();
    if (!t) continue;
    const k = normalizeLot(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

// Comparison key for lot matching: case-insensitive, ignores spaces and dashes
// ("AB-1234 x" matches "ab1234X"). Display always keeps the original text.
export function normalizeLot(s: string): string {
  return String(s ?? "").toUpperCase().replace(/[\s\-_.]/g, "");
}

export interface RecallCaseForChecklist {
  affected_summary?: string | null;
  corrective_action?: string | null;
  vendor_response_sent_on?: string | null;
  vendor_response_not_required?: number | boolean | null;
  closeout_notified_at?: string | null;
  signoff_at?: string | null;
}

export interface ChecklistItem { key: string; label: string; done: boolean; }

const filled = (s: unknown) => typeof s === "string" && s.trim().length > 0;

// The closeout checklist. A case closes only when every item is done; the
// server enforces this on the close route, the page only mirrors it.
// vendorDocCount = vendor paperwork files attached to the case.
export function recallChecklist(c: RecallCaseForChecklist, vendorDocCount: number): ChecklistItem[] {
  const vendorNotRequired = !!Number(c.vendor_response_not_required || 0);
  return [
    { key: "affected", label: "What was affected is described", done: filled(c.affected_summary) },
    { key: "corrective_action", label: "Corrective action is described", done: filled(c.corrective_action) },
    { key: "vendor_response", label: "Vendor response sent (or marked not required)", done: vendorNotRequired || isYmd(c.vendor_response_sent_on) },
    { key: "vendor_paperwork", label: "Vendor paperwork attached (or marked not required)", done: vendorNotRequired || vendorDocCount > 0 },
    { key: "closeout_notice", label: "Notification list told what was done", done: filled(c.closeout_notified_at) },
    { key: "signoff", label: "Manager sign-off", done: filled(c.signoff_at) },
  ];
}

// Sign-off needs every item except itself; close needs all six.
export function readyForSignoff(items: ChecklistItem[]): boolean {
  return items.filter((i) => i.key !== "signoff").every((i) => i.done);
}
export function readyToClose(items: ChecklistItem[]): boolean {
  return items.every((i) => i.done);
}

// Overdue reminder cadence for an open case: the first day it is overdue, then
// every 3 days after the last reminder. daysOverdue = today - due_date.
export function decideOverdueReminder(daysOverdue: number, daysSinceLastReminder: number | null): boolean {
  if (!(daysOverdue >= 1)) return false;
  if (daysSinceLastReminder == null) return true;
  return daysSinceLastReminder >= 3;
}

export function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  return Math.round((Date.parse(toYmd + "T00:00:00Z") - Date.parse(fromYmd + "T00:00:00Z")) / 86400000);
}

// File name for a downloaded notice, manufacturer first so a shared drive
// sorts by vendor: Vendor_Product_RecallNo_YYYY-MM-DD.ext
export function noticeFilename(
  c: { vendor?: string | null; product?: string | null; recall_number?: string | null; notice_date?: string | null },
  originalFilename: string,
): string {
  const clean = (s: unknown) => String(s ?? "").trim().replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const ext = (/\.[A-Za-z0-9]{1,8}$/.exec(String(originalFilename || ""))?.[0] || "").toLowerCase();
  const parts = [clean(c.vendor) || "Vendor", clean(c.product), clean(c.recall_number), isYmd(c.notice_date) ? c.notice_date : ""].filter(Boolean);
  return parts.join("_") + ext;
}
