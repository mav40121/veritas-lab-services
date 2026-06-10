// client/src/components/VerificationAnalytesPanel.tsx
//
// 2026-06-09 PR2 of multi-analyte verification (Michael feedback).
// Self-contained panel for the Verification detail page's "Analytes"
// tab. Lists every analyte on the package, lets the director add /
// edit / sign / delete. Each analyte carries its own TEa, MDLs, AMR,
// and lifecycle (draft / finalized).
//
// Endpoint contract (shipped in PR #697):
//   GET    /api/veritacheck/verifications/:id/analytes
//   POST   /api/veritacheck/verifications/:id/analytes
//   PATCH  /api/veritacheck/verifications/:id/analytes/:analyteId
//   POST   /api/veritacheck/verifications/:id/analytes/:analyteId/finalize
//   DELETE /api/veritacheck/verifications/:id/analytes/:analyteId
//
// Finalize is per-analyte: director can sign off on analyte A while B
// remains in draft. The bundle PDF still renders for the whole
// package, but a per-analyte signature block surfaces when there are
// multiple analytes.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { authHeaders } from "@/lib/auth";
import { API_BASE } from "@/lib/queryClient";
import { Plus, Edit2, Trash2, CheckCircle2, Lock } from "lucide-react";

export interface VerificationAnalyte {
  id: number;
  verification_id: number;
  analyte_name: string;
  tea_value: number | null;
  tea_units: string | null;
  tea_is_percentage: number;
  mdls_json: string | null;
  amr_low: number | null;
  amr_high: number | null;
  amr_units: string | null;
  lifecycle_state: "draft" | "finalized";
  finalized_at: string | null;
  finalized_by_user_id: number | null;
  finalized_signature: string | null;
  sort_order: number;
}

interface AnalyteFormState {
  analyte_name: string;
  tea_value: string;
  tea_units: string;
  tea_is_percentage: boolean;
  mdls_csv: string;
  amr_low: string;
  amr_high: string;
  amr_units: string;
}

function emptyFormState(): AnalyteFormState {
  return {
    analyte_name: "",
    tea_value: "",
    tea_units: "",
    tea_is_percentage: true,
    mdls_csv: "",
    amr_low: "",
    amr_high: "",
    amr_units: "",
  };
}

function fromAnalyte(a: VerificationAnalyte): AnalyteFormState {
  let mdls: number[] = [];
  if (a.mdls_json) {
    try { const parsed = JSON.parse(a.mdls_json); if (Array.isArray(parsed)) mdls = parsed.filter(v => typeof v === "number"); } catch {}
  }
  return {
    analyte_name: a.analyte_name,
    tea_value: a.tea_value != null ? String(a.tea_value) : "",
    tea_units: a.tea_units || "",
    tea_is_percentage: a.tea_is_percentage === 1,
    mdls_csv: mdls.join(", "),
    amr_low: a.amr_low != null ? String(a.amr_low) : "",
    amr_high: a.amr_high != null ? String(a.amr_high) : "",
    amr_units: a.amr_units || "",
  };
}

function formToBody(f: AnalyteFormState): any {
  const mdls = f.mdls_csv.split(",").map(s => s.trim()).filter(s => s !== "").map(Number).filter(n => Number.isFinite(n));
  return {
    analyte_name: f.analyte_name.trim(),
    tea_value: f.tea_value === "" ? null : Number(f.tea_value),
    tea_units: f.tea_units.trim() || null,
    tea_is_percentage: f.tea_is_percentage ? 1 : 0,
    mdls_json: mdls.length > 0 ? JSON.stringify(mdls) : null,
    amr_low: f.amr_low === "" ? null : Number(f.amr_low),
    amr_high: f.amr_high === "" ? null : Number(f.amr_high),
    amr_units: f.amr_units.trim() || null,
  };
}

export function VerificationAnalytesPanel({ verificationId }: { verificationId: number }) {
  const { toast } = useToast();
  const [analytes, setAnalytes] = useState<VerificationAnalyte[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<VerificationAnalyte | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<AnalyteFormState>(emptyFormState());
  const [signing, setSigning] = useState<VerificationAnalyte | null>(null);
  const [signature, setSignature] = useState("");

  async function reload() {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/veritacheck/verifications/${verificationId}/analytes`, {
        headers: authHeaders(),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const rows = await r.json();
      setAnalytes(Array.isArray(rows) ? rows : []);
    } catch (e: any) {
      toast({ title: "Could not load analytes", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [verificationId]);

  function startAdd() {
    setForm(emptyFormState());
    setAdding(true);
  }
  function startEdit(a: VerificationAnalyte) {
    if (a.lifecycle_state === "finalized") {
      toast({ title: "Locked", description: "Finalized analytes are read-only. Use the amendment workflow.", variant: "destructive" });
      return;
    }
    setForm(fromAnalyte(a));
    setEditing(a);
  }
  function startSign(a: VerificationAnalyte) {
    if (a.lifecycle_state === "finalized") return;
    setSignature("");
    setSigning(a);
  }

  async function saveAdd() {
    if (!form.analyte_name.trim()) {
      toast({ title: "Name required", description: "Enter an analyte name.", variant: "destructive" }); return;
    }
    setBusy(true);
    try {
      const body = formToBody(form);
      const r = await fetch(`${API_BASE}/api/veritacheck/verifications/${verificationId}/analytes`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${r.status}`);
      }
      toast({ title: "Analyte added" });
      setAdding(false);
      await reload();
    } catch (e: any) {
      toast({ title: "Could not add analyte", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(true);
    try {
      const body = formToBody(form);
      const r = await fetch(`${API_BASE}/api/veritacheck/verifications/${verificationId}/analytes/${editing.id}`, {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${r.status}`);
      }
      toast({ title: "Analyte updated" });
      setEditing(null);
      await reload();
    } catch (e: any) {
      toast({ title: "Could not update", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  }

  async function doSign() {
    if (!signing || !signature.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/veritacheck/verifications/${verificationId}/analytes/${signing.id}/finalize`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ signature: signature.trim() }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${r.status}`);
      }
      toast({ title: "Analyte signed" });
      setSigning(null);
      setSignature("");
      await reload();
    } catch (e: any) {
      toast({ title: "Could not sign", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  }

  async function doAmend(a: VerificationAnalyte) {
    if (a.lifecycle_state !== "finalized") return;
    if (!confirm(`Create a new draft amending "${a.analyte_name}"? The original stays finalized in the audit trail.`)) return;
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/veritacheck/verifications/${verificationId}/analytes/${a.id}/amend`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: "{}",
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${r.status}`);
      }
      toast({ title: "Analyte amended", description: "New draft created. Original stays in the audit trail." });
      await reload();
    } catch (e: any) {
      toast({ title: "Could not amend", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  }

  async function doDelete(a: VerificationAnalyte) {
    if (a.lifecycle_state === "finalized") return;
    if (!confirm(`Delete analyte "${a.analyte_name}"? Studies linked to this analyte will need to be reassigned first.`)) return;
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/veritacheck/verifications/${verificationId}/analytes/${a.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${r.status}`);
      }
      toast({ title: "Analyte deleted" });
      await reload();
    } catch (e: any) {
      toast({ title: "Could not delete", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading analytes...</div>;

  return (
    <div className="space-y-3" data-testid="verification-analytes-panel">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Each analyte on this instrument is verified independently with its own TEa, MDLs, AMR, and signature. One carryover study (scope=instrument) covers every analyte on the package; per-analyte studies are linked from the Performance Elements tab.
        </p>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={startAdd} data-testid="add-analyte-button">
          <Plus size={12} /> Add Analyte
        </Button>
      </div>

      {analytes.length === 0 && (
        <div className="text-center py-10 border-2 border-dashed border-border rounded-xl">
          <p className="text-sm text-muted-foreground">No analytes yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Add the first analyte to this verification package to get started.</p>
        </div>
      )}

      {analytes.map((a) => (
        <div key={a.id} className="rounded-lg border border-border bg-card p-4" data-testid={`analyte-row-${a.id}`}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="font-semibold text-sm">{a.analyte_name}</h4>
                {a.lifecycle_state === "finalized" ? (
                  <Badge variant="outline" className="text-xs gap-1 bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300">
                    <Lock size={10} /> Finalized
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">Draft</Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground space-x-3">
                {a.tea_value != null && (
                  <span>
                    TEa: <strong>{a.tea_value}{a.tea_is_percentage === 1 ? "%" : (a.tea_units ? " " + a.tea_units : "")}</strong>
                  </span>
                )}
                {a.amr_low != null && a.amr_high != null && (
                  <span>
                    AMR: <strong>{a.amr_low} to {a.amr_high}{a.amr_units ? " " + a.amr_units : ""}</strong>
                  </span>
                )}
                {(() => {
                  try {
                    if (!a.mdls_json) return null;
                    const mdls = JSON.parse(a.mdls_json);
                    if (!Array.isArray(mdls) || mdls.length === 0) return null;
                    return <span>MDLs: <strong>{mdls.join(", ")}</strong></span>;
                  } catch { return null; }
                })()}
              </div>
              {a.finalized_at && (
                <div className="text-xs text-muted-foreground">
                  Signed: <strong>{a.finalized_signature}</strong> on {new Date(a.finalized_at).toLocaleDateString()}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
              {a.lifecycle_state !== "finalized" ? (
                <>
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => startEdit(a)} disabled={busy} data-testid={`edit-analyte-${a.id}`}>
                    <Edit2 size={12} /> Edit
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-emerald-600" onClick={() => startSign(a)} disabled={busy} data-testid={`sign-analyte-${a.id}`}>
                    <CheckCircle2 size={12} /> Sign
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-rose-600" onClick={() => doDelete(a)} disabled={busy} data-testid={`delete-analyte-${a.id}`}>
                    <Trash2 size={12} /> Delete
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => doAmend(a)} disabled={busy} data-testid={`amend-analyte-${a.id}`}>
                  <Edit2 size={12} /> Amend
                </Button>
              )}
            </div>
          </div>
        </div>
      ))}

      {/* Add/Edit dialog (shared form) */}
      <Dialog open={adding || editing !== null} onOpenChange={(v) => { if (!v) { setAdding(false); setEditing(null); } }}>
        <DialogContent className="max-w-lg" data-testid="analyte-dialog">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit analyte" : "Add analyte"}</DialogTitle>
            <DialogDescription>
              All fields except the name are optional. Director or designee remains the source of truth for any analyte-level claim on the package.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="ana-name" className="text-xs">Analyte name</Label>
              <Input id="ana-name" value={form.analyte_name} onChange={(e) => setForm({ ...form, analyte_name: e.target.value })} placeholder="e.g. Glucose, ALT, Hemoglobin" data-testid="analyte-name-input" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="ana-tea" className="text-xs">TEa value</Label>
                <Input id="ana-tea" type="number" step="any" value={form.tea_value} onChange={(e) => setForm({ ...form, tea_value: e.target.value })} placeholder="e.g. 10" />
              </div>
              <div>
                <Label htmlFor="ana-tea-units" className="text-xs">TEa units</Label>
                <Input id="ana-tea-units" value={form.tea_units} onChange={(e) => setForm({ ...form, tea_units: e.target.value })} placeholder={form.tea_is_percentage ? "%" : "mg/dL"} disabled={form.tea_is_percentage} />
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <input type="checkbox" id="ana-tea-pct" checked={form.tea_is_percentage} onChange={(e) => setForm({ ...form, tea_is_percentage: e.target.checked })} />
              <Label htmlFor="ana-tea-pct">TEa is percentage</Label>
            </div>
            <div>
              <Label htmlFor="ana-mdls" className="text-xs">Medical Decision Levels (comma-separated)</Label>
              <Input id="ana-mdls" value={form.mdls_csv} onChange={(e) => setForm({ ...form, mdls_csv: e.target.value })} placeholder="e.g. 70, 200, 400" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="ana-amr-lo" className="text-xs">AMR low</Label>
                <Input id="ana-amr-lo" type="number" step="any" value={form.amr_low} onChange={(e) => setForm({ ...form, amr_low: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="ana-amr-hi" className="text-xs">AMR high</Label>
                <Input id="ana-amr-hi" type="number" step="any" value={form.amr_high} onChange={(e) => setForm({ ...form, amr_high: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="ana-amr-units" className="text-xs">AMR units</Label>
                <Input id="ana-amr-units" value={form.amr_units} onChange={(e) => setForm({ ...form, amr_units: e.target.value })} placeholder="mg/dL" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setAdding(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={editing ? saveEdit : saveAdd} disabled={busy || !form.analyte_name.trim()} data-testid="analyte-save-button">
              {editing ? "Save changes" : "Add analyte"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sign dialog */}
      <Dialog open={signing !== null} onOpenChange={(v) => { if (!v) setSigning(null); }}>
        <DialogContent className="max-w-md" data-testid="analyte-sign-dialog">
          <DialogHeader>
            <DialogTitle>Sign and finalize analyte</DialogTitle>
            <DialogDescription>
              Signing locks this analyte from edits. Subsequent changes require the amendment workflow. Type your initials or full name as the signature.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="ana-sig" className="text-xs">Signature (initials or full name)</Label>
            <Input id="ana-sig" value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="e.g. MV or Michael Veri" data-testid="analyte-sign-input" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSigning(null)}>Cancel</Button>
            <Button onClick={doSign} disabled={busy || !signature.trim()} data-testid="analyte-sign-confirm">Sign and lock</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
