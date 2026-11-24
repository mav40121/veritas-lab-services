// System documents across laboratories (B1, 2026-11-24; server/policySharedDocuments.ts): each procedure the system sent, the version
// each laboratory has approved, what is waiting there and since when, its review date, and read-and-sign as counts. Reached from
// Inspection Readiness. The rows are exactly the laboratories of the reader's readiness roll-up; the filters only take rows away.
// No person is named. A row opens the document in its own laboratory, where that laboratory's own rules apply.
import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { useAuth } from "@/components/AuthContext";
import { API_BASE, responseErrorText } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Building2, FileSpreadsheet, Lock } from "lucide-react";
import { labLocaleDate } from "@/lib/labDate";
import { groupsInRollup, type RollupGroupRef, type RollupLab } from "@/lib/readinessRollup";
import { labsForFilter, type SystemFindingLab } from "@/lib/systemFindings";
import { SYSTEM_LAB_STATE_LABEL, type SystemLabState } from "@shared/systemDocuments";

interface LabRow {
  lab_id: number; lab_name: string | null; clia_number: string | null; document_id: number | null; state: SystemLabState;
  approved_label: string | null; approved_own: boolean; approved_own_label: string | null; open_label: string | null; queued_label: string | null; waiting_since: string | null;
  declined_label: string | null; declined_reason: string | null; declined_at: string | null; next_review_date: string | null; review_overdue: boolean; signed: number; owed: number; addenda: number;
}
interface DocRow { master_document_id: number; organization_id: number; organization_name: string | null; title: string; doc_number: string | null; version_label: string | null; retired: boolean; labs: LabRow[] }
interface Repository { organization_id: number; organization_name: string | null; lab_id: number | null }

const selectCls = "h-9 rounded-md border border-input bg-background px-2 text-sm max-w-full";
const STATE_CLS: Record<SystemLabState, string> = {
  current: "text-emerald-800 dark:text-emerald-300",
  waiting: "text-amber-800 dark:text-amber-300",
  behind: "text-amber-800 dark:text-amber-300",
  declined: "text-red-800 dark:text-red-300",
  own_copy: "text-muted-foreground", left: "text-muted-foreground", archived: "text-muted-foreground", removed: "text-muted-foreground",
};

export default function SystemDocumentsPage() {
  const { isLoggedIn } = useAuth();
  const { toast } = useToast();
  const activeLabId = useActiveLabId();
  const params = new URLSearchParams(useSearch());
  const orgParam = Number(params.get("org"));
  const organizationId = Number.isInteger(orgParam) && orgParam > 0 ? orgParam : null;
  const groupParam = params.get("group");

  const [docs, setDocs] = useState<DocRow[]>([]);
  const [labs, setLabs] = useState<SystemFindingLab[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [groups, setGroups] = useState<RollupGroupRef[]>([]);
  const [group, setGroup] = useState<"all" | "none" | number>(groupParam === "none" ? "none" : Number(groupParam) > 0 ? Number(groupParam) : "all");
  const [status, setStatus] = useState<SystemLabState | "">("");
  const [q, setQ] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "refused" | "error">("loading");
  const [exporting, setExporting] = useState(false);

  async function load() {
    setState("loading");
    try {
      const [dRes, gRes] = await Promise.all([
        fetch(`${API_BASE}/api/system-documents`, { headers: authHeaders() }),
        fetch(`${API_BASE}/api/rollup-groups`, { headers: authHeaders() }).catch(() => null),
      ]);
      if (dRes.status === 403) { setState("refused"); return; }
      if (!dRes.ok) throw new Error(`system-documents ${dRes.status}`);
      const body = await dRes.json();
      setDocs(body.documents || []);
      setLabs(body.labs || []);
      setRepositories(body.repositories || []);
      if (gRes?.ok) setGroups((await gRes.json()).groups || []);
      setState("ready");
    } catch (e) {
      console.error("Failed to load system documents:", e);
      setState("error");
    }
  }
  useEffect(() => {
    if (isLoggedIn) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  if (!isLoggedIn) {
    return <div className="container max-w-2xl mx-auto py-12 px-4"><Card><CardContent className="py-10 text-center"><Lock className="mx-auto h-10 w-10 text-muted-foreground mb-3" /><h2 className="text-lg font-semibold mb-1">Sign in to view system documents</h2><Button asChild className="mt-3"><Link href="/login">Sign in</Link></Button></CardContent></Card></div>;
  }

  // A filter left over from another view (a group that holds none of these labs) reads as All labs, as the roll-up does.
  const scoped = labsForFilter(labs, groups, { organizationId, group: "all" });
  const shownGroups = groupsInRollup(scoped as unknown as RollupLab[], groups);
  const noneCount = shownGroups.length ? labsForFilter(scoped, shownGroups, { organizationId: null, group: "none" }).length : 0;
  const effectiveGroup = group === "none" ? (noneCount > 0 ? "none" : "all") : typeof group === "number" && shownGroups.some((g) => g.id === group) ? group : "all";
  const inView = new Set(labsForFilter(scoped, shownGroups, { organizationId: null, group: effectiveGroup }).map((l) => l.lab_id));
  const term = q.trim().toLowerCase();
  const shown = docs
    .filter((d) => (organizationId == null || d.organization_id === organizationId) && (!term || `${d.doc_number ?? ""} ${d.title}`.toLowerCase().includes(term)))
    .map((d) => ({ ...d, labs: d.labs.filter((l) => inView.has(l.lab_id) && (!status || l.state === status)) }))
    .filter((d) => d.labs.length > 0);
  const rows = shown.flatMap((d) => d.labs);
  const states = [...new Set(docs.flatMap((d) => d.labs.map((l) => l.state)))];
  const orgName = organizationId != null ? scoped.find((l) => l.organization_name)?.organization_name : null;
  const day = (s: string | null) => (s ? labLocaleDate(s) || s : "");

  const exportExcel = async () => {
    setExporting(true);
    try {
      const query = [organizationId != null ? `org=${organizationId}` : "", effectiveGroup !== "all" ? `group=${effectiveGroup}` : "", status ? `state=${status}` : ""].filter(Boolean).join("&");
      const res = await fetch(`${API_BASE}/api/system-documents/export.xlsx${query ? `?${query}` : ""}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(await responseErrorText(res, "The Excel file couldn't be made."));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = (res.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/)?.[1] || "VeritaDC_System_Documents.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) {
      toast({ title: "Not exported", description: e?.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="container max-w-6xl mx-auto py-8 px-4">
      <div className="mb-6">
        <Button asChild size="sm" variant="ghost" className="-ml-2 mb-2"><Link href={`/labs/${activeLabId}/readiness${organizationId != null ? `?org=${organizationId}` : ""}`}><ArrowLeft className="h-4 w-4 mr-1.5" />Inspection Readiness</Link></Button>
        <div className="flex items-center gap-2"><Building2 className="h-6 w-6 text-primary" /><h1 className="text-2xl font-bold">System documents</h1></div>
        <p className="text-sm text-muted-foreground mt-1">
          One procedure, written once in VeritaDC™ and sent to the laboratories of your readiness roll-up{orgName ? ` (${orgName})` : ""}. Each laboratory approves it by its own rules. Read-and-sign is counts only.
        </p>
        {repositories.map((r) => (
          <p key={r.organization_id} className="text-sm mt-1" data-testid="system-documents-repository">
            {r.lab_id != null
              ? <Link href={`/labs/${r.lab_id}/veritapolicy-app/my-policies`} className="text-primary hover:underline">Write, approve and send them in {r.organization_name ?? "your system"}'s repository</Link>
              : <span className="text-muted-foreground">{r.organization_name} has no repository laboratory yet. Veritas sets one up: info@veritaslabservices.com.</span>}
          </p>
        ))}
      </div>

      {state === "loading" ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Loading system documents...</CardContent></Card>
      ) : state === "refused" ? (
        <Card><CardContent className="py-10 text-center"><Lock className="mx-auto h-10 w-10 text-muted-foreground mb-3" /><p className="text-sm">A VeritaAssure® subscription is required.</p></CardContent></Card>
      ) : state === "error" ? (
        <Card><CardContent className="py-8 text-center"><p className="text-destructive font-medium mb-2">Couldn't load the system documents.</p><Button size="sm" variant="outline" onClick={load}>Retry</Button></CardContent></Card>
      ) : docs.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground" data-testid="system-documents-empty">No system document has been sent to these laboratories yet.</CardContent></Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a document" aria-label="Find a document" className="h-9 w-52 max-w-full" />
            {shownGroups.length > 0 && (
              <select aria-label="Lab group" className={selectCls} value={String(effectiveGroup)} data-testid="system-documents-group" onChange={(e) => { const v = e.target.value; setGroup(v === "all" || v === "none" ? v : Number(v)); }}>
                <option value="all">All labs ({scoped.length})</option>
                {shownGroups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.lab_ids.filter((id) => scoped.some((l) => l.lab_id === id)).length})</option>)}
                {noneCount > 0 && <option value="none">Not in a group ({noneCount})</option>}
              </select>
            )}
            <select aria-label="Status" className={selectCls} value={status} data-testid="system-documents-status" onChange={(e) => setStatus(e.target.value as SystemLabState | "")}>
              <option value="">Every status</option>
              {states.map((s) => <option key={s} value={s}>{SYSTEM_LAB_STATE_LABEL[s]}</option>)}
            </select>
            <span className="text-sm text-muted-foreground" data-testid="system-documents-summary">
              {shown.length} {shown.length === 1 ? "document" : "documents"}, {rows.filter((l) => l.state === "current").length} of {rows.length} approved, {rows.filter((l) => l.state === "waiting").length} waiting
            </span>
            <Button size="sm" variant="outline" className="ml-auto" onClick={exportExcel} disabled={exporting} data-testid="system-documents-excel"><FileSpreadsheet className="h-4 w-4 mr-1.5" />{exporting ? "Making it..." : "Excel"}</Button>
          </div>
          <div className="space-y-4" data-testid="system-documents-list">
            {shown.length === 0 && <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Nothing matches these filters.</CardContent></Card>}
            {shown.map((d) => (
              <Card key={d.master_document_id} data-testid={`system-document-${d.master_document_id}`}>
                <CardContent className="p-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 border-b">
                    <span className="font-semibold min-w-0">{d.doc_number && <span className="mr-2 font-mono text-xs text-muted-foreground">{d.doc_number}</span>}{d.title}</span>
                    <span className="text-sm text-muted-foreground">{d.retired ? "Retired by the system" : d.version_label ? `System version ${d.version_label}` : "No approved version now"}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" style={{ minWidth: 760 }}>
                      <thead className="text-left text-xs text-muted-foreground border-b bg-muted/50">
                        <tr><th className="py-2 px-4">Laboratory</th><th className="py-2 pr-4">Status</th><th className="py-2 pr-4">Approved here</th><th className="py-2 pr-4">Waiting</th><th className="py-2 pr-4">Next review</th><th className="py-2 pr-4">Read and sign</th></tr>
                      </thead>
                      <tbody>
                        {d.labs.map((l) => (
                          <tr key={l.lab_id} className="border-b border-border/50 last:border-b-0 align-top">
                            <td className="py-2.5 px-4 font-medium">
                              {l.document_id != null && l.state !== "declined" && l.state !== "archived" ? <Link href={`/labs/${l.lab_id}/veritapolicy-app/my-policies`} className="hover:underline">{l.lab_name || `Lab ${l.lab_id}`}</Link> : l.lab_name || `Lab ${l.lab_id}`}
                              {l.addenda > 0 && <span className="block text-xs font-normal text-muted-foreground">{l.addenda} site {l.addenda === 1 ? "addendum" : "addenda"}</span>}
                            </td>
                            <td className={`py-2.5 pr-4 ${STATE_CLS[l.state]}`}>
                              {SYSTEM_LAB_STATE_LABEL[l.state]}
                              {l.declined_reason && <span className="block text-xs text-muted-foreground max-w-[16rem]">{l.state === "declined" ? "" : `Declined version ${l.declined_label}: `}{l.declined_reason}</span>}
                            </td>
                            <td className="py-2.5 pr-4">{l.approved_label ? `Version ${l.approved_label}` : l.approved_own ? `Its own version ${l.approved_own_label ?? ""}` : <span className="text-muted-foreground">None yet</span>}</td>
                            <td className="py-2.5 pr-4">
                              {l.open_label ? <>Version {l.open_label}<span className="block text-xs text-muted-foreground">since {day(l.waiting_since)}</span></> : null}
                              {l.queued_label ? <span className="block text-xs text-muted-foreground">Version {l.queued_label} {l.open_label ? "waits behind it" : `since ${day(l.waiting_since)}`}</span> : null}
                            </td>
                            <td className={`py-2.5 pr-4 ${l.review_overdue ? "text-red-800 dark:text-red-300" : ""}`}>{l.next_review_date ? day(l.next_review_date) : <span className="text-muted-foreground">Not set</span>}{l.review_overdue && <span className="block text-xs">Review overdue</span>}</td>
                            <td className="py-2.5 pr-4">{l.signed + l.owed > 0 ? `${l.signed} signed, ${l.owed} owed` : <span className="text-muted-foreground">Nobody assigned</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
