import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthContext";
import { ModuleHowToCard } from "@/components/ModuleHowToCard";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  Map,
  Lock,
  AlertTriangle,
  CheckCircle2,
  CalendarClock,
  FileSpreadsheet,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { CorrelationsDueSoonWidget } from "@/components/CorrelationsDueSoonWidget";

interface MapSummary {
  id: number;
  name: string;
  totalTests: number;
  gaps: number;
  updated_at: string;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "-";
  }
}

function DeleteConfirmDialog({
  mapId,
  mapName,
  onDelete,
}: {
  mapId: number;
  mapName: string;
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
          title="Delete map"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete map?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{mapName}</span> and
          all its test data will be permanently deleted. This cannot be undone.
        </p>
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              onDelete(mapId);
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

export default function VeritaMapAppPage() {
  const { user, isLoggedIn } = useAuth();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const readOnly = useIsReadOnly('veritamap');

  const [newMapName, setNewMapName] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  // Access check – only free and per_study plans see the freemium banner
  const hasPlanAccess =
    !!user?.plan && user.plan !== "free" && user.plan !== "per_study";

  // Multi-Lab Tier 2 Phase 3.3b: lab-scope reads/writes through the lab in
  // the URL. Inner map endpoints (called from VeritaMapMapPage) stay on
  // legacy URLs in this PR; they scope by map_id which is globally unique.
  const activeLabId = useActiveLabId();
  const mapsListUrl = activeLabId
    ? `/api/labs/${activeLabId}/veritamap/maps`
    : `/api/veritamap/maps`;
  const mapDeleteUrl = (id: number | string) =>
    activeLabId
      ? `/api/labs/${activeLabId}/veritamap/maps/${id}`
      : `/api/veritamap/maps/${id}`;

  // Fetch maps
  const { data: maps, isLoading } = useQuery<MapSummary[]>({
    queryKey: [mapsListUrl],
    enabled: isLoggedIn,
  });

  // Create map
  const createMap = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch(`${API_BASE}${mapsListUrl}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to create map");
      }
      return res.json() as Promise<MapSummary>;
    },
    onSuccess: (newMap) => {
      qc.invalidateQueries({ queryKey: [mapsListUrl] });
      setDialogOpen(false);
      setNewMapName("");
      // Preserve lab context across the navigation to the Build page.
      navigate(activeLabId
        ? `/labs/${activeLabId}/veritamap-app/${newMap.id}/build`
        : `/veritamap-app/${newMap.id}/build`);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Delete map
  const deleteMap = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${API_BASE}${mapDeleteUrl(id)}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [mapsListUrl] });
      toast({ title: "Map deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete map", variant: "destructive" });
    },
  });

  // ── Not logged in ─────────────────────────────────────────────────────────
  if (!isLoggedIn) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mb-4">
            <Lock className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Sign in to access VeritaMap™</h1>
          <p className="text-muted-foreground text-sm mb-6">
            VeritaMap™ requires an account. Sign in to continue.
          </p>
          <Button asChild>
            <Link href="/login">Sign In</Link>
          </Button>
        </div>
      <ModuleHowToCard
        moduleKey="veritamap"
        moduleName="VeritaMap™"
        whatItDoes="VeritaMap is where you build your facility's test menu. Pick the instruments your lab runs, toggle the tests you actually perform on each, and the menu becomes the source of truth that feeds VeritaCheck (study setup), VeritaComp (competency programs), VeritaPT (PT coverage), and VeritaTrack (regulatory calendar). The menu also captures CLIA complexity, specialty, FDA classification, and fields for the critical values, reference intervals, and AMR your lab will verify and enter per 42 CFR 493.1253."
        howToUse={[
          "Add the instruments your lab runs from the database of 190+ FDA-cleared analyzers.",
          "Toggle the tests you actually perform on each instrument; CLIA complexity, specialty, and FDA classification populate automatically.",
          "Record your facility's MEC-adopted critical values for each analyte, if your lab chooses to track them here.",
          "Enter your verified reference intervals and AMR per 42 CFR 493.1253.",
          "Other Verita modules read from this menu automatically; update here whenever you add or retire a test."
        ]}
      />

      </div>
    );
  }

  // ── Main app ──────────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold tracking-tight">VeritaMap™</h1>
            <Badge
              variant="outline"
              className="text-xs bg-primary/5 text-primary border-primary/20"
            >
              Beta
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Test Menu Regulatory Mapping: track calibration verification,
            method comparison, and SOP compliance.
          </p>
        </div>

        {/* New Map button + resources link + dialog */}
        <div className="flex items-center gap-2">
          {/* Toggle: This map / Whole lab. PARKING_LOT #19 Phase 1.
              Hidden when only 0 or 1 maps exist (single-map labs don't need it). */}
          {(maps?.length ?? 0) > 1 && (
            <div className="hidden sm:flex items-center gap-1 rounded-md border border-border bg-card p-0.5">
              <Button
                size="sm"
                className="h-7 text-xs px-3 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                This map
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs px-3"
                onClick={() => navigate(activeLabId
                  ? `/labs/${activeLabId}/veritamap-app/labwide`
                  : "/veritamap-app/labwide")}
              >
                Whole lab
              </Button>
            </div>
          )}
          <a
            href={activeLabId ? `/labs/${activeLabId}/veritamap-app/resources` : "/veritamap-app/resources"}
            className="text-xs text-muted-foreground hover:text-primary underline transition-colors"
          >
            Reference literature
          </a>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0" disabled={readOnly} title={readOnly ? "Resubscribe to add new records" : undefined}>
              <Plus className="h-4 w-4 mr-1.5" />
              New Map
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Create New Map</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground mb-3">
              Give your map a name (e.g., "Main Lab 2026" or "Chemistry Panel").
            </p>
            <Input
              placeholder="Map name…"
              value={newMapName}
              onChange={(e) => setNewMapName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newMapName.trim()) {
                  createMap.mutate(newMapName.trim());
                }
              }}
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDialogOpen(false);
                  setNewMapName("");
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!newMapName.trim() || createMap.isPending}
                onClick={() => {
                  if (newMapName.trim()) createMap.mutate(newMapName.trim());
                }}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {createMap.isPending ? "Creating…" : "Create & Build"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Free tier banner */}
      {!hasPlanAccess && (
        <div className="mb-6 p-3.5 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 flex items-center justify-between gap-3">
          <div className="text-sm text-amber-800 dark:text-amber-200">
            <span className="font-semibold">Free plan:</span> up to 4 instruments and 10 analytes per map.{" "}
            <Link href="/veritamap" className="underline hover:no-underline font-medium">Upgrade for unlimited</Link>
          </div>
        </div>
      )}

      {/* Correlations due soon */}
      <CorrelationsDueSoonWidget className="mb-6" />

      {/* Maps list */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : !maps?.length ? (
        /* Empty state */
        <div className="text-center py-20 border-2 border-dashed border-border rounded-xl">
          <FileSpreadsheet
            size={36}
            className="text-muted-foreground mx-auto mb-3"
          />
          <h3 className="font-semibold mb-1">No maps yet</h3>
          <p className="text-sm text-muted-foreground mb-5 max-w-xs mx-auto">
            Create your first VeritaMap™ to start tracking regulatory compliance
            for your test menu.
          </p>
          <Button
            onClick={() => setDialogOpen(true)}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
            disabled={readOnly}
            title={readOnly ? "Resubscribe to add new records" : undefined}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Create Your First Map
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {maps.map((map) => (
            <Card
              key={map.id}
              className="hover:border-primary/40 transition-colors"
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm truncate">
                        {map.name}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <CalendarClock size={11} />
                        Updated {formatDate(map.updated_at)}
                      </span>
                      <span className="flex items-center gap-1">
                        <CheckCircle2 size={11} className="text-emerald-500" />
                        {map.totalTests ?? 0} tests
                      </span>
                      {(map.gaps ?? 0) > 0 ? (
                        <span className="flex items-center gap-1 text-amber-600 font-medium">
                          <AlertTriangle size={11} />
                          {map.gaps} gap{map.gaps !== 1 ? "s" : ""}
                        </span>
                      ) : map.totalTests > 0 ? (
                        <span className="flex items-center gap-1 text-emerald-600 font-medium">
                          <CheckCircle2 size={11} />
                          No gaps
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs gap-1 hover:bg-primary/10 hover:text-primary hover:border-primary/30"
                      onClick={() => navigate(activeLabId
                        ? `/labs/${activeLabId}/veritamap-app/${map.id}`
                        : `/veritamap-app/${map.id}`)}
                    >
                      Open Map
                      <ChevronRight size={12} />
                    </Button>
                    <DeleteConfirmDialog
                      mapId={map.id}
                      mapName={map.name}
                      onDelete={(id) => deleteMap.mutate(id)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
