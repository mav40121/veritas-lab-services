import React, { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/components/AuthContext";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock, Download, ChevronDown, ChevronUp, Search, Clock, ChevronRight } from "lucide-react";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";

// ── Types ──────────────────────────────────────────────────────────────────────
interface PolicySettings {
  id?: number;
  user_id?: number;
  has_blood_bank: number;
  has_transplant: number;
  has_microbiology: number;
  has_maternal_serum: number;
  is_independent: number;
  waived_only: number;
  accreditation_body: string;
  accreditation_choice?: string;  // 'TJC' | 'CAP' | 'AABB' | 'COLA' | 'CAP+AABB' | 'CLIA'
  setup_complete: number;
}

const CHOICE_LABEL: Record<string, string> = {
  TJC: "TJC",
  CAP: "CAP",
  AABB: "AABB",
  COLA: "COLA",
  "CAP+AABB": "CAP + AABB",
  CLIA: "CLIA",
};

// Master List policy row -- mirrors the polished 96-row Excel.
interface MasterPolicy {
  policy_id: string;
  policy_name: string;
  section: string;
  subspecialty: string;
  service_line: string;
  description: string;
  cfr_citations: string;
  ao_citations: { label: string; value: string }[];
  notes: string;
  status: string;            // 'not_started' | 'in_progress' | 'complete' | 'na'
  is_na: boolean;
  na_reason: string | null;
  our_policy_name: string | null;
  user_notes: string | null;
  updated_at: string | null;
}

interface Summary {
  total: number;
  complete: number;
  in_progress: number;
  not_started: number;
  na: number;
  applicable: number;
  score: number;
  ao_label: string;
}

// ── Status config ──────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; color: string; next: string }> = {
  not_started: { label: "Not Started", color: "bg-muted text-muted-foreground", next: "in_progress" },
  in_progress: { label: "In Progress", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", next: "complete" },
  complete:    { label: "Complete",    color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", next: "not_started" },
  na:          { label: "N/A",         color: "bg-muted/50 text-muted-foreground", next: "not_started" },
};

const DEFAULT_SETTINGS: PolicySettings = {
  has_blood_bank: 1,
  has_transplant: 0,
  has_microbiology: 1,
  has_maternal_serum: 0,
  is_independent: 0,
  waived_only: 0,
  accreditation_body: "clia",
  accreditation_choice: "CLIA",
  setup_complete: 1,
};

// ── Toggle switch component ────────────────────────────────────────────────────
function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors
        ${checked ? "bg-primary" : "bg-muted"}
        ${disabled ? "opacity-50 cursor-not-allowed" : ""}
        focus:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
    >
      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`} />
    </button>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function VeritaPolicyAppPage() {
  const { user, isLoggedIn } = useAuth();
  const isReadOnly = useIsReadOnly();
  const { toast } = useToast();

  const hasPlanAccess = !!user && ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "waived", "community", "hospital", "large_hospital", "enterprise"].includes(user.plan);

  const [settings, setSettings] = useState<PolicySettings>(DEFAULT_SETTINGS);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [policies, setPolicies] = useState<MasterPolicy[]>([]);
  const [aoColumns, setAoColumns] = useState<string[]>([]);
  const [aoLabel, setAoLabel] = useState<string>("CLIA only");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingMasterList, setDownloadingMasterList] = useState(false);
  const [loading, setLoading] = useState(true);

  // Filter/search state
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterSection, setFilterSection] = useState("all");
  const [filterServiceLine, setFilterServiceLine] = useState("all");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [editingPolicyName, setEditingPolicyName] = useState<Record<string, string>>({});
  const [bulkConfirm, setBulkConfirm] = useState<{ section: string; rows: MasterPolicy[]; markNa: boolean } | null>(null);
  const [bulkApplying, setBulkApplying] = useState(false);

  const settingsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, summaryRes, listRes] = await Promise.all([
        fetch(`${API_BASE}/api/veritapolicy/settings`, { headers: authHeaders() }),
        fetch(`${API_BASE}/api/veritapolicy/master-list/summary`, { headers: authHeaders() }),
        fetch(`${API_BASE}/api/veritapolicy/master-list`, { headers: authHeaders() }),
      ]);
      const [s, sum, list] = await Promise.all([settingsRes.json(), summaryRes.json(), listRes.json()]);
      setSettings({ ...DEFAULT_SETTINGS, ...s });
      setSummary(sum);
      setPolicies(list.rows || []);
      setAoColumns(list.ao_columns || []);
      setAoLabel(list.ao_label || "CLIA only");
      if (!s.setup_complete) setSettingsOpen(true);
    } catch {
      toast({ title: "Error loading data", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (isLoggedIn && hasPlanAccess) loadAll();
  }, [isLoggedIn, hasPlanAccess, loadAll]);

  async function saveSettings(updated: PolicySettings) {
    if (settingsSaveTimer.current) clearTimeout(settingsSaveTimer.current);
    settingsSaveTimer.current = setTimeout(async () => {
      try {
        await fetch(`${API_BASE}/api/veritapolicy/settings`, {
          method: "PUT",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ ...updated, setup_complete: true }),
        });
        // Reload list + summary -- accreditor change affects AO columns shown.
        const [sumRes, listRes] = await Promise.all([
          fetch(`${API_BASE}/api/veritapolicy/master-list/summary`, { headers: authHeaders() }),
          fetch(`${API_BASE}/api/veritapolicy/master-list`, { headers: authHeaders() }),
        ]);
        const [sum, list] = await Promise.all([sumRes.json(), listRes.json()]);
        setSummary(sum);
        setPolicies(list.rows || []);
        setAoColumns(list.ao_columns || []);
        setAoLabel(list.ao_label || "CLIA only");
      } catch {
        toast({ title: "Error saving settings", variant: "destructive" });
      }
    }, 600);
  }

  function updateSetting(key: keyof PolicySettings, value: any) {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    saveSettings(updated);
  }

  async function updatePolicy(p: MasterPolicy, patch: Partial<MasterPolicy>) {
    setPolicies(prev => prev.map(r => r.policy_id === p.policy_id ? { ...r, ...patch } : r));
    try {
      await fetch(`${API_BASE}/api/veritapolicy/master-list/${encodeURIComponent(p.policy_id)}`, {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          status: patch.status ?? p.status,
          is_na: patch.is_na ?? p.is_na,
          na_reason: patch.na_reason ?? p.na_reason,
          our_policy_name: patch.our_policy_name ?? p.our_policy_name,
          notes: patch.user_notes ?? p.user_notes,
        }),
      });
      const sum = await fetch(`${API_BASE}/api/veritapolicy/master-list/summary`, { headers: authHeaders() }).then(r => r.json());
      setSummary(sum);
    } catch {
      toast({ title: "Error saving", variant: "destructive" });
      setPolicies(prev => prev.map(r => r.policy_id === p.policy_id ? p : r));
    }
  }

  function cycleStatus(p: MasterPolicy) {
    if (p.is_na || isReadOnly) return;
    const next = STATUS_CONFIG[p.status]?.next || "not_started";
    updatePolicy(p, { status: next });
  }

  async function handleDownloadPdf() {
    setDownloadingPdf(true);
    try {
      const res = await fetch(`${API_BASE}/api/veritapolicy/pdf`, { method: "POST", headers: authHeaders() });
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "VeritaPolicy-Report.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "PDF generation failed", variant: "destructive" });
    } finally {
      setDownloadingPdf(false);
    }
  }

  async function handleDownloadMasterList() {
    setDownloadingMasterList(true);
    try {
      const res = await fetch(`${API_BASE}/api/veritapolicy/master-list/excel`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Excel generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const date = new Date().toISOString().split("T")[0];
      a.download = `VeritaPolicy_MasterList_${date}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Excel generation failed", variant: "destructive" });
    } finally {
      setDownloadingMasterList(false);
    }
  }

  async function handleBulkNa(section: string, rows: MasterPolicy[], markNa: boolean) {
    setBulkConfirm({ section, rows, markNa });
  }

  async function confirmBulkNa() {
    if (!bulkConfirm) return;
    setBulkApplying(true);
    const { rows, markNa } = bulkConfirm;
    const target = rows.filter(r => r.is_na !== markNa);
    let failed = 0;
    setPolicies(prev => prev.map(r => {
      if (target.some(t => t.policy_id === r.policy_id)) {
        return { ...r, is_na: markNa, status: markNa ? 'na' : 'not_started' };
      }
      return r;
    }));
    for (const p of target) {
      try {
        await fetch(`${API_BASE}/api/veritapolicy/master-list/${encodeURIComponent(p.policy_id)}`, {
          method: "PATCH",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            status: markNa ? 'na' : 'not_started',
            is_na: markNa,
            na_reason: p.na_reason,
            our_policy_name: p.our_policy_name,
            notes: p.user_notes,
          }),
        });
      } catch { failed++; }
    }
    try {
      const sum = await fetch(`${API_BASE}/api/veritapolicy/master-list/summary`, { headers: authHeaders() }).then(r => r.json());
      setSummary(sum);
    } catch {}
    setBulkApplying(false);
    setBulkConfirm(null);
    if (failed > 0) {
      toast({ title: `${target.length - failed} updated, ${failed} failed`, variant: "destructive" });
    } else {
      toast({ title: `Marked ${target.length} ${bulkConfirm.section} policies as ${markNa ? 'N/A' : 'Applicable'}` });
    }
  }

  // ── Auth / plan gates ──────────────────────────────────────────────────────
  if (!isLoggedIn) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
        <Lock size={40} className="text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold text-foreground mb-2">Sign in to access VeritaPolicy&#8482;</h2>
        <p className="text-muted-foreground text-sm">Your policy compliance tracker requires a VeritaAssure&#8482; account.</p>
      </div>
    );
  }

  if (!hasPlanAccess) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
        <Lock size={40} className="text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold text-foreground mb-2">Upgrade to access VeritaPolicy&#8482;</h2>
        <p className="text-muted-foreground text-sm mb-4">VeritaPolicy&#8482; is included with all paid VeritaAssure&#8482; plans.</p>
        <a href="/pricing"><Button>View Plans</Button></a>
      </div>
    );
  }

  // ── Filter ─────────────────────────────────────────────────────────────────
  const sections = Array.from(new Set(policies.map(p => p.section))).sort();
  const serviceLines = Array.from(new Set(policies.map(p => p.service_line).filter(Boolean))).sort();

  const choice = settings.accreditation_choice || 'CLIA';
  const headerLabel = `${CHOICE_LABEL[choice] || choice} Policy Compliance Tracker`;

  const filtered = policies.filter(p => {
    if (filterStatus !== "all" && p.status !== filterStatus) return false;
    if (filterSection !== "all" && p.section !== filterSection) return false;
    if (filterServiceLine !== "all" && p.service_line !== filterServiceLine) return false;
    if (search) {
      const s = search.toLowerCase();
      const hay = [p.policy_id, p.policy_name, p.subspecialty, p.description, p.cfr_citations,
                    ...(p.ao_citations || []).map(a => a.value), p.our_policy_name || ""]
                    .join(" ").toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  });

  // Group by Section (preserving order of first appearance).
  const grouped: { section: string; rows: MasterPolicy[] }[] = [];
  const seenSections = new Set<string>();
  for (const p of filtered) {
    if (!seenSections.has(p.section)) {
      seenSections.add(p.section);
      grouped.push({ section: p.section, rows: [] });
    }
    grouped.find(g => g.section === p.section)!.rows.push(p);
  }

  const totalCols = 6 + (aoColumns.length > 0 ? 1 : 0); // ID, Policy, Citations, Our Policy, Status, N/A (+ optional AO column always merged with citations? we'll keep one citations column showing CFR + AO chips)

  return (
    <div className="container-default py-8 space-y-4">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">VeritaPolicy&#8482;</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {headerLabel}
            {summary ? ` - ${summary.total} policies (${aoLabel})` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleDownloadMasterList} disabled={downloadingMasterList} className="gap-1.5">
            <Download size={14} /> {downloadingMasterList ? "Generating..." : "Master List (Excel)"}
          </Button>
          <Button size="sm" onClick={handleDownloadPdf} disabled={downloadingPdf} className="gap-1.5">
            <Download size={14} /> {downloadingPdf ? "Generating..." : "Download PDF"}
          </Button>
        </div>
      </div>

      {/* Settings panel */}
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          onClick={() => setSettingsOpen(p => !p)}
          className="w-full flex items-center justify-between px-4 py-3 bg-muted/40 hover:bg-muted/60 transition-colors text-sm font-medium text-foreground"
        >
          <span>Lab Settings</span>
          {settingsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {settingsOpen && (
          <div className="px-4 py-4 grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-border bg-card">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-foreground">Independent Laboratory (not hospital-based)</span>
              <Toggle
                checked={!!settings.is_independent}
                disabled={isReadOnly}
                onChange={v => updateSetting("is_independent", v ? 1 : 0)}
              />
            </div>
            <p className="sm:col-span-2 text-xs text-muted-foreground">
              Independent labs have additional governance requirements. Use the N/A button on individual policies for service lines your lab does not offer.
            </p>
          </div>
        )}
      </div>

      {/* Summary bar */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Complete",    value: summary.complete,    color: "text-green-600 dark:text-green-400" },
            { label: "In Progress", value: summary.in_progress, color: "text-amber-600 dark:text-amber-400" },
            { label: "Not Started", value: summary.not_started, color: "text-muted-foreground" },
            { label: "N/A",         value: summary.na,          color: "text-muted-foreground" },
          ].map(s => (
            <div key={s.label} className="bg-card border border-border rounded-lg p-3 text-center">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Readiness bar */}
      {summary && summary.total > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-foreground">Readiness Score</span>
            <span className="text-sm font-bold text-primary">{summary.score}%</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2">
            <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${summary.score}%` }} />
          </div>
        </div>
      )}

      {/* Instruction banner */}
      <div className="bg-primary/5 border border-primary/20 rounded-lg px-4 py-3 text-sm text-muted-foreground">
        For each policy, enter the name of the policy in your manual that addresses it, then mark the status.
        Click the status badge to cycle: Not Started, In Progress, Complete. Use N/A for policies that do not apply.
        Click any row to expand the description, citations, and notes from the master list.
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search policies, citations, descriptions..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="border border-border rounded px-2 py-1 text-sm bg-background text-foreground h-8">
          <option value="all">All Statuses</option>
          <option value="not_started">Not Started</option>
          <option value="in_progress">In Progress</option>
          <option value="complete">Complete</option>
          <option value="na">N/A</option>
        </select>
        <select value={filterSection} onChange={e => setFilterSection(e.target.value)}
          className="border border-border rounded px-2 py-1 text-sm bg-background text-foreground h-8">
          <option value="all">All Sections</option>
          {sections.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {serviceLines.length > 1 && (
          <select value={filterServiceLine} onChange={e => setFilterServiceLine(e.target.value)}
            className="border border-border rounded px-2 py-1 text-sm bg-background text-foreground h-8">
            <option value="all">All Service Lines</option>
            {serviceLines.map(sl => <option key={sl} value={sl}>{sl}</option>)}
          </select>
        )}
      </div>

      {/* Master List table */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-3 py-2 font-semibold text-foreground w-20">ID</th>
                <th className="text-left px-3 py-2 font-semibold text-foreground">Policy</th>
                <th className="text-left px-3 py-2 font-semibold text-foreground min-w-[180px]">Citations</th>
                <th className="text-left px-3 py-2 font-semibold text-foreground min-w-[200px]">Our Policy Name</th>
                <th className="text-left px-3 py-2 font-semibold text-foreground w-28">Status</th>
                <th className="text-left px-3 py-2 font-semibold text-foreground w-14">N/A</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">Loading...</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No policies match your filters.</td></tr>
              )}
              {!loading && grouped.map(group => {
                const allNa = group.rows.every(r => r.is_na);
                return (
                  <React.Fragment key={`group-${group.section}`}>
                    <tr className="bg-muted/70 border-b border-border">
                      <td colSpan={6} className="px-3 py-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-foreground">
                            {group.section}
                            <span className="ml-2 font-normal text-muted-foreground">({group.rows.length})</span>
                          </span>
                          {!isReadOnly && group.rows.length > 0 && (
                            <div className="flex gap-1.5">
                              {!allNa && (
                                <button
                                  onClick={() => handleBulkNa(group.section, group.rows, true)}
                                  className="text-[11px] px-2 py-0.5 rounded border border-border text-muted-foreground hover:border-foreground hover:text-foreground transition-colors">
                                  Mark all N/A
                                </button>
                              )}
                              {allNa && (
                                <button
                                  onClick={() => handleBulkNa(group.section, group.rows, false)}
                                  className="text-[11px] px-2 py-0.5 rounded border border-border text-muted-foreground hover:border-foreground hover:text-foreground transition-colors">
                                  Mark all Applicable
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                    {group.rows.map((p, i) => {
                      const isExpanded = expandedRows.has(p.policy_id);
                      const isNa = p.is_na;
                      const statusCfg = STATUS_CONFIG[isNa ? "na" : p.status] || STATUS_CONFIG.not_started;
                      const policyVal = editingPolicyName[p.policy_id] ?? p.our_policy_name ?? "";

                      return (
                        <tr key={p.policy_id}
                          className={`border-b border-border last:border-0 ${i % 2 === 0 ? "bg-background" : "bg-muted/20"} ${isNa ? "opacity-60" : ""}`}>

                          {/* Policy ID + subspecialty + service line */}
                          <td className="px-3 py-2 align-top">
                            <div className="flex flex-col gap-1">
                              <span className="font-mono text-xs font-bold text-primary">{p.policy_id}</span>
                              {p.subspecialty && <Badge variant="outline" className="text-[10px] px-1 py-0 w-fit">{p.subspecialty}</Badge>}
                              {p.service_line && p.service_line !== "all" && (
                                <Badge variant="outline" className="text-[10px] px-1 py-0 w-fit">{p.service_line}</Badge>
                              )}
                            </div>
                          </td>

                          {/* Policy name + description */}
                          <td className="px-3 py-2 align-top">
                            <button className="text-left w-full"
                              onClick={() => setExpandedRows(prev => {
                                const next = new Set(prev);
                                next.has(p.policy_id) ? next.delete(p.policy_id) : next.add(p.policy_id);
                                return next;
                              })}>
                              <div className="flex items-start gap-1">
                                <span className={`text-foreground font-medium ${isNa ? "line-through text-muted-foreground" : ""}`}>{p.policy_name}</span>
                                {(p.description || p.notes) && (
                                  isExpanded
                                    ? <ChevronUp size={12} className="shrink-0 mt-1 text-muted-foreground" />
                                    : <ChevronRight size={12} className="shrink-0 mt-1 text-muted-foreground" />
                                )}
                              </div>
                              {isExpanded && p.description && (
                                <div className="text-xs text-muted-foreground mt-2 leading-relaxed border-l-2 border-primary/30 pl-2">
                                  {p.description}
                                </div>
                              )}
                              {isExpanded && p.notes && (
                                <div className="text-[11px] text-muted-foreground mt-2 leading-relaxed border-l-2 border-amber-400/40 pl-2 italic">
                                  <span className="not-italic font-semibold">Notes from master list: </span>{p.notes}
                                </div>
                              )}
                            </button>
                          </td>

                          {/* Citations: CFR + AO chips */}
                          <td className="px-3 py-2 align-top">
                            <div className="flex flex-col gap-1.5">
                              {p.cfr_citations && (
                                <div className="text-[11px]">
                                  <span className="font-mono font-bold text-primary mr-1">CFR</span>
                                  <span className="text-foreground">{p.cfr_citations}</span>
                                </div>
                              )}
                              {(p.ao_citations || []).filter(a => a.value).map(a => (
                                <div key={a.label} className="text-[11px]">
                                  <span className="font-mono font-bold text-primary mr-1">{a.label}</span>
                                  <span className="text-foreground">{a.value}</span>
                                </div>
                              ))}
                              {!p.cfr_citations && !(p.ao_citations || []).some(a => a.value) && (
                                <span className="text-[11px] text-muted-foreground italic">No citations</span>
                              )}
                            </div>
                          </td>

                          {/* Our Policy Name */}
                          <td className="px-3 py-2 align-top">
                            <Input
                              value={policyVal}
                              disabled={isNa || isReadOnly}
                              placeholder={isNa ? "N/A" : "e.g. QC Policy (POL-003)"}
                              className="h-7 text-xs"
                              onChange={e => setEditingPolicyName(prev => ({ ...prev, [p.policy_id]: e.target.value }))}
                              onBlur={() => {
                                const val = editingPolicyName[p.policy_id];
                                if (val !== undefined && val !== p.our_policy_name) {
                                  updatePolicy(p, { our_policy_name: val });
                                  setEditingPolicyName(prev => { const n = { ...prev }; delete n[p.policy_id]; return n; });
                                }
                              }}
                              onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                            />
                          </td>

                          {/* Status */}
                          <td className="px-3 py-2 align-top">
                            <button
                              disabled={isReadOnly || isNa}
                              onClick={() => cycleStatus(p)}
                              title={isNa ? "Marked N/A" : "Click to change status"}
                              className={`px-2 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${statusCfg.color} ${isReadOnly || isNa ? "cursor-default" : "cursor-pointer hover:opacity-80"}`}>
                              {statusCfg.label}
                            </button>
                          </td>

                          {/* N/A toggle */}
                          <td className="px-3 py-2 align-top">
                            <button
                              disabled={isReadOnly}
                              onClick={() => updatePolicy(p, { is_na: !isNa, status: isNa ? "not_started" : p.status })}
                              title={isNa ? "Mark as applicable" : "Mark as N/A"}
                              className={`text-xs px-1.5 py-1 rounded border transition-colors ${isNa ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:border-foreground"}`}>
                              N/A
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Policy library -- Coming Soon */}
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex items-center gap-3 mb-2">
          <h2 className="text-base font-semibold text-foreground">Policy Library</h2>
          <Badge variant="outline" className="text-xs gap-1"><Clock size={10} /> Coming Soon</Badge>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Upload policy documents, track review dates, manage approval workflows, and give staff read-only access to current approved policies.
          Policy library management is coming in a future update.
        </p>
      </div>

      {/* Bulk N/A confirmation dialog */}
      {bulkConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !bulkApplying && setBulkConfirm(null)}>
          <div className="bg-card border border-border rounded-lg p-6 max-w-md mx-4 shadow-lg" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-foreground mb-2">
              {bulkConfirm.markNa ? "Mark section as N/A?" : "Mark section as Applicable?"}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              {bulkConfirm.markNa
                ? `Mark all ${bulkConfirm.rows.filter(r => !r.is_na).length} ${bulkConfirm.section} policies as N/A?`
                : `Mark all ${bulkConfirm.rows.filter(r => r.is_na).length} ${bulkConfirm.section} policies as Applicable?`}
            </p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" disabled={bulkApplying} onClick={() => setBulkConfirm(null)}>Cancel</Button>
              <Button size="sm" disabled={bulkApplying} onClick={confirmBulkNa}>
                {bulkApplying ? "Applying..." : bulkConfirm.markNa ? "Mark N/A" : "Mark Applicable"}
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
