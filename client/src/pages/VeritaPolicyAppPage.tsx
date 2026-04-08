import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { useAuth } from "@/components/AuthContext";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Lock,
  Users,
  FileDown,
  Settings,
  Plus,
  Edit2,
  Trash2,
  Upload,
  CheckCircle2,
  Clock,
  X,
  Link2,
  AlertTriangle,
  Search,
  RotateCcw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Types ───────────────────────────────────────────────────────────────────

interface PolicySettings {
  has_blood_bank: number;
  has_transplant: number;
  has_microbiology: number;
  has_maternal_serum: number;
  is_independent: number;
  waived_only: number;
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
  status: "not_started" | "in_progress" | "complete" | "na";
  is_na: boolean;
  auto_na: boolean;
  na_reason: string | null;
  lab_policy_id: number | null;
  lab_policy: { id: number; policy_number: string | null; policy_name: string } | null;
  notes: string | null;
  updated_at: string | null;
}

interface LabPolicy {
  id: number;
  user_id: number;
  policy_number: string | null;
  policy_name: string;
  owner: string | null;
  status: "not_started" | "in_progress" | "complete";
  last_reviewed: string | null;
  next_review: string | null;
  notes: string | null;
  document_name: string | null;
  document_path: string | null;
  requirements_covered: number;
  created_at: string;
  updated_at: string;
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

// ── Constants ────────────────────────────────────────────────────────────────

const CHAPTERS = [
  { value: "APR", label: "APR - Accreditation Participation" },
  { value: "DC", label: "DC - Document and Process Control" },
  { value: "EC", label: "EC - Environment of Care" },
  { value: "EM", label: "EM - Emergency Management" },
  { value: "HR", label: "HR - Human Resources" },
  { value: "IC", label: "IC - Infection Prevention and Control" },
  { value: "IM", label: "IM - Information Management" },
  { value: "LD", label: "LD - Leadership" },
  { value: "PI", label: "PI - Performance Improvement" },
  { value: "QSA", label: "QSA - Quality System Assessment" },
  { value: "SE", label: "SE - Safety and Equipment" },
  { value: "TS", label: "TS - Transplant Safety" },
  { value: "WT", label: "WT - Waived Testing" },
];

const STATUS_CYCLE: Record<string, "not_started" | "in_progress" | "complete"> = {
  not_started: "in_progress",
  in_progress: "complete",
  complete: "not_started",
};

// ── Helper components ────────────────────────────────────────────────────────

function StatusBadge({ status, autoNa }: { status: string; autoNa?: boolean }) {
  if (status === "na") {
    return (
      <Badge variant="outline" className="text-xs font-medium border-border text-muted-foreground bg-muted/40">
        {autoNa ? "N/A (Auto)" : "N/A"}
      </Badge>
    );
  }
  if (status === "complete") {
    return (
      <Badge variant="outline" className="text-xs font-medium border-green-500/30 text-green-700 bg-green-500/10">
        Complete
      </Badge>
    );
  }
  if (status === "in_progress") {
    return (
      <Badge variant="outline" className="text-xs font-medium border-amber-500/30 text-amber-700 bg-amber-500/10">
        In Progress
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs font-medium border-border text-muted-foreground">
      Not Started
    </Badge>
  );
}

function PolicyStatusBadge({ status }: { status: string }) {
  if (status === "complete") {
    return <Badge variant="outline" className="text-xs border-green-500/30 text-green-700 bg-green-500/10">Complete</Badge>;
  }
  if (status === "in_progress") {
    return <Badge variant="outline" className="text-xs border-amber-500/30 text-amber-700 bg-amber-500/10">In Progress</Badge>;
  }
  return <Badge variant="outline" className="text-xs border-border text-muted-foreground">Not Started</Badge>;
}

function getReviewStatus(nextReview: string | null): "overdue" | "due_soon" | "ok" | "none" {
  if (!nextReview) return "none";
  const d = new Date(nextReview);
  const now = new Date();
  const diffDays = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "overdue";
  if (diffDays <= 90) return "due_soon";
  return "ok";
}

// ── Setup Wizard ─────────────────────────────────────────────────────────────

const WIZARD_QUESTIONS = [
  { key: "has_blood_bank", label: "Does your lab have a Blood Bank / Transfusion Service?" },
  { key: "has_transplant", label: "Does your lab perform Transplant testing?" },
  { key: "has_microbiology", label: "Does your lab have a Microbiology section?" },
  { key: "has_maternal_serum", label: "Does your lab perform Maternal Serum Marker screening?" },
  { key: "is_independent", label: "Is your lab an independent laboratory (not hospital-based)?" },
  { key: "waived_only", label: "Does your lab perform Waived testing ONLY?" },
];

interface SetupWizardProps {
  onComplete: () => void;
  existingSettings?: PolicySettings | null;
}

function SetupWizard({ onComplete, existingSettings }: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, boolean>>(() => ({
    has_blood_bank: existingSettings ? !!existingSettings.has_blood_bank : false,
    has_transplant: existingSettings ? !!existingSettings.has_transplant : false,
    has_microbiology: existingSettings ? !!existingSettings.has_microbiology : false,
    has_maternal_serum: existingSettings ? !!existingSettings.has_maternal_serum : false,
    is_independent: existingSettings ? !!existingSettings.is_independent : false,
    waived_only: existingSettings ? !!existingSettings.waived_only : false,
  }));
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const current = WIZARD_QUESTIONS[step];
  const isLast = step === WIZARD_QUESTIONS.length - 1;

  async function handleAnswer(answer: boolean) {
    const updated = { ...answers, [current.key]: answer };
    setAnswers(updated);

    if (isLast) {
      setSaving(true);
      try {
        await fetch(`${API_BASE}/api/veritapolicy/settings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ ...updated, setup_complete: true }),
        });
        onComplete();
      } catch {
        toast({ title: "Error saving settings", variant: "destructive" });
      } finally {
        setSaving(false);
      }
    } else {
      setStep(s => s + 1);
    }
  }

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-lg">
        <div className="mb-8 text-center">
          <h1 className="font-serif text-3xl font-bold mb-2">
            VeritaPolicy{"™"} Setup
          </h1>
          <p className="text-muted-foreground text-sm">
            Answer a few questions to customize your policy requirements. This determines which TJC standards apply to your lab.
          </p>
        </div>

        {/* Progress dots */}
        <div className="flex justify-center gap-2 mb-8">
          {WIZARD_QUESTIONS.map((_, i) => (
            <div
              key={i}
              className={`h-2 w-2 rounded-full transition-all ${i === step ? "bg-primary w-6" : i < step ? "bg-primary/60" : "bg-border"}`}
            />
          ))}
        </div>

        <Card>
          <CardContent className="p-8">
            <div className="text-xs text-muted-foreground mb-3 font-medium">
              Question {step + 1} of {WIZARD_QUESTIONS.length}
            </div>
            <h2 className="text-lg font-semibold mb-8 leading-snug">{current.label}</h2>
            <div className="flex gap-4">
              <Button
                size="lg"
                className="flex-1 bg-primary hover:bg-primary/90"
                onClick={() => handleAnswer(true)}
                disabled={saving}
              >
                Yes
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="flex-1"
                onClick={() => handleAnswer(false)}
                disabled={saving}
              >
                No
              </Button>
            </div>
          </CardContent>
        </Card>

        {step > 0 && (
          <button
            className="mt-4 text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mx-auto"
            onClick={() => setStep(s => s - 1)}
          >
            <RotateCcw size={13} /> Go back
          </button>
        )}
      </div>
    </div>
  );
}

// ── Readiness Score ──────────────────────────────────────────────────────────

function ReadinessScore({ summary }: { summary: Summary }) {
  const { score, total, complete, in_progress, not_started, na } = summary;
  const circumference = 2 * Math.PI * 40;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      {/* Circular gauge */}
      <div className="relative flex-shrink-0">
        <svg width="96" height="96" viewBox="0 0 96 96">
          <circle cx="48" cy="48" r="40" fill="none" stroke="currentColor" strokeWidth="8" className="text-border" />
          <circle
            cx="48"
            cy="48"
            r="40"
            fill="none"
            stroke="#01696F"
            strokeWidth="8"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform="rotate(-90 48 48)"
            style={{ transition: "stroke-dashoffset 0.6s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-foreground">{score}%</span>
          <span className="text-[10px] text-muted-foreground font-medium">Ready</span>
        </div>
      </div>

      {/* Stat boxes */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1">
        <div className="bg-background border border-border rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-foreground">{total}</div>
          <div className="text-xs text-muted-foreground">Total Applicable</div>
        </div>
        <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-green-700">{complete}</div>
          <div className="text-xs text-muted-foreground">Complete</div>
        </div>
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-amber-700">{in_progress}</div>
          <div className="text-xs text-muted-foreground">In Progress</div>
        </div>
        <div className="bg-background border border-border rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-muted-foreground">{not_started}</div>
          <div className="text-xs text-muted-foreground">Not Started</div>
        </div>
      </div>
    </div>
  );
}

// ── Requirements Tab ─────────────────────────────────────────────────────────

interface RequirementsTabProps {
  requirements: Requirement[];
  policies: LabPolicy[];
  isReadOnly: boolean;
  onRefresh: () => void;
}

function RequirementsTab({ requirements, policies, isReadOnly, onRefresh }: RequirementsTabProps) {
  const [filter, setFilter] = useState<string>("all");
  const [chapterFilter, setChapterFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [naRowId, setNaRowId] = useState<number | null>(null);
  const [naReason, setNaReason] = useState("");
  const [linkRowId, setLinkRowId] = useState<number | null>(null);
  const [saving, setSaving] = useState<number | null>(null);
  const { toast } = useToast();

  async function patchRequirement(id: number, body: object) {
    setSaving(id);
    try {
      const res = await fetch(`${API_BASE}/api/veritapolicy/requirements/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Save failed");
      onRefresh();
    } catch {
      toast({ title: "Error saving change", variant: "destructive" });
    } finally {
      setSaving(null);
    }
  }

  function cycleStatus(req: Requirement) {
    if (req.auto_na || req.is_na) return;
    const next = STATUS_CYCLE[req.status as keyof typeof STATUS_CYCLE] || "in_progress";
    patchRequirement(req.id, { status: next, is_na: false });
  }

  async function saveNa(req: Requirement) {
    await patchRequirement(req.id, { is_na: true, na_reason: naReason || null });
    setNaRowId(null);
    setNaReason("");
  }

  async function removeNa(req: Requirement) {
    await patchRequirement(req.id, { is_na: false, na_reason: null });
  }

  async function linkPolicy(req: Requirement, policyId: number | null) {
    await patchRequirement(req.id, { lab_policy_id: policyId });
    setLinkRowId(null);
  }

  const filtered = requirements.filter(r => {
    if (filter !== "all" && r.status !== filter) return false;
    if (chapterFilter !== "all" && r.chapter !== chapterFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return r.name.toLowerCase().includes(q) || r.standard.toLowerCase().includes(q) || r.chapter_label.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div>
      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex gap-1 flex-wrap">
          {[
            { value: "all", label: "All" },
            { value: "not_started", label: "Not Started" },
            { value: "in_progress", label: "In Progress" },
            { value: "complete", label: "Complete" },
            { value: "na", label: "N/A" },
          ].map(f => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-3 py-1 text-xs rounded-full border transition-all font-medium ${
                filter === f.value
                  ? "bg-primary text-white border-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 ml-auto">
          <Select value={chapterFilter} onValueChange={setChapterFilter}>
            <SelectTrigger className="w-48 h-8 text-xs">
              <SelectValue placeholder="All Chapters" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Chapters</SelectItem>
              {CHAPTERS.map(c => (
                <SelectItem key={c.value} value={c.value}>{c.value}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              className="h-8 pl-7 text-xs w-48"
            />
          </div>
        </div>
      </div>

      <div className="text-xs text-muted-foreground mb-2">{filtered.length} requirement{filtered.length !== 1 ? "s" : ""} shown</div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th className="text-left px-3 py-2 font-semibold text-muted-foreground w-8">#</th>
                <th className="text-left px-3 py-2 font-semibold text-muted-foreground w-14">Ch.</th>
                <th className="text-left px-3 py-2 font-semibold text-muted-foreground min-w-[180px]">Standard / Policy Name</th>
                <th className="text-left px-3 py-2 font-semibold text-muted-foreground min-w-[140px]">Linked Policy</th>
                <th className="text-left px-3 py-2 font-semibold text-muted-foreground w-28">Status</th>
                <th className="text-right px-3 py-2 font-semibold text-muted-foreground w-36">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((req, idx) => {
                const isNaRow = naRowId === req.id;
                const isLinkRow = linkRowId === req.id;
                const isSaving = saving === req.id;
                const dimmed = req.is_na;

                return (
                  <tr
                    key={req.id}
                    className={`border-b border-border last:border-0 transition-colors ${
                      idx % 2 === 0 ? "bg-background" : "bg-muted/20"
                    } ${dimmed ? "opacity-50" : ""}`}
                  >
                    <td className="px-3 py-2 text-muted-foreground">{req.id}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="text-[10px] font-mono border-border">
                        {req.chapter}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className={`font-mono text-[10px] text-muted-foreground mb-0.5 ${dimmed ? "line-through" : ""}`}>
                        {req.standard.length > 30 ? req.standard.slice(0, 30) + "..." : req.standard}
                      </div>
                      <div className="font-medium text-foreground leading-tight">{req.name}</div>
                      {isNaRow && (
                        <div className="mt-2 flex gap-2 items-center">
                          <Input
                            value={naReason}
                            onChange={e => setNaReason(e.target.value)}
                            placeholder="Reason (optional)"
                            className="h-7 text-xs flex-1"
                            autoFocus
                          />
                          <button
                            className="text-xs text-primary font-medium hover:underline"
                            onClick={() => saveNa(req)}
                            disabled={isSaving}
                          >
                            Save
                          </button>
                          <button
                            className="text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => { setNaRowId(null); setNaReason(""); }}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      )}
                      {isLinkRow && (
                        <div className="mt-2">
                          <Select onValueChange={v => linkPolicy(req, v === "none" ? null : parseInt(v))}>
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue placeholder="Select policy to link..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">- Remove link -</SelectItem>
                              {policies.map(p => (
                                <SelectItem key={p.id} value={String(p.id)}>
                                  {p.policy_number ? `${p.policy_number} - ` : ""}{p.policy_name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <button
                            className="mt-1 text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => setLinkRowId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {req.lab_policy ? (
                        <span className="text-primary text-[11px] font-medium">
                          {req.lab_policy.policy_number ? `${req.lab_policy.policy_number} - ` : ""}
                          {req.lab_policy.policy_name.length > 28
                            ? req.lab_policy.policy_name.slice(0, 28) + "..."
                            : req.lab_policy.policy_name}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-[11px]">None</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {!req.auto_na && (
                        <button
                          onClick={() => !isReadOnly && cycleStatus(req)}
                          disabled={isReadOnly || req.auto_na || isSaving}
                          className={`transition-opacity ${isReadOnly || req.auto_na ? "cursor-default" : "hover:opacity-80 cursor-pointer"}`}
                          title={req.auto_na ? "Auto N/A based on service line settings" : "Click to cycle status"}
                        >
                          <StatusBadge status={req.status} autoNa={req.auto_na} />
                        </button>
                      )}
                      {req.auto_na && <StatusBadge status="na" autoNa={true} />}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!req.auto_na && !isReadOnly && (
                        <div className="flex gap-1 justify-end">
                          {!req.is_na ? (
                            <button
                              onClick={() => { setNaRowId(isNaRow ? null : req.id); setNaReason(""); setLinkRowId(null); }}
                              className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded border border-border hover:border-foreground/30 transition-all"
                            >
                              N/A
                            </button>
                          ) : (
                            <button
                              onClick={() => removeNa(req)}
                              className="text-[10px] text-amber-600 hover:text-amber-700 px-1.5 py-0.5 rounded border border-amber-300/50 hover:border-amber-400 transition-all"
                            >
                              Undo N/A
                            </button>
                          )}
                          <button
                            onClick={() => { setLinkRowId(isLinkRow ? null : req.id); setNaRowId(null); }}
                            className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded border border-border hover:border-foreground/30 transition-all flex items-center gap-0.5"
                          >
                            <Link2 size={10} /> Link
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground text-sm">
                    No requirements match the current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Policies Tab ─────────────────────────────────────────────────────────────

interface PoliciesTabProps {
  policies: LabPolicy[];
  isReadOnly: boolean;
  onRefresh: () => void;
}

interface PolicyForm {
  policy_number: string;
  policy_name: string;
  owner: string;
  status: "not_started" | "in_progress" | "complete";
  last_reviewed: string;
  next_review: string;
  notes: string;
}

const BLANK_FORM: PolicyForm = {
  policy_number: "",
  policy_name: "",
  owner: "",
  status: "not_started",
  last_reviewed: "",
  next_review: "",
  notes: "",
};

function PoliciesTab({ policies, isReadOnly, onRefresh }: PoliciesTabProps) {
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<PolicyForm>(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  function openAdd() {
    setEditId(null);
    setForm(BLANK_FORM);
    setShowModal(true);
  }

  function openEdit(p: LabPolicy) {
    setEditId(p.id);
    setForm({
      policy_number: p.policy_number || "",
      policy_name: p.policy_name,
      owner: p.owner || "",
      status: p.status,
      last_reviewed: p.last_reviewed || "",
      next_review: p.next_review || "",
      notes: p.notes || "",
    });
    setShowModal(true);
  }

  async function handleSubmit() {
    if (!form.policy_name.trim()) {
      toast({ title: "Policy name is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const body = {
        policy_number: form.policy_number || null,
        policy_name: form.policy_name,
        owner: form.owner || null,
        status: form.status,
        last_reviewed: form.last_reviewed || null,
        next_review: form.next_review || null,
        notes: form.notes || null,
      };
      if (editId) {
        await fetch(`${API_BASE}/api/veritapolicy/policies/${editId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(body),
        });
      } else {
        await fetch(`${API_BASE}/api/veritapolicy/policies`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(body),
        });
      }
      setShowModal(false);
      onRefresh();
      toast({ title: editId ? "Policy updated" : "Policy added" });
    } catch {
      toast({ title: "Error saving policy", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this policy? It will be unlinked from all requirements.")) return;
    setDeletingId(id);
    try {
      await fetch(`${API_BASE}/api/veritapolicy/policies/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      onRefresh();
      toast({ title: "Policy deleted" });
    } catch {
      toast({ title: "Error deleting policy", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  }

  async function handleUpload(policyId: number, file: File) {
    setUploadingId(policyId);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await fetch(`${API_BASE}/api/veritapolicy/policies/${policyId}/upload`, {
        method: "POST",
        headers: authHeaders(),
        body: fd,
      });
      onRefresh();
      toast({ title: "Document uploaded" });
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setUploadingId(null);
    }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div className="text-sm text-muted-foreground">{policies.length} polic{policies.length !== 1 ? "ies" : "y"} in library</div>
        {!isReadOnly && (
          <Button size="sm" className="bg-primary hover:bg-primary/90" onClick={openAdd}>
            <Plus size={14} className="mr-1.5" /> Add Policy
          </Button>
        )}
      </div>

      {policies.length === 0 ? (
        <div className="rounded-lg border border-border border-dashed p-12 text-center">
          <p className="text-muted-foreground text-sm mb-4">No policies added yet. Use "Add Policy" to start building your library.</p>
          {!isReadOnly && (
            <Button size="sm" className="bg-primary hover:bg-primary/90" onClick={openAdd}>
              <Plus size={14} className="mr-1.5" /> Add First Policy
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/40 border-b border-border">
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground w-24">Policy #</th>
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground min-w-[160px]">Policy Name</th>
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground w-24">Owner</th>
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground w-24">Status</th>
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground w-24">Last Reviewed</th>
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground w-28">Next Review</th>
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground w-20">Req. Covered</th>
                  <th className="text-right px-3 py-2 font-semibold text-muted-foreground w-28">Actions</th>
                </tr>
              </thead>
              <tbody>
                {policies.map((p, idx) => {
                  const reviewStatus = getReviewStatus(p.next_review);
                  return (
                    <tr
                      key={p.id}
                      className={`border-b border-border last:border-0 ${idx % 2 === 0 ? "bg-background" : "bg-muted/20"}`}
                    >
                      <td className="px-3 py-2 font-mono text-muted-foreground">{p.policy_number || "-"}</td>
                      <td className="px-3 py-2 font-medium text-foreground">
                        {p.policy_name}
                        {p.document_name && (
                          <div className="text-[10px] text-primary mt-0.5 flex items-center gap-1">
                            <Upload size={9} /> {p.document_name}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{p.owner || "-"}</td>
                      <td className="px-3 py-2"><PolicyStatusBadge status={p.status} /></td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {p.last_reviewed ? new Date(p.last_reviewed).toLocaleDateString() : "-"}
                      </td>
                      <td className="px-3 py-2">
                        {p.next_review ? (
                          <span className={`font-medium ${reviewStatus === "overdue" ? "text-red-600" : reviewStatus === "due_soon" ? "text-amber-600" : "text-foreground"}`}>
                            {new Date(p.next_review).toLocaleDateString()}
                            {reviewStatus === "overdue" && (
                              <AlertTriangle size={11} className="inline ml-1 text-red-500" />
                            )}
                            {reviewStatus === "due_soon" && (
                              <Clock size={11} className="inline ml-1 text-amber-500" />
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`font-semibold ${p.requirements_covered > 0 ? "text-primary" : "text-muted-foreground"}`}>
                          {p.requirements_covered}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {!isReadOnly && (
                          <div className="flex gap-1 justify-end items-center">
                            <label
                              title="Upload document"
                              className="cursor-pointer text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted transition-colors"
                            >
                              <Upload size={13} />
                              <input
                                type="file"
                                className="hidden"
                                onChange={e => {
                                  const f = e.target.files?.[0];
                                  if (f) handleUpload(p.id, f);
                                  e.target.value = "";
                                }}
                                disabled={uploadingId === p.id}
                              />
                            </label>
                            <button
                              onClick={() => openEdit(p)}
                              className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted transition-colors"
                            >
                              <Edit2 size={13} />
                            </button>
                            <button
                              onClick={() => handleDelete(p.id)}
                              disabled={deletingId === p.id}
                              className="text-muted-foreground hover:text-red-600 p-1 rounded hover:bg-red-50 transition-colors"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      <Dialog open={showModal} onOpenChange={open => { if (!open) setShowModal(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Policy" : "Add Policy"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-foreground mb-1 block">Policy Number</label>
                <Input
                  value={form.policy_number}
                  onChange={e => setForm(f => ({ ...f, policy_number: e.target.value }))}
                  placeholder="e.g. LAB-001"
                  className="text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground mb-1 block">Owner</label>
                <Input
                  value={form.owner}
                  onChange={e => setForm(f => ({ ...f, owner: e.target.value }))}
                  placeholder="e.g. Lab Director"
                  className="text-sm"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">Policy Name <span className="text-red-500">*</span></label>
              <Input
                value={form.policy_name}
                onChange={e => setForm(f => ({ ...f, policy_name: e.target.value }))}
                placeholder="Policy name"
                className="text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">Status</label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as any }))}>
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="not_started">Not Started</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="complete">Complete</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-foreground mb-1 block">Last Reviewed</label>
                <Input
                  type="date"
                  value={form.last_reviewed}
                  onChange={e => setForm(f => ({ ...f, last_reviewed: e.target.value }))}
                  className="text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground mb-1 block">Next Review Date</label>
                <Input
                  type="date"
                  value={form.next_review}
                  onChange={e => setForm(f => ({ ...f, next_review: e.target.value }))}
                  className="text-sm"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">Notes</label>
              <Textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Optional notes..."
                className="text-sm"
                rows={3}
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" size="sm" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button size="sm" className="bg-primary hover:bg-primary/90" onClick={handleSubmit} disabled={saving}>
                {saving ? "Saving..." : editId ? "Save Changes" : "Add Policy"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function VeritaPolicyAppPage() {
  const { user, isLoggedIn } = useAuth();
  const isReadOnly = useIsReadOnly();
  const { toast } = useToast();

  const hasPlanAccess = !!user && ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "waived", "community", "hospital", "large_hospital"].includes(user.plan);

  const [settings, setSettings] = useState<PolicySettings | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [policies, setPolicies] = useState<LabPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"requirements" | "policies">("requirements");
  const [showWizard, setShowWizard] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  async function loadAll() {
    try {
      const [settingsRes, summaryRes, reqRes, polRes] = await Promise.all([
        fetch(`${API_BASE}/api/veritapolicy/settings`, { headers: authHeaders() }),
        fetch(`${API_BASE}/api/veritapolicy/summary`, { headers: authHeaders() }),
        fetch(`${API_BASE}/api/veritapolicy/requirements`, { headers: authHeaders() }),
        fetch(`${API_BASE}/api/veritapolicy/policies`, { headers: authHeaders() }),
      ]);
      const [s, sum, r, p] = await Promise.all([settingsRes.json(), summaryRes.json(), reqRes.json(), polRes.json()]);
      setSettings(s);
      setSummary(sum);
      setRequirements(r);
      setPolicies(p);
      if (!s.setup_complete) setShowWizard(true);
    } catch {
      toast({ title: "Error loading data", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isLoggedIn && hasPlanAccess) loadAll();
    else setLoading(false);
  }, [isLoggedIn, hasPlanAccess]);

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

  async function handleWizardComplete() {
    // Wizard already saved setup_complete:true before calling here.
    // Close wizard first, then reload data -- but never re-trigger the wizard
    // check based on stale server state. Set setup_complete locally immediately.
    setShowWizard(false);
    setSettings(prev => prev ? { ...prev, setup_complete: 1 } : prev);
    // Reload requirements, summary, policies without re-running the wizard gate
    try {
      const [settingsRes, summaryRes, reqRes, polRes] = await Promise.all([
        fetch(`${API_BASE}/api/veritapolicy/settings`, { headers: authHeaders() }),
        fetch(`${API_BASE}/api/veritapolicy/summary`, { headers: authHeaders() }),
        fetch(`${API_BASE}/api/veritapolicy/requirements`, { headers: authHeaders() }),
        fetch(`${API_BASE}/api/veritapolicy/policies`, { headers: authHeaders() }),
      ]);
      const [s, sum, r, p] = await Promise.all([settingsRes.json(), summaryRes.json(), reqRes.json(), polRes.json()]);
      setSettings(s);
      setSummary(sum);
      setRequirements(r);
      setPolicies(p);
      // Never re-show wizard here -- user just completed it
    } catch {
      toast({ title: "Error loading data", variant: "destructive" });
    }
  }

  // ── Auth / plan gates ──

  if (!isLoggedIn) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
        <Lock size={40} className="text-muted-foreground mb-4" />
        <h2 className="font-serif text-2xl font-bold mb-2">Sign in to access VeritaPolicy{"™"}</h2>
        <p className="text-muted-foreground mb-6 max-w-md">TJC policy compliance tracking for clinical laboratories.</p>
        <Button asChild size="lg" className="bg-primary hover:bg-primary/90">
          <Link href="/login">Sign In</Link>
        </Button>
      </div>
    );
  }

  if (!hasPlanAccess) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
        <Users size={40} className="text-muted-foreground mb-4" />
        <h2 className="font-serif text-2xl font-bold mb-2">Upgrade to access VeritaPolicy{"™"}</h2>
        <p className="text-muted-foreground mb-6 max-w-md">
          VeritaPolicy{"™"} is included in all VeritaAssure{"™"} plans (Community and above). Subscribe to get started.
        </p>
        <Button asChild size="lg" className="bg-primary hover:bg-primary/90">
          <Link href="/veritacheck">View Plans</Link>
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading...</div>
      </div>
    );
  }

  if (showWizard) {
    return <SetupWizard onComplete={handleWizardComplete} existingSettings={settings} />;
  }

  return (
    <div className="container-default py-8">
      <div className="max-w-6xl mx-auto">

        {/* Description banner */}
        <div className="bg-primary/10 border border-primary/20 rounded-lg px-4 py-2.5 text-sm text-primary font-medium mb-6">
          VeritaPolicy{"™"} tracks all 88 TJC-required laboratory policies. Use the Requirements tab to track status and link your policy documents. Use the Our Policies tab to manage your policy library.
        </div>

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="font-serif text-3xl font-bold flex items-center gap-2">
              <CheckCircle2 size={28} className="text-primary" />
              VeritaPolicy{"™"}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              TJC Policy Compliance Tracker - 88 required laboratory policies
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowWizard(true)}
              title="Re-run setup wizard to change service line settings"
            >
              <Settings size={14} className="mr-1.5" /> Settings
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleDownloadPdf}
              disabled={downloadingPdf}
            >
              <FileDown size={14} className="mr-1.5" />
              {downloadingPdf ? "Generating..." : "Download PDF"}
            </Button>
          </div>
        </div>

        {/* Readiness score */}
        {summary && (
          <Card className="mb-6">
            <CardContent className="p-6">
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-sm text-foreground">Readiness Score</h2>
                  {summary.na > 0 && (
                    <span className="text-xs text-muted-foreground">{summary.na} N/A requirements excluded</span>
                  )}
                </div>
                <ReadinessScore summary={summary} />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        <div className="flex border-b border-border mb-6">
          <button
            onClick={() => setActiveTab("requirements")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "requirements"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Requirements
          </button>
          <button
            onClick={() => setActiveTab("policies")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "policies"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Our Policies
            {policies.length > 0 && (
              <span className="ml-1.5 text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">{policies.length}</span>
            )}
          </button>
        </div>

        {activeTab === "requirements" && (
          <RequirementsTab
            requirements={requirements}
            policies={policies}
            isReadOnly={isReadOnly}
            onRefresh={loadAll}
          />
        )}
        {activeTab === "policies" && (
          <PoliciesTab
            policies={policies}
            isReadOnly={isReadOnly}
            onRefresh={loadAll}
          />
        )}

      </div>
    </div>
  );
}
