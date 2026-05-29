// VeritaPolicyMyPoliciesPage.tsx
//
// VeritaPolicy approval workflow client surface.
//   Phase 1: upload + list + inline-render + download.
//   Phase 2: workflow engine (submit / approve / reject), Pending My Review,
//            Rename. Typed-signature on approve and reject (Phase 3 will add
//            password re-auth and tamper-detection on download).

import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthContext";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Loader2,
  Upload,
  FileText,
  Download,
  Eye,
  FolderPlus,
  Send,
  CheckCircle2,
  XCircle,
  Pencil,
  ShieldCheck,
  Clock,
} from "lucide-react";

interface Manual {
  id: number;
  name: string;
  description: string | null;
  display_order: number;
}

interface WorkflowStep {
  id: number;
  step_order: number;
  step_name: string;
  required_role: string;
  specific_user_id: number | null;
  allow_self_approval: number;
}

interface Workflow {
  id: number;
  name: string;
  description: string | null;
  is_default: number;
  steps: WorkflowStep[];
}

interface PendingReview {
  document_id: number;
  title: string;
  manual_id: number | null;
  updated_at: string;
  step_id: number;
  step_name: string;
  step_order: number;
  total_steps: number;
}

interface PendingStepInfo {
  step: WorkflowStep | null;
  totalSteps: number;
  completedSteps: number;
  canCurrentUserApprove: boolean;
  reason: string | null;
}

interface PolicyDocument {
  id: number;
  lab_id: number;
  manual_id: number | null;
  title: string;
  description: string | null;
  status: string;
  owner_user_id: number;
  effective_date: string | null;
  next_review_date: string | null;
  review_interval_months: number;
  workflow_id: number | null;
  current_version_id: number | null;
  current_version_number: number | null;
  current_file_format: string | null;
  current_uploaded_at: string | null;
  manual_name: string | null;
  created_at: string;
  updated_at: string;
  // Phase 2.1: in_review rows include these so the UI can render
  // "Awaiting step X of Y: <name>" inline.
  pending_step_id?: number;
  pending_step_name?: string;
  pending_step_role?: string;
  pending_step_order?: number;
  pending_total_steps?: number;
}

interface PendingAttestation {
  attestation_id: number;
  document_id: number;
  version_id: number;
  assigned_at: string;
  due_date: string | null;
  title: string;
  current_version_id: number | null;
  manual_id: number | null;
  manual_name: string | null;
  is_stale_version: boolean;
}

interface LabMemberLite {
  membership_id: number;
  user_id: number;
  role: string;
  name: string | null;
  email: string;
  seat_type?: string;
}

interface EligibilityPreview {
  perStep: {
    step_id: number;
    step_order: number;
    step_name: string;
    required_role: string;
    eligible_count: number;
  }[];
  minCount: number;
}

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700 border-slate-300",
  in_review: "bg-amber-100 text-amber-900 border-amber-300",
  approved: "bg-emerald-100 text-emerald-900 border-emerald-300",
  expired: "bg-red-100 text-red-900 border-red-300",
  archived: "bg-zinc-100 text-zinc-600 border-zinc-300",
};

function fmtDate(s: string | null): string {
  if (!s) return "-";
  try {
    return new Date(s).toLocaleDateString();
  } catch {
    return s;
  }
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_BADGE[status] || STATUS_BADGE.draft;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${cls}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

export default function VeritaPolicyMyPoliciesPage() {
  const { user } = useAuth();
  const activeLabId = useActiveLabId();
  const { toast } = useToast();

  const invalidateAll = () => {
    queryClient.invalidateQueries({
      queryKey: [`/api/labs/${activeLabId}/veritapolicy/documents`],
    });
    queryClient.invalidateQueries({
      queryKey: [`/api/labs/${activeLabId}/veritapolicy/manuals`],
    });
  };

  // ── Queries ─────────────────────────────────────────────────────────────
  const { data: docsData, isLoading: docsLoading } = useQuery<{
    documents: PolicyDocument[];
  }>({
    queryKey: [`/api/labs/${activeLabId}/veritapolicy/documents`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!activeLabId,
  });

  const { data: manualsData } = useQuery<{ manuals: Manual[] }>({
    queryKey: [`/api/labs/${activeLabId}/veritapolicy/manuals`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!activeLabId,
  });

  const documents = docsData?.documents || [];
  const manuals = manualsData?.manuals || [];

  const { data: workflowsData } = useQuery<{ workflows: Workflow[] }>({
    queryKey: [`/api/labs/${activeLabId}/veritapolicy/workflows`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!activeLabId,
  });
  const workflows = workflowsData?.workflows || [];

  const { data: pendingData } = useQuery<{ pending: PendingReview[] }>({
    queryKey: [`/api/labs/${activeLabId}/veritapolicy/pending-reviews`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!activeLabId,
    refetchInterval: 30000,
  });
  const pendingReviews = pendingData?.pending || [];

  const { data: pendingAttestData } = useQuery<{ pending: PendingAttestation[] }>({
    queryKey: [`/api/labs/${activeLabId}/veritapolicy/pending-attestations`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!activeLabId,
    refetchInterval: 30000,
  });
  const pendingAttestations = pendingAttestData?.pending || [];

  const { data: membersData } = useQuery<{ members: LabMemberLite[] }>({
    queryKey: [`/api/labs/${activeLabId}/members`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!activeLabId,
  });
  const labMembers = membersData?.members || [];

  // ── Upload state ────────────────────────────────────────────────────────
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadManualId, setUploadManualId] = useState<string>("");
  const [uploadReviewMonths, setUploadReviewMonths] = useState<string>("12");
  const [uploadingProgress, setUploadingProgress] = useState(false);

  const resetUpload = () => {
    setUploadFile(null);
    setUploadTitle("");
    setUploadDescription("");
    setUploadManualId("");
    setUploadReviewMonths("12");
  };

  const uploadDoc = async () => {
    if (!uploadFile) {
      toast({ title: "Pick a file first", variant: "destructive" });
      return;
    }
    setUploadingProgress(true);
    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      if (uploadTitle.trim()) fd.append("title", uploadTitle.trim());
      if (uploadDescription.trim()) fd.append("description", uploadDescription.trim());
      if (uploadManualId) fd.append("manual_id", uploadManualId);
      if (uploadReviewMonths) fd.append("review_interval_months", uploadReviewMonths);
      const token = localStorage.getItem("veritas_token") || "";
      const res = await fetch(
        `/api/labs/${activeLabId}/veritapolicy/documents`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        }
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Upload failed");
      toast({
        title: "Uploaded",
        description: `${body.title} created in draft.`,
      });
      setUploadOpen(false);
      resetUpload();
      invalidateAll();
    } catch (err: any) {
      toast({
        title: "Upload failed",
        description: String(err?.message || err),
        variant: "destructive",
      });
    } finally {
      setUploadingProgress(false);
    }
  };

  // ── Manual create modal ─────────────────────────────────────────────────
  const [newManualOpen, setNewManualOpen] = useState(false);
  const [newManualName, setNewManualName] = useState("");
  const [newManualDescription, setNewManualDescription] = useState("");

  const createManualMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/labs/${activeLabId}/veritapolicy/manuals`,
        { name: newManualName.trim(), description: newManualDescription.trim() }
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Manual created" });
      setNewManualOpen(false);
      setNewManualName("");
      setNewManualDescription("");
      invalidateAll();
    },
    onError: (err: any) =>
      toast({ title: "Create failed", description: String(err?.message || err), variant: "destructive" }),
  });

  // ── Phase 2: submit / approve / reject / rename ────────────────────────
  const [submitDoc, setSubmitDoc] = useState<PolicyDocument | null>(null);
  const [submitWorkflowId, setSubmitWorkflowId] = useState<string>("");

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!submitDoc) throw new Error("No document");
      if (!submitWorkflowId) throw new Error("Pick a workflow");
      const res = await apiRequest(
        "POST",
        `/api/labs/${activeLabId}/veritapolicy/documents/${submitDoc.id}/submit`,
        { workflowId: Number(submitWorkflowId) }
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Submitted for review" });
      setSubmitDoc(null);
      setSubmitWorkflowId("");
      invalidateAll();
      queryClient.invalidateQueries({
        queryKey: [`/api/labs/${activeLabId}/veritapolicy/pending-reviews`],
      });
    },
    onError: (err: any) =>
      toast({
        title: "Submit failed",
        description: String(err?.message || err),
        variant: "destructive",
      }),
  });

  type SignAction = "approved" | "rejected";
  const [signDoc, setSignDoc] = useState<PolicyDocument | null>(null);
  const [signAction, setSignAction] = useState<SignAction>("approved");
  const [signTypedName, setSignTypedName] = useState("");
  const [signPassword, setSignPassword] = useState("");
  const [signComment, setSignComment] = useState("");

  const openSign = (doc: PolicyDocument, action: SignAction) => {
    setSignDoc(doc);
    setSignAction(action);
    setSignTypedName(user?.name || "");
    setSignPassword("");
    setSignComment("");
  };

  const signMutation = useMutation({
    mutationFn: async () => {
      if (!signDoc) throw new Error("No document");
      const endpoint = signAction === "approved" ? "approve" : "reject";
      const res = await apiRequest(
        "POST",
        `/api/labs/${activeLabId}/veritapolicy/documents/${signDoc.id}/${endpoint}`,
        {
          typedSignature: signTypedName.trim(),
          password: signPassword,
          comment: signComment.trim() || undefined,
        }
      );
      return res.json();
    },
    onSuccess: (body: any) => {
      toast({
        title: signAction === "approved" ? "Approved" : "Rejected",
        description:
          signAction === "approved"
            ? body?.status === "approved"
              ? "All steps complete; policy is now approved."
              : `Next step: ${body?.nextStep || "?"}`
            : "Returned to draft.",
      });
      setSignDoc(null);
      setSignTypedName("");
      setSignPassword("");
      setSignComment("");
      invalidateAll();
      queryClient.invalidateQueries({
        queryKey: [`/api/labs/${activeLabId}/veritapolicy/pending-reviews`],
      });
    },
    onError: (err: any) =>
      toast({
        title: "Action failed",
        description: String(err?.message || err),
        variant: "destructive",
      }),
  });

  const [renameDoc, setRenameDoc] = useState<PolicyDocument | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameDescription, setRenameDescription] = useState("");
  const [renameManualId, setRenameManualId] = useState<string>("");

  const openRename = (doc: PolicyDocument) => {
    setRenameDoc(doc);
    setRenameTitle(doc.title);
    setRenameDescription(doc.description || "");
    setRenameManualId(doc.manual_id ? String(doc.manual_id) : "");
  };

  // ── Phase 7: search + new-version upload + version history ───────────
  const [searchQ, setSearchQ] = useState("");

  const [newVersionDoc, setNewVersionDoc] = useState<PolicyDocument | null>(null);
  const [newVersionFile, setNewVersionFile] = useState<File | null>(null);
  const [newVersionSummary, setNewVersionSummary] = useState("");
  const [newVersionUploading, setNewVersionUploading] = useState(false);

  const openNewVersion = (doc: PolicyDocument) => {
    setNewVersionDoc(doc);
    setNewVersionFile(null);
    setNewVersionSummary("");
  };

  const uploadNewVersion = async () => {
    if (!newVersionDoc || !newVersionFile) {
      toast({ title: "Pick a file first", variant: "destructive" });
      return;
    }
    setNewVersionUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", newVersionFile);
      if (newVersionSummary.trim()) fd.append("change_summary", newVersionSummary.trim());
      const token = localStorage.getItem("veritas_token") || "";
      const res = await fetch(
        `/api/labs/${activeLabId}/veritapolicy/documents/${newVersionDoc.id}/versions`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        }
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Upload failed");
      toast({
        title: "New version uploaded",
        description: `Version ${body?.version_number} now current; status reset to draft.`,
      });
      setNewVersionDoc(null);
      setNewVersionFile(null);
      setNewVersionSummary("");
      invalidateAll();
    } catch (err: any) {
      toast({
        title: "Upload failed",
        description: String(err?.message || err),
        variant: "destructive",
      });
    } finally {
      setNewVersionUploading(false);
    }
  };

  // Version history loaded into the View modal alongside signoffs.
  const [viewVersions, setViewVersions] = useState<any[]>([]);

  // ── Phase 5: recertify ─────────────────────────────────────────────────
  // Helper: days until next_review_date, negative if overdue.
  const daysUntil = (iso: string | null | undefined): number | null => {
    if (!iso) return null;
    try {
      const d = new Date(iso);
      if (!Number.isFinite(d.getTime())) return null;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      d.setHours(0, 0, 0, 0);
      return Math.round((d.getTime() - today.getTime()) / 86400000);
    } catch {
      return null;
    }
  };

  const reviewStateLabel = (days: number | null) => {
    if (days == null) return null;
    if (days < 0) return { label: `${Math.abs(days)}d overdue`, cls: "text-red-700 font-semibold" };
    if (days <= 30) return { label: `due in ${days}d`, cls: "text-amber-800 font-medium" };
    return { label: `due in ${days}d`, cls: "text-muted-foreground" };
  };

  const [recertifyDoc, setRecertifyDoc] = useState<PolicyDocument | null>(null);
  const [recertifyTypedName, setRecertifyTypedName] = useState("");
  const [recertifyPassword, setRecertifyPassword] = useState("");
  const [recertifyComment, setRecertifyComment] = useState("");

  const openRecertify = (doc: PolicyDocument) => {
    setRecertifyDoc(doc);
    setRecertifyTypedName(user?.name || "");
    setRecertifyPassword("");
    setRecertifyComment("");
  };

  const recertifyMutation = useMutation({
    mutationFn: async () => {
      if (!recertifyDoc) throw new Error("No document");
      const res = await apiRequest(
        "POST",
        `/api/labs/${activeLabId}/veritapolicy/documents/${recertifyDoc.id}/recertify`,
        {
          typedSignature: recertifyTypedName.trim(),
          password: recertifyPassword,
          comment: recertifyComment.trim() || undefined,
        }
      );
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Re-certified",
        description: "Next review date advanced.",
      });
      setRecertifyDoc(null);
      setRecertifyPassword("");
      setRecertifyComment("");
      invalidateAll();
    },
    onError: (err: any) =>
      toast({
        title: "Re-certify failed",
        description: String(err?.message || err),
        variant: "destructive",
      }),
  });

  const dueSoonDocs = documents.filter((d) => {
    if (d.status !== "approved") return false;
    const days = daysUntil(d.next_review_date);
    return days != null && days <= 30;
  });

  // ── Phase 4: attestation assign + complete ─────────────────────────────
  const [assignDoc, setAssignDoc] = useState<PolicyDocument | null>(null);
  const [assignSelected, setAssignSelected] = useState<Set<number>>(new Set());
  const [assignDueDate, setAssignDueDate] = useState<string>("");

  const openAssign = (doc: PolicyDocument) => {
    setAssignDoc(doc);
    setAssignSelected(new Set());
    setAssignDueDate("");
  };

  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!assignDoc) throw new Error("No document");
      const ids = Array.from(assignSelected);
      if (ids.length === 0) throw new Error("Pick at least one person");
      const res = await apiRequest(
        "POST",
        `/api/labs/${activeLabId}/veritapolicy/documents/${assignDoc.id}/attestations`,
        { assignedToUserIds: ids, dueDate: assignDueDate || undefined }
      );
      return res.json();
    },
    onSuccess: (body: any) => {
      toast({
        title: "Assigned",
        description: `${body?.assigned ?? 0} attestation(s) created.`,
      });
      setAssignDoc(null);
      setAssignSelected(new Set());
      setAssignDueDate("");
      queryClient.invalidateQueries({
        queryKey: [`/api/labs/${activeLabId}/veritapolicy/pending-attestations`],
      });
    },
    onError: (err: any) =>
      toast({
        title: "Assign failed",
        description: String(err?.message || err),
        variant: "destructive",
      }),
  });

  // Completion modal
  const [attestTarget, setAttestTarget] = useState<PendingAttestation | null>(null);
  const [attestTypedName, setAttestTypedName] = useState("");
  const [attestPassword, setAttestPassword] = useState("");

  const openAttest = (p: PendingAttestation) => {
    setAttestTarget(p);
    setAttestTypedName(user?.name || "");
    setAttestPassword("");
  };

  const attestCompleteMutation = useMutation({
    mutationFn: async () => {
      if (!attestTarget) throw new Error("No attestation");
      const res = await apiRequest(
        "POST",
        `/api/labs/${activeLabId}/veritapolicy/attestations/${attestTarget.attestation_id}/complete`,
        {
          typedSignature: attestTypedName.trim(),
          password: attestPassword,
        }
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Attestation recorded" });
      setAttestTarget(null);
      setAttestTypedName("");
      setAttestPassword("");
      queryClient.invalidateQueries({
        queryKey: [`/api/labs/${activeLabId}/veritapolicy/pending-attestations`],
      });
    },
    onError: (err: any) =>
      toast({
        title: "Attestation failed",
        description: String(err?.message || err),
        variant: "destructive",
      }),
  });

  // ── Phase 2.1: recall ──────────────────────────────────────────────────
  const recallMutation = useMutation({
    mutationFn: async (docId: number) => {
      const res = await apiRequest(
        "POST",
        `/api/labs/${activeLabId}/veritapolicy/documents/${docId}/recall`,
        {}
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Recalled", description: "Document returned to draft." });
      invalidateAll();
      queryClient.invalidateQueries({
        queryKey: [`/api/labs/${activeLabId}/veritapolicy/pending-reviews`],
      });
    },
    onError: (err: any) =>
      toast({
        title: "Recall failed",
        description: String(err?.message || err),
        variant: "destructive",
      }),
  });

  // ── Phase 2.1: eligibility preview at submit time ─────────────────────
  const [eligibility, setEligibility] = useState<EligibilityPreview | null>(null);
  const [eligibilityLoading, setEligibilityLoading] = useState(false);

  // Refetch eligibility whenever the user picks a workflow in the submit dialog.
  const fetchEligibility = async (docId: number, workflowId: number) => {
    setEligibility(null);
    setEligibilityLoading(true);
    try {
      const token = localStorage.getItem("veritas_token") || "";
      const res = await fetch(
        `/api/labs/${activeLabId}/veritapolicy/documents/${docId}/eligibility?workflowId=${workflowId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const body = await res.json();
      if (res.ok) setEligibility(body);
    } catch {
      // Non-fatal: warning just doesn't render.
    } finally {
      setEligibilityLoading(false);
    }
  };

  const renameMutation = useMutation({
    mutationFn: async () => {
      if (!renameDoc) throw new Error("No document");
      const res = await apiRequest(
        "PATCH",
        `/api/labs/${activeLabId}/veritapolicy/documents/${renameDoc.id}`,
        {
          title: renameTitle.trim(),
          description: renameDescription.trim() || null,
          manualId: renameManualId ? Number(renameManualId) : null,
        }
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Saved" });
      setRenameDoc(null);
      invalidateAll();
    },
    onError: (err: any) =>
      toast({
        title: "Save failed",
        description: String(err?.message || err),
        variant: "destructive",
      }),
  });

  // ── View modal ──────────────────────────────────────────────────────────
  const [viewDoc, setViewDoc] = useState<PolicyDocument | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewHtml, setViewHtml] = useState<string>("");
  const [viewPdfUrl, setViewPdfUrl] = useState<string>("");
  const [viewTampered, setViewTampered] = useState(false);
  const [viewSignoffs, setViewSignoffs] = useState<any[]>([]);

  const openView = async (doc: PolicyDocument) => {
    setViewDoc(doc);
    setViewHtml("");
    setViewPdfUrl("");
    setViewTampered(false);
    setViewSignoffs([]);
    setViewVersions([]);
    setViewLoading(true);
    try {
      const token = localStorage.getItem("veritas_token") || "";
      // Fire-and-forget signoff history so the audit trail renders alongside.
      fetch(`/api/labs/${activeLabId}/veritapolicy/documents/${doc.id}/signoffs`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((body) => setViewSignoffs(body?.signoffs || []))
        .catch(() => {});
      // Fire-and-forget version history.
      fetch(`/api/labs/${activeLabId}/veritapolicy/documents/${doc.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((body) => setViewVersions(body?.versions || []))
        .catch(() => {});
      if (doc.current_file_format === "pdf") {
        const res = await fetch(
          `/api/labs/${activeLabId}/veritapolicy/documents/${doc.id}/render`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) throw new Error("Render failed");
        if (res.headers.get("X-VeritaPolicy-Tamper") === "yes") setViewTampered(true);
        const blob = await res.blob();
        setViewPdfUrl(URL.createObjectURL(blob));
      } else {
        const res = await fetch(
          `/api/labs/${activeLabId}/veritapolicy/documents/${doc.id}/render`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || "Render failed");
        setViewHtml(body.html || "");
        if (body.tampered) setViewTampered(true);
      }
    } catch (err: any) {
      toast({
        title: "View failed",
        description: String(err?.message || err),
        variant: "destructive",
      });
      setViewDoc(null);
    } finally {
      setViewLoading(false);
    }
  };

  const closeView = () => {
    if (viewPdfUrl) URL.revokeObjectURL(viewPdfUrl);
    setViewDoc(null);
    setViewHtml("");
    setViewPdfUrl("");
    setViewTampered(false);
    setViewSignoffs([]);
    setViewVersions([]);
  };

  // ── Download ────────────────────────────────────────────────────────────
  const downloadDoc = async (doc: PolicyDocument) => {
    try {
      const token = localStorage.getItem("veritas_token") || "";
      const res = await fetch(
        `/api/labs/${activeLabId}/veritapolicy/documents/${doc.id}/download`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error("Download failed");
      if (res.headers.get("X-VeritaPolicy-Tamper") === "yes") {
        toast({
          title: "Tamper warning",
          description:
            "This file does not match the hash captured at upload time. Investigate before using.",
          variant: "destructive",
        });
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${doc.title.replace(/[^A-Za-z0-9_-]+/g, "_")}.${doc.current_file_format || "bin"}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({
        title: "Download failed",
        description: String(err?.message || err),
        variant: "destructive",
      });
    }
  };

  // ── Group documents by manual for display ──────────────────────────────
  const filteredDocs = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    if (q.length < 2) return documents;
    return documents.filter((d) => {
      return (
        d.title.toLowerCase().includes(q) ||
        (d.description || "").toLowerCase().includes(q) ||
        (d.manual_name || "").toLowerCase().includes(q)
      );
    });
  }, [documents, searchQ]);

  const grouped = useMemo(() => {
    const byManual = new Map<string, PolicyDocument[]>();
    filteredDocs.forEach((doc) => {
      const key = doc.manual_name || "Unassigned";
      if (!byManual.has(key)) byManual.set(key, []);
      byManual.get(key)!.push(doc);
    });
    const ordered = manuals.map((m) => m.name);
    if (byManual.has("Unassigned")) ordered.push("Unassigned");
    return ordered.filter((name) => byManual.has(name)).map((name) => ({
      manualName: name,
      docs: byManual.get(name)!,
    }));
  }, [documents, manuals]);

  if (!activeLabId) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <Card>
          <CardContent className="p-6">
            Pick a lab from the lab switcher to manage policies.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Policies</h1>
          <p className="text-sm text-muted-foreground">
            Upload your lab policies and procedures, organize them by manual,
            and route them through review and approval workflows. Phase 1
            ships upload, organize, view, and download. Phases 2+ add the
            multi-step approval workflow, electronic signature, and employee
            attestations.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <a href={`/labs/${activeLabId}/veritapolicy-app/compliance`}>
            <Button variant="outline">
              <FileText size={14} className="mr-1.5" /> Compliance
            </Button>
          </a>
          <Button variant="outline" onClick={() => setNewManualOpen(true)}>
            <FolderPlus size={14} className="mr-1.5" /> New Manual
          </Button>
          <Button onClick={() => setUploadOpen(true)}>
            <Upload size={14} className="mr-1.5" /> Upload Policy
          </Button>
        </div>
      </div>

      {documents.length > 0 && (
        <div>
          <Input
            placeholder="Search policies by title, description, or manual..."
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            className="max-w-md"
          />
        </div>
      )}

      {dueSoonDocs.length > 0 && (
        <Card className="border-amber-300 bg-amber-50/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock size={16} className="text-amber-700" />
              Policies due for review ({dueSoonDocs.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {dueSoonDocs.map((d) => {
                const days = daysUntil(d.next_review_date);
                const state = reviewStateLabel(days);
                return (
                  <li key={d.id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="font-medium">{d.title}</span>
                      {d.manual_name && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          in {d.manual_name}
                        </span>
                      )}
                      <div className="text-xs">
                        next review {fmtDate(d.next_review_date)}{" "}
                        {state && <span className={state.cls}>· {state.label}</span>}
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <Button size="sm" variant="outline" onClick={() => openView(d)}>
                        <Eye size={12} className="mr-1" /> View
                      </Button>
                      <Button size="sm" onClick={() => openRecertify(d)}>
                        <ShieldCheck size={12} className="mr-1" /> Confirm Still Current
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {pendingAttestations.length > 0 && (
        <Card className="border-sky-300 bg-sky-50/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText size={16} className="text-sky-700" />
              Pending my attestations ({pendingAttestations.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {pendingAttestations.map((p) => (
                <li
                  key={p.attestation_id}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <span className="font-medium">{p.title}</span>
                    {p.manual_name && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        in {p.manual_name}
                      </span>
                    )}
                    <div className="text-xs text-muted-foreground">
                      assigned {fmtDate(p.assigned_at)}
                      {p.due_date && <> · due {fmtDate(p.due_date)}</>}
                      {p.is_stale_version && (
                        <span className="ml-2 text-amber-700">
                          (a newer version is now current; this attestation is stale)
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    {(() => {
                      const doc = documents.find((d) => d.id === p.document_id);
                      return doc ? (
                        <Button size="sm" variant="outline" onClick={() => openView(doc)}>
                          <Eye size={12} className="mr-1" /> View
                        </Button>
                      ) : null;
                    })()}
                    <Button size="sm" onClick={() => openAttest(p)}>
                      <CheckCircle2 size={12} className="mr-1" /> Attest
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {pendingReviews.length > 0 && (
        <Card className="border-amber-300 bg-amber-50/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck size={16} className="text-amber-700" />
              Pending my review ({pendingReviews.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {pendingReviews.map((p) => {
                const doc = documents.find((d) => d.id === p.document_id);
                return (
                  <li
                    key={p.document_id}
                    className="flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <span className="font-medium">{p.title}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        step {p.step_order} of {p.total_steps}: {p.step_name}
                      </span>
                    </div>
                    {doc && (
                      <div className="flex gap-1.5 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openView(doc)}
                        >
                          <Eye size={12} className="mr-1" /> View
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => openSign(doc, "approved")}
                        >
                          <CheckCircle2 size={12} className="mr-1" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => openSign(doc, "rejected")}
                        >
                          <XCircle size={12} className="mr-1" /> Reject
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {docsLoading ? (
        <Card>
          <CardContent className="p-6 flex items-center gap-2 text-muted-foreground">
            <Loader2 className="animate-spin" size={14} /> Loading...
          </CardContent>
        </Card>
      ) : documents.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <div className="text-center space-y-3">
              <FileText
                size={32}
                className="mx-auto text-muted-foreground"
              />
              <div className="font-medium">No policies uploaded yet</div>
              <div className="text-sm text-muted-foreground">
                Drag a DOCX or PDF in, or click Upload Policy to start.
              </div>
              <Button onClick={() => setUploadOpen(true)}>
                <Upload size={14} className="mr-1.5" /> Upload Policy
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        grouped.map(({ manualName, docs }) => (
          <Card key={manualName}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {manualName}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  ({docs.length} {docs.length === 1 ? "policy" : "policies"})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="py-2 pr-3">Title</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">Format</th>
                      <th className="py-2 pr-3">Updated</th>
                      <th className="py-2 pr-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs.map((doc) => (
                      <tr
                        key={doc.id}
                        className="border-b last:border-b-0"
                      >
                        <td className="py-2 pr-3">
                          <div className="font-medium">{doc.title}</div>
                          {doc.description && (
                            <div className="text-xs text-muted-foreground">
                              {doc.description}
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <StatusBadge status={doc.status} />
                          {doc.status === "in_review" && doc.pending_step_name && (
                            <div className="text-[10px] text-amber-800 mt-1 leading-tight">
                              Step {doc.pending_step_order} of {doc.pending_total_steps}:{" "}
                              <span className="font-medium">{doc.pending_step_name}</span>
                              <div className="text-[10px] text-muted-foreground">
                                awaiting{" "}
                                {doc.pending_step_role
                                  ? doc.pending_step_role.replace(/_/g, " ")
                                  : "reviewer"}
                              </div>
                            </div>
                          )}
                          {doc.status === "approved" && doc.next_review_date && (() => {
                            const days = daysUntil(doc.next_review_date);
                            const state = reviewStateLabel(days);
                            return (
                              <div className="text-[10px] mt-1 leading-tight">
                                <span className="text-muted-foreground">next review </span>
                                <span>{fmtDate(doc.next_review_date)}</span>
                                {state && <span className={`ml-1 ${state.cls}`}>· {state.label}</span>}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="py-2 pr-3 text-xs uppercase font-mono text-muted-foreground">
                          {doc.current_file_format || "-"}
                          {doc.current_version_number != null && (
                            <span className="ml-1 text-[10px]">
                              v{doc.current_version_number}
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground">
                          {fmtDate(doc.updated_at)}
                        </td>
                        <td className="py-2 pr-3 text-right space-x-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openView(doc)}
                          >
                            <Eye size={12} className="mr-1" /> View
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => downloadDoc(doc)}
                          >
                            <Download size={12} className="mr-1" /> Download
                          </Button>
                          {doc.status === "draft" && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setSubmitDoc(doc);
                                  const def = workflows.find((w) => w.is_default) || workflows[0];
                                  const wfId = def ? String(def.id) : "";
                                  setSubmitWorkflowId(wfId);
                                  if (def) fetchEligibility(doc.id, def.id);
                                }}
                              >
                                <Send size={12} className="mr-1" /> Submit
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => openRename(doc)}
                                title="Rename / edit metadata"
                              >
                                <Pencil size={12} />
                              </Button>
                            </>
                          )}
                          {doc.owner_user_id === user?.id && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openNewVersion(doc)}
                              title="Upload a new version; will reset status to draft"
                            >
                              <Upload size={12} />
                            </Button>
                          )}
                          {doc.status === "in_review" &&
                            pendingReviews.some((p) => p.document_id === doc.id) && (
                              <>
                                <Button
                                  size="sm"
                                  variant="default"
                                  onClick={() => openSign(doc, "approved")}
                                >
                                  <CheckCircle2 size={12} className="mr-1" /> Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-red-600 hover:text-red-700"
                                  onClick={() => openSign(doc, "rejected")}
                                >
                                  <XCircle size={12} className="mr-1" /> Reject
                                </Button>
                              </>
                            )}
                          {doc.status === "in_review" &&
                            doc.owner_user_id === user?.id && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  if (
                                    confirm(
                                      `Recall "${doc.title}" from review and return it to draft?`
                                    )
                                  ) {
                                    recallMutation.mutate(doc.id);
                                  }
                                }}
                                disabled={recallMutation.isPending}
                                title="Pull back from review and return to draft"
                              >
                                Recall
                              </Button>
                            )}
                          {doc.status === "approved" && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openAssign(doc)}
                                title="Assign staff to read-and-attest"
                              >
                                <ShieldCheck size={12} className="mr-1" /> Assign
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openRecertify(doc)}
                                title="Confirm this policy is still current; advances next review date"
                              >
                                Recertify
                              </Button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ))
      )}

      {/* ── Upload modal ──────────────────────────────────────────────── */}
      <Dialog
        open={uploadOpen}
        onOpenChange={(open) => {
          if (!open) {
            setUploadOpen(false);
            resetUpload();
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Upload a policy</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">File (DOCX or PDF, up to 25 MB)</Label>
              <Input
                type="file"
                accept=".docx,.pdf,.html,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
              />
              {uploadFile && (
                <div className="text-xs text-muted-foreground mt-1">
                  {uploadFile.name} ({Math.round(uploadFile.size / 1024)} KB)
                </div>
              )}
            </div>
            <div>
              <Label className="text-xs">
                Title (leave blank to auto-extract from the document)
              </Label>
              <Input
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                placeholder="e.g., Specimen Rejection Criteria"
              />
            </div>
            <div>
              <Label className="text-xs">Description (optional)</Label>
              <Textarea
                value={uploadDescription}
                onChange={(e) => setUploadDescription(e.target.value)}
                rows={2}
                placeholder="One sentence about what this policy covers."
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Manual</Label>
                <Select value={uploadManualId} onValueChange={setUploadManualId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    {manuals.map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Review interval (months)</Label>
                <Select value={uploadReviewMonths} onValueChange={setUploadReviewMonths}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="6">6 months</SelectItem>
                    <SelectItem value="12">12 months</SelectItem>
                    <SelectItem value="24">24 months</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>
              Cancel
            </Button>
            <Button onClick={uploadDoc} disabled={!uploadFile || uploadingProgress}>
              {uploadingProgress && (
                <Loader2 className="animate-spin mr-1" size={14} />
              )}
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── New manual modal ─────────────────────────────────────────── */}
      <Dialog open={newManualOpen} onOpenChange={setNewManualOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New manual</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Name</Label>
              <Input
                value={newManualName}
                onChange={(e) => setNewManualName(e.target.value)}
                placeholder="e.g., Molecular"
              />
            </div>
            <div>
              <Label className="text-xs">Description (optional)</Label>
              <Textarea
                value={newManualDescription}
                onChange={(e) => setNewManualDescription(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewManualOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createManualMutation.mutate()}
              disabled={
                createManualMutation.isPending || !newManualName.trim()
              }
            >
              {createManualMutation.isPending && (
                <Loader2 className="animate-spin mr-1" size={14} />
              )}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── View modal ──────────────────────────────────────────────── */}
      <Dialog
        open={!!viewDoc}
        onOpenChange={(open) => {
          if (!open) closeView();
        }}
      >
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewDoc?.title || "Policy"}</DialogTitle>
          </DialogHeader>
          {viewTampered && (
            <div className="rounded border border-red-300 bg-red-50 text-red-900 p-2 text-xs space-y-1">
              <div className="font-medium flex items-center gap-1">
                <XCircle size={14} /> Tamper warning
              </div>
              <div>
                The file on disk does not match the hash captured at upload time. Do not rely on
                signatures attached to this version. Investigate before approving or distributing.
              </div>
            </div>
          )}
          {viewVersions.length > 1 && (
            <div className="rounded border bg-muted/30 p-2 text-xs space-y-1">
              <div className="font-medium flex items-center gap-1">
                <FileText size={14} /> Version history ({viewVersions.length})
              </div>
              <ul className="space-y-0.5">
                {viewVersions.map((v: any) => (
                  <li key={v.id} className="flex items-center justify-between gap-2">
                    <span>
                      <span className="font-medium">v{v.version_number}</span>
                      <span className="ml-2 text-muted-foreground">
                        {v.file_format?.toUpperCase()}
                      </span>
                      <span className="ml-2 text-muted-foreground">
                        uploaded {fmtDate(v.uploaded_at)}
                      </span>
                      {v.change_summary && (
                        <span className="ml-2 italic text-muted-foreground">
                          - {v.change_summary}
                        </span>
                      )}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {v.file_hash_sha256?.slice(0, 12)}…
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {viewSignoffs.length > 0 && (
            <div className="rounded border bg-muted/30 p-2 text-xs space-y-1">
              <div className="font-medium flex items-center gap-1">
                <ShieldCheck size={14} /> Signature history ({viewSignoffs.length})
              </div>
              <ol className="space-y-1">
                {viewSignoffs.map((s: any) => (
                  <li key={s.id} className="flex items-start gap-2 leading-snug">
                    <span
                      className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] uppercase border ${
                        s.action === "approved"
                          ? "bg-emerald-100 text-emerald-900 border-emerald-300"
                          : "bg-red-100 text-red-900 border-red-300"
                      }`}
                    >
                      {s.action}
                    </span>
                    <span className="flex-1">
                      <span className="font-medium">{s.typed_signature || s.user_name}</span>
                      {s.step_name && (
                        <span className="text-muted-foreground"> on {s.step_name}</span>
                      )}
                      <span className="text-muted-foreground"> at {fmtDate(s.signed_at)}</span>
                      {s.comment && (
                        <div className="italic text-muted-foreground">{s.comment}</div>
                      )}
                      <div className="text-[10px] font-mono text-muted-foreground break-all">
                        sha256: {s.signed_document_hash?.slice(0, 24)}…
                      </div>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {viewLoading ? (
            <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="animate-spin" size={14} /> Loading...
            </div>
          ) : viewPdfUrl ? (
            <iframe
              src={viewPdfUrl}
              title={viewDoc?.title || "Policy"}
              className="w-full h-[70vh] border"
            />
          ) : (
            <div
              className="prose prose-sm max-w-none border rounded p-4 bg-white"
              dangerouslySetInnerHTML={{ __html: viewHtml }}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeView}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Submit for review modal ────────────────────────────────── */}
      <Dialog
        open={!!submitDoc}
        onOpenChange={(open) => {
          if (!open) {
            setSubmitDoc(null);
            setSubmitWorkflowId("");
            setEligibility(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Submit for review</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Pick a workflow. The document moves from draft to in_review and
              the first reviewer is notified.
            </p>
            <div>
              <Label className="text-xs">Workflow</Label>
              <Select
                value={submitWorkflowId}
                onValueChange={(v) => {
                  setSubmitWorkflowId(v);
                  if (submitDoc && v) fetchEligibility(submitDoc.id, Number(v));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick a workflow" />
                </SelectTrigger>
                <SelectContent>
                  {workflows.map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>
                      {w.name} ({w.steps?.length || 0} steps)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {eligibility && eligibility.minCount === 0 && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 space-y-1">
                <div className="font-medium">No eligible reviewer exists for at least one step.</div>
                <div>
                  Submitting this workflow now will leave the document stuck in review until you
                  invite a reviewer (or recall it). Steps with zero eligible reviewers:
                </div>
                <ul className="list-disc ml-4">
                  {eligibility.perStep
                    .filter((p) => p.eligible_count === 0)
                    .map((p) => (
                      <li key={p.step_id}>
                        Step {p.step_order} — {p.step_name} (
                        {p.required_role.replace(/_/g, " ")})
                      </li>
                    ))}
                </ul>
              </div>
            )}
            {eligibility && eligibility.minCount > 0 && eligibilityLoading === false && (
              <div className="text-[10px] text-muted-foreground">
                Eligible reviewers per step:{" "}
                {eligibility.perStep
                  .map((p) => `${p.step_order}=${p.eligible_count}`)
                  .join(", ")}
              </div>
            )}
            {submitWorkflowId &&
              (() => {
                const wf = workflows.find((w) => String(w.id) === submitWorkflowId);
                if (!wf) return null;
                return (
                  <div className="text-xs text-muted-foreground border rounded p-2 bg-muted/30">
                    <div className="font-medium mb-1">{wf.description}</div>
                    <ol className="list-decimal ml-4 space-y-0.5">
                      {wf.steps.map((s) => (
                        <li key={s.id}>
                          {s.step_name}{" "}
                          <span className="text-[10px] uppercase tracking-wide opacity-70">
                            ({s.required_role.replace(/_/g, " ")})
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                );
              })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubmitDoc(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => submitMutation.mutate()}
              disabled={!submitWorkflowId || submitMutation.isPending}
            >
              {submitMutation.isPending && (
                <Loader2 className="animate-spin mr-1" size={14} />
              )}
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Sign modal (approve or reject) ──────────────────────────── */}
      <Dialog
        open={!!signDoc}
        onOpenChange={(open) => {
          if (!open) {
            setSignDoc(null);
            setSignTypedName("");
            setSignComment("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {signAction === "approved" ? "Approve" : "Reject"} this policy
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {signAction === "approved"
                ? "Your typed name plus a hash of the current version is recorded as your electronic signature for this approval step. 21 CFR Part 11 password re-auth lands in Phase 3."
                : "Rejecting returns the document to draft. The owner can revise and resubmit."}
            </p>
            <div>
              <Label className="text-xs">Type your full name</Label>
              <Input
                value={signTypedName}
                onChange={(e) => setSignTypedName(e.target.value)}
                placeholder="e.g., Michael Veri"
              />
            </div>
            <div>
              <Label className="text-xs">Your password (21 CFR Part 11 re-auth)</Label>
              <Input
                type="password"
                value={signPassword}
                onChange={(e) => setSignPassword(e.target.value)}
                placeholder="Account password"
                autoComplete="current-password"
              />
            </div>
            <div>
              <Label className="text-xs">
                Comment{signAction === "rejected" ? " (recommended)" : " (optional)"}
              </Label>
              <Textarea
                value={signComment}
                onChange={(e) => setSignComment(e.target.value)}
                rows={3}
                placeholder={
                  signAction === "rejected"
                    ? "Tell the owner what needs to change."
                    : "Optional approval note."
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSignDoc(null)}>
              Cancel
            </Button>
            <Button
              variant={signAction === "approved" ? "default" : "destructive"}
              onClick={() => signMutation.mutate()}
              disabled={
                signMutation.isPending ||
                signTypedName.trim().length < 2 ||
                signPassword.length < 1
              }
            >
              {signMutation.isPending && (
                <Loader2 className="animate-spin mr-1" size={14} />
              )}
              {signAction === "approved" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Upload new version modal ─────────────────────────────── */}
      <Dialog
        open={!!newVersionDoc}
        onOpenChange={(open) => {
          if (!open) {
            setNewVersionDoc(null);
            setNewVersionFile(null);
            setNewVersionSummary("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Upload new version: {newVersionDoc?.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              The current version becomes the previous version in history. The new version starts as
              draft and the approval workflow runs again. Attestations on the prior version are
              marked stale.
            </p>
            <div>
              <Label className="text-xs">File (DOCX, PDF, or HTML)</Label>
              <Input
                type="file"
                accept=".docx,.pdf,.html,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(e) => setNewVersionFile(e.target.files?.[0] || null)}
              />
              {newVersionFile && (
                <div className="text-xs text-muted-foreground mt-1">
                  {newVersionFile.name} ({Math.round(newVersionFile.size / 1024)} KB)
                </div>
              )}
            </div>
            <div>
              <Label className="text-xs">Change summary (optional)</Label>
              <Textarea
                value={newVersionSummary}
                onChange={(e) => setNewVersionSummary(e.target.value)}
                rows={2}
                placeholder="e.g., Updated critical value list per Mayo Q2 2026."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewVersionDoc(null)}>
              Cancel
            </Button>
            <Button
              onClick={uploadNewVersion}
              disabled={!newVersionFile || newVersionUploading}
            >
              {newVersionUploading && <Loader2 className="animate-spin mr-1" size={14} />}
              Upload new version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Recertify modal ─────────────────────────────────────────── */}
      <Dialog
        open={!!recertifyDoc}
        onOpenChange={(open) => {
          if (!open) {
            setRecertifyDoc(null);
            setRecertifyPassword("");
            setRecertifyComment("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm still current: {recertifyDoc?.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              By submitting this form you attest that this policy remains current and accurate
              as written. The next review date will advance by{" "}
              {recertifyDoc?.review_interval_months ?? 12} months. Typed name plus password is
              your 21 CFR Part 11 electronic signature; a sha256 of the current version is
              captured at this time.
            </p>
            <div>
              <Label className="text-xs">Type your full name</Label>
              <Input
                value={recertifyTypedName}
                onChange={(e) => setRecertifyTypedName(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Your password</Label>
              <Input
                type="password"
                value={recertifyPassword}
                onChange={(e) => setRecertifyPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div>
              <Label className="text-xs">Comment (optional)</Label>
              <Textarea
                value={recertifyComment}
                onChange={(e) => setRecertifyComment(e.target.value)}
                rows={2}
                placeholder="Optional note for the audit log."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecertifyDoc(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => recertifyMutation.mutate()}
              disabled={
                recertifyMutation.isPending ||
                recertifyTypedName.trim().length < 2 ||
                recertifyPassword.length < 1
              }
            >
              {recertifyMutation.isPending && (
                <Loader2 className="animate-spin mr-1" size={14} />
              )}
              Confirm Still Current
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Assign attestations modal ───────────────────────────────── */}
      <Dialog
        open={!!assignDoc}
        onOpenChange={(open) => {
          if (!open) {
            setAssignDoc(null);
            setAssignSelected(new Set());
            setAssignDueDate("");
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Assign for attestation</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Pick the staff who must read and attest to{" "}
              <span className="font-medium">{assignDoc?.title}</span>. Each assignment is per
              version; if you upload a new version they will need to re-attest.
            </p>
            <div className="border rounded max-h-64 overflow-y-auto divide-y">
              {labMembers.length === 0 ? (
                <div className="p-3 text-xs text-muted-foreground">No lab members yet.</div>
              ) : (
                labMembers.map((m) => (
                  <label
                    key={m.membership_id}
                    className="flex items-center gap-2 p-2 text-sm hover:bg-muted/30 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={assignSelected.has(m.user_id)}
                      onChange={(e) => {
                        const next = new Set(assignSelected);
                        if (e.target.checked) next.add(m.user_id);
                        else next.delete(m.user_id);
                        setAssignSelected(next);
                      }}
                    />
                    <span className="flex-1">
                      <span className="font-medium">{m.name || m.email}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {m.role}
                        {m.seat_type && ` · ${m.seat_type.replace(/_/g, " ")}`}
                      </span>
                    </span>
                  </label>
                ))
              )}
            </div>
            <div>
              <Label className="text-xs">Due date (optional)</Label>
              <Input
                type="date"
                value={assignDueDate}
                onChange={(e) => setAssignDueDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDoc(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => assignMutation.mutate()}
              disabled={assignMutation.isPending || assignSelected.size === 0}
            >
              {assignMutation.isPending && (
                <Loader2 className="animate-spin mr-1" size={14} />
              )}
              Assign ({assignSelected.size})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Complete attestation modal ─────────────────────────────── */}
      <Dialog
        open={!!attestTarget}
        onOpenChange={(open) => {
          if (!open) {
            setAttestTarget(null);
            setAttestTypedName("");
            setAttestPassword("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Attest to: {attestTarget?.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              By submitting this form you confirm that you have read and understood the current
              version of this policy. Typed name plus password is your 21 CFR Part 11 electronic
              signature; a sha256 of the current version is captured at attest time.
            </p>
            <div>
              <Label className="text-xs">Type your full name</Label>
              <Input
                value={attestTypedName}
                onChange={(e) => setAttestTypedName(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Your password</Label>
              <Input
                type="password"
                value={attestPassword}
                onChange={(e) => setAttestPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAttestTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => attestCompleteMutation.mutate()}
              disabled={
                attestCompleteMutation.isPending ||
                attestTypedName.trim().length < 2 ||
                attestPassword.length < 1
              }
            >
              {attestCompleteMutation.isPending && (
                <Loader2 className="animate-spin mr-1" size={14} />
              )}
              I attest
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Rename / edit metadata modal ─────────────────────────────── */}
      <Dialog
        open={!!renameDoc}
        onOpenChange={(open) => {
          if (!open) setRenameDoc(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit policy details</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Title</Label>
              <Input
                value={renameTitle}
                onChange={(e) => setRenameTitle(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <Textarea
                value={renameDescription}
                onChange={(e) => setRenameDescription(e.target.value)}
                rows={2}
              />
            </div>
            <div>
              <Label className="text-xs">Manual</Label>
              <Select value={renameManualId} onValueChange={setRenameManualId}>
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  {manuals.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDoc(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => renameMutation.mutate()}
              disabled={renameMutation.isPending || renameTitle.trim().length < 2}
            >
              {renameMutation.isPending && (
                <Loader2 className="animate-spin mr-1" size={14} />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
