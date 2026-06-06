// CompetencyBulkImportDialog
//
// Wave I PR I4 (2026-06-06). Bulk import historical competency
// assessments from an xlsx. File picker -> server-side preview ->
// commit. Mirrors PR #571's staff bulk-import UX so the lab director
// only has to learn one upload workflow across the two modules.
//
// On commit, each row creates a locked competency_assessment with
// completion_date = assessment_date. Per-element items are NOT
// populated; the surveyor PDF renders "No data recorded" cleanly for
// historical paper-record migrations.

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

type RowIssue = { field?: string; severity: "error" | "warning"; message: string };
type ValidatedRow = {
  rowNumber: number;
  status: "ok" | "warning" | "error";
  parsed: { employeeName: string; programName: string; assessmentType: string; assessmentDate: string; status: string; evaluatorName: string };
  issues: RowIssue[];
  willCreateCompEmployee: boolean;
};
type PreviewResponse = {
  rows: ValidatedRow[];
  summary: { total: number; ok: number; warning: number; error: number };
  fatal?: string;
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  labId: number;
}

export function CompetencyBulkImportDialog({ open, onOpenChange, labId }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);

  function reset() {
    setFile(null);
    setPreview(null);
  }

  async function downloadTemplate() {
    try {
      const r = await fetch(`${API_BASE}/api/labs/${labId}/competency/assessments/bulk-template`, { headers: authHeaders() });
      if (!r.ok) throw new Error(await r.text());
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "VeritaComp_Bulk_Import_Template.xlsx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Template download failed", description: err.message, variant: "destructive" });
    }
  }

  async function doPreview() {
    if (!file) return;
    setPreviewing(true);
    setPreview(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await fetch(`${API_BASE}/api/labs/${labId}/competency/assessments/bulk-preview`, {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      const json: PreviewResponse = await r.json();
      if (!r.ok) {
        toast({ title: "Preview failed", description: json.fatal || (json as any).error || `HTTP ${r.status}`, variant: "destructive" });
        setPreview(json);
      } else {
        setPreview(json);
      }
    } catch (err: any) {
      toast({ title: "Preview failed", description: err.message, variant: "destructive" });
    } finally {
      setPreviewing(false);
    }
  }

  async function doCommit() {
    if (!file || !preview) return;
    if (preview.summary.error > 0) {
      toast({ title: "Fix errors first", description: `${preview.summary.error} row(s) have errors. Fix them in the xlsx and re-upload.`, variant: "destructive" });
      return;
    }
    setCommitting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await fetch(`${API_BASE}/api/labs/${labId}/competency/assessments/bulk-commit`, {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      const json = await r.json();
      if (!r.ok) {
        toast({ title: "Import failed", description: json.message || json.error || `HTTP ${r.status}`, variant: "destructive" });
      } else {
        toast({
          title: "Bulk import complete",
          description: `${json.imported} assessment(s) imported${json.createdCompEmployees > 0 ? `; ${json.createdCompEmployees} new competency_employees stub(s) created` : ""}.`,
        });
        await queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).includes("/competency/") });
        reset();
        onOpenChange(false);
      }
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setCommitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Import Historical Assessments</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Step 1: download the template */}
          <div className="border border-border rounded-md p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm">
                <strong>Step 1.</strong> Download the template, fill in one row per historical assessment, and save as xlsx.
              </div>
              <Button variant="outline" size="sm" onClick={downloadTemplate}>
                <Download size={14} className="mr-1.5" /> Template
              </Button>
            </div>
          </div>

          {/* Step 2: upload */}
          <div className="border border-border rounded-md p-3">
            <div className="text-sm mb-2"><strong>Step 2.</strong> Upload the filled-in xlsx. Server validates without writing.</div>
            <div className="flex items-center gap-2">
              <label className="flex-1 flex items-center gap-2 border border-dashed border-border rounded-md px-3 py-2 cursor-pointer hover:border-primary/50">
                <FileSpreadsheet size={16} className="text-muted-foreground" />
                <input
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }}
                />
                <span className="text-sm truncate">{file ? file.name : "Click to pick a .xlsx file"}</span>
              </label>
              <Button onClick={doPreview} disabled={!file || previewing}>
                <Upload size={14} className="mr-1.5" />
                {previewing ? "Validating..." : "Preview"}
              </Button>
            </div>
          </div>

          {/* Step 3: review */}
          {preview && !preview.fatal && (
            <div className="border border-border rounded-md p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm">
                  <strong>Step 3.</strong> Review the preview. Commit imports all OK and Warning rows; errors block commit.
                </div>
                <div className="flex items-center gap-2">
                  <Badge className="text-[10px] border bg-emerald-500/10 text-emerald-700 border-emerald-500/30">{preview.summary.ok} OK</Badge>
                  <Badge className="text-[10px] border bg-amber-500/10 text-amber-700 border-amber-500/30">{preview.summary.warning} warning</Badge>
                  <Badge className="text-[10px] border bg-red-500/10 text-red-700 border-red-500/30">{preview.summary.error} error</Badge>
                </div>
              </div>
              {preview.rows.length === 0 && (
                <div className="text-sm text-muted-foreground py-4 text-center">No data rows in the file.</div>
              )}
              {preview.rows.length > 0 && (
                <div className="overflow-x-auto max-h-[40vh]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-background">
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="text-left py-1 pr-2 font-medium">#</th>
                        <th className="text-left py-1 pr-2 font-medium">Status</th>
                        <th className="text-left py-1 pr-2 font-medium">Employee</th>
                        <th className="text-left py-1 pr-2 font-medium">Program</th>
                        <th className="text-left py-1 pr-2 font-medium">Type</th>
                        <th className="text-left py-1 pr-2 font-medium">Date</th>
                        <th className="text-left py-1 pr-2 font-medium">Result</th>
                        <th className="text-left py-1 pr-2 font-medium">Issues</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row) => {
                        const Icon = row.status === "ok" ? CheckCircle2 : row.status === "warning" ? AlertTriangle : XCircle;
                        const iconColor = row.status === "ok" ? "text-emerald-600" : row.status === "warning" ? "text-amber-600" : "text-red-600";
                        return (
                          <tr key={row.rowNumber} className="border-b border-border/40">
                            <td className="py-1 pr-2 font-mono">{row.rowNumber}</td>
                            <td className="py-1 pr-2"><Icon size={12} className={iconColor} /></td>
                            <td className="py-1 pr-2">
                              {row.parsed.employeeName}
                              {row.willCreateCompEmployee && (
                                <Badge className="ml-1 text-[9px] border bg-blue-500/10 text-blue-700 border-blue-500/30">stub on import</Badge>
                              )}
                            </td>
                            <td className="py-1 pr-2 truncate max-w-[160px]">{row.parsed.programName}</td>
                            <td className="py-1 pr-2">{row.parsed.assessmentType}</td>
                            <td className="py-1 pr-2 font-mono">{row.parsed.assessmentDate}</td>
                            <td className="py-1 pr-2">{row.parsed.status}</td>
                            <td className="py-1 pr-2 text-[10px] text-muted-foreground">
                              {row.issues.length === 0 ? "" : row.issues.map((i) => i.message).join("; ")}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {preview?.fatal && (
            <div className="border border-red-500/30 bg-red-500/10 rounded-md p-3 text-sm text-red-700">
              <strong>Cannot parse file:</strong> {preview.fatal}
            </div>
          )}

          {/* Step 4: commit */}
          {preview && !preview.fatal && preview.rows.length > 0 && (
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { reset(); }}>Discard</Button>
              <Button
                onClick={doCommit}
                disabled={committing || preview.summary.error > 0}
                className="bg-primary hover:bg-primary/90"
              >
                {committing ? "Importing..." : `Import ${preview.summary.ok + preview.summary.warning} row(s)`}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
