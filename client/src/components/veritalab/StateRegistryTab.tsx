// State Laboratory Licensure Registry tab (parking-lot #22 Phase 2).
//
// Renders the per-state catalog of laboratory licensure requirements
// beyond CLIA. Surfaced inside the existing VeritaLab page as a sub-tab
// alongside the Certificate roster and the CMS-116 form.
//
// Data is reference-only, served read-only from
// GET /api/veritalab/state-registry. Lab director opens the registry,
// filters or types their state code, and sees the agency + form + fee
// + renewal cadence. When licensure_required = 'unknown', the row carries
// a verify-with-agency note that should be the gate before the lab acts.
//
// Editorial: per CLAUDE.md section 9, rows with insufficient confidence
// are tagged licensure_required='unknown' rather than fabricated. The
// operator's editorial pass is the gate.

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { MapPin, ExternalLink, AlertTriangle } from "lucide-react";

interface RegistryRow {
  state_code: string;
  state_name: string;
  licensure_required: "yes" | "no" | "exempt" | "unknown";
  authority_name: string | null;
  authority_url: string | null;
  application_form_name: string | null;
  application_form_url: string | null;
  fee_description: string | null;
  renewal_cadence: string | null;
  notes: string | null;
  source_citation: string | null;
  last_verified: string | null;
}

type FilterMode = "all" | "yes" | "no" | "exempt" | "unknown";

const FILTER_LABEL: Record<FilterMode, string> = {
  all: "All jurisdictions",
  yes: "Requires state license",
  exempt: "CMS-exempt state",
  no: "CLIA only",
  unknown: "Needs verification",
};

function licensureBadge(value: RegistryRow["licensure_required"]) {
  const palettes: Record<RegistryRow["licensure_required"], string> = {
    yes: "bg-amber-500/10 text-amber-700 border-amber-500/20",
    exempt: "bg-blue-500/10 text-blue-700 border-blue-500/20",
    no: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
    unknown: "bg-muted text-muted-foreground border-border",
  };
  const labels: Record<RegistryRow["licensure_required"], string> = {
    yes: "State license required",
    exempt: "CMS-exempt state",
    no: "CLIA only",
    unknown: "Verify",
  };
  return (
    <Badge variant="outline" className={palettes[value]}>
      {labels[value]}
    </Badge>
  );
}

export function StateRegistryTab() {
  const [rows, setRows] = useState<RegistryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/veritalab/state-registry`, { headers: authHeaders() });
        if (!res.ok) throw new Error(`Load failed: ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setRows(Array.isArray(data?.rows) ? data.rows : []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Unable to load registry");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && r.licensure_required !== filter) return false;
      if (q && !(
        r.state_code.toLowerCase().includes(q) ||
        r.state_name.toLowerCase().includes(q) ||
        (r.authority_name || "").toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [rows, search, filter]);

  const summary = useMemo(() => {
    const tally: Record<RegistryRow["licensure_required"], number> = {
      yes: 0, exempt: 0, no: 0, unknown: 0,
    };
    for (const r of rows) tally[r.licensure_required] = (tally[r.licensure_required] || 0) + 1;
    return tally;
  }, [rows]);

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading state registry...</div>;
  }
  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-destructive font-medium mb-2">Unable to load state registry</p>
          <p className="text-sm text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    );
  }
  if (rows.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-12 text-center">
          <MapPin size={40} className="text-muted-foreground mx-auto mb-4" />
          <h3 className="font-semibold text-lg mb-2">State registry is empty</h3>
          <p className="text-muted-foreground text-sm max-w-lg mx-auto">
            The per-state licensure catalog has not been seeded on this environment yet. An administrator can run the seed via
            <code className="mx-1 px-1.5 py-0.5 rounded bg-muted text-xs">POST /api/admin/seed-state-registry</code>
            to populate this table.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header card */}
      <Card>
        <CardContent className="p-4 flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <MapPin size={20} className="text-primary mt-0.5 shrink-0" />
            <div className="min-w-0">
              <h3 className="font-semibold">State Laboratory Licensure Registry</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-xl">
                Per-state catalog of clinical laboratory licensure requirements beyond the federal CLIA certificate.
                Rows tagged "Verify" reflect agency confirmations the operator should resolve before treating them as canonical.
              </p>
              <div className="flex items-center gap-2 mt-2 text-xs flex-wrap">
                <span className="text-muted-foreground">{rows.length} jurisdictions:</span>
                <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/20">
                  {summary.yes} state license
                </Badge>
                <Badge variant="outline" className="bg-blue-500/10 text-blue-700 border-blue-500/20">
                  {summary.exempt} CMS-exempt
                </Badge>
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/20">
                  {summary.no} CLIA only
                </Badge>
                {summary.unknown > 0 && (
                  <Badge variant="outline" className="bg-muted text-muted-foreground border-border">
                    {summary.unknown} verify
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filter row */}
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          placeholder="Filter by state code, name, or agency..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:flex-1"
        />
        <Select value={filter} onValueChange={(v) => setFilter(v as FilterMode)}>
          <SelectTrigger className="sm:w-72"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(FILTER_LABEL) as FilterMode[]).map((k) => (
              <SelectItem key={k} value={k}>{FILTER_LABEL[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No jurisdictions match the filter.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <Card key={r.state_code}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                  <div className="min-w-0">
                    <h4 className="font-semibold flex items-center gap-2">
                      <span>{r.state_name}</span>
                      <span className="text-xs text-muted-foreground font-mono">{r.state_code}</span>
                    </h4>
                  </div>
                  {licensureBadge(r.licensure_required)}
                </div>

                {r.authority_name && (
                  <div className="text-sm mb-2">
                    <span className="text-xs text-muted-foreground">Authority:</span>{" "}
                    {r.authority_url ? (
                      <a href={r.authority_url} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline inline-flex items-center gap-1">
                        {r.authority_name} <ExternalLink size={12} />
                      </a>
                    ) : (
                      <span>{r.authority_name}</span>
                    )}
                  </div>
                )}

                {r.application_form_name && (
                  <div className="text-sm mb-2">
                    <span className="text-xs text-muted-foreground">Application:</span>{" "}
                    {r.application_form_url ? (
                      <a href={r.application_form_url} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline inline-flex items-center gap-1">
                        {r.application_form_name} <ExternalLink size={12} />
                      </a>
                    ) : (
                      <span>{r.application_form_name}</span>
                    )}
                  </div>
                )}

                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm text-muted-foreground">
                  {r.fee_description && (
                    <div><span className="font-medium text-foreground">Fee:</span> {r.fee_description}</div>
                  )}
                  {r.renewal_cadence && (
                    <div><span className="font-medium text-foreground">Renewal:</span> {r.renewal_cadence}</div>
                  )}
                </div>

                {r.notes && (
                  <div className={`text-xs mt-3 p-2 rounded border ${
                    r.licensure_required === "unknown"
                      ? "bg-amber-50 border-amber-300 text-amber-900"
                      : "bg-muted/40 border-border text-muted-foreground"
                  } flex items-start gap-2`}>
                    {r.licensure_required === "unknown" && <AlertTriangle size={13} className="shrink-0 mt-0.5" />}
                    <span>{r.notes}</span>
                  </div>
                )}

                {(r.source_citation || r.last_verified) && (
                  <div className="text-xs text-muted-foreground mt-2 flex flex-wrap gap-x-4">
                    {r.source_citation && <span>Source: {r.source_citation}</span>}
                    {r.last_verified && <span>Verified: {r.last_verified}</span>}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
