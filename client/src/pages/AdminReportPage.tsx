import { useState, useMemo } from "react";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { applyLicenseToExcelJS } from "@/lib/licenseStamp";
import { getUser } from "@/lib/auth";

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
}

interface ReportData {
  generatedAt: string;
  totalUsers: number;
  users: UserRecord[];
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
  | "study_count"
  | "created_at";

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
      // Update local data
      if (data) {
        setData({
          ...data,
          users: data.users.map(u =>
            u.id === userId
              ? { ...u, plan: result.user.plan, seat_count: result.user.seatCount, planDisplayName: PLAN_OPTIONS.find(p => p.value === result.user.plan)?.label || result.user.plan }
              : u
          ),
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
    let rows = data.users;

    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (u) =>
          (u.clia_lab_name || "").toLowerCase().includes(q) ||
          (u.email || "").toLowerCase().includes(q) ||
          (u.name || "").toLowerCase().includes(q) ||
          (u.clia_number || "").toLowerCase().includes(q)
      );
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
  // Seat users are excluded from the top-level list and appended after their owner
  const grouped = useMemo(() => {
    const owners = filtered.filter(u => !u.seat_owner_id);
    const seats  = filtered.filter(u =>  u.seat_owner_id);
    const result: (UserRecord & { _isSeat?: boolean })[] = [];
    for (const owner of owners) {
      result.push(owner);
      const ownerSeats = seats.filter(s => s.seat_owner_id === owner.id);
      for (const seat of ownerSeats) {
        result.push({ ...seat, _isSeat: true });
      }
    }
    // Any seat whose owner isn't in the filtered list (e.g. filtered out)
    const orphanSeats = seats.filter(s => !owners.find(o => o.id === s.seat_owner_id));
    for (const seat of orphanSeats) result.push({ ...seat, _isSeat: true });
    return result;
  }, [filtered]);

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
        u.clia_lab_name || "Not set",
        u.clia_number || "Not on file",
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
    { label: "Last Login", key: "last_login" },
    { label: "Sessions", key: "session_count" },
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
          <input
            type="text"
            placeholder="Search lab name, email, name, CLIA number..."
            className="border border-border rounded px-3 py-2 text-sm bg-background text-foreground flex-1 min-w-[220px] focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
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
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-card rounded-lg shadow-sm border border-border p-4">
            <div className="text-sm text-muted-foreground">Total Accounts</div>
            <div className="text-2xl font-bold">{totalAccounts}</div>
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
              {grouped.map((u, i) => (
                <tr
                  key={u.id}
                  className={`text-foreground ${
                    u._isSeat
                      ? "bg-blue-50/40 dark:bg-blue-950/20 border-l-4 border-l-blue-400"
                      : i % 2 === 0 ? "bg-background" : "bg-muted/30"
                  }`}
                >
                  <td className="px-3 py-2 whitespace-nowrap">
                    {u._isSeat && <span className="inline-block w-4" />}
                    <span className="font-medium">
                      {u.seat_owner_id
                        ? (u.clia_lab_name || u.seat_owner_lab_name || u.seat_owner_name || u.seat_owner_email)
                        : (u.clia_lab_name || <span className="text-muted-foreground font-normal">Not set</span>)
                      }
                    </span>
                    {!u._isSeat && u.seat_count > 0 && (
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
                      : (u.clia_number || <span className="text-muted-foreground">Not on file</span>)
                    }
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {u.clia_director || u.name || ""}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{u.email}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {u.seat_owner_id ? (
                      <span className="text-xs font-medium text-blue-500">Seat</span>
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
                    {u.last_login ? formatRelative(u.last_login) : <span className="text-muted-foreground">Never</span>}
                  </td>
                  <td className="px-3 py-2 text-center">{u.session_count || 0}</td>
                  <td className="px-3 py-2 text-center">{u.study_count || 0}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {formatDate(u.created_at)}
                  </td>
                </tr>
              ))}
              {grouped.length === 0 && (
                <tr>
                  <td colSpan={16} className="px-3 py-8 text-center text-muted-foreground">
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
