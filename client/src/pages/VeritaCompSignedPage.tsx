// client/src/pages/VeritaCompSignedPage.tsx
//
// "Signed competencies" (Michael 2026-11-02: "an easy way to see 'completed' competencies to see supporting
// documentation"): every signed competency in the lab, newest first, filterable by person or method, department,
// competency and date. Each row opens the person's page on that method with the sign-off's entries showing
// (?method=&signoff=, MethodSignOffPanel openSignoffId). Read-only.
//   GET /api/labs/:labId/competency/signoffs
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { MILESTONE_LABEL, type MethodMilestone } from "@shared/competencySignoff";
import { fmtDate } from "@/lib/competencyElements";
import { useStaffOwnScope } from "@/hooks/useStaffLogin";
import { labDayOf } from "@/lib/labDate";

interface SignedRow {
  employeeId: number; employeeName: string; employeeTitle: string | null;
  instrumentId: number; methodName: string; department: string | null; complexity: string;
  groupMembers: Array<{ id: number; name: string }> | null;
  signoffId: number | null; legacy: boolean; imported: boolean; importedFrom: string | null;
  milestone: MethodMilestone | null; signedDate: string | null; signerName: string | null; signerRole: string | null;
  determination: "pass" | "fail" | "remediation"; hasEntries: boolean;
}

const ROLE_ABBR: Record<string, string> = { LD: "LD", TC: "TC", TS: "TS", GS: "GS" };
const RESULT: Record<string, { label: string; cls: string }> = {
  pass: { label: "Pass", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  fail: { label: "Fail", cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  remediation: { label: "Remediation", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
};
const selectCls = "h-8 text-xs rounded-md border bg-background px-2";

export default function VeritaCompSignedPage() {
  const activeLabId = useActiveLabId();
  const { ownOnly } = useStaffOwnScope(); // Michael Q182 = 1: a Staff login's list holds only their own
  const url = activeLabId ? `/api/labs/${activeLabId}/competency/signoffs` : null;
  const { data, isLoading, error } = useQuery<{ signoffs: SignedRow[] }>({
    queryKey: [url ?? "no-lab"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}${url}`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`Failed to load (${r.status})`);
      return r.json();
    },
    enabled: !!url,
  });
  const labRoute = (p: string) => (activeLabId ? `/labs/${activeLabId}${p}` : p);
  const rows = data?.signoffs || [];
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [milestone, setMilestone] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const depts = useMemo(() => Array.from(new Set(rows.map((r) => r.department || "Other"))).sort(), [rows]);
  const shown = rows.filter((r) => {
    const needle = q.trim().toLowerCase();
    if (needle && !`${r.employeeName} ${r.methodName}`.toLowerCase().includes(needle)) return false;
    if (dept && (r.department || "Other") !== dept) return false;
    if (milestone && r.milestone !== milestone) return false;
    const d = labDayOf(r.signedDate);
    if (from && (!d || d < from)) return false;
    if (to && (!d || d > to)) return false;
    return true;
  });
  const filtered = shown.length !== rows.length;

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
      <Link href={labRoute("/veritacomp-app")} className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1">
        <ChevronLeft size={14} /> VeritaComp&trade;
      </Link>
      <div>
        <h1 className="text-2xl font-bold">{ownOnly ? "My signed competencies" : "Signed competencies"}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {ownOnly ? "Your signed competencies" : "Every signed competency in this lab"}, newest first. Open one to see the entries it was signed on: specimen IDs, observers, evidence, dates and N/A reasons.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2" data-testid="signed-filters">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-2 top-2 text-muted-foreground" />
          <Input className="h-8 text-xs pl-7" placeholder={ownOnly ? "Method" : "Person or method"} value={q} onChange={(e) => setQ(e.target.value)} data-testid="signed-search" />
        </div>
        <select className={selectCls} value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department" data-testid="signed-dept">
          <option value="">All departments</option>
          {depts.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className={selectCls} value={milestone} onChange={(e) => setMilestone(e.target.value)} aria-label="Competency" data-testid="signed-milestone">
          <option value="">All competencies</option>
          {(Object.keys(MILESTONE_LABEL) as MethodMilestone[]).map((m) => <option key={m} value={m}>{MILESTONE_LABEL[m]}</option>)}
        </select>
        <div className="flex items-end gap-2">
          <label className="text-[10px] text-muted-foreground flex flex-col">Signed from
            <Input type="date" className="h-8 text-xs w-[140px]" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="signed-from" />
          </label>
          <label className="text-[10px] text-muted-foreground flex flex-col">to
            <Input type="date" className="h-8 text-xs w-[140px]" value={to} onChange={(e) => setTo(e.target.value)} data-testid="signed-to" />
          </label>
        </div>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground py-8 text-center">Loading...</div>}
      {error && <div className="text-sm text-red-600">Could not load signed competencies.</div>}
      {data && (
        <p className="text-xs text-muted-foreground" data-testid="signed-count">
          {filtered ? `${shown.length} of ${rows.length} signed competencies` : `${rows.length} signed ${rows.length === 1 ? "competency" : "competencies"}`}
        </p>
      )}
      {data && rows.length === 0 && (
        <Card><CardContent className="p-6 text-sm text-muted-foreground" data-testid="signed-empty">
          {ownOnly ? "None of your competencies are signed yet. A method appears here once your evaluator signs it." : "No competencies are signed yet. A method appears here once it is signed on the person's page."}
        </CardContent></Card>
      )}

      <div className="space-y-1.5">
        {shown.map((r, i) => {
          const res = RESULT[r.determination] || RESULT.pass;
          const href = labRoute(`/veritacomp-app/employee/${r.employeeId}?method=${r.instrumentId}${r.signoffId != null ? `&signoff=${r.signoffId}` : ""}`);
          return (
            <Link key={`${r.employeeId}-${r.instrumentId}-${r.signoffId ?? `x${i}`}`} href={href} data-testid="signed-row"
              className="grid grid-cols-[1fr_auto] sm:grid-cols-[96px_1.2fr_1.4fr_1fr_auto] items-center gap-x-3 gap-y-0.5 rounded-md border p-3 hover:border-primary/40 transition-colors">
              <div className="text-xs font-medium sm:order-none order-2 col-span-2 sm:col-span-1 text-muted-foreground sm:text-foreground">{fmtDate(r.signedDate)}</div>
              <div className="min-w-0 order-1 sm:order-none">
                <div className="text-sm font-medium truncate">{r.employeeName}</div>
                {r.employeeTitle && <div className="text-[11px] text-muted-foreground truncate">{r.employeeTitle}</div>}
              </div>
              <div className="min-w-0 order-3 sm:order-none col-span-2 sm:col-span-1">
                <div className="text-sm truncate">{r.methodName}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {[r.groupMembers?.length ? r.groupMembers.map((m) => m.name).join(", ") : "", r.department || "", r.complexity].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div className="text-xs order-4 sm:order-none col-span-2 sm:col-span-1">
                <span className="font-medium">{r.milestone ? MILESTONE_LABEL[r.milestone] : "Signed"}</span>
                {r.signerName && <span className="text-muted-foreground"> by {r.signerName}{r.signerRole ? `, ${ROLE_ABBR[r.signerRole] || r.signerRole}` : ""}</span>}
                {r.imported && <div className="text-[10px] text-muted-foreground">Imported from {r.importedFrom || "an earlier program"}</div>}
              </div>
              <div className="flex items-center gap-1.5 order-1 sm:order-none justify-end">
                <Badge className={`text-[10px] ${res.cls}`} data-testid="signed-result">{res.label}</Badge>
                <ChevronRight size={16} className="text-muted-foreground" />
              </div>
            </Link>
          );
        })}
      </div>
      {data && rows.length > 0 && shown.length === 0 && (
        <p className="text-sm text-muted-foreground" data-testid="signed-none-match">No signed competencies match these filters.</p>
      )}
    </div>
  );
}
