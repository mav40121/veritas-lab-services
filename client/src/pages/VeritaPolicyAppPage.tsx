import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/components/AuthContext";
import { useIsReadOnly } from "@/lib/useIsReadOnly";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock, Download, Settings, Search, ChevronDown, ChevronUp, Clock } from "lucide-react";
import { API_BASE, authHeaders } from "@/lib/auth";

// ── Types ──────────────────────────────────────────────────────────────────────
interface PolicySettings {
  id: number;
  user_id: number;
  has_blood_bank: number;
  has_transplant: number;
  has_microbiology: number;
  has_maternal_serum: number;
  is_independent: number;
  waived_only: number;
  accreditation_body: string; // "tjc" | "cap" | "both"
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
  source: string; // "tjc" | "cap"
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

// ── Setup wizard questions ─────────────────────────────────────────────────────
const WIZARD_QUESTIONS = [
  { key: "accreditation_body", label: "Which accreditation body applies to your lab?", type: "select", options: [
    { value: "tjc", label: "The Joint Commission (TJC)" },
    { value: "cap", label: "College of American Pathologists (CAP)" },
    { value: "both", label: "Both TJC and CAP" },
  ]},
  { key: "has_blood_bank", label: "Does your lab have a Blood Bank / Transfusion Service?", type: "yesno" },
  { key: "has_transplant", label: "Does your lab perform Transplant testing?", type: "yesno" },
  { key: "has_microbiology", label: "Does your lab have a Microbiology section?", type: "yesno" },
  { key: "has_maternal_serum", label: "Does your lab perform Maternal Serum Marker screening?", type: "yesno" },
  { key: "is_independent", label: "Is your lab an independent laboratory (not hospital-based)?", type: "yesno" },
  { key: "waived_only", label: "Does your lab perform Waived testing ONLY?", type: "yesno" },
];

// ── Status config ──────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; color: string; next: string }> = {
  not_started: { label: "Not Started", color: "bg-muted text-muted-foreground", next: "in_progress" },
  in_progress: { label: "In Progress", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", next: "complete" },
  complete:    { label: "Complete",    color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", next: "not_started" },
  na:          { label: "N/A",         color: "bg-muted/50 text-muted-foreground line-through", next: "not_started" },
};

// ── SetupWizard ───────────────────────────────────────────────────────────────
function SetupWizard({ onComplete, existing }: { onComplete: (s: Record<string, any>) => void; existing: PolicySettings | null }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({
    accreditation_body: existing?.accreditation_body || "tjc",
    has_blood_bank: existing?.has_blood_bank ?? 1,
    has_transplant: existing?.has_transplant ?? 0,
    has_microbiology: existing?.has_microbiology ?? 1,
    has_maternal_serum: existing?.has_maternal_serum ?? 0,
    is_independent: existing?.is_independent ?? 0,
    waived_only: existing?.waived_only ?? 0,
  });

  const q = WIZARD_QUESTIONS[step];

  function answer(val: any) {
    const updated = { ...answers, [q.key]: val };
    setAnswers(updated);
    if (step < WIZARD_QUESTIONS.length - 1) {
      setStep(step + 1);
    } else {
      onComplete(updated);
    }
  }

  const progress = ((step) / WIZARD_QUESTIONS.length) * 100;

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-lg">
        <h1 className="text-2xl font-bold text-foreground text-center mb-2">VeritaPolicy&#8482; Setup</h1>
        <p className="text-muted-foreground text-center text-sm mb-6">
          Answer a few questions to customize which policy requirements apply to your lab.
        </p>
        {/* Progress bar */}
        <div className="w-full bg-muted rounded-full h-1.5 mb-8">
          <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-xs text-muted-foreground mb-1">Question {step + 1} of {WIZARD_QUESTIONS.length}</p>
          <p className="text-base font-semibold text-foreground mb-5">{q.label}</p>
          {q.type === "select" ? (
            <div className="space-y-2">
              {q.options!.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => answer(opt.value)}
                  className={`w-full text-left px-4 py-3 rounded-lg border transition-colors text-sm font-medium
                    ${answers[q.key] === opt.value
                      ? "bg-primary text-white border-primary"
                      : "bg-background text-foreground border-border hover:border-primary"}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex gap-3">
              <button onClick={() => answer(1)}
                className={`flex-1 py-3 rounded-lg border font-medium text-sm transition-colors
                  ${answers[q.key] === 1 ? "bg-primary text-white border-primary" : "bg-background text-foreground border-border hover:border-primary"}`}>
                Yes
              </button>
              <button onClick={() => answer(0)}
                className={`flex-1 py-3 rounded-lg border font-medium text-sm transition-colors
                  ${answers[q.key] === 0 ? "bg-primary text-white border-primary" : "bg-background text-foreground border-border hover:border-primary"}`}>
                No
              </button>
            </div>
          )}
        </div>
        {step > 0 && (
          <button onClick={() => setStep(step - 1)} className="mt-4 text-sm text-muted-foreground hover:text-foreground transition-colors mx-auto block">
            Back
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function VeritaPolicyAppPage() {
  const { user, isLoggedIn } = useAuth();
  const isReadOnly = useIsReadOnly();
  const { toast } = useToast();

  const hasPlanAccess = !!user && ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "waived", "community", "hospital", "large_hospital"].includes(user.plan);

  const [settings, setSettings] = useState<PolicySettings | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [showWizard, setShowWizard] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  // Filter/search state
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterChapter, setFilterChapter] = useState("all");
  const [filterSource, setFilterSource] = useState("all");
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  // Inline editing state: reqId -> policy_name being typed
  const [editingPolicyName, setEditingPolicyName] = useState<Record<number, string>>({});

  const loadAll = useCallback(async () => {
    try {
      const [settingsRes, summaryRes, reqRes] = await Promise.all([
        fetch(`${API_BASE}/api/veritapolicy/settings`, { headers: authHeaders() }),
        fetch(`${API_BASE}/api/veritapolicy/summary`, { headers: authHeaders() }),
        fetch(`${API_BASE}/api/veritapolicy/requirements`, { headers: authHeaders() }),
      ]);
      const [s, sum, r] = await Promise.all([settingsRes.json(), summaryRes.json(), reqRes.json()]);
      setSettings(s);
      setSummary(sum);
      setRequirements(r);
      if (!s.setup_complete) setShowWizard(true);
    } catch {
      toast({ title: "Error loading data", variant: "destructive" });
    }
  }, [toast]);

  useEffect(() => {
    if (isLoggedIn && hasPlanAccess) loadAll();
  }, [isLoggedIn, hasPlanAccess, loadAll]);

  async function handleWizardComplete(answers: Record<string, any>) {
    try {
      await fetch(`${API_BASE}/api/veritapolicy/settings`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ ...answers, setup_complete: true }),
      });
      setShowWizard(false);
      setSettings(prev => prev ? { ...prev, ...answers, setup_complete: 1 } : prev);
      // Reload without re-triggering wizard
      const [sum, r] = await Promise.all([
        fetch(`${API_BASE}/api/veritapolicy/summary`, { headers: authHeaders() }).then(res => res.json()),
        fetch(`${API_BASE}/api/veritapolicy/requirements`, { headers: authHeaders() }).then(res => res.json()),
      ]);
      setSummary(sum);
      setRequirements(r);
    } catch {
      toast({ title: "Error saving settings", variant: "destructive" });
    }
  }

  async function updateRequirement(req: Requirement, patch: Partial<Requirement>) {
    const updated = { ...req, ...patch };
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
      // Refresh summary
      const sum = await fetch(`${API_BASE}/api/veritapolicy/summary`, { headers: authHeaders() }).then(r => r.json());
      setSummary(sum);
    } catch {
      toast({ title: "Error saving", variant: "destructive" });
      setRequirements(prev => prev.map(r => r.id === req.id ? req : r)); // rollback
    }
  }

  function cycleStatus(req: Requirement) {
    if (req.auto_na || req.is_na) return;
    const next = STATUS_CONFIG[req.status]?.next || "not_started";
    updateRequirement(req, { status: next });
  }

  async function handleDownloadPdf() {
    setDownloadingPdf(true);
    try {
      const res = await fetch(`${API_BASE}/api/veritapolicy/pdf`, {
        method: "POST",
        headers: authHeaders(),
      });
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

  if (showWizard) {
    return <SetupWizard onComplete={handleWizardComplete} existing={settings} />;
  }

  // ── Filter requirements ────────────────────────────────────────────────────
  const chapters = Array.from(new Set(requirements.map(r => r.chapter))).sort();
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

  const accredBody = settings?.accreditation_body || "tjc";
  const showBothSources = accredBody === "both";

  return (
    <div className="container-default py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">VeritaPolicy&#8482;</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Track required policies for{" "}
            {accredBody === "tjc" ? "TJC accreditation" : accredBody === "cap" ? "CAP accreditation" : "TJC and CAP accreditation"}.
            {summary && ` ${summary.total} applicable requirements.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowWizard(true)} className="gap-1.5">
            <Settings size={14} /> Settings
          </Button>
          <Button size="sm" onClick={handleDownloadPdf} disabled={downloadingPdf} className="gap-1.5">
            <Download size={14} /> {downloadingPdf ? "Generating..." : "Download PDF"}
          </Button>
        </div>
      </div>

      {/* Summary bar */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Complete", value: summary.complete, color: "text-green-600 dark:text-green-400" },
            { label: "In Progress", value: summary.in_progress, color: "text-amber-600 dark:text-amber-400" },
            { label: "Not Started", value: summary.not_started, color: "text-muted-foreground" },
            { label: "N/A", value: summary.na, color: "text-muted-foreground" },
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

      {/* Info banner */}
      <div className="bg-primary/5 border border-primary/20 rounded-lg px-4 py-3 text-sm text-muted-foreground">
        For each applicable requirement, enter the name of the policy in your policy manual that addresses it.
        Click the status badge to cycle through Not Started, In Progress, and Complete.
        Use N/A for requirements that do not apply to your lab.
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
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="border border-border rounded px-2 py-1 text-sm bg-background text-foreground h-8"
        >
          <option value="all">All Statuses</option>
          <option value="not_started">Not Started</option>
          <option value="in_progress">In Progress</option>
          <option value="complete">Complete</option>
          <option value="na">N/A</option>
        </select>
        <select
          value={filterChapter}
          onChange={e => setFilterChapter(e.target.value)}
          className="border border-border rounded px-2 py-1 text-sm bg-background text-foreground h-8"
        >
          <option value="all">All Chapters</option>
          {chapters.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {showBothSources && (
          <select
            value={filterSource}
            onChange={e => setFilterSource(e.target.value)}
            className="border border-border rounded px-2 py-1 text-sm bg-background text-foreground h-8"
          >
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
                <th className="text-left px-3 py-2 font-semibold text-foreground w-16">N/A</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                    No requirements match your filters.
                  </td>
                </tr>
              )}
              {filtered.map((req, i) => {
                const isExpanded = expandedRows.has(req.id);
                const isNa = req.is_na;
                const statusCfg = STATUS_CONFIG[isNa ? "na" : req.status] || STATUS_CONFIG.not_started;
                const policyVal = editingPolicyName[req.id] ?? req.policy_name ?? "";

                return (
                  <tr
                    key={req.id}
                    className={`border-b border-border last:border-0 ${i % 2 === 0 ? "bg-background" : "bg-muted/20"} ${isNa ? "opacity-50" : ""}`}
                  >
                    {/* Chapter */}
                    <td className="px-3 py-2 align-top">
                      <div className="flex flex-col gap-1">
                        <span className="font-mono text-xs font-bold text-primary">{req.chapter}</span>
                        {showBothSources && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0 w-fit">{req.source?.toUpperCase()}</Badge>
                        )}
                      </div>
                    </td>

                    {/* Requirement name + expand */}
                    <td className="px-3 py-2 align-top">
                      <button
                        className="text-left w-full"
                        onClick={() => setExpandedRows(prev => {
                          const next = new Set(prev);
                          next.has(req.id) ? next.delete(req.id) : next.add(req.id);
                          return next;
                        })}
                      >
                        <div className="flex items-start gap-1">
                          <span className={`text-foreground ${isNa ? "line-through text-muted-foreground" : ""} text-left`}>
                            {req.name}
                          </span>
                          {isExpanded ? <ChevronUp size={12} className="shrink-0 mt-1 text-muted-foreground" /> : <ChevronDown size={12} className="shrink-0 mt-1 text-muted-foreground" />}
                        </div>
                        {req.standard && (
                          <div className="text-xs text-muted-foreground mt-0.5">{req.standard}</div>
                        )}
                        {isExpanded && req.description && (
                          <div className="text-xs text-muted-foreground mt-2 leading-relaxed border-l-2 border-primary/30 pl-2">
                            {req.description}
                          </div>
                        )}
                      </button>
                    </td>

                    {/* Policy name input */}
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
                        onKeyDown={e => {
                          if (e.key === "Enter") {
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                      />
                    </td>

                    {/* Status badge -- click to cycle */}
                    <td className="px-3 py-2 align-top">
                      <button
                        disabled={req.auto_na || isReadOnly}
                        onClick={() => cycleStatus(req)}
                        title={req.auto_na ? "Auto N/A from service line settings" : "Click to change status"}
                        className={`px-2 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${statusCfg.color} ${req.auto_na || isReadOnly ? "cursor-default" : "cursor-pointer hover:opacity-80"}`}
                      >
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
                          className={`text-xs px-1.5 py-1 rounded border transition-colors ${isNa ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:border-foreground"}`}
                        >
                          N/A
                        </button>
                      )}
                    </td>
                  </tr>
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
          <Badge variant="outline" className="text-xs gap-1">
            <Clock size={10} /> Coming Soon
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Upload your policy documents, track review dates, manage approval workflows, and give staff read-only access to current approved policies.
          Policy library management is coming in a future update.
        </p>
      </div>
    </div>
  );
}
