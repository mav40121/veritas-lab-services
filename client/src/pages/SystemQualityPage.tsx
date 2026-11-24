// Quality indicators across a system's laboratories (B15): reached from the Inspection Readiness roll-up, for a system's owner or
// admin only (the server refuses anyone else; server/orgQuality.ts). Two views: the report across laboratories, and the
// organization's own indicators, defined once and turned on laboratory by laboratory.
import { useState } from "react";
import { Link, useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthContext";
import { API_BASE, responseErrorText } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { downloadPdfToken } from "@/lib/utils";
import { labTodayIso } from "@/lib/labDate";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, BarChart3, Download, Edit2, FileText, ListChecks, Lock, Plus } from "lucide-react";
import { PeriodPicker, RESULT_COLOR, firstPeriod } from "@/components/veritaqa/LabReportTab";
import {
  ORG_FREQUENCIES, ORG_FREQUENCY_LABEL, ORG_INDICATOR_KINDS, ORG_KIND_LABEL, orgUnit, targetText, valueText,
  type OrgIndicatorKind, type OrgIndicatorVersion, type OrgFrequency, type PeriodResult, type TotalResult,
} from "@shared/qualityIndicators";

interface OrgLab { lab_id: number; lab_name: string | null; clia_number: string | null; can_turn_on: boolean }
interface OrgIndicator { id: number; current: OrgIndicatorVersion | null; versions: (OrgIndicatorVersion & { changed_at: string })[]; labs: { lab_id: number; on: boolean; turned_on_at: string; turned_off_at: string | null; entries: number }[] }
interface Organization { id: number; name: string; labs: OrgLab[]; indicators: OrgIndicator[] }
interface ReportRow { lab_id: number; lab_name: string; off_since: string | null; result: PeriodResult; result_text: string; target_text: string }
interface Report { period: { label: string }; group: { id: number; name: string } | null; labs: { lab_id: number }[]; departments: string[]; indicators: { id: number; name: string; department: string; definition: string | null; numerator_text: string | null; denominator_text: string | null; kind: OrgIndicatorKind; unit: string; frequency: OrgFrequency; changes: { version: number; effective_from: string }[]; rows: ReportRow[]; total: TotalResult; labs_on: number }[] }
interface Group { id: number; name: string; lab_ids: number[]; organization_id: number | null }

const selectCls = "h-9 rounded-md border border-input bg-background px-2 text-sm max-w-full";
const num = (n: number | null) => (n == null ? "" : n.toLocaleString("en-US", { maximumFractionDigits: 2 }));
const OVERVIEW = "/api/org-quality/overview";

class Refused extends Error {}
async function getJson(path: string) {
  const r = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  if (r.status === 403) throw new Refused(await responseErrorText(r, "This is for the owner or an admin of a system of laboratories."));
  if (!r.ok) throw new Error(await responseErrorText(r, "Could not load this page"));
  return r.json();
}

export default function SystemQualityPage() {
  const { isLoggedIn } = useAuth();
  const activeLabId = useActiveLabId();
  const params = new URLSearchParams(useSearch());
  const orgParam = Number(params.get("org"));
  const [view, setView] = useState<"report" | "indicators">("report");
  const [chosenOrg, setChosenOrg] = useState<number | null>(Number.isInteger(orgParam) && orgParam > 0 ? orgParam : null);
  const { data, error, isLoading } = useQuery<{ organizations: Organization[] }>({ queryKey: [OVERVIEW], enabled: isLoggedIn, refetchOnMount: "always", retry: false, queryFn: () => getJson(OVERVIEW) });

  if (!isLoggedIn) {
    return <div className="container max-w-2xl mx-auto py-12 px-4"><Card><CardContent className="py-10 text-center"><Lock className="mx-auto h-10 w-10 text-muted-foreground mb-3" /><h2 className="text-lg font-semibold mb-1">Sign in to view quality indicators across laboratories</h2><Button asChild className="mt-3"><Link href="/login">Sign in</Link></Button></CardContent></Card></div>;
  }
  const org = data?.organizations.find((o) => o.id === chosenOrg) ?? data?.organizations[0] ?? null;
  const groupParam = Number(params.get("group"));
  return (
    <div className="container max-w-6xl mx-auto py-8 px-4">
      <div className="mb-6">
        <Button asChild size="sm" variant="ghost" className="-ml-2 mb-2" data-testid="system-quality-back"><Link href={`/labs/${activeLabId}/readiness${org ? `?org=${org.id}` : ""}`}><ArrowLeft className="h-4 w-4 mr-1.5" />Inspection Readiness</Link></Button>
        <div className="flex flex-wrap items-center gap-2">
          <BarChart3 className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Quality indicators across laboratories</h1>
          {data && data.organizations.length > 1 && (
            <select aria-label="System" className={`${selectCls} ml-auto`} value={org?.id ?? ""} onChange={(e) => setChosenOrg(Number(e.target.value))} data-testid="system-quality-org">
              {data.organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
        </div>
        {org && <p className="text-sm text-muted-foreground mt-1">{org.name}, {org.labs.length} {org.labs.length === 1 ? "laboratory" : "laboratories"}. Each laboratory enters its own numbers in VeritaQA™.</p>}
      </div>
      {isLoading ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Loading...</CardContent></Card>
      ) : error ? (
        <Card><CardContent className="py-10 text-center" data-testid={error instanceof Refused ? "system-quality-refused" : "system-quality-error"}><Lock className="mx-auto h-10 w-10 text-muted-foreground mb-3" /><p className="text-sm">{(error as Error).message}</p></CardContent></Card>
      ) : org ? (
        <>
          <div className="flex gap-1 mb-5 border-b overflow-x-auto [&>button]:shrink-0">
            {([["report", "Report", BarChart3], ["indicators", "Indicators", ListChecks]] as const).map(([k, label, Icon]) => (
              <button key={k} onClick={() => setView(k)} data-testid={`system-quality-tab-${k}`} className={`px-4 py-2 text-sm font-medium border-b-2 ${view === k ? "border-[#01696F] text-[#01696F] dark:text-teal-300" : "border-transparent text-muted-foreground hover:text-foreground"}`}><Icon size={14} className="inline mr-1.5" />{label}</button>
            ))}
          </div>
          {view === "report" ? <ReportView key={org.id} org={org} initialGroup={groupParam > 0 ? groupParam : null} onIndicators={() => setView("indicators")} /> : <IndicatorsView key={org.id} org={org} />}
        </>
      ) : null}
    </div>
  );
}

// ── The report ──────────────────────────────────────────────────────────────

function ReportView({ org, initialGroup, onIndicators }: { org: Organization; initialGroup: number | null; onIndicators: () => void }) {
  const { toast } = useToast();
  const [pick, setPick] = useState(firstPeriod);
  const [groupId, setGroupId] = useState<number | null>(initialGroup);
  const [department, setDepartment] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const { data: groupsData } = useQuery<{ groups: Group[] }>({ queryKey: ["/api/rollup-groups"], refetchOnMount: "always", queryFn: () => getJson("/api/rollup-groups") });
  const mine = new Set(org.labs.map((l) => l.lab_id));
  const groups = (groupsData?.groups || []).filter((g) => g.lab_ids.some((id) => mine.has(id)));
  const group = groups.find((g) => g.id === groupId) ?? null;
  const body = { organizationId: org.id, ...pick, ...(group ? { groupId: group.id } : {}), ...(department ? { department } : {}) };
  const query = new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)])).toString();
  const { data, error, isLoading } = useQuery<Report>({ queryKey: ["/api/org-quality/report", query], refetchOnMount: "always", retry: false, placeholderData: (p) => p, queryFn: () => getJson(`/api/org-quality/report?${query}`) });
  async function download(kind: "pdf" | "xlsx") {
    setBusy(kind);
    try {
      const r = await fetch(`${API_BASE}/api/org-quality/report/${kind}`, { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) { toast({ title: "Report failed", description: await responseErrorText(r, "Try again."), variant: "destructive" }); return; }
      const { token, filename } = await r.json();
      downloadPdfToken(token, filename);
    } finally { setBusy(null); }
  }
  return (
    <div className="space-y-4" data-testid="system-quality-report">
      <div className="flex flex-wrap items-center gap-2">
        <PeriodPicker value={pick} onChange={setPick} kinds={[["month", "Month"], ["quarter", "Quarter"], ["ytd", "Year to date"], ["year", "Year"]]} />
        {groups.length > 0 && (
          <select aria-label="Lab group" className={selectCls} value={group?.id ?? ""} onChange={(e) => setGroupId(e.target.value ? Number(e.target.value) : null)} data-testid="system-quality-group">
            <option value="">All laboratories ({org.labs.length})</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.lab_ids.filter((id) => mine.has(id)).length})</option>)}
          </select>
        )}
        <select aria-label="Department" className={selectCls} value={department} onChange={(e) => setDepartment(e.target.value)} data-testid="system-quality-department">
          <option value="">All departments</option>
          {[...new Set([...(data?.departments || []), ...(department ? [department] : [])])].map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={() => download("pdf")} disabled={!data || busy != null} data-testid="system-quality-pdf"><FileText size={14} className="mr-1.5" />{busy === "pdf" ? "Making..." : "PDF"}</Button>
          <Button size="sm" variant="outline" onClick={() => download("xlsx")} disabled={!data || busy != null} data-testid="system-quality-xlsx"><Download size={14} className="mr-1.5" />{busy === "xlsx" ? "Making..." : "Excel"}</Button>
        </div>
      </div>
      {isLoading ? <p className="py-8 text-center text-sm text-muted-foreground">Loading the report...</p>
        : error ? <p role="alert" className="text-sm text-destructive">{(error as Error).message}</p>
        : data && (
          <>
            <p className="text-sm font-medium">{data.period.label}{data.group ? `, ${data.group.name}` : ""}</p>
            {data.indicators.length === 0 && (
              <Card><CardContent className="py-8 text-center text-sm text-muted-foreground" data-testid="system-quality-empty">
                No organization indicator is turned on in {data.labs.length === org.labs.length ? "your laboratories" : "these laboratories"}{department ? " for this department" : ""}.
                <div><Button size="sm" variant="outline" className="mt-3" onClick={onIndicators}>Set up indicators</Button></div>
              </CardContent></Card>
            )}
            {data.indicators.map((i) => (
              <Card key={i.id} data-testid={`system-quality-indicator-${i.id}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{i.name} <span className="text-sm font-normal text-muted-foreground">{i.department}</span></CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {i.definition ? `${i.definition} ` : ""}{i.kind === "count" ? `Counts: ${i.numerator_text}.` : `Numerator: ${i.numerator_text}. Denominator: ${i.denominator_text}.`} Entered {ORG_FREQUENCY_LABEL[i.frequency].toLowerCase()}.
                    {i.changes.map((c) => <b key={c.version}> The definition changed from {c.effective_from} (version {c.version}).</b>)}
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" style={{ minWidth: 720 }}>
                      <thead className="border-b bg-muted text-left text-xs text-muted-foreground">
                        <tr><th className="px-2 py-2">Laboratory</th><th className="px-2 py-2 text-right">{i.kind === "count" ? "Count" : "Numerator"}</th><th className="px-2 py-2 text-right">Denominator</th><th className="px-2 py-2 text-right">Value</th><th className="px-2 py-2">Target</th><th className="px-2 py-2">Result</th><th className="px-2 py-2 text-center">Entries</th></tr>
                      </thead>
                      <tbody>
                        {i.rows.map((x) => (
                          <tr key={x.lab_id} className="border-b" data-testid={`system-quality-row-${i.id}-${x.lab_id}`}>
                            <td className="px-2 py-2 font-medium"><Link href={`/labs/${x.lab_id}/veritabench/pi`} className="hover:underline">{x.lab_name}</Link>{x.off_since && <div className="text-xs font-normal text-muted-foreground">Off since {x.off_since}</div>}</td>
                            <td className="px-2 py-2 text-right font-mono">{num(x.result.numerator)}</td>
                            <td className="px-2 py-2 text-right font-mono">{num(x.result.denominator)}</td>
                            <td className="px-2 py-2 text-right font-mono">{x.result.state === "no_entry" ? <span className="font-sans text-muted-foreground">No entry</span> : valueText(x.result.value, x.result.unit)}</td>
                            <td className="px-2 py-2 text-xs">{x.target_text}</td>
                            <td className={`px-2 py-2 text-xs font-semibold ${RESULT_COLOR[x.result_text] || ""}`}>{x.result_text}{x.result.note && <div className="font-normal text-muted-foreground">{x.result.note}</div>}</td>
                            <td className="px-2 py-2 text-center text-xs">{x.result.entered} of {x.result.expected}</td>
                          </tr>
                        ))}
                        <tr className="bg-[#E6F2F2] dark:bg-teal-950/40 font-semibold" data-testid={`system-quality-total-${i.id}`}>
                          <td className="px-2 py-2">Total <span className="text-xs font-normal">({i.total.labs_counted} of {i.rows.length} with an entry)</span></td>
                          {i.total.shown ? (
                            <><td className="px-2 py-2 text-right font-mono">{num(i.total.numerator)}</td><td className="px-2 py-2 text-right font-mono">{num(i.total.denominator)}</td><td className="px-2 py-2 text-right font-mono">{valueText(i.total.value, i.total.unit)}</td><td colSpan={3} /></>
                          ) : <td colSpan={6} className="px-2 py-2 text-xs font-normal">{i.total.reason}</td>}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            ))}
            <p className="text-xs text-muted-foreground">Totals add up numerators and denominators; percents are never averaged. No entry is neither met nor missed. Targets are your organization's own.</p>
          </>
        )}
    </div>
  );
}

// ── The organization's indicators ─────────────────────────────────────────────

function IndicatorsView({ org }: { org: Organization }) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState<OrgIndicator | "new" | null>(null);
  const [labsFor, setLabsFor] = useState<OrgIndicator | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: [OVERVIEW] }); qc.invalidateQueries({ queryKey: ["/api/org-quality/report"] }); };
  return (
    <div className="space-y-3" data-testid="system-quality-indicators">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">Define an indicator once, then turn it on in the laboratories that enter it. Their own indicators stay beside it.</p>
        <Button size="sm" onClick={() => setEdit("new")} className="ml-auto bg-[#01696F] text-white hover:bg-[#015458]" data-testid="system-quality-new"><Plus size={14} className="mr-1.5" />New indicator</Button>
      </div>
      {org.indicators.length === 0 && <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No organization indicators yet.</CardContent></Card>}
      {org.indicators.map((i) => {
        const v = i.current;
        if (!v) return null;
        const on = i.labs.filter((l) => l.on).length;
        const ahead = i.versions.filter((x) => x.version > v.version);
        return (
          <Card key={i.id} data-testid={`system-quality-definition-${i.id}`}>
            <CardContent className="py-4 space-y-1.5">
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{v.name}</div>
                  <div className="text-xs text-muted-foreground">{v.department}. {ORG_KIND_LABEL[v.kind]}. {ORG_FREQUENCY_LABEL[v.frequency]}. Target: {targetText(v.target, v.direction, orgUnit(v.kind, v.unit))}.</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => setLabsFor(i)} data-testid={`system-quality-labs-${i.id}`}>On in {on} of {org.labs.length}</Button>
                <Button size="sm" variant="outline" onClick={() => setEdit(i)} data-testid={`system-quality-edit-${i.id}`}><Edit2 size={13} className="mr-1" />Change</Button>
              </div>
              {v.definition && <p className="text-sm whitespace-pre-wrap">{v.definition}</p>}
              <p className="text-xs">{v.kind === "count" ? `Counts: ${v.numerator_text}` : `Numerator: ${v.numerator_text}. Denominator: ${v.denominator_text}`}</p>
              {i.versions.length > 1 && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">{i.versions.length} versions{ahead.length ? `, the next from ${ahead[0].effective_from}` : ""}</summary>
                  <ul className="mt-1 list-disc pl-5 space-y-0.5">
                    {[...i.versions].reverse().map((x) => <li key={x.version}>Version {x.version} from {x.effective_from}: {x.name}, target {targetText(x.target, x.direction, orgUnit(x.kind, x.unit))}, {ORG_FREQUENCY_LABEL[x.frequency].toLowerCase()}</li>)}
                  </ul>
                </details>
              )}
            </CardContent>
          </Card>
        );
      })}
      {edit && <IndicatorDialog org={org} indicator={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refresh(); }} />}
      {labsFor && <LabsDialog org={org} indicator={labsFor} onClose={() => setLabsFor(null)} onSaved={() => { setLabsFor(null); refresh(); }} />}
    </div>
  );
}

function IndicatorDialog({ org, indicator, onClose, onSaved }: { org: Organization; indicator: OrgIndicator | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const last = indicator ? indicator.versions[indicator.versions.length - 1] : null;
  const thisMonth = labTodayIso().slice(0, 7);
  const [f, setF] = useState({
    name: last?.name ?? "", department: last?.department ?? "", definition: last?.definition ?? "", numerator_text: last?.numerator_text ?? "", denominator_text: last?.denominator_text ?? "",
    kind: (last?.kind ?? "percent") as OrgIndicatorKind, unit: last?.unit ?? "", target: last?.target != null ? String(last.target) : "", direction: last?.direction ?? "lower_is_better", frequency: (last?.frequency ?? "monthly") as OrgFrequency,
    effective_from: last && last.effective_from > thisMonth ? last.effective_from : thisMonth,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  async function save() {
    setBusy(true); setError("");
    try {
      const url = indicator ? `/api/org-quality/indicators/${indicator.id}` : "/api/org-quality/indicators";
      const r = await fetch(`${API_BASE}${url}`, { method: indicator ? "PUT" : "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ ...f, target: f.target.trim() === "" ? null : f.target.trim(), organizationId: org.id }) });
      if (!r.ok) { setError(await responseErrorText(r, "That could not be saved")); return; }
      toast({ title: indicator ? "New version saved" : "Indicator added", description: indicator ? `It starts in ${f.effective_from}. Entries already made keep the target they were entered under.` : "Turn it on in the laboratories that will enter it." });
      onSaved();
    } finally { setBusy(false); }
  }
  const field = "space-y-1";
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto" data-testid="system-quality-form">
        <DialogHeader>
          <DialogTitle>{indicator ? "Change this indicator" : "New organization indicator"}</DialogTitle>
          <DialogDescription>{indicator ? "A change is kept as a new version. Entries already made keep the definition and target they were entered under." : `For ${org.name}. Nothing is added to a laboratory until you turn it on there.`}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className={field}><Label htmlFor="oq-name">Name</Label><Input id="oq-name" value={f.name} maxLength={160} onChange={(e) => set("name", e.target.value)} data-testid="oq-name" /></div>
          <div className={field}><Label htmlFor="oq-department">Department</Label><Input id="oq-department" value={f.department} maxLength={120} onChange={(e) => set("department", e.target.value)} data-testid="oq-department" /></div>
          <div className={field}><Label htmlFor="oq-definition">Definition</Label><Textarea id="oq-definition" value={f.definition} onChange={(e) => set("definition", e.target.value)} rows={2} data-testid="oq-definition" /></div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className={field}><Label htmlFor="oq-kind">Kind</Label><select id="oq-kind" className={`${selectCls} w-full`} value={f.kind} onChange={(e) => set("kind", e.target.value)} data-testid="oq-kind">{ORG_INDICATOR_KINDS.map((k) => <option key={k} value={k}>{ORG_KIND_LABEL[k]}</option>)}</select></div>
            <div className={field}><Label htmlFor="oq-frequency">Entered</Label><select id="oq-frequency" className={`${selectCls} w-full`} value={f.frequency} onChange={(e) => set("frequency", e.target.value)} data-testid="oq-frequency">{ORG_FREQUENCIES.map((k) => <option key={k} value={k}>{ORG_FREQUENCY_LABEL[k]}</option>)}</select></div>
          </div>
          <div className={field}><Label htmlFor="oq-numerator">{f.kind === "count" ? "What is counted" : "Numerator: what it counts"}</Label><Input id="oq-numerator" value={f.numerator_text} onChange={(e) => set("numerator_text", e.target.value)} data-testid="oq-numerator" /></div>
          {f.kind !== "count" && <div className={field}><Label htmlFor="oq-denominator">Denominator: what it counts</Label><Input id="oq-denominator" value={f.denominator_text} onChange={(e) => set("denominator_text", e.target.value)} data-testid="oq-denominator" /></div>}
          <div className="grid sm:grid-cols-3 gap-3">
            <div className={field}><Label htmlFor="oq-target">Your target (optional)</Label><Input id="oq-target" type="text" inputMode="decimal" value={f.target} onChange={(e) => set("target", e.target.value)} data-testid="oq-target" /></div>
            <div className={field}><Label htmlFor="oq-direction">Met when</Label><select id="oq-direction" className={`${selectCls} w-full`} value={f.direction} onChange={(e) => set("direction", e.target.value)}><option value="lower_is_better">At or below it</option><option value="higher_is_better">At or above it</option></select></div>
            {(f.kind === "ratio" || f.kind === "count") && <div className={field}><Label htmlFor="oq-unit">Unit (optional)</Label><Input id="oq-unit" value={f.unit} maxLength={40} onChange={(e) => set("unit", e.target.value)} placeholder={f.kind === "ratio" ? "minutes" : "complaints"} /></div>}
          </div>
          {indicator && <div className={field}><Label htmlFor="oq-from">Starts in</Label><Input id="oq-from" type="month" min={thisMonth} value={f.effective_from} onChange={(e) => set("effective_from", e.target.value)} className="max-w-[200px]" data-testid="oq-from" /></div>}
          {error && <p role="alert" className="text-sm text-destructive" data-testid="oq-error">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy || !f.name.trim()} className="bg-[#01696F] text-white hover:bg-[#015458]" data-testid="oq-save">{busy ? "Saving..." : indicator ? "Save new version" : "Add indicator"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LabsDialog({ org, indicator, onClose, onSaved }: { org: Organization; indicator: OrgIndicator; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const was = new Set(indicator.labs.filter((l) => l.on).map((l) => l.lab_id));
  const [on, setOn] = useState<Set<number>>(new Set(was));
  const [busy, setBusy] = useState(false);
  const entries = (id: number) => indicator.labs.find((l) => l.lab_id === id)?.entries ?? 0;
  const toggle = (id: number) => setOn((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const added = [...on].filter((id) => !was.has(id)).length, removed = [...was].filter((id) => !on.has(id)).length;
  async function save() {
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/org-quality/indicators/${indicator.id}/labs`, { method: "PUT", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ labIds: [...on] }) });
      if (!r.ok) { toast({ title: "Not saved", description: await responseErrorText(r, "Try again."), variant: "destructive" }); return; }
      toast({ title: "Saved" });
      onSaved();
    } finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="system-quality-labs-dialog">
        <DialogHeader>
          <DialogTitle>{indicator.current?.name}</DialogTitle>
          <DialogDescription>Laboratories that enter it. Turning it off keeps its entries, and turning it on again picks them back up.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          {org.labs.map((l) => (
            <label key={l.lab_id} className="flex items-center gap-2 rounded-md border p-2.5 text-sm">
              <input type="checkbox" checked={on.has(l.lab_id)} disabled={busy || (!l.can_turn_on && !was.has(l.lab_id))} onChange={() => toggle(l.lab_id)} data-testid={`system-quality-lab-${l.lab_id}`} />
              <span className="min-w-0 flex-1">{l.lab_name || l.clia_number || `Laboratory ${l.lab_id}`}</span>
              <span className="text-xs text-muted-foreground">{!l.can_turn_on ? "Retired" : entries(l.lab_id) ? `${entries(l.lab_id)} ${entries(l.lab_id) === 1 ? "entry" : "entries"}${was.has(l.lab_id) && !on.has(l.lab_id) ? ", kept" : ""}` : ""}</span>
            </label>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <span className="mr-auto text-xs text-muted-foreground">{added ? `${added} turned on` : ""}{added && removed ? ", " : ""}{removed ? `${removed} turned off` : ""}</span>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy || (!added && !removed)} className="bg-[#01696F] text-white hover:bg-[#015458]" data-testid="system-quality-labs-save">{busy ? "Saving..." : "Save"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
