import { useState, useMemo } from "react";
import ExcelJS from "exceljs";

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
  | "created_at";

function formatDate(val: string | null): string {
  if (!val) return "";
  const d = new Date(val);
  if (isNaN(d.getTime())) return "";
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

function getExpires(u: UserRecord): string {
  return formatDate(u.plan_expires_at || u.subscription_expires_at);
}

function StatusBadge({ status }: { status: string }) {
  const s = (status || "").toLowerCase();
  let bg = "bg-gray-200 text-gray-700";
  if (s === "active") bg = "bg-green-100 text-green-800";
  else if (s === "canceled" || s === "past_due") bg = "bg-red-100 text-red-800";
  else if (s === "free") bg = "bg-gray-100 text-gray-600";
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${bg}`}>
      {status || "N/A"}
    </span>
  );
}

export default function AdminReportPage() {
  const [secret, setSecret] = useState("");
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Filters
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  async function fetchReport() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/report?secret=${encodeURIComponent(secret)}`);
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
    const ws = wb.addWorksheet("Customer Report");

    // Title row
    ws.mergeCells("A1:M1");
    const titleCell = ws.getCell("A1");
    titleCell.value = `VeritaAssure(TM) Customer Report - Generated: ${new Date().toLocaleString()}`;
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

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const today = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `veritaassure-customer-report-${today}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Login screen
  if (!data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-md p-8 max-w-sm w-full">
          <h1 className="text-xl font-bold mb-1">VeritaAssure(TM) Admin Report</h1>
          <p className="text-gray-500 text-sm mb-6">Enter admin secret to continue</p>
          {error && (
            <div className="bg-red-50 text-red-700 text-sm rounded px-3 py-2 mb-4">
              {error}
            </div>
          )}
          <input
            type="password"
            className="w-full border border-gray-300 rounded px-3 py-2 mb-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
    { label: "Joined", key: "created_at" },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">VeritaAssure(TM) Admin Report</h1>
          <p className="text-gray-500 text-sm">Customer account overview</p>
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
            className="border border-gray-300 rounded px-3 py-2 text-sm flex-1 min-w-[220px] focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="border border-gray-300 rounded px-3 py-2 text-sm"
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
            <option value="veritacheck_only">VeritaCheck Unlimited</option>
          </select>
          <select
            className="border border-gray-300 rounded px-3 py-2 text-sm"
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
          <div className="bg-white rounded-lg shadow-sm border p-4">
            <div className="text-sm text-gray-500">Total Accounts</div>
            <div className="text-2xl font-bold">{totalAccounts}</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border p-4">
            <div className="text-sm text-gray-500">Active Paid</div>
            <div className="text-2xl font-bold text-green-600">{activePaid}</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border p-4">
            <div className="text-sm text-gray-500">Free/Expired</div>
            <div className="text-2xl font-bold text-gray-500">{freeExpired}</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border p-4">
            <div className="text-sm text-gray-500">Total Seats</div>
            <div className="text-2xl font-bold text-blue-600">{totalSeats}</div>
          </div>
        </div>

        {/* Data table */}
        <div className="bg-white rounded-lg shadow-sm border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col.key)}
                    className="px-3 py-2 text-left font-medium text-gray-600 cursor-pointer hover:bg-gray-100 whitespace-nowrap select-none"
                  >
                    {col.label}
                    {sortIndicator(col.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((u, i) => (
                <tr
                  key={u.id}
                  className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}
                >
                  <td className="px-3 py-2 whitespace-nowrap">
                    {u.clia_lab_name || "Not set"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {u.clia_number || "Not on file"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {u.clia_director || u.name || ""}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{u.email}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{u.planDisplayName}</td>
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
                  <td className="px-3 py-2 whitespace-nowrap">
                    {formatDate(u.created_at)}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-3 py-8 text-center text-gray-400">
                    No users found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="text-xs text-gray-400 text-right">
          Generated: {data.generatedAt ? new Date(data.generatedAt).toLocaleString() : ""}
        </div>
      </div>
    </div>
  );
}
