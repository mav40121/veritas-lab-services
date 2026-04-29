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
  has_blood_bank: number;  // deprecated: column retained in schema, no longer used in UI or auto-N/A logic
  has_transplant: number;  // deprecated: column retained in schema, no longer used in UI or auto-N/A logic
  has_microbiology: number;  // deprecated: column retained in schema, no longer used in UI or auto-N/A logic
  has_maternal_serum: number;  // deprecated: column retained in schema, no longer used in UI or auto-N/A logic
  is_independent: number;
  waived_only: number;  // deprecated: column retained in schema, no longer used in UI or auto-N/A logic
  accreditation_body: string;
  setup_complete: number;
}

interface Requirement {
  id: number;
  chapter: string;
  chapter_label: string;
  standard: string;
  name: string;
  description: string;
  service_line: string;
  source: string;
  status: string;
  is_na: boolean;
  auto_na: boolean;
  na_reason: string | null;
  policy_name: string | null;
  notes: string | null;
}

interface Summary {
  total: number;
  complete: number;
  in_progress: number;
  not_started: number;
  na: number;
  score: number;
  setup_complete: number;
}

// ── Status config ──────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; color: string; next: string }> = {
  not_started: { label: "Not Started", color: "bg-muted text-muted-foreground", next: "in_progress" },
  in_progress:  { label: "In Progress", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", next: "complete" },
  complete:     { label: "Complete",    color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", next: "not_started" },
  na:           { label: "N/A",         color: "bg-muted/50 text-muted-foreground", next: "not_started" },
};

const DEFAULT_SETTINGS: PolicySettings = {
  has_blood_bank: 1,
  has_transplant: 0,
  has_microbiology: 1,
  has_maternal_serum: 0,
  is_independent: 0,
  waived_only: 0,
  accreditation_body: "tjc",
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
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [loading, setLoading] = useState(true);

  // Filter/search state
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterChapter, setFilterChapter] = useState("all");
  const [filterSource, setFilterSource] = useState("all");
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [editingPolicyName, setEditingPolicyName] = useState<Record<number, string>>({});
  const [bulkConfirm, setBulkConfirm] = useState<{ chapter: string; label: string; reqs: Requirement[]; markNa: boolean } | null>(null);
  const [bulkApplying, setBulkApplying] = useState(false);

  // Debounce settings save
  const settingsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, summaryRes, reqRes] = await Promise.all([
        fetch(`${API_BASE}/api/veritapolicy/settings`, { headers: authHeaders() }),
        fetch(`${API_BASE}/api/veritapolicy/summary`, { headers: authHeaders() }),
        fetch(`${API_BASE}/api/veritapolicy/requirements`, { headers: authHeaders() }),
      ]);
      const [s, sum, r] = await Promise.all([settingsRes.json(), summaryRes.json(), reqRes.json()]);
      setSettings({ ...DEFAULT_SETTINGS, ...s });
      setSummary(sum);
      setRequirements(r);
      // Default source filter to match the lab's accreditation body setting
      const ab = s?.accreditation_body || 'tjc';
      setFilterSource(ab === 'both' ? 'all' : ab);
      // Show settings panel on first visit (setup not yet complete)
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

  // Save settings and reload requirements when settings change
  async function saveSettings(updated: PolicySettings) {
    if (settingsSaveTimer.current) clearTimeout(settingsSaveTimer.current);
    settingsSaveTimer.current = setTimeout(async () => {
      try {
        await fetch(`${API_BASE}/api/veritapolicy/settings`, {
          method: "PUT",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ ...updated, setup_complete: true }),
        });
        // Reload requirements and summary since applicability may have changed
        const [sumRes, reqRes] = await Promise.all([
          fetch(`${API_BASE}/api/veritapolicy/summary`, { headers: authHeaders() }),
          fetch(`${API_BASE}/api/veritapolicy/requirements`, { headers: authHeaders() }),
        ]);
        const [sum, r] = await Promise.all([sumRes.json(), reqRes.json()]);
        setSummary(sum);
        setRequirements(r);
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

  async function updateRequirement(req: Requirement, patch: Partial<Requirement>) {
    setRequirements(prev => prev.map(r => r.id === req.id ? { ...r, ...patch } : r));
    try {
      await fetch(`${API_BASE}/api/veritapolicy/requirements/${req.id}`, {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          status: patch.status ?? req.status,
          is_na: patch.is_na ?? req.is_na,
          na_reason: patch.na_reason ?? req.na_reason,
          policy_name: patch.policy_name ?? req.policy_name,
          notes: patch.notes ?? req.notes,
        }),
      });
      const sum = await fetch(`${API_BASE}/api/veritapolicy/summary`, { headers: authHeaders() }).then(r => r.json());
      setSummary(sum);
    } catch {
      toast({ title: "Error saving", variant: "destructive" });
      setRequirements(prev => prev.map(r => r.id === req.id ? req : r));
    }
  }

  function cycleStatus(req: Requirement) {
    if (req.auto_na || req.is_na || isReadOnly) return;
    const next = STATUS_CONFIG[req.status]?.next || "not_started";
    updateRequirement(req, { status: next });
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

  async function handleBulkNa(chapter: string, chapterLabel: string, reqs: Requirement[], markNa: boolean) {
    setBulkConfirm({ chapter, label: chapterLabel, reqs, markNa });
  }

  async function confirmBulkNa() {
    if (!bulkConfirm) return;
    setBulkApplying(true);
    const { reqs, markNa } = bulkConfirm;
    const target = reqs.filter(r => !r.auto_na && r.is_na !== markNa);
    let failed = 0;
    // Optimistic update
    setRequirements(prev => prev.map(r => {
      if (target.some(t => t.id === r.id)) {
        return { ...r, is_na: markNa, status: markNa ? 'na' : 'not_started' };
      }
      return r;
    }));
    // Send individual PATCH requests (reuses existing endpoint)
    for (const req of target) {
      try {
        await fetch(`${API_BASE}/api/veritapolicy/requirements/${req.id}`, {
          method: "PATCH",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            status: markNa ? 'na' : 'not_started',
            is_na: markNa,
            na_reason: req.na_reason,
            policy_name: req.policy_name,
            notes: req.notes,
          }),
        });
      } catch { failed++; }
    }
    // Refresh summary
    try {
      const sum = await fetch(`${API_BASE}/api/veritapolicy/summary`, { headers: authHeaders() }).then(r => r.json());
      setSummary(sum);
    } catch {}
    setBulkApplying(false);
    setBulkConfirm(null);
    if (failed > 0) {
      toast({ title: `${target.length - failed} updated, ${failed} failed`, variant: "destructive" });
    } else {
      toast({ title: `Marked ${target.length} ${bulkConfirm.chapter} requirements as ${markNa ? 'N/A' : 'Applicable'}` });
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

  // ── Filter requirements ────────────────────────────────────────────────────
  const chapters = Array.from(new Set(requirements.map(r => r.chapter))).sort();
  const showBothSources = settings.accreditation_body === 'both';

  const filtered = requirements.filter(r => {
    if (filterStatus !== "all" && r.status !== filterStatus) return false;
    if (filterChapter !== "all" && r.chapter !== filterChapter) return false;
    if (filterSource !== "all" && r.source !== filterSource) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!r.name.toLowerCase().includes(s) && !r.standard.toLowerCase().includes(s) && !(r.policy_name || "").toLowerCase().includes(s)) return false;
    }
    return true;
  });

  // Group filtered requirements by chapter (preserving order)
  const groupedByChapter: { chapter: string; label: string; reqs: Requirement[] }[] = [];
  const seenChapters = new Set<string>();
  for (const r of filtered) {
    if (!seenChapters.has(r.chapter)) {
      seenChapters.add(r.chapter);
      groupedByChapter.push({ chapter: r.chapter, label: r.chapter_label, reqs: [] });
    }
    groupedByChapter.find(g => g.chapter === r.chapter)!.reqs.push(r);
  }

  return (
    <div className="container-default py-8 space-y-4">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">VeritaPolicy&#8482;</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            TJC + CAP Policy Compliance Tracker
            {summary ? ` - ${summary.total} applicable requirements` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
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

            {/* Lab type toggle */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-foreground">Independent Laboratory (not hospital-based)</span>
              <Toggle
                checked={!!settings.is_independent}
                disabled={isReadOnly}
                onChange={v => updateSetting("is_independent", v ? 1 : 0)}
              />
            </div>
            <p className="sm:col-span-2 text-xs text-muted-foreground">
              Independent labs have additional governance requirements. Use the N/A button on individual requirements for service lines your lab does not offer.
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
        For each requirement, enter the name of the policy in your manual that addresses it, then mark the status.
        Click the status badge to cycle: Not Started, In Progress, Complete. Use N/A for requirements that do not apply.
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search requirements or policies..."
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
        <select value={filterChapter} onChange={e => setFilterChapter(e.target.value)}
          className="border border-border rounded px-2 py-1 text-sm bg-background text-foreground h-8">
          <option value="all">All Chapters</option>
          {chapters.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {showBothSources && (
          <select value={filterSource} onChange={e => setFilterSource(e.target.value)}
            className="border border-border rounded px-2 py-1 text-sm bg-background text-foreground h-8">
            <option value="all">TJC + CAP</option>
            <option value="tjc">TJC Only</option>
            <option value="cap">CAP Only</option>
          </select>
        )}
      </div>

      {/* Requirements table */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-3 py-2 font-semibold text-foreground w-16">Chapter</th>
                <th className="text-left px-3 py-2 font-semibold text-foreground">Requirement</th>
                <th className="text-left px-3 py-2 font-semibold text-foreground min-w-[200px]">Our Policy Name</th>
                <th className="text-left px-3 py-2 font-semibold text-foreground w-28">Status</th>
                <th className="text-left px-3 py-2 font-semibold text-foreground w-14">N/A</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">Loading...</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">No requirements match your filters.</td></tr>
              )}
              {!loading && groupedByChapter.map(group => {
                const allNa = group.reqs.filter(r => !r.auto_na).every(r => r.is_na);
                const manualReqs = group.reqs.filter(r => !r.auto_na);
                return (
                  <React.Fragment key={`group-${group.chapter}`}>
                    {/* Category section header */}
                    <tr className="bg-muted/70 border-b border-border">
                      <td colSpan={5} className="px-3 py-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-foreground">
                            {group.chapter} - {group.label}
                            <span className="ml-2 font-normal text-muted-foreground">({group.reqs.length})</span>
                          </span>
                          {!isReadOnly && manualReqs.length > 0 && (
                            <div className="flex gap-1.5">
                              {!allNa && (
                                <button
                                  onClick={() => handleBulkNa(group.chapter, group.label, group.reqs, true)}
                                  className="text-[11px] px-2 py-0.5 rounded border border-border text-muted-foreground hover:border-foreground hover:text-foreground transition-colors">
                                  Mark all N/A
                                </button>
                              )}
                              {allNa && (
                                <button
                                  onClick={() => handleBulkNa(group.chapter, group.label, group.reqs, false)}
                                  className="text-[11px] px-2 py-0.5 rounded border border-border text-muted-foreground hover:border-foreground hover:text-foreground transition-colors">
                                  Mark all Applicable
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                    {group.reqs.map((req, i) => {
                      const isExpanded = expandedRows.has(req.id);
                      const isNa = req.is_na;
                      const statusCfg = STATUS_CONFIG[isNa ? "na" : req.status] || STATUS_CONFIG.not_started;
                      const policyVal = editingPolicyName[req.id] ?? req.policy_name ?? "";

                      return (
                        <tr key={req.id}
                          className={`border-b border-border last:border-0 ${i % 2 === 0 ? "bg-background" : "bg-muted/20"} ${isNa ? "opacity-50" : ""}`}>

                          {/* Chapter */}
                          <td className="px-3 py-2 align-top">
                            <div className="flex flex-col gap-1">
                              <span className="font-mono text-xs font-bold text-primary">{req.chapter}</span>
                              {showBothSources && (
                                <Badge variant="outline" className="text-[10px] px-1 py-0 w-fit">{req.source?.toUpperCase()}</Badge>
                              )}
                            </div>
                          </td>

                          {/* Requirement name */}
                          <td className="px-3 py-2 align-top">
                            <button className="text-left w-full"
                              onClick={() => setExpandedRows(prev => {
                                const next = new Set(prev);
                                next.has(req.id) ? next.delete(req.id) : next.add(req.id);
                                return next;
                              })}>
                              <div className="flex items-start gap-1">
                                <span className={`text-foreground ${isNa ? "line-through text-muted-foreground" : ""}`}>{req.name}</span>
                                {req.description && (
                                  isExpanded
                                    ? <ChevronUp size={12} className="shrink-0 mt-1 text-muted-foreground" />
                                    : <ChevronRight size={12} className="shrink-0 mt-1 text-muted-foreground" />
                                )}
                              </div>
                              {req.standard && <div className="text-xs text-muted-foreground mt-0.5">{req.standard}</div>}
                              {isExpanded && req.description && (
                                <div className="text-xs text-muted-foreground mt-2 leading-relaxed border-l-2 border-primary/30 pl-2">
                                  {req.description}
                                </div>
                              )}
                            </button>
                          </td>

                          {/* Policy name */}
                          <td className="px-3 py-2 align-top">
                            <Input
                              value={policyVal}
                              disabled={isNa || isReadOnly}
                              placeholder={isNa ? "N/A" : "e.g. QC Policy (POL-003)"}
                              className="h-7 text-xs"
                              onChange={e => setEditingPolicyName(prev => ({ ...prev, [req.id]: e.target.value }))}
                              onBlur={() => {
                                const val = editingPolicyName[req.id];
                                if (val !== undefined && val !== req.policy_name) {
                                  updateRequirement(req, { policy_name: val });
                                  setEditingPolicyName(prev => { const n = { ...prev }; delete n[req.id]; return n; });
                                }
                              }}
                              onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                            />
                          </td>

                          {/* Status */}
                          <td className="px-3 py-2 align-top">
                            <button
                              disabled={req.auto_na || isReadOnly}
                              onClick={() => cycleStatus(req)}
                              title={req.auto_na ? "Auto N/A from lab settings" : "Click to change status"}
                              className={`px-2 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${statusCfg.color} ${req.auto_na || isReadOnly ? "cursor-default" : "cursor-pointer hover:opacity-80"}`}>
                              {req.auto_na ? "N/A (Auto)" : statusCfg.label}
                            </button>
                          </td>

                          {/* N/A toggle */}
                          <td className="px-3 py-2 align-top">
                            {!req.auto_na && (
                              <button
                                disabled={isReadOnly}
                                onClick={() => updateRequirement(req, { is_na: !isNa, status: isNa ? "not_started" : req.status })}
                                title={isNa ? "Mark as applicable" : "Mark as N/A"}
                                className={`text-xs px-1.5 py-1 rounded border transition-colors ${isNa ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:border-foreground"}`}>
                                N/A
                              </button>
                            )}
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
              {bulkConfirm.markNa ? "Mark category as N/A?" : "Mark category as Applicable?"}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              {bulkConfirm.markNa
                ? `Mark all ${bulkConfirm.reqs.filter(r => !r.auto_na && !r.is_na).length} ${bulkConfirm.chapter} requirements as N/A?`
                : `Mark all ${bulkConfirm.reqs.filter(r => !r.auto_na && r.is_na).length} ${bulkConfirm.chapter} requirements as Applicable?`}
              {" "}This affects the {bulkConfirm.chapter} ({bulkConfirm.label}) category.
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
