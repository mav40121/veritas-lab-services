import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthContext";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Plus,
  Trash2,
  ChevronRight,
  ClipboardList,
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
  Lock,
} from "lucide-react";

interface ScanSummary {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  assessedCount: number;    // items that are NOT "Not Assessed"
  compliantCount: number;
  needsAttentionCount: number;
  immediateActionCount: number;
  naCount: number;
  totalItems: number;       // always 168
}

function ComplianceMeter({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-muted-foreground">-</span>;
  const color =
    pct >= 80 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-red-500";
  const textColor =
    pct >= 80 ? "text-emerald-700" : pct >= 60 ? "text-amber-700" : "text-red-700";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden min-w-[80px]">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <span className={`text-xs font-semibold tabular-nums ${textColor}`}>
        {Math.round(pct)}%
      </span>
    </div>
  );
}

function ProgressBar({ assessed, total }: { assessed: number; total: number }) {
  const pct = total > 0 ? (assessed / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden min-w-[80px]">
        <div
          className="h-full rounded-full bg-primary/70 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">
        {assessed}/{total}
      </span>
    </div>
  );
}

function DeleteConfirmDialog({
  scanId,
  scanName,
  onDelete,
}: {
  scanId: number;
  scanName: string;
  onDelete: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
          title="Delete scan"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete Scan?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Are you sure you want to delete{" "}
          <span className="font-semibold text-foreground">"{scanName}"</span>?
          This action cannot be undone.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              onDelete(scanId);
              setOpen(false);
            }}
          >
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function VeritaScanAppPage() {
  const { user, isLoggedIn } = useAuth();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const readOnly = useIsReadOnly();

  const [newScanName, setNewScanName] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  // Access check
  const hasPlanAccess =
    user?.plan === "annual" ||
    user?.plan === "lab" ||
    user?.plan === "veritascan";

  // Fetch scans
  const {
    data: scans,
    isLoading,
    error,
  } = useQuery<ScanSummary[]>({
    queryKey: ["/api/veritascan/scans"],
    enabled: isLoggedIn && hasPlanAccess,
  });

  // Create scan
  const createScan = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch(`${API_BASE}/api/veritascan/scans`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to create scan");
      }
      return res.json() as Promise<ScanSummary>;
    },
    onSuccess: (newScan) => {
      qc.invalidateQueries({ queryKey: ["/api/veritascan/scans"] });
      setDialogOpen(false);
      setNewScanName("");
      navigate(`/veritascan-app/${newScan.id}`);
    },
  });

  // Delete scan
  const deleteScan = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${API_BASE}/api/veritascan/scans/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/veritascan/scans"] });
    },
  });

  // ── Not logged in ────────────────────────────────────────────────────────
  if (!isLoggedIn) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mb-4">
            <Lock className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Sign in to access VeritaScan</h1>
          <p className="text-muted-foreground text-sm mb-6">
            VeritaScan™ requires an account. Sign in to continue.
          </p>
          <Button asChild>
            <Link href="/login">Sign In</Link>
          </Button>
        </div>
      </div>
    );
  }

  // ── No plan access ────────────────────────────────────────────────────────
  if (!hasPlanAccess) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-950/30 mb-4">
            <ClipboardList className="h-7 w-7 text-amber-600" />
          </div>
          <h1 className="text-2xl font-bold mb-2">VeritaScan Access Required</h1>
          <p className="text-muted-foreground text-sm mb-6">
            Your current plan doesn't include VeritaScan™. Upgrade to access the
            168-item inspection readiness self-assessment.
          </p>
          <Button asChild>
            <Link href="/veritascan">View Plans</Link>
          </Button>
        </div>
      </div>
    );
  }

  // ── Main app ─────────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold tracking-tight">VeritaScan™</h1>
            <Badge
              variant="outline"
              className="text-xs bg-primary/5 text-primary border-primary/20"
            >
              Beta
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Inspection Readiness Self-Assessment: 168 items across 10 domains
          </p>
        </div>

        {/* New Scan button + dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="shrink-0" disabled={readOnly} title={readOnly ? "Resubscribe to add new records" : undefined}>
              <Plus className="h-4 w-4 mr-1.5" />
              New Scan
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Create New Scan</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Give this scan a name, e.g. "Annual Mock Inspection Q1 2026" or
              "Pre-TJC Survey Mar 2026".
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const name = newScanName.trim();
                if (name) createScan.mutate(name);
              }}
              className="space-y-3 pt-1"
            >
              <Input
                autoFocus
                placeholder="Scan name…"
                value={newScanName}
                onChange={(e) => setNewScanName(e.target.value)}
                maxLength={120}
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDialogOpen(false);
                    setNewScanName("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!newScanName.trim() || createScan.isPending}
                >
                  {createScan.isPending ? "Creating…" : "Create Scan"}
                </Button>
              </div>
              {createScan.isError && (
                <p className="text-xs text-destructive">
                  {(createScan.error as Error).message}
                </p>
              )}
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-28 rounded-xl bg-muted/60 animate-pulse"
            />
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Failed to load scans. Please refresh and try again.
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && scans?.length === 0 && (
        <div className="text-center py-16 rounded-xl border border-dashed border-border">
          <ClipboardList className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
          <p className="font-semibold mb-1">No scans yet</p>
          <p className="text-sm text-muted-foreground mb-5">
            Create your first inspection readiness scan to get started.
          </p>
          <Button onClick={() => setDialogOpen(true)} disabled={readOnly} title={readOnly ? "Resubscribe to add new records" : undefined}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Scan
          </Button>
        </div>
      )}

      {/* Scan list */}
      {!isLoading && !error && scans && scans.length > 0 && (
        <div className="space-y-3">
          {scans.map((scan) => {
            const assessed = scan.assessedCount ?? 0;
            const total = scan.totalItems ?? 168;
            const compliant = scan.compliantCount ?? 0;
            const na = scan.naCount ?? 0;
            const gap =
              (scan.needsAttentionCount ?? 0) +
              (scan.immediateActionCount ?? 0);
            const denominator = total - na;
            const compliancePct =
              assessed > 0 && denominator > 0
                ? (compliant / denominator) * 100
                : null;

            const date = new Date(scan.updatedAt || scan.createdAt);
            const dateStr = date.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            });

            return (
              <Card
                key={scan.id}
                className="group hover:border-primary/30 transition-colors"
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    {/* Main info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="font-semibold text-sm leading-tight truncate">
                          {scan.name}
                        </span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {dateStr}
                        </span>
                      </div>

                      {/* Progress row */}
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 mb-2">
                        <div>
                          <p className="text-xs text-muted-foreground mb-0.5">
                            Progress
                          </p>
                          <ProgressBar assessed={assessed} total={total} />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-0.5">
                            Compliance
                          </p>
                          <ComplianceMeter pct={compliancePct} />
                        </div>
                      </div>

                      {/* Badges */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {gap > 0 ? (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-full px-2 py-0.5">
                            <AlertTriangle className="h-3 w-3" />
                            {gap} gap{gap !== 1 ? "s" : ""}
                          </span>
                        ) : assessed > 0 ? (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-full px-2 py-0.5">
                            <CheckCircle2 className="h-3 w-3" />
                            No gaps found
                          </span>
                        ) : null}
                        {(scan.immediateActionCount ?? 0) > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-full px-2 py-0.5">
                            <AlertOctagon className="h-3 w-3" />
                            {scan.immediateActionCount} immediate
                          </span>
                        )}
                        {assessed === 0 && (
                          <span className="text-xs text-muted-foreground">
                            Not started
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <DeleteConfirmDialog
                        scanId={scan.id}
                        scanName={scan.name}
                        onDelete={(id) => deleteScan.mutate(id)}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/veritascan-app/${scan.id}`)}
                        className="gap-1"
                      >
                        Open
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
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
