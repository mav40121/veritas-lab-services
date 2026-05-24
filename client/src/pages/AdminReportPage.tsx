import { useState, useMemo, useEffect } from "react";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { applyLicenseToExcelJS } from "@/lib/licenseStamp";
import { getUser } from "@/lib/auth";

// Each row represents one (user, lab) combination. Users who own multiple
// labs (Lisa Veri's case) appear in multiple rows -- one per lab. Users with
// no labs (legacy pre-migration accounts and seat users) appear in one row
// with NULL lab fields; the UI falls back to the user-level clia_number /
// clia_lab_name in that case via effective_* fields. Parking-lot #14.
interface UserRecord {
  id: number;
  email: string;
  name: string;
  created_at: string;
  plan: string;
  subscription_status: string;
  subscription_expires_at: string | null;
  plan_expires_at: string | null;
  clia_number: string | null;
  clia_lab_name: string | null;
  clia_director: string | null;
  clia_address: string | null;
  clia_certificate_type: string | null;
  clia_tier: string | null;
  clia_specialty_count: number | null;
  seat_count: number;
  study_credits: number;
  stripe_customer_id: string | null;
  hipaa_acknowledged: number | null;
  hipaa_acknowledged_at: string | null;
  active_seats: number;
  pending_seats: number;
  planDisplayName: string;
  // Seat relationship fields
  seat_owner_id: number | null;
  seat_owner_name: string | null;
  seat_owner_email: string | null;
  seat_owner_lab_name: string | null;
  seat_owner_clia_number: string | null;
  // Activity fields
  last_login: string | null;
  session_count: number;
  study_count: number;
  audit_action_count: number;
  last_action_at: string | null;
  // Per-lab fields: present when the row joins to a labs record via an
  // active lab_members row; null for users with no active memberships
  // (legacy pre-Phase-3 accounts and seat users).
  lab_id: number | null;
  lab_clia_number: string | null;
  lab_name: string | null;
  accreditation_cap: number | null;
  accreditation_tjc: number | null;
  accreditation_cola: number | null;
  accreditation_aabb: number | null;
  lab_clia_locked: number | null;
  lab_name_locked: number | null;
  lab_created_at: string | null;
  // Membership fields (Multi-Lab Tier 2): role and primary flag on the
  // lab_members row that joined this user to this lab. A user with N active
  // memberships expands into N rows; non-primary rows are read-only to
  // avoid an admin clicking the plan dropdown on a secondary row and
  // unintentionally retargeting the user's primary lab.
  lab_role: string | null;
  is_primary_lab: number | null;
  // Effective identity computed server-side: lab fields when present, user
  // fields otherwise. Use these in the UI to render lab name + CLIA so a
  // multi-lab owner shows correctly per row.
  effective_clia_number: string | null;
  effective_lab_name: string | null;
}

interface ReportData {
  generatedAt: string;
  // New shape (parking-lot #14): one row per (user, lab) combination.
  totalLabs: number;
  labs: UserRecord[];
  // Backward-compatible aliases the server still emits during the rollout.
  totalUsers?: number;
  users?: UserRecord[];
}

type SortKey =
  | "clia_lab_name"
  | "clia_number"
  | "clia_director"
  | "email"
  | "planDisplayName"
  | "subscription_status"
  | "seat_count"
  | "active_seats"
  | "pending_seats"
  | "expires"
  | "clia_certificate_type"
  | "hipaa_acknowledged"
  | "last_login"
  | "session_count"
  | "audit_action_count"
  | "study_count"
  | "engagement"
  | "created_at";

// Engagement is computed: the most recent of last_login and last_action_at.
// Returns ISO string (most recent) or null if neither exists. Used to render
// the traffic-light dot and as a sortable signal for the Engagement column.
function mostRecentActivity(u: { last_login: string | null; last_action_at: string | null }): string | null {
  const a = u.last_login ? new Date(u.last_login).getTime() : 0;
  const b = u.last_action_at ? new Date(u.last_action_at).getTime() : 0;
  if (a === 0 && b === 0) return null;
  return new Date(Math.max(a, b)).toISOString();
}

function engagementBucket(iso: string | null): { color: string; label: string; days: number | null } {
  if (!iso) return { color: "bg-muted", label: "Never", days: null };
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 14) return { color: "bg-green-500", label: `${days}d ago`, days };
  if (days <= 30) return { color: "bg-amber-500", label: `${days}d ago`, days };
  return { color: "bg-red-500", label: `${days}d ago`, days };
}

function formatDate(val: string | null): string {
  if (!val) return "";
  const d = new Date(val);
  if (isNaN(d.getTime())) return "";
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

function formatRelative(val: string | null): string {
  if (!val) return "Never";
  const d = new Date(val);
  if (isNaN(d.getTime())) return "";
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function getExpires(u: UserRecord): string {
  return formatDate(u.plan_expires_at || u.subscription_expires_at);
}

function StatusBadge({ status }: { status: string }) {
  const s = (status || "").toLowerCase();
  let bg = "bg-muted text-muted-foreground";
  if (s === "active") bg = "bg-green-100 text-green-800";
  else if (s === "canceled" || s === "past_due") bg = "bg-red-100 text-red-800";
  else if (s === "free") bg = "bg-muted/60 text-muted-foreground";
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${bg}`}>
      {status || "N/A"}
    </span>
  );
}

const PLAN_OPTIONS = [
  { value: "free",            label: "Free" },
  { value: "per_study",       label: "Per Study" },
  { value: "clinic",          label: "Clinic ($499/yr - 2 seats)" },
  { value: "community",       label: "Community ($999/yr - 5 seats)" },
  { value: "hospital",        label: "Hospital ($1,999/yr - 15 seats)" },
  { value: "enterprise",      label: "Enterprise ($2,999/yr - 25 seats)" },
  { value: "waived",          label: "Waived" },
  { value: "large_hospital",  label: "Large Hospital" },
  { value: "veritacheck_only",label: "VeritaCheck™ Only" },
  { value: "lab",             label: "Lab" },
];

export default function AdminReportPage() {
  const [secret, setSecret] = useState("");
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [setPlanLoading, setSetPlanLoading] = useState<number | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  // When set, opens the per-user activity modal showing recent sessions +
  // recent audit-log entries. Click count in the Actions column to open.
  const [activityUserId, setActivityUserId] = useState<number | null>(null);

  // Collapse state per owner user_id. Owners with seats can be collapsed to
  // reduce visual noise. In-memory only (no localStorage); reset on reload.
  const [collapsedOwners, setCollapsedOwners] = useState<Set<number>>(() => new Set());
  function toggleOwnerCollapsed(ownerId: number) {
    setCollapsedOwners(prev => {
      const next = new Set(prev);
      if (next.has(ownerId)) next.delete(ownerId);
      else next.add(ownerId);
      return next;
    });
  }

  async function handleSetPlan(userId: number, plan: string) {
    setSetPlanLoading(userId);
    try {
      const res = await fetch("/api/admin/set-plan", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
        body: JSON.stringify({ userId, plan }),
      });
      const result = await res.json();
      if (!res.ok) { alert(result.error || "Failed to set plan"); return; }
      // Update local data. Mutate whichever shape the server returned (the
      // new `labs` field, the legacy `users` alias, or both for the
      // backward-compatible rollout window).
      if (data) {
        const updateRow = (u: UserRecord): UserRecord =>
          u.id === userId
            ? { ...u, plan: result.user.plan, seat_count: result.user.seatCount, planDisplayName: PLAN_OPTIONS.find(p => p.value === result.user.plan)?.label || result.user.plan }
            : u;
        setData({
          ...data,
          labs: data.labs ? data.labs.map(updateRow) : data.labs,
          users: data.users ? data.users.map(updateRow) : data.users,
        });
      }
    } catch { alert("Network error"); }
    finally { setSetPlanLoading(null); }
  }

  async function fetchReport() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/report`, { headers: { "x-admin-secret": secret } });
      if (res.status === 403) {
        setError("Invalid admin secret");
        setData(null);
        return;
      }
      if (!res.ok) {
        setError("Failed to load report");
        setData(null);
        return;
      }
      const json = await res.json();
      setData(json);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    if (!data) return [];
    // Prefer the new per-lab `labs` field; fall back to legacy `users` for
    // backward compatibility during the rollout.
    let rows = data.labs ?? data.users ?? [];

    if (search) {
      const q = search.toLowerCase();
      const matchesText = (u: UserRecord) =>
        (u.effective_lab_name || u.clia_lab_name || "").toLowerCase().includes(q) ||
        (u.email || "").toLowerCase().includes(q) ||
        (u.name || "").toLowerCase().includes(q) ||
        (u.effective_clia_number || u.clia_number || "").toLowerCase().includes(q);

      // Two-pass: first collect direct matches; then pull in the owner row
      // for any seat that matched, so the hierarchy stays intact when you
      // search for a seat name. Without this, searching "Daniela" would
      // surface her seat row but drop Michael's owner row, breaking nesting.
      const directMatches = rows.filter(matchesText);
      const ownerIdsToInclude = new Set<number>();
      for (const u of directMatches) {
        if (u.seat_owner_id) ownerIdsToInclude.add(u.seat_owner_id);
      }
      rows = rows.filter(u => matchesText(u) || ownerIdsToInclude.has(u.id));
    }

    if (planFilter) {
      rows = rows.filter((u) => u.plan === planFilter);
    }

    if (statusFilter) {
      rows = rows.filter(
        (u) => (u.subscription_status || "").toLowerCase() === statusFilter.toLowerCase()
      );
    }

    // Sort
    const sorted = [...rows].sort((a, b) => {
      let aVal: any;
      let bVal: any;

      if (sortKey === "expires") {
        aVal = a.plan_expires_at || a.subscription_expires_at || "";
        bVal = b.plan_expires_at || b.subscription_expires_at || "";
      } else if (sortKey === "engagement") {
        aVal = mostRecentActivity(a) || "";
        bVal = mostRecentActivity(b) || "";
      } else {
        aVal = (a as any)[sortKey];
        bVal = (b as any)[sortKey];
      }

      if (aVal == null) aVal = "";
      if (bVal == null) bVal = "";

      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }

      const strA = String(aVal).toLowerCase();
      const strB = String(bVal).toLowerCase();
      if (strA < strB) return sortDir === "asc" ? -1 : 1;
      if (strA > strB) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [data, search, planFilter, statusFilter, sortKey, sortDir]);

  // Group: owners first, then their seats nested underneath
  // Seat users are excluded from the top-level list and appended after their owner.
  // Multi-Lab Tier 2: a user with N active memberships appears in N owner rows
  // (one per lab). Seats only nest under that user's PRIMARY lab row (or the
  // first occurrence if no primary survives the active filter) so seats don't
  // duplicate across the user's secondary lab rows.
  // Precomputed: nested-seat count per owner user_id. Used to render the
  // chevron toggle + "(N seats)" indicator on owner rows. Derived from
  // the unfiltered seat list so the count is honest about how many seats
  // belong to the owner overall (not just those matching current search).
  const seatCountByOwner = useMemo(() => {
    const counts = new Map<number, number>();
    for (const u of filtered) {
      if (u.seat_owner_id) counts.set(u.seat_owner_id, (counts.get(u.seat_owner_id) || 0) + 1);
    }
    return counts;
  }, [filtered]);

  // Owner ids that currently have at least one nested seat. Used to drive
  // the Expand all / Collapse all buttons (they only act on owners that
  // actually have a chevron worth toggling).
  const ownersWithSeats = useMemo(() => {
    const ids = new Set<number>();
    for (const [ownerId, n] of seatCountByOwner) {
      if (n > 0) ids.add(ownerId);
    }
    return ids;
  }, [seatCountByOwner]);

  const grouped = useMemo(() => {
    const owners = filtered.filter(u => !u.seat_owner_id);
    const seats  = filtered.filter(u =>  u.seat_owner_id);
    const result: (UserRecord & { _isSeat?: boolean; _seatCount?: number })[] = [];
    const seatsAttachedFor = new Set<number>();
    for (const owner of owners) {
      const ownerSeatCount = seatCountByOwner.get(owner.id) || 0;
      result.push({ ...owner, _seatCount: ownerSeatCount });
      const ownerSeats = seats.filter(s => s.seat_owner_id === owner.id);
      const isPrimaryOrFirstForUser =
        (owner.is_primary_lab === 1) || (!seatsAttachedFor.has(owner.id) && !owners.some(o => o.id === owner.id && o.is_primary_lab === 1));
      const isCollapsed = collapsedOwners.has(owner.id);
      if (ownerSeats.length > 0 && isPrimaryOrFirstForUser && !isCollapsed) {
        for (const seat of ownerSeats) result.push({ ...seat, _isSeat: true });
        seatsAttachedFor.add(owner.id);
      } else if (ownerSeats.length > 0 && isPrimaryOrFirstForUser && isCollapsed) {
        // Mark the owner row as "attached" even when collapsed so secondary
        // membership rows for the same user don't try to host the seats.
        seatsAttachedFor.add(owner.id);
      }
    }
    // Any seat whose owner isn't in the filtered list (e.g. filtered out).
    // Orphan seats always render regardless of collapse state — collapse
    // only affects seats nested directly under a visible owner row.
    const orphanSeats = seats.filter(s => !owners.find(o => o.id === s.seat_owner_id));
    for (const seat of orphanSeats) result.push({ ...seat, _isSeat: true });
    return result;
  }, [filtered, collapsedOwners, seatCountByOwner]);

  // Summary stats
  const totalAccounts = filtered.length;
  const activePaid = filtered.filter(
    (u) => (u.subscription_status || "").toLowerCase() === "active" && u.plan !== "free"
  ).length;
  const freeExpired = filtered.filter(
    (u) =>
      u.plan === "free" ||
      (u.subscription_status || "").toLowerCase() === "canceled" ||
      (u.subscription_status || "").toLowerCase() === "past_due"
  ).length;
  const totalSeats = filtered.reduce((sum, u) => sum + (u.seat_count || 0), 0);

  // New summary tiles (PR 4): Trials expiring soon + Pending invites.
  // Trials = subscription_status='trialing' OR plan_expires_at within 7 days.
  // Pending invites = accounts with at least one pending_seats > 0.
  const TRIAL_HORIZON_DAYS = 7;
  const trialsExpiringSoon = useMemo(() => {
    const horizon = Date.now() + TRIAL_HORIZON_DAYS * 24 * 60 * 60 * 1000;
    const seen = new Set<number>();
    let n = 0;
    for (const u of filtered) {
      if (seen.has(u.id)) continue;
      const trialing = (u.subscription_status || "").toLowerCase() === "trialing";
      const exp = u.plan_expires_at || u.subscription_expires_at;
      const expSoon = exp ? new Date(exp).getTime() <= horizon : false;
      if (trialing || expSoon) {
        seen.add(u.id);
        n++;
      }
    }
    return n;
  }, [filtered]);
  const pendingInvitesCount = useMemo(() => {
    const seen = new Set<number>();
    let n = 0;
    for (const u of filtered) {
      if (seen.has(u.id)) continue;
      if ((u.pending_seats || 0) > 0) {
        seen.add(u.id);
        n += u.pending_seats || 0;
      }
    }
    return n;
  }, [filtered]);
  // Distinct accounts (dedupe by user.id across multi-lab rows).
  const distinctAccounts = useMemo(() => {
    const ids = new Set<number>();
    for (const u of filtered) ids.add(u.id);
    return ids.size;
  }, [filtered]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  }

  async function exportExcel() {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Perplexity Computer";
    wb.created = new Date();

    // ===== About sheet (sheet 1) =====
    const exportPwd = "veritaassure-admin-export";
    const aboutBorder: any = {
      top: { style: "thin", color: { argb: "FFD0D0D0" } },
      bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
      left: { style: "thin", color: { argb: "FFD0D0D0" } },
      right: { style: "thin", color: { argb: "FFD0D0D0" } },
    };
    const about = wb.addWorksheet("About");
    about.getColumn(1).width = 110;
    const aboutTitle = about.getCell("A1");
    aboutTitle.value = "VeritaAssure Admin \u2014 Customer Report";
    aboutTitle.font = { name: "Calibri", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
    aboutTitle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
    aboutTitle.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    about.getRow(1).height = 30;
    const aboutIdentity = about.getCell("A2");
    aboutIdentity.value = `Generated: ${new Date().toLocaleString()}    Internal Use Only \u2014 VeritaAssure / Veritas Lab Services`;
    aboutIdentity.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FF0A3A3D" } };
    aboutIdentity.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F2F2" } };
    aboutIdentity.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
    aboutIdentity.border = aboutBorder;
    about.getRow(2).height = 24;
    let aboutRow = 3;
    const aboutSection = (text: string) => {
      const c = about.getCell(`A${aboutRow}`);
      c.value = text;
      c.font = { name: "Calibri", bold: true, size: 12, color: { argb: "FF0A3A3D" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F2F2" } };
      c.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
      c.border = aboutBorder;
      about.getRow(aboutRow).height = 22; aboutRow += 1;
    };
    const aboutBody = (text: string) => {
      const c = about.getCell(`A${aboutRow}`);
      c.value = text;
      c.font = { name: "Calibri", size: 11, color: { argb: "FF28251D" } };
      c.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
      c.border = aboutBorder;
      const estLines = Math.max(1, Math.floor(text.length / 100) + 1);
      about.getRow(aboutRow).height = Math.max(20, estLines * 16); aboutRow += 1;
    };
    const aboutBlank = () => { about.getRow(aboutRow).height = 8; aboutRow += 1; };
    aboutSection("About this report");
    aboutBody("This workbook is the VeritaAssure platform Customer Report \u2014 a snapshot of every customer account on the VeritaAssure / Veritas Lab Services platform at the time of generation. It contains lab identity (CLIA lab name and CLIA number), primary contact and email, account type and subscription status, seat utilization (limit, active, pending), expiration date, CLIA certificate type, HIPAA acknowledgment status, last login, session count, study count, and account creation date. It is generated by VeritaAssure platform administrators for internal business operations \u2014 churn review, revenue forecasting, support outreach, and compliance audit response.");
    aboutBlank();
    aboutSection("How to use this workbook");
    aboutBody("The Customer Report tab is the data sheet. Rows reflect the filter applied at export time on the Admin Report page \u2014 if a search or status filter was active, only matching customers are included. The header row is row 2 (row 1 is the report title). Auto-fit column widths are sized to the longest value in each column up to a 40-character cap. Freeze pane locks rows 1-2 so the title and header stay visible while you scroll. There is no sheet auto-filter applied; filter the data set in the Admin Report UI before exporting, or apply Excel's Data > Filter after opening.");
    aboutBlank();
    aboutSection("Disclaimer \u2014 INTERNAL USE ONLY");
    aboutBody("This workbook is an INTERNAL VeritaAssure platform-administration report. It is NOT a deliverable for any customer, NOT a regulatory submission, and NOT a HIPAA-covered transaction record. It contains personally identifiable information (customer email addresses, contact names) and business-sensitive subscription data; do not email this file unencrypted, do not store it on shared or unmanaged drives, and do not distribute it outside Veritas Lab Services / VeritaAssure personnel with a documented business need. Numbers reflect what is in the platform database at export time and may lag real-time activity. CLIA numbers and CLIA lab names are self-reported by customers during onboarding and are not validated against the CMS CLIA registry by VeritaAssure. HIPAA Ack reflects whether the customer clicked the acknowledgment in the platform; it is not a substitute for a Business Associate Agreement and does not establish HIPAA compliance for either party. Any customer-facing decision (suspension, refund, contract change) must be supported by the underlying contractual record, not by this snapshot alone.");
    aboutBlank();
    aboutSection("Generated by");
    aboutBody(`This workbook was generated by an authenticated VeritaAssure platform administrator on ${new Date().toLocaleString()}. The export action is logged in the platform audit trail. The report title and "Internal Use Only" appear on every printed page header and footer.`);
    aboutBlank();
    aboutSection("Coverage gaps");
    aboutBody("If platform administration needs an additional column not represented here \u2014 for example, MRR, lifetime study volume, NPS score, or support ticket count \u2014 please open an internal request so it can be evaluated for inclusion in a future revision.");
    about.headerFooter.oddHeader = `&L&"Calibri,Regular"&10VeritaAssure Admin \u2014 Customer Report&R&"Calibri,Regular"&10INTERNAL USE ONLY`;
    about.headerFooter.oddFooter = `&L&"Calibri,Regular"&9VeritaAssure / Veritas Lab Services&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9INTERNAL USE ONLY`;
    await about.protect(exportPwd, {
      selectLockedCells: false, selectUnlockedCells: false,
      formatCells: false, formatColumns: false, formatRows: false,
      insertRows: false, insertColumns: false, insertHyperlinks: false,
      deleteRows: false, deleteColumns: false,
      sort: false, autoFilter: false, pivotTables: false,
    });

    const ws = wb.addWorksheet("Customer Report");

    // Title row
    ws.mergeCells("A1:M1");
    const titleCell = ws.getCell("A1");
    titleCell.value = `VeritaAssure™ Customer Report - Generated: ${new Date().toLocaleString()}`;
    titleCell.font = { bold: true, size: 13 };
    titleCell.alignment = { horizontal: "left" };

    // Headers
    const headers = [
      "Lab Name",
      "CLIA Number",
      "Primary Contact",
      "Email",
      "Account Type",
      "Status",
      "Seat Limit",
      "Active Seats",
      "Pending Seats",
      "Expires",
      "CLIA Cert Type",
      "HIPAA Ack",
      "Last Login",
      "Sessions",
      "Studies",
      "Joined",
    ];

    const headerRow = ws.addRow(headers);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1E40AF" },
      };
      cell.alignment = { horizontal: "center" };
    });

    // Data rows
    for (const u of filtered) {
      ws.addRow([
        u.effective_lab_name || u.clia_lab_name || "Not set",
        u.effective_clia_number || u.clia_number || "Not on file",
        u.clia_director || u.name || "",
        u.email,
        u.planDisplayName,
        u.subscription_status || "N/A",
        u.seat_count || 0,
        u.active_seats || 0,
        u.pending_seats || 0,
        getExpires(u),
        u.clia_certificate_type || "",
        u.hipaa_acknowledged ? "Yes" : "No",
        u.last_login ? formatRelative(u.last_login) : "Never",
        u.session_count || 0,
        u.audit_action_count || 0,
        u.study_count || 0,
        formatDate(u.created_at),
      ]);
    }

    // Auto-size columns
    ws.columns.forEach((col) => {
      let maxLen = 12;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const len = String(cell.value || "").length;
        if (len > maxLen) maxLen = len;
      });
      col.width = Math.min(maxLen + 2, 40);
    });

    // Freeze top rows (title + header)
    ws.views = [{ state: "frozen", ySplit: 2, xSplit: 0 }];

    // Page-setup header/footer carry the INTERNAL USE ONLY watermark on every printed page.
    ws.headerFooter.oddHeader = `&L&"Calibri,Regular"&10VeritaAssure Customer Report&R&"Calibri,Regular"&10INTERNAL USE ONLY`;
    ws.headerFooter.oddFooter = `&L&"Calibri,Regular"&9VeritaAssure / Veritas Lab Services&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9INTERNAL USE ONLY`;

    await ws.protect(exportPwd, {
      selectLockedCells: true, selectUnlockedCells: true,
      formatCells: false, formatColumns: false, formatRows: false,
      insertRows: false, insertColumns: false, insertHyperlinks: false,
      deleteRows: false, deleteColumns: false,
      sort: false, autoFilter: true, pivotTables: false,
    });

    // Workbook opens to the About sheet (sheet 1, activeTab 0).
    wb.views = [{ x: 0, y: 0, width: 10000, height: 20000,
                  firstSheet: 0, activeTab: 0, visibility: "visible" }];

    const u = getUser();
    applyLicenseToExcelJS(wb, {
      licensee: u?.cliaLabName || u?.name || u?.email || "Admin Console",
      email: u?.email || "anonymous",
      plan: u?.plan,
      issueDate: new Date().toISOString().slice(0, 10),
    });
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const today = new Date().toISOString().slice(0, 10);
    saveAs(blob, `veritaassure-customer-report-${today}.xlsx`);
  }

  // Login screen
  if (!data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="bg-card rounded-lg shadow-md p-8 max-w-sm w-full border border-border">
          <h1 className="text-xl font-bold mb-1">VeritaAssure™ Admin Report</h1>
          <p className="text-muted-foreground text-sm mb-6">Enter admin secret to continue</p>
          {error && (
            <div className="bg-red-50 text-red-700 text-sm rounded px-3 py-2 mb-4">
              {error}
            </div>
          )}
          <input
            type="password"
            className="w-full border border-border rounded px-3 py-2 mb-4 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Admin secret"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchReport()}
          />
          <button
            onClick={fetchReport}
            disabled={loading || !secret}
            className="w-full bg-blue-600 text-white rounded py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Loading..." : "Access Report"}
          </button>
        </div>
      </div>
    );
  }

  const columns: { label: string; key: SortKey }[] = [
    { label: "Lab Name", key: "clia_lab_name" },
    { label: "CLIA Number", key: "clia_number" },
    { label: "Primary Contact", key: "clia_director" },
    { label: "Email", key: "email" },
    { label: "Account Type", key: "planDisplayName" },
    { label: "Status", key: "subscription_status" },
    { label: "Seat Limit", key: "seat_count" },
    { label: "Active Seats", key: "active_seats" },
    { label: "Pending Seats", key: "pending_seats" },
    { label: "Expires", key: "expires" },
    { label: "CLIA Cert Type", key: "clia_certificate_type" },
    { label: "HIPAA Ack", key: "hipaa_acknowledged" },
    { label: "Engagement", key: "engagement" },
    { label: "Last Login", key: "last_login" },
    { label: "Sessions", key: "session_count" },
    { label: "Actions", key: "audit_action_count" },
    { label: "Studies", key: "study_count" },
    { label: "Joined", key: "created_at" },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">VeritaAssure™ Admin Report</h1>
          <p className="text-muted-foreground text-sm">Customer account overview</p>
        </div>
        <button
          onClick={exportExcel}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700"
        >
          Export to Excel
        </button>
      </div>

      <div className="px-6 py-4 space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[220px] relative">
            <input
              type="text"
              placeholder="Search lab name, email, name, CLIA number..."
              className="border border-border rounded px-3 py-2 pr-8 text-sm bg-background text-foreground w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-lg leading-none"
                title="Clear search"
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>
          <select
            className="border border-border rounded px-3 py-2 text-sm bg-background text-foreground"
            value={planFilter}
            onChange={(e) => setPlanFilter(e.target.value)}
          >
            <option value="">All Plans</option>
            <option value="free">Free</option>
            <option value="per_study">Per Study</option>
            <option value="waived">Waived</option>
            <option value="community">Community</option>
            <option value="hospital">Hospital</option>
            <option value="large_hospital">Large Hospital</option>
            <option value="veritacheck_only">VeritaCheck™ Unlimited</option>
          </select>
          <select
            className="border border-border rounded px-3 py-2 text-sm bg-background text-foreground"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="free">Free</option>
            <option value="past_due">Past Due</option>
            <option value="canceled">Canceled</option>
          </select>
          {ownersWithSeats.size > 0 && (
            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={() => setCollapsedOwners(new Set(ownersWithSeats))}
                className="border border-border rounded px-3 py-2 text-sm bg-background text-foreground hover:bg-muted"
                title="Collapse all owners that have nested seats"
              >
                Collapse all
              </button>
              <button
                type="button"
                onClick={() => setCollapsedOwners(new Set())}
                className="border border-border rounded px-3 py-2 text-sm bg-background text-foreground hover:bg-muted"
                title="Expand all owner groups"
              >
                Expand all
              </button>
            </div>
          )}
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          <div className="bg-card rounded-lg shadow-sm border border-border p-4">
            <div className="text-sm text-muted-foreground">Total Accounts</div>
            <div className="text-2xl font-bold">{distinctAccounts}</div>
            <div className="text-xs text-muted-foreground mt-1">{totalAccounts} rows shown</div>
          </div>
          <div className="bg-card rounded-lg shadow-sm border border-border p-4">
            <div className="text-sm text-muted-foreground">Active Paid</div>
            <div className="text-2xl font-bold text-green-600">{activePaid}</div>
          </div>
          <div className="bg-card rounded-lg shadow-sm border border-border p-4">
            <div className="text-sm text-muted-foreground">Free/Expired</div>
            <div className="text-2xl font-bold text-muted-foreground">{freeExpired}</div>
          </div>
          <div className="bg-card rounded-lg shadow-sm border border-border p-4">
            <div className="text-sm text-muted-foreground">Total Seats</div>
            <div className="text-2xl font-bold text-blue-600">{totalSeats}</div>
          </div>
          <div className="bg-card rounded-lg shadow-sm border border-border p-4">
            <div className="text-sm text-muted-foreground" title="Subscription trialing OR plan expires within 7 days">Trials Expiring ≤7d</div>
            <div className={`text-2xl font-bold ${trialsExpiringSoon > 0 ? "text-amber-600" : "text-muted-foreground"}`}>{trialsExpiringSoon}</div>
          </div>
          <div className="bg-card rounded-lg shadow-sm border border-border p-4">
            <div className="text-sm text-muted-foreground" title="Seat invites that haven't been accepted yet">Pending Invites</div>
            <div className={`text-2xl font-bold ${pendingInvitesCount > 0 ? "text-blue-600" : "text-muted-foreground"}`}>{pendingInvitesCount}</div>
          </div>
        </div>

        {/* Data table */}
        <div
          className="bg-card rounded-lg shadow-sm border border-border overflow-scroll admin-table-scroll"
          style={{ maxWidth: '100%', maxHeight: 'calc(100vh - 280px)', scrollbarWidth: 'thin', scrollbarColor: '#555 transparent' }}
        >
          <table className="w-max min-w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b bg-muted">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col.key)}
                    className="px-3 py-2 text-left font-semibold text-foreground cursor-pointer hover:bg-muted whitespace-nowrap select-none"
                  >
                    {col.label}
                    {sortIndicator(col.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grouped.map((u, i) => {
                const isSecondaryMembership = u.lab_id != null && u.is_primary_lab !== 1 && !u._isSeat;
                return (
                <tr
                  key={`${u.id}-${u.lab_id != null ? `lab-${u.lab_id}` : 'nolab'}-${u._isSeat ? 'seat' : 'owner'}`}
                  className={`text-foreground ${
                    u._isSeat
                      ? "bg-blue-50/40 dark:bg-blue-950/20 border-l-4 border-l-blue-400"
                      : isSecondaryMembership
                      ? "bg-amber-50/30 dark:bg-amber-950/10 border-l-4 border-l-amber-400"
                      : i % 2 === 0 ? "bg-background" : "bg-muted/30"
                  }`}
                >
                  <td className="px-3 py-2 whitespace-nowrap">
                    {u._isSeat && <span className="inline-block w-4" />}
                    {!u._isSeat && ((u as any)._seatCount ?? 0) > 0 && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleOwnerCollapsed(u.id); }}
                        className="inline-flex items-center justify-center w-4 h-4 mr-1 text-muted-foreground hover:text-foreground"
                        title={collapsedOwners.has(u.id) ? "Expand seats" : "Collapse seats"}
                        aria-label={collapsedOwners.has(u.id) ? "Expand seats" : "Collapse seats"}
                      >
                        <span style={{ display: "inline-block", transform: collapsedOwners.has(u.id) ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 120ms" }}>▾</span>
                      </button>
                    )}
                    <span className="font-medium">
                      {u.seat_owner_id
                        ? (u.effective_lab_name || u.clia_lab_name || u.seat_owner_lab_name || u.seat_owner_name || u.seat_owner_email)
                        : (u.effective_lab_name || u.clia_lab_name || <span className="text-muted-foreground font-normal">Not set</span>)
                      }
                    </span>
                    {!u._isSeat && collapsedOwners.has(u.id) && ((u as any)._seatCount ?? 0) > 0 && (
                      <span className="ml-2 text-xs text-muted-foreground">({(u as any)._seatCount} seat{(u as any)._seatCount === 1 ? "" : "s"} hidden)</span>
                    )}
                    {isSecondaryMembership && (
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700" title={`This user has an additional ${u.lab_role || 'member'} role on this lab. Their primary lab is shown elsewhere.`}>
                        Secondary lab ({u.lab_role || 'member'})
                      </span>
                    )}
                    {!u._isSeat && !isSecondaryMembership && u.seat_count > 0 && (
                      <span className={`ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                        u.active_seats >= u.seat_count
                          ? "bg-red-100 text-red-700"
                          : u.active_seats > 0
                          ? "bg-blue-100 text-blue-700"
                          : "bg-muted text-muted-foreground"
                      }`}>
                        {u.active_seats} of {u.seat_count} seats used
                      </span>
                    )}
                    {u._isSeat && (
                      <div className="text-xs text-blue-500 mt-0.5 ml-4">
                        Seat under: {u.seat_owner_lab_name || u.seat_owner_name}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {u.seat_owner_id
                      ? (u.seat_owner_clia_number || <span className="text-muted-foreground">Not on file</span>)
                      : (u.effective_clia_number || u.clia_number || <span className="text-muted-foreground">Not on file</span>)
                    }
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {u.clia_director || u.name || ""}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{u.email}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {u.seat_owner_id ? (
                      <span className="text-xs font-medium text-blue-500">Seat</span>
                    ) : isSecondaryMembership ? (
                      <span className="text-xs text-muted-foreground" title="Plan is set on the user's primary lab. Edit it from the primary row.">
                        {u.planDisplayName}
                      </span>
                    ) : (
                      <>
                        <select
                          value={u.plan || "free"}
                          disabled={setPlanLoading === u.id}
                          onChange={e => handleSetPlan(u.id, e.target.value)}
                          className="text-xs border rounded px-1.5 py-1 bg-background cursor-pointer"
                          title={u.planDisplayName}
                        >
                          {PLAN_OPTIONS.map(p => (
                            <option key={p.value} value={p.value}>{p.label}</option>
                          ))}
                        </select>
                        {setPlanLoading === u.id && <span className="ml-1 text-xs text-muted-foreground">Saving...</span>}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <StatusBadge status={u.subscription_status} />
                  </td>
                  <td className="px-3 py-2 text-center">{u.seat_count || 0}</td>
                  <td className="px-3 py-2 text-center">{u.active_seats || 0}</td>
                  <td className="px-3 py-2 text-center">{u.pending_seats || 0}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{getExpires(u)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {u.clia_certificate_type || ""}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {u.hipaa_acknowledged ? "Yes" : "No"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">
                    {(() => {
                      const recent = mostRecentActivity(u);
                      const b = engagementBucket(recent);
                      return (
                        <span
                          className="inline-flex items-center gap-1.5"
                          title={recent
                            ? `Last activity ${new Date(recent).toLocaleString()} (last_login: ${u.last_login || "never"}, last_action: ${u.last_action_at || "never"})`
                            : "No login or audit activity recorded"}
                        >
                          <span className={`inline-block w-2 h-2 rounded-full ${b.color}`} />
                          <span className={b.days === null ? "text-muted-foreground" : ""}>{b.label}</span>
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">
                    {u.last_login ? formatRelative(u.last_login) : <span className="text-muted-foreground">Never</span>}
                  </td>
                  <td className="px-3 py-2 text-center">{u.session_count || 0}</td>
                  <td className="px-3 py-2 text-center">
                    <button
                      type="button"
                      className="font-medium hover:underline text-primary disabled:text-muted-foreground disabled:no-underline disabled:cursor-default"
                      disabled={(u.audit_action_count || 0) === 0}
                      onClick={() => setActivityUserId(u.id)}
                      title={u.last_action_at ? `Last action ${formatRelative(u.last_action_at)}` : "No actions recorded"}
                    >
                      {u.audit_action_count || 0}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-center">{u.study_count || 0}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {formatDate(u.created_at)}
                  </td>
                </tr>
                );
              })}
              {grouped.length === 0 && (
                <tr>
                  <td colSpan={18} className="px-3 py-8 text-center text-muted-foreground">
                    No users found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="text-xs text-muted-foreground text-right">
          Generated: {data.generatedAt ? new Date(data.generatedAt).toLocaleString() : ""}
        </div>

        {/* Audit Log Viewer */}
        <AuditLogPanel secret={secret} />

        {/* Per-user engagement modal. Opens when the operator clicks an
            "Actions" count cell in the report table above. The state lives
            in this top-level component because the modal sits outside the
            AuditLogPanel sub-tree. */}
        {activityUserId !== null && (
          <UserActivityModal
            userId={activityUserId}
            secret={secret}
            onClose={() => setActivityUserId(null)}
          />
        )}
      </div>
    </div>
  );
}

function AuditLogPanel({ secret }: { secret: string }) {
  const [userId, setUserId] = useState("");
  const [module, setModule] = useState("");
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [expanded, setExpanded] = useState(false);

  async function fetchAuditLog() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (userId) params.set("userId", userId);
      if (module) params.set("module", module);
      const res = await fetch(`/api/admin/audit-log?${params}`, { headers: { "x-admin-secret": secret } });
      const d = await res.json();
      setEntries(d.entries || []);

      if (userId) {
        const snapRes = await fetch(`/api/admin/snapshots?userId=${userId}`, { headers: { "x-admin-secret": secret } });
        const snapData = await snapRes.json();
        setSnapshots(snapData.snapshots || []);
      }
    } catch { setEntries([]); }
    setLoading(false);
  }

  async function triggerSnapshot() {
    await fetch(`/api/admin/run-snapshot`, { method: "POST", headers: { "x-admin-secret": secret } });
    alert("Snapshot triggered for all paid users.");
  }

  return (
    <div className="mt-8 border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-muted text-sm font-semibold text-left text-foreground"
        onClick={() => setExpanded(e => !e)}
      >
        Audit Log + Snapshots
        <span className="text-xs text-muted-foreground">{expanded ? "Hide" : "Show"}</span>
      </button>

      {expanded && (
        <div className="p-4 space-y-4">
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">User ID (optional)</label>
              <input value={userId} onChange={e => setUserId(e.target.value)} placeholder="e.g. 15" className="border rounded px-2 py-1 text-sm w-28" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Module (optional)</label>
              <select value={module} onChange={e => setModule(e.target.value)} className="border rounded px-2 py-1 text-sm">
                <option value="">All</option>
                <option value="veritamap">VeritaMap™</option>
                <option value="veritascan">VeritaScan™</option>
                <option value="veritacomp">VeritaComp™</option>
                <option value="veritastaff">VeritaStaff™</option>
                <option value="veritalab">VeritaLab™</option>
                <option value="veritacheck">VeritaCheck™</option>
              </select>
            </div>
            <button onClick={fetchAuditLog} disabled={loading} className="bg-primary text-white text-sm px-3 py-1.5 rounded hover:bg-primary/90">
              {loading ? "Loading..." : "Fetch Log"}
            </button>
            <button onClick={triggerSnapshot} className="bg-amber-600 text-white text-sm px-3 py-1.5 rounded hover:bg-amber-700">
              Run Snapshot Now
            </button>
          </div>

          {snapshots.length > 0 && (
            <div className="bg-blue-50 rounded p-3">
              <p className="text-xs font-semibold text-blue-800 mb-2">Available Snapshots for User {userId}</p>
              <div className="flex flex-wrap gap-2">
                {snapshots.map((s: any) => (
                  <button key={s.id}
                    onClick={async () => {
                      const res = await fetch(`/api/admin/snapshots/${s.id}`, { headers: { "x-admin-secret": secret } });
                      const data = await res.json();
                      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                      const url = URL.createObjectURL(blob);
                      window.open(url, "_blank");
                    }}
                    className="text-xs bg-background border border-blue-200 rounded px-2 py-1 text-blue-700 hover:bg-blue-100 cursor-pointer">
                    {s.snapshot_date} ({Math.round(s.size_bytes / 1024)}KB)
                  </button>
                ))}
              </div>
            </div>
          )}

          {entries.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-muted">
                    <th className="px-2 py-1.5 text-left border">Time</th>
                    <th className="px-2 py-1.5 text-left border">User</th>
                    <th className="px-2 py-1.5 text-left border">Module</th>
                    <th className="px-2 py-1.5 text-left border">Action</th>
                    <th className="px-2 py-1.5 text-left border">Entity</th>
                    <th className="px-2 py-1.5 text-left border">Label</th>
                    <th className="px-2 py-1.5 text-left border">Before (size)</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e: any) => (
                    <tr key={e.id} className={`border-b ${
                      e.action === "delete" ? "bg-red-50" :
                      e.action === "restore" ? "bg-green-50" : ""
                    }`}>
                      <td className="px-2 py-1 border whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td>
                      <td className="px-2 py-1 border">{e.owner_user_id}</td>
                      <td className="px-2 py-1 border">{e.module}</td>
                      <td className="px-2 py-1 border font-semibold">{e.action}</td>
                      <td className="px-2 py-1 border">{e.entity_type}</td>
                      <td className="px-2 py-1 border max-w-[200px] truncate">{e.entity_label}</td>
                      <td className="px-2 py-1 border text-muted-foreground">{e.before_json ? `${Math.round(e.before_json.length / 1024 * 10) / 10}KB` : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : entries.length === 0 && !loading ? (
            <p className="text-sm text-muted-foreground">No entries. Click Fetch Log to load.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ── Per-user engagement detail modal ──────────────────────────────────
//
// Opens from the Actions column in the main table. Shows the latest
// sessions and audit-log entries for one user so the operator can tell
// the difference between "logged in once and left" and "actively using
// the platform."

interface UserActivityResponse {
  user: { id: number; email: string; name: string | null; created_at: string };
  summary: {
    session_count: number;
    last_session_at: string | null;
    audit_action_count: number;
    last_action_at: string | null;
  };
  sessions: Array<{ id: number; created_at: string; last_active: string; is_active: number; device_info: string | null }>;
  audit: Array<{ id: number; module: string; action: string; entity_type: string; entity_label: string | null; entity_id: string | null; ip_address: string | null; created_at: string }>;
}

function UserActivityModal({ userId, secret, onClose }: { userId: number; secret: string; onClose: () => void }) {
  const [data, setData] = useState<UserActivityResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/users/${userId}/activity`, { headers: { "x-admin-secret": secret } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (e: any) {
        if (!cancelled) setErr(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, secret]);

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto" onClick={onClose}>
      <div className="bg-background border border-border rounded-lg shadow-lg max-w-3xl w-full my-8 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-border flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">User Activity</h2>
            {data && (
              <p className="text-xs text-muted-foreground">
                {data.user.name || data.user.email} &middot; user id {data.user.id} &middot; joined {new Date(data.user.created_at).toLocaleDateString()}
              </p>
            )}
          </div>
          <button className="text-muted-foreground hover:text-foreground" onClick={onClose}>x</button>
        </div>
        <div className="p-4 space-y-4">
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : err ? (
            <div className="text-sm text-destructive">{err}</div>
          ) : data ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="rounded-md border border-border p-2">
                  <div className="text-muted-foreground">Sessions</div>
                  <div className="text-base font-semibold">{data.summary.session_count}</div>
                </div>
                <div className="rounded-md border border-border p-2">
                  <div className="text-muted-foreground">Last login</div>
                  <div className="text-base font-semibold">{data.summary.last_session_at ? new Date(data.summary.last_session_at).toLocaleString() : "Never"}</div>
                </div>
                <div className="rounded-md border border-border p-2">
                  <div className="text-muted-foreground">Audit actions</div>
                  <div className="text-base font-semibold">{data.summary.audit_action_count}</div>
                </div>
                <div className="rounded-md border border-border p-2">
                  <div className="text-muted-foreground">Last action</div>
                  <div className="text-base font-semibold">{data.summary.last_action_at ? new Date(data.summary.last_action_at).toLocaleString() : "None"}</div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-2">Recent actions ({data.audit.length})</h3>
                {data.audit.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No audit entries. User has logged in but not created, edited, or deleted anything.</p>
                ) : (
                  <div className="border border-border rounded-md overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-muted">
                        <tr className="text-left">
                          <th className="px-2 py-1">When</th>
                          <th className="px-2 py-1">Module</th>
                          <th className="px-2 py-1">Action</th>
                          <th className="px-2 py-1">Entity</th>
                          <th className="px-2 py-1">Label</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.audit.map(a => (
                          <tr key={a.id} className="border-t border-border">
                            <td className="px-2 py-1 whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</td>
                            <td className="px-2 py-1">{a.module}</td>
                            <td className="px-2 py-1">{a.action}</td>
                            <td className="px-2 py-1">{a.entity_type}{a.entity_id ? ` #${a.entity_id}` : ""}</td>
                            <td className="px-2 py-1 truncate max-w-[200px]" title={a.entity_label || ""}>{a.entity_label || ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-2">Recent sessions ({data.sessions.length})</h3>
                {data.sessions.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No sessions on record.</p>
                ) : (
                  <div className="border border-border rounded-md overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-muted">
                        <tr className="text-left">
                          <th className="px-2 py-1">Started</th>
                          <th className="px-2 py-1">Last active</th>
                          <th className="px-2 py-1">Active?</th>
                          <th className="px-2 py-1">Device</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.sessions.map(s => (
                          <tr key={s.id} className="border-t border-border">
                            <td className="px-2 py-1 whitespace-nowrap">{new Date(s.created_at).toLocaleString()}</td>
                            <td className="px-2 py-1 whitespace-nowrap">{new Date(s.last_active).toLocaleString()}</td>
                            <td className="px-2 py-1">{s.is_active ? "Yes" : "No"}</td>
                            <td className="px-2 py-1 truncate max-w-[280px]" title={s.device_info || ""}>{(s.device_info || "").slice(0, 80)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
