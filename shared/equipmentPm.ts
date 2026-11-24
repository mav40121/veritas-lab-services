// shared/equipmentPm.ts
//
// VeritaMaintain equipment rules (B9, 2026-11-24), shared by the server (server/equipment.ts) and the page
// (client/src/pages/EquipmentAppPage.tsx) so the preview a person sees before saving is what the server does. Pure: no database
// and no clock. scripts/verify-equipment-pm-rules.mts exercises every branch.
//
// The PM due date: only an event that completes PM moves it, and never to an earlier date unless the person says so. Before, any
// repair, service, calibration or function check moved it, and a backdated entry could move it earlier.

export const EQUIP_EVENT_TYPES = ["calibration", "preventive_maintenance", "service", "repair", "function_check", "troubleshooting", "solution_change"] as const;
export type EquipEventType = (typeof EQUIP_EVENT_TYPES)[number];

export const EQUIP_EVENT_LABEL: Record<string, string> = {
  calibration: "Calibration",
  preventive_maintenance: "Preventive maintenance",
  pm: "Preventive maintenance",
  service: "Service",
  repair: "Repair",
  function_check: "Function check",
  troubleshooting: "Troubleshooting",
  solution_change: "Solution change",
  // Lines a moved instrument brings along from the other lab's stain log. Never logged by hand.
  stain_log: "Stain log",
};

/** Troubleshooting and a solution change are records, not maintenance: they never complete PM. */
export const canCompletePm = (eventType: string): boolean => eventType !== "troubleshooting" && eventType !== "solution_change" && eventType !== "stain_log";

/** What "Completes PM" starts as: yes on preventive maintenance, no on everything else until the person says so. */
export const completesPmByDefault = (eventType: string): boolean => eventType === "preventive_maintenance";

export const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// What a completed schedule, the PM included, does to its due date (shared/equipmentSchedules.ts planScheduleDue works it out).
export interface PmDuePlan {
  /** The date this event works out to, or null when there is nothing to work it out from. */
  computed: string | null;
  /** True when the due date becomes `computed`. */
  move: boolean;
  /** Set when `computed` is earlier than the due date on file and the person didn't say to move it back. */
  held: { keeps: string; works_out_to: string } | null;
}

// ── Files ──────────────────────────────────────────────────────────────────────────────────────────────

export const EQUIP_FILE_KINDS = [
  { value: "vendor_report", label: "Vendor report" },
  { value: "service_report", label: "Service report" },
  { value: "calibration_certificate", label: "Calibration certificate" },
  { value: "pm_checklist", label: "PM checklist" },
  { value: "ifu", label: "IFU" },
  { value: "other", label: "Other" },
] as const;
export const EQUIP_FILE_KIND_LABEL: Record<string, string> = Object.fromEntries(EQUIP_FILE_KINDS.map((k) => [k.value, k.label]));
export const EQUIP_FILE_MAX_MB = 20;
export const EQUIP_FILE_TYPES = "PDF, Word (DOCX), Excel (XLSX or XLS), image (PNG or JPG) or text (TXT)";
export const EQUIP_FILE_ACCEPT = ".pdf,.docx,.xlsx,.xls,.png,.jpg,.jpeg,.txt";

// ── Out of service ─────────────────────────────────────────────────────────────────────────────────────
// A period's start and stop are the lab's own wall clock, "YYYY-MM-DDTHH:MM", as the person typed them.

export const isLocalMinute = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(v) && !Number.isNaN(Date.parse(`${v}:00Z`))
  && new Date(`${v}:00Z`).toISOString().slice(0, 16) === v;

/** Whole minutes between two wall-clock moments, never negative. */
export const minutesBetween = (from: string, until: string): number => Math.max(0, Math.round((Date.parse(`${until}:00Z`) - Date.parse(`${from}:00Z`)) / 60000));

/** "45 min", "3 h 5 min", "2 d 4 h". */
export function durationLabel(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), min = m % 60;
  if (d) return h ? `${d} d ${h} h` : `${d} d`;
  if (h) return min ? `${h} h ${min} min` : `${h} h`;
  return `${min} min`;
}

/** How much of a period falls inside a month; an open one counts up to now. */
export function minutesInMonth(p: { down_from: string; down_until?: string | null }, month: string, nowLocal: string): number {
  const first = `${month}-01T00:00`;
  const [y, mo] = month.split("-").map(Number);
  const next = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 16);
  const from = p.down_from > first ? p.down_from : first;
  const end = p.down_until || nowLocal;
  const until = end < next ? end : next;
  return until > from ? minutesBetween(from, until) : 0;
}

/** True when the instrument was out of service for the whole of that day. */
export function outAllDay(periods: { down_from: string; down_until?: string | null }[], day: string): boolean {
  const start = `${day}T00:00`, end = `${addDays(day, 1)}T00:00`;
  return periods.some((p) => p.down_from <= start && (!p.down_until || p.down_until >= end));
}
