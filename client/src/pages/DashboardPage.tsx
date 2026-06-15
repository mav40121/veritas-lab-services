import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Study } from "@shared/schema";
import { PlusCircle, FileText, Trash2, CheckCircle2, XCircle, FlaskConical, Download, Edit2, FileEdit, Archive, GitBranch } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useState } from "react";
import { getToken } from "@/lib/auth";
import { CorrelationsDueSoonWidget } from "@/components/CorrelationsDueSoonWidget";
import { CompetencyStatusTile } from "@/components/CompetencyStatusTile";
import { CredentialExpirationTile } from "@/components/CredentialExpirationTile";
import { ReassessmentTrackerTile } from "@/components/ReassessmentTrackerTile";
import { DutyChangeTile } from "@/components/DutyChangeTile";
import { ComplianceScoreTile } from "@/components/ComplianceScoreTile";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useLabRoute } from "@/hooks/useLabRoute";
import { ModuleHowToCard } from "@/components/ModuleHowToCard";

export default function Dashboard() {
  const labRoute = useLabRoute();
  const { toast } = useToast();
  const readOnly = useIsReadOnly('veritacheck');
  // Multi-Lab Tier 2 Phase 3: studies are lab-scoped. labId comes from the
  // /labs/:labId/dashboard URL (LegacyWorkspaceRedirect bounces bare
  // /dashboard to this form). Falls back to legacy /api/studies when not
  // in a lab-scoped URL so a stale cache or unauth flow still resolves.
  const labId = useActiveLabId();
  const studiesUrl = labId ? `/api/labs/${labId}/studies` : "/api/studies";
  const deleteUrl = (id: number) => labId ? `/api/labs/${labId}/studies/${id}` : `/api/studies/${id}`;

  // VeritaCheck Phase 1 PR 3: Active / Archived view toggle. Archived studies
  // are excluded server-side from the default list; ?archived=1 returns only
  // the archived set. The query key includes the URL so the two views cache
  // independently and the toggle is instant after first load.
  const [showArchived, setShowArchived] = useState(false);
  const listUrl = showArchived ? `${studiesUrl}?archived=1` : studiesUrl;

  const { data: studies, isLoading } = useQuery<Study[]>({
    queryKey: [listUrl],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", deleteUrl(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [listUrl] });
      toast({ title: "Study deleted" });
    },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  const passCount = studies?.filter((s) => s.status === "pass").length ?? 0;
  const failCount = studies?.filter((s) => s.status === "fail").length ?? 0;

  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const token = getToken();
      if (!token) {
        toast({ title: "Please sign in to export", variant: "destructive" });
        return;
      }
      const res = await fetch("/api/my-studies/export", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        let msg = "Export failed";
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch {}
        toast({ title: msg, variant: "destructive" });
        return;
      }
      const cd = res.headers.get("Content-Disposition") || "";
      const m = /filename="([^"]+)"/.exec(cd);
      const filename = m ? m[1] : `VeritaCheck_Studies_${new Date().toISOString().split("T")[0]}.xlsx`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast({ title: "Studies workbook downloaded" });
    } catch (e: any) {
      toast({ title: "Export failed", description: e?.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Study Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {showArchived ? "Archived studies (off the active list, retained in the audit trail)" : "Active studies"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Active / Archived view toggle */}
          <div className="inline-flex rounded-md border border-border overflow-hidden" role="group" aria-label="Study view">
            <button
              type="button"
              onClick={() => setShowArchived(false)}
              className={`h-8 px-3 text-xs font-medium transition-colors ${!showArchived ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground hover:bg-muted"}`}
              data-testid="toggle-active-studies"
            >
              Active
            </button>
            <button
              type="button"
              onClick={() => setShowArchived(true)}
              className={`h-8 px-3 text-xs font-medium transition-colors inline-flex items-center gap-1 ${showArchived ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground hover:bg-muted"}`}
              data-testid="toggle-archived-studies"
            >
              <Archive size={12} />Archived
            </button>
          </div>
          {!showArchived && !!studies?.length && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1"
              onClick={handleExport}
              disabled={exporting}
              data-testid="button-export-studies-xlsx"
              title="Download all studies as an Excel workbook"
            >
              <Download size={13} />
              {exporting ? "Exporting..." : "Export to Excel"}
            </Button>
          )}
          <Button asChild variant="outline" size="sm" className="h-8 text-xs gap-1">
            <Link href={labRoute("/dashboard/verifications")}>
              <FileText size={13} />
              Instrument Verification Packages
            </Link>
          </Button>
          {readOnly ? (
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground" disabled title="Resubscribe to add new records">
              <PlusCircle size={14} className="mr-1.5" />
              New Study
            </Button>
          ) : (
            <Button asChild className="bg-primary hover:bg-primary/90 text-primary-foreground">
              <Link href={labRoute("/study/new")}>
                <PlusCircle size={14} className="mr-1.5" />
                New Study
              </Link>
            </Button>
          )}
        </div>
      </div>

      <ModuleHowToCard
        moduleKey="veritacheck"
        moduleName="VeritaCheck™"
        whatItDoes="VeritaCheck runs the analytical performance verification studies CLIA requires before a new method goes into patient testing: Calibration Verification / Linearity, Precision, Correlation / Method Comparison, Reagent Lot Verification (EP26-A), QC Lot Verification (C24-Ed4), and Coagulation New Lot. Each study calculates the statistics, generates the CFR-cited narrative, and produces a director-signed PDF on page 1."
        howToUse={[
          "Click New Study and pick the study type that matches your need (Calibration Verification / Linearity, Precision, Correlation / Method Comparison, Reagent Lot Verification, QC Lot Verification, Coagulation New Lot).",
          "Add the instrument and analyte from your VeritaMap test menu.",
          "Enter your data manually or paste from a CSV; the calculator runs the statistics live.",
          "Review the calculated values against the CLIA TEa (or Lab-Set Internal Goal where no canonical TEa exists).",
          "The medical director or designee signs; download the PDF and file with your CLIA records.",
        ]}
      />

      {/* Wave J PR J4 (2026-06-06): headline compliance score for the lab.
          Aggregates the five tile signals into a single number with a
          colored band, plus a drill-down panel listing per-program scores
          ranked worst-first. Self-hides when nothing is on file. Mounted
          first so the LD's eye lands on the overall score before any
          per-area tile. */}
      <ComplianceScoreTile className="mb-6" />

      {/* PR E2: Competency status tile (lab-scoped). Hides itself when the
          lab has zero active testing personnel or the user is on the legacy
          /dashboard URL. */}
      <CompetencyStatusTile className="mb-6" />

      {/* Wave F PR F3: Credential expiration tile. Hides itself when the lab
          has zero credentials with an expiration_date. Pairs visually with
          the competency tile so surveyors see both signals adjacently. */}
      <CredentialExpirationTile className="mb-6" />

      {/* Wave G PR G2: Open-reassessment queue tile. Self-hides when no
          failing assessments are open. Per §493.1235(b)(7) a failing
          assessment triggers a mandatory reassessment cycle; this tile
          surfaces who still owes a follow-up. */}
      <ReassessmentTrackerTile className="mb-6" />

      {/* Wave H PR H4: Duty-change reassessment queue tile. Self-hides
          when no employee has an open duty-change event (instrument
          added but no follow-up duty-change competency assessment).
          Per §493.1235(a) and TJC HR.01.06.01, an employee's testing
          duties changing triggers a reassessment. */}
      <DutyChangeTile className="mb-6" />

      {/* Correlations due soon */}
      <CorrelationsDueSoonWidget className="mb-6" />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold">{studies?.length ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Total Studies</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-green-400">{passCount}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Passing</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-red-400">{failCount}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Failing</div>
          </CardContent>
        </Card>
      </div>

      {/* Studies list */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : !studies?.length ? (
        showArchived ? (
          <div className="text-center py-20 border-2 border-dashed border-border rounded-xl">
            <Archive size={32} className="text-muted-foreground mx-auto mb-3" />
            <h3 className="font-semibold mb-1">No archived studies</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Studies you archive, and originals superseded by a signed-off amendment, appear here.
            </p>
            <Button variant="outline" onClick={() => setShowArchived(false)} data-testid="back-to-active-empty">
              Back to active studies
            </Button>
          </div>
        ) : (
        <div className="text-center py-20 border-2 border-dashed border-border rounded-xl">
          <FlaskConical size={32} className="text-muted-foreground mx-auto mb-3" />
          <h3 className="font-semibold mb-1">No studies yet</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Run your first study to get started.
          </p>
          <Button asChild className="bg-primary hover:bg-primary/90 text-primary-foreground">
            <Link href={labRoute("/study/new")}>Start a Study</Link>
          </Button>
        </div>
        )
      ) : (
        <div className="space-y-2">
          {studies.map((study) => {
            const isDraft = study.status === "draft";
            const editPath = labId ? `/labs/${labId}/study/${study.id}/edit` : `/study/${study.id}/edit`;
            const viewPath = labId ? `/labs/${labId}/study/${study.id}/results` : `/study/${study.id}/results`;
            return (
            <Card key={study.id} className="hover:border-primary/30 transition-colors group" data-testid={`card-study-${study.id}`}>
              <CardContent className="p-4 flex items-center gap-4">
                {/* Status icon: pass / fail / draft */}
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${isDraft ? "bg-amber-500/10 text-amber-400" : study.status === "pass" ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                  {isDraft ? <FileEdit size={18} /> : study.status === "pass" ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                </div>

                {/* Study info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm truncate">{study.testName}</span>
                    <Badge variant="outline" className="text-xs shrink-0">
                      {study.studyType === "cal_ver" ? "Calibration Verification (CLSI EP06)" : study.studyType === "precision" ? "Precision (EP15)" : study.studyType === "lot_to_lot" ? "Reagent Lot Verification (EP26-A)" : study.studyType === "pt_coag" ? "PT/Coag" : study.studyType === "qc_range" ? "QC Lot Verification (C24-Ed4)" : study.studyType === "multi_analyte_coag" ? "Multi-Analyte Lot Comparison" : study.studyType === "ref_interval" ? "Reference Range Verification" : study.studyType === "sensitivity" ? "Sensitivity (EP17-A2)" : study.studyType === "carryover" ? "Carryover (EP10-A3)" : study.studyType === "accuracy_bias" ? "Accuracy / Bias: Single Instrument vs Target (EP15-A3)" : study.studyType === "linearity" ? "Linearity (EP06)" : study.studyType === "reportable_range" ? "Reportable Range (CLIA §493.1255)" : "Method Comparison: Multi-Instrument Correlation (EP09 + EP15-A3)"}
                    </Badge>
                    <span className={`text-xs font-semibold ${isDraft ? "text-amber-500" : study.status === "pass" ? "pass-badge" : "fail-badge"}`}>
                      {(study.status || "").toUpperCase()}
                    </span>
                    {(study as any).amends_study_id ? (
                      <Badge variant="outline" className="text-xs shrink-0 border-blue-400/40 text-blue-500" data-testid={`badge-amendment-${study.id}`}>
                        <GitBranch size={10} className="mr-1" />Amendment of #{(study as any).amends_study_id}
                      </Badge>
                    ) : null}
                    {(study as any).archived_at ? (
                      <Badge variant="outline" className="text-xs shrink-0 border-amber-500/40 text-amber-600" data-testid={`badge-archived-${study.id}`} title={(study as any).archive_reason || undefined}>
                        <Archive size={10} className="mr-1" />Archived
                      </Badge>
                    ) : null}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex gap-3 flex-wrap">
                    <span>{study.instrument || (isDraft ? "(no instrument yet)" : "-")}</span>
                    <span>·</span>
                    <span>{study.date}</span>
                    <span>·</span>
                    <span>Analyst: {study.analyst || (isDraft ? "(unassigned)" : "-")}</span>
                    {!isDraft && <>
                      <span>·</span>
                      <span>TEa: ±{(study as any).teaIsPercentage === 0 ? `${study.cliaAllowableError} ${(study as any).teaUnit || ''}` : `${(study.cliaAllowableError * 100).toFixed(1)}%`}</span>
                    </>}
                  </div>
                </div>

                {/* Actions: drafts get an Edit (continue) button; completed studies get View (results) + Edit. */}
                <div className="flex items-center gap-2 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                  <Button asChild variant={isDraft ? "default" : "outline"} size="sm" className={isDraft ? "bg-primary hover:bg-primary/90 text-primary-foreground" : ""} data-testid={`button-${isDraft ? "edit" : "view"}-${study.id}`}>
                    <Link href={isDraft ? editPath : viewPath}>
                      {isDraft ? <><Edit2 size={13} className="mr-1" />Continue</> : <><FileText size={13} className="mr-1" />View</>}
                    </Link>
                  </Button>
                  {!isDraft && (
                    <Button asChild variant="ghost" size="icon" className="h-8 w-8" data-testid={`button-edit-${study.id}`} title="Edit study">
                      <Link href={editPath}>
                        <Edit2 size={13} />
                      </Link>
                    </Button>
                  )}
                  <ConfirmDialog
                    title="Delete Study?"
                    message={`Delete the "${study.testName}" study? All results will be permanently removed.`}
                    confirmLabel="Delete"
                    onConfirm={() => deleteMutation.mutate(study.id)}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive h-8 w-8"
                      data-testid={`button-delete-${study.id}`}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </ConfirmDialog>
                </div>
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
