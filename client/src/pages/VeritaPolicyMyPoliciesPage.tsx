// VeritaPolicyMyPoliciesPage.tsx
//
// VeritaPolicy approval workflow — Phase 1 client surface.
// Upload + list + inline-render of lab-owned policy documents, organized
// into manuals (Chemistry, Hematology, Safety, etc.). Backed by the
// nine-table schema from Phase 0.
//
// Phase 1 is read/upload/view only. The multi-step approval workflow UI,
// signoffs, attestations, periodic reviews, and audit dashboard ship in
// Phases 2-7.

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
} from "lucide-react";

interface Manual {
  id: number;
  name: string;
  description: string | null;
  display_order: number;
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

  // ── View modal ──────────────────────────────────────────────────────────
  const [viewDoc, setViewDoc] = useState<PolicyDocument | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewHtml, setViewHtml] = useState<string>("");
  const [viewPdfUrl, setViewPdfUrl] = useState<string>("");

  const openView = async (doc: PolicyDocument) => {
    setViewDoc(doc);
    setViewHtml("");
    setViewPdfUrl("");
    setViewLoading(true);
    try {
      const token = localStorage.getItem("veritas_token") || "";
      if (doc.current_file_format === "pdf") {
        // For PDF, we fetch as blob then create object URL for inline iframe.
        const res = await fetch(
          `/api/labs/${activeLabId}/veritapolicy/documents/${doc.id}/render`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) throw new Error("Render failed");
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
  const grouped = useMemo(() => {
    const byManual = new Map<string, PolicyDocument[]>();
    documents.forEach((doc) => {
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
          <Button variant="outline" onClick={() => setNewManualOpen(true)}>
            <FolderPlus size={14} className="mr-1.5" /> New Manual
          </Button>
          <Button onClick={() => setUploadOpen(true)}>
            <Upload size={14} className="mr-1.5" /> Upload Policy
          </Button>
        </div>
      </div>

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
    </div>
  );
}
