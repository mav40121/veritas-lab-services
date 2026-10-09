import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Plus, Download, Trash2, CheckCircle, Pencil, ShieldCheck } from "lucide-react";

type CatalogItem = { key: string; label: string; group: string; positions: string[]; gate?: string };
type Catalog = {
  positions: string[]; complexities: string[]; catalog: CatalogItem[]; isMedicalDirector: boolean;
  // 2026-10-08: the owner or an admin prepares letters; the medical director signs.
  canPrepare?: boolean; medicalDirectorEmail?: string | null; medicalDirectorIsMember?: boolean;
};
type Letter = {
  id: number; delegate_name: string; position: string; complexity_scope: string;
  status: string; signed_name?: string | null; signed_at?: string | null;
  responsibilities: Record<string, boolean>;
};

const POSITION_LABEL: Record<string, string> = {
  clinical_consultant: "Clinical Consultant",
  technical_consultant: "Technical Consultant (moderate)",
  technical_supervisor: "Technical Supervisor (high)",
  general_supervisor: "General Supervisor (high)",
};
const COMPLEXITY_LABEL: Record<string, string> = {
  moderate: "Moderate complexity",
  high: "High complexity (covers moderate)",
};

function groupItems(items: CatalogItem[]): [string, CatalogItem[]][] {
  const order: string[] = [];
  const map: Record<string, CatalogItem[]> = {};
  for (const i of items) { if (!order.includes(i.group)) order.push(i.group); (map[i.group] ||= []).push(i); }
  return order.map((g) => [g, map[g]] as [string, CatalogItem[]]);
}

export function LettersOfDelegation({ activeLabId }: { activeLabId: number | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const base = activeLabId ? `${API_BASE}/api/labs/${activeLabId}/director-delegations` : null;

  const catalogQ = useQuery<Catalog>({
    queryKey: ["dd-catalog", activeLabId], enabled: !!base,
    queryFn: async () => { const r = await fetch(`${base}/catalog`, { headers: authHeaders() }); if (!r.ok) throw new Error(await r.text()); return r.json(); },
  });
  const listQ = useQuery<Letter[]>({
    queryKey: ["dd-list", activeLabId], enabled: !!base,
    queryFn: async () => { const r = await fetch(base!, { headers: authHeaders() }); if (!r.ok) throw new Error(await r.text()); return r.json(); },
  });

  const isMd = !!catalogQ.data?.isMedicalDirector;
  const canPrepare = !!catalogQ.data?.canPrepare || isMd;
  const mdEmail = catalogQ.data?.medicalDirectorEmail || null;
  const mdIsMember = !!catalogQ.data?.medicalDirectorIsMember;
  const signLink = activeLabId && typeof window !== "undefined" ? `${window.location.origin}/labs/${activeLabId}/veritastaff-app?tab=delegations` : "";
  const copySignLink = async () => {
    try { await navigator.clipboard.writeText(signLink); toast({ title: "Signing link copied", description: "Send it to the medical director. It opens this list, where they sign." }); }
    catch { toast({ title: "Copy failed", description: signLink }); }
  };
  const catalog = catalogQ.data?.catalog ?? [];
  const positions = catalogQ.data?.positions ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Letter | null>(null);
  const [signTarget, setSignTarget] = useState<Letter | null>(null);
  const [signName, setSignName] = useState("");

  const [fName, setFName] = useState("");
  const [fPos, setFPos] = useState("technical_supervisor");
  const [fComp, setFComp] = useState("high");
  const [fResp, setFResp] = useState<Record<string, boolean>>({});

  const itemsForPos = (pos: string) => catalog.filter((i) => i.positions.includes(pos));
  const invalidate = () => qc.invalidateQueries({ queryKey: ["dd-list", activeLabId] });

  const openCreate = () => { setEditing(null); setFName(""); setFPos("technical_supervisor"); setFComp("high"); setFResp({}); setDialogOpen(true); };
  const openEdit = (l: Letter) => { setEditing(l); setFName(l.delegate_name); setFPos(l.position); setFComp(l.complexity_scope); setFResp(l.responsibilities || {}); setDialogOpen(true); };

  const saveMut = useMutation({
    mutationFn: async () => {
      const body = { delegate_name: fName.trim(), position: fPos, complexity_scope: fComp, responsibilities: fResp };
      const r = await fetch(editing ? `${base}/${editing.id}` : base!, { method: editing ? "PUT" : "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => { setDialogOpen(false); invalidate(); toast({ title: editing ? "Draft updated" : "Draft created" }); },
    onError: (e: any) => toast({ title: "Save failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const signMut = useMutation({
    mutationFn: async () => { const r = await fetch(`${base}/${signTarget!.id}/sign`, { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ signed_name: signName.trim() }) }); if (!r.ok) throw new Error(await r.text()); return r.json(); },
    onSuccess: () => { setSignTarget(null); setSignName(""); invalidate(); toast({ title: "Letter signed and active" }); },
    onError: (e: any) => toast({ title: "Sign failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const discardMut = useMutation({
    mutationFn: async (id: number) => { const r = await fetch(`${base}/${id}`, { method: "DELETE", headers: authHeaders() }); if (!r.ok) throw new Error(await r.text()); return r.json(); },
    onSuccess: () => { invalidate(); toast({ title: "Draft discarded" }); },
    onError: (e: any) => toast({ title: "Discard failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const revokeMut = useMutation({
    mutationFn: async (id: number) => { const r = await fetch(`${base}/${id}/revoke`, { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" } }); if (!r.ok) throw new Error(await r.text()); return r.json(); },
    onSuccess: () => { invalidate(); toast({ title: "Letter revoked" }); },
    onError: (e: any) => toast({ title: "Revoke failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const downloadPdf = async (l: Letter) => {
    if (!base) return;
    const r = await fetch(`${base}/${l.id}/pdf`, { headers: authHeaders() });
    if (!r.ok) { toast({ title: "PDF failed", variant: "destructive" }); return; }
    const blob = await r.blob();
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u; a.download = `Letter-of-Delegation-${l.delegate_name.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}.pdf`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u);
  };

  const statusBadge = (s: string) =>
    s === "active" ? <Badge className="bg-green-600 hover:bg-green-600">Active</Badge>
      : s === "draft" ? <Badge variant="secondary">Draft</Badge>
        : <Badge variant="outline">Revoked</Badge>;

  if (!activeLabId) {
    return <Card><CardContent className="py-8 text-center text-muted-foreground">Select a lab to manage letters of delegation.</CardContent></Card>;
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2"><ShieldCheck size={20} className="text-primary" /> Letters of Delegation</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            The medical director delegates specific CLIA responsibilities, in writing, to a Technical Consultant,
            Technical Supervisor, or General Supervisor. Each signed letter is a surveyor-ready record and controls
            who may co-sign QC period reviews and close findings.
          </p>
        </div>
        {canPrepare && <Button onClick={openCreate} data-testid="new-delegation-btn"><Plus size={16} className="mr-1" /> New letter</Button>}
      </div>

      {canPrepare && !isMd && (
        <div className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm" data-testid="delegation-prepare-note">
          {mdEmail ? (
            <>
              You prepare the letters; the medical director (<span className="font-medium">{mdEmail}</span>) signs them.
              {mdIsMember
                ? <> When a draft is ready, send them the signing link. <button type="button" className="underline text-primary font-medium" onClick={copySignLink} data-testid="copy-sign-link">Copy signing link</button></>
                : <> They are not a member of this lab yet, so invite them on the Members page as the medical director before they can sign.</>}
            </>
          ) : (
            <>You prepare the letters; the medical director signs them. No medical director is set for this lab yet: designate one on the Members page so drafts can be signed.</>
          )}
        </div>
      )}
      {!canPrepare && (
        <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          Letters of delegation are prepared by the lab's owner or an admin and signed by the medical director. You can view and download existing letters below.
        </div>
      )}

      <Card><CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Delegate</TableHead><TableHead>Position</TableHead><TableHead>Complexity</TableHead>
            <TableHead className="text-center">Items</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {listQ.data && listQ.data.length > 0 ? listQ.data.map((l) => {
              const onCount = Object.values(l.responsibilities || {}).filter(Boolean).length;
              return (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.delegate_name}</TableCell>
                  <TableCell className="text-sm">{POSITION_LABEL[l.position] || l.position}</TableCell>
                  <TableCell className="text-sm">{COMPLEXITY_LABEL[l.complexity_scope] || l.complexity_scope}</TableCell>
                  <TableCell className="text-center">{onCount}</TableCell>
                  <TableCell>
                    {statusBadge(l.status)}
                    {l.signed_at && <div className="text-xs text-muted-foreground mt-0.5">by {l.signed_name}</div>}
                    {l.status === "draft" && (
                      <div className="text-xs mt-0.5 text-amber-700 dark:text-amber-400" data-testid={`delegation-awaiting-${l.id}`}>
                        {isMd ? "Ready for your signature" : "Waiting for the medical director to sign"}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button variant="ghost" size="sm" title="Download PDF" onClick={() => downloadPdf(l)}><Download size={15} /></Button>
                    {canPrepare && l.status === "draft" && <Button variant="ghost" size="sm" title="Edit draft" onClick={() => openEdit(l)} data-testid={`edit-delegation-${l.id}`}><Pencil size={15} /></Button>}
                    {canPrepare && l.status === "draft" && (
                      <ConfirmDialog title="Discard this draft?" message={`This deletes the unsigned draft for ${l.delegate_name}. Nothing has been signed, so no record is lost.`} confirmLabel="Discard" onConfirm={() => discardMut.mutate(l.id)}>
                        <Button variant="ghost" size="sm" title="Discard draft" data-testid={`discard-delegation-${l.id}`}><Trash2 size={15} className="text-muted-foreground" /></Button>
                      </ConfirmDialog>
                    )}
                    {isMd && l.status === "draft" && <Button variant="ghost" size="sm" title="Sign" onClick={() => { setSignName(""); setSignTarget(l); }} data-testid={`sign-delegation-${l.id}`}><CheckCircle size={15} className="text-green-600" /></Button>}
                    {isMd && l.status === "active" && (
                      <ConfirmDialog title="Revoke this letter?" message={`This revokes the delegation to ${l.delegate_name}. They can no longer act under it, and a new letter is required to restore it.`} confirmLabel="Revoke" onConfirm={() => revokeMut.mutate(l.id)}>
                        <Button variant="ghost" size="sm" title="Revoke"><Trash2 size={15} className="text-destructive" /></Button>
                      </ConfirmDialog>
                    )}
                  </TableCell>
                </TableRow>
              );
            }) : (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No letters of delegation yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent></Card>

      {/* Create / edit draft */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit draft letter" : "New letter of delegation"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Delegate name</Label><Input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="e.g. Jane Tech, MLS(ASCP)" data-testid="delegate-name" /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Position</Label>
                <Select value={fPos} onValueChange={(v) => { setFPos(v); setFResp({}); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{positions.map((p) => <SelectItem key={p} value={p}>{POSITION_LABEL[p] || p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Complexity scope</Label>
                <Select value={fComp} onValueChange={setFComp}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="moderate">Moderate complexity</SelectItem>
                    <SelectItem value="high">High complexity (covers moderate)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Delegated responsibilities</Label>
              <div className="mt-2 space-y-3 border rounded-md p-3">
                {groupItems(itemsForPos(fPos)).map(([group, items]) => (
                  <div key={group}>
                    <div className="text-xs font-semibold text-primary mb-1">{group}</div>
                    {items.map((it) => (
                      <label key={it.key} className="flex items-start gap-2 py-1 text-sm cursor-pointer">
                        <Checkbox className="mt-0.5" checked={!!fResp[it.key]} onCheckedChange={(c) => setFResp((s) => ({ ...s, [it.key]: !!c }))} />
                        <span>{it.label}{it.gate && <Badge variant="outline" className="ml-2 text-[10px] align-middle">controls access</Badge>}</span>
                      </label>
                    ))}
                  </div>
                ))}
                {itemsForPos(fPos).length === 0 && <div className="text-sm text-muted-foreground">No delegable responsibilities for this position.</div>}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => saveMut.mutate()} disabled={!fName.trim() || saveMut.isPending} data-testid="save-delegation">{editing ? "Save draft" : "Create draft"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sign */}
      <Dialog open={!!signTarget} onOpenChange={(o) => { if (!o) setSignTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Sign letter of delegation</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            You are signing as the laboratory's medical director, delegating the checked responsibilities to{" "}
            <span className="font-medium text-foreground">{signTarget?.delegate_name}</span>. This records your electronic signature and activates the letter.
          </p>
          <div className="mt-3"><Label>Type your full name to sign</Label><Input value={signName} onChange={(e) => setSignName(e.target.value)} placeholder="Dr. Jane Director, MD" data-testid="sign-name" /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSignTarget(null)}>Cancel</Button>
            <Button onClick={() => signMut.mutate()} disabled={!signName.trim() || signMut.isPending} data-testid="confirm-sign">Sign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
