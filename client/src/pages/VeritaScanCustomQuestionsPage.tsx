// VeritaScan™ Custom Questions (parking-lot #55, phase 2)
//
// Lab-authored scan items that sit ALONGSIDE the curated 173-item master set.
// This page is the author / edit / retire surface; it is lab-scoped (a custom
// question is shared across every scan in the lab). Scoring and export live in
// later phases and keep custom items in their OWN section that does not count
// toward the standardized readiness %.
//
// Backend: GET/POST/PATCH /api/labs/:labId/veritascan/custom-items
// (server/routes.ts, validated by server/veritascanCustomItems.ts).

import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthContext";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useLabRoute } from "@/hooks/useLabRoute";
import { DOMAINS } from "@/lib/veritaScanData";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Archive, RotateCcw, Lock, ListChecks, ArrowLeft } from "lucide-react";

const QUESTION_MAX = 500;
const CITATION_MAX = 300;
const NO_DOMAIN = "__none__"; // Select cannot take an empty-string value.

interface CustomItem {
  id: number;
  lab_id: number;
  domain: string | null;
  question: string;
  tjc: string | null;
  cap: string | null;
  cfr: string | null;
  aabb: string | null;
  cola: string | null;
  status: string;
  retired_at: string | null;
  created_at: string;
  updated_at: string;
}

interface FormState {
  question: string;
  domain: string; // NO_DOMAIN sentinel or a real domain
  tjc: string; cap: string; cfr: string; aabb: string; cola: string;
}

const EMPTY_FORM: FormState = { question: "", domain: NO_DOMAIN, tjc: "", cap: "", cfr: "", aabb: "", cola: "" };

function toBody(f: FormState) {
  return {
    question: f.question.trim(),
    domain: f.domain === NO_DOMAIN ? null : f.domain,
    tjc: f.tjc.trim() || null,
    cap: f.cap.trim() || null,
    cfr: f.cfr.trim() || null,
    aabb: f.aabb.trim() || null,
    cola: f.cola.trim() || null,
  };
}

export default function VeritaScanCustomQuestionsPage() {
  const labId = useActiveLabId();
  const labRoute = useLabRoute();
  const { user } = useAuth();
  const isReadOnly = useIsReadOnly("veritascan");
  const { toast } = useToast();
  const qc = useQueryClient();

  // Explicit allowlist per CLAUDE.md §8 (VeritaLabAppPage canonical pattern).
  // Mirrors the VeritaScan plan set used on the scan pages.
  const hasPlanAccess = !!user && [
    "annual", "professional", "lab", "complete",
    "veritamap", "veritascan", "veritacomp",
    "clinic", "waived", "community", "hospital", "large_hospital", "enterprise",
  ].includes(user.plan);

  const [includeRetired, setIncludeRetired] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<CustomItem | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const itemsQuery = useQuery<CustomItem[]>({
    queryKey: [`/api/labs/${labId}/veritascan/custom-items`, includeRetired],
    enabled: !!labId && hasPlanAccess,
    queryFn: async () => {
      const qs = includeRetired ? "?include_retired=1" : "";
      const res = await fetch(`${API_BASE}/api/labs/${labId}/veritascan/custom-items${qs}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load custom questions (${res.status})`);
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, any>) => {
      const res = await fetch(`${API_BASE}/api/labs/${labId}/veritascan/custom-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error || `Create failed (${res.status})`); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Custom question added" });
      qc.invalidateQueries({ queryKey: [`/api/labs/${labId}/veritascan/custom-items`] });
      setAddOpen(false);
      setForm(EMPTY_FORM);
    },
    onError: (err: Error) => toast({ title: "Could not add question", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: Record<string, any> }) => {
      const res = await fetch(`${API_BASE}/api/labs/${labId}/veritascan/custom-items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error || `Update failed (${res.status})`); }
      return res.json();
    },
    onSuccess: (_data, vars) => {
      toast({ title: vars.body?.status ? "Question updated" : "Question saved" });
      qc.invalidateQueries({ queryKey: [`/api/labs/${labId}/veritascan/custom-items`] });
      setEditItem(null);
    },
    onError: (err: Error) => toast({ title: "Could not update question", description: err.message, variant: "destructive" }),
  });

  function openAdd() { setForm(EMPTY_FORM); setAddOpen(true); }
  function openEdit(it: CustomItem) {
    setForm({
      question: it.question,
      domain: it.domain || NO_DOMAIN,
      tjc: it.tjc || "", cap: it.cap || "", cfr: it.cfr || "", aabb: it.aabb || "", cola: it.cola || "",
    });
    setEditItem(it);
  }

  const items = itemsQuery.data || [];
  const activeCount = items.filter(i => i.status === "active").length;

  // ── Plan gate ──────────────────────────────────────────────────────────
  if (user && !hasPlanAccess) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <Lock className="h-8 w-8 mx-auto text-muted-foreground" />
            <h1 className="text-xl font-semibold">Custom Questions</h1>
            <p className="text-sm text-muted-foreground">
              Available for VeritaScan™ subscribers. Add VeritaScan to author your own
              site-specific scan items.
            </p>
            <Button asChild variant="outline"><Link href="/veritascan">View plans</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
          <Link href={labRoute("/veritascan-app")}><ArrowLeft className="h-4 w-4 mr-1.5" />Back to VeritaScan</Link>
        </Button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <ListChecks className="h-5 w-5 text-primary" />
              <h1 className="text-2xl font-bold tracking-tight">Custom Questions</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Your own site-specific scan items, assessed alongside the standardized set.
              They are scored in a separate section and do not affect the standardized readiness score.
            </p>
          </div>
          <Button className="shrink-0" onClick={openAdd} disabled={isReadOnly} title={isReadOnly ? "Resubscribe to add" : undefined}>
            <Plus className="h-4 w-4 mr-1.5" />Add question
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-muted-foreground">
          {activeCount} active question{activeCount === 1 ? "" : "s"}
        </p>
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={includeRetired} onChange={(e) => setIncludeRetired(e.target.checked)} />
          Show retired
        </label>
      </div>

      {itemsQuery.isLoading && (
        <div className="space-y-2">{[1, 2, 3].map(n => <div key={n} className="h-20 rounded-lg bg-muted/60 animate-pulse" />)}</div>
      )}
      {itemsQuery.isError && (
        <Card><CardContent className="py-6 text-sm text-destructive">Could not load custom questions. {(itemsQuery.error as Error)?.message}</CardContent></Card>
      )}

      {!itemsQuery.isLoading && !itemsQuery.isError && items.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <ListChecks className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No custom questions yet. Add your first site-specific check.</p>
            <Button variant="outline" onClick={openAdd} disabled={isReadOnly}><Plus className="h-4 w-4 mr-1.5" />Add question</Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {items.map((it) => (
          <Card key={it.id} className={it.status === "retired" ? "opacity-60" : undefined}>
            <CardContent className="py-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  {it.domain && <Badge variant="outline" className="text-xs">{it.domain}</Badge>}
                  {it.status === "retired" && <Badge variant="outline" className="text-xs text-muted-foreground">Retired</Badge>}
                </div>
                <p className="text-sm font-medium break-words">{it.question}</p>
                {(it.tjc || it.cap || it.cfr || it.aabb || it.cola) && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {[
                      it.tjc && `TJC: ${it.tjc}`, it.cap && `CAP: ${it.cap}`, it.cfr && `CFR: ${it.cfr}`,
                      it.aabb && `AABB: ${it.aabb}`, it.cola && `COLA: ${it.cola}`,
                    ].filter(Boolean).join("  ·  ")}
                  </p>
                )}
              </div>
              <Button variant="ghost" size="sm" className="shrink-0" onClick={() => openEdit(it)} disabled={isReadOnly}>
                <Pencil className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Add dialog */}
      <Dialog open={addOpen} onOpenChange={(o) => { if (!o) setForm(EMPTY_FORM); setAddOpen(o); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add custom question</DialogTitle>
            <DialogDescription>A site-specific check your lab wants on every scan, scored in its own section.</DialogDescription>
          </DialogHeader>
          <CustomItemForm form={form} setForm={setForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddOpen(false); setForm(EMPTY_FORM); }}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate(toBody(form))}
              disabled={!form.question.trim() || form.question.length > QUESTION_MAX || createMutation.isPending}
            >
              {createMutation.isPending ? "Adding…" : "Add question"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editItem} onOpenChange={(o) => { if (!o) setEditItem(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit custom question</DialogTitle>
            <DialogDescription>
              {editItem?.status === "retired"
                ? "This question is retired. Reactivate it to use it on new scans."
                : "Edit the question or retire it. Retiring keeps it on scans that already used it."}
            </DialogDescription>
          </DialogHeader>
          <CustomItemForm form={form} setForm={setForm} />
          <DialogFooter className="flex sm:justify-between gap-2">
            <div>
              {editItem && editItem.status === "active" && (
                <Button
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() => updateMutation.mutate({ id: editItem.id, body: { status: "retired" } })}
                  disabled={isReadOnly || updateMutation.isPending}
                >
                  <Archive className="h-4 w-4 mr-1.5" />Retire
                </Button>
              )}
              {editItem && editItem.status === "retired" && (
                <Button
                  variant="outline"
                  onClick={() => updateMutation.mutate({ id: editItem.id, body: { status: "active" } })}
                  disabled={isReadOnly || updateMutation.isPending}
                >
                  <RotateCcw className="h-4 w-4 mr-1.5" />Reactivate
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditItem(null)}>Cancel</Button>
              <Button
                onClick={() => editItem && updateMutation.mutate({ id: editItem.id, body: toBody(form) })}
                disabled={isReadOnly || !form.question.trim() || form.question.length > QUESTION_MAX || updateMutation.isPending}
              >
                {updateMutation.isPending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CustomItemForm({ form, setForm }: { form: FormState; setForm: (f: FormState) => void }) {
  const set = (patch: Partial<FormState>) => setForm({ ...form, ...patch });
  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="cq-question">Question <span className="text-destructive">*</span></Label>
        <Textarea
          id="cq-question"
          value={form.question}
          onChange={(e) => set({ question: e.target.value })}
          placeholder="e.g. Is the backup freezer temperature logged twice per shift?"
          rows={2}
          maxLength={QUESTION_MAX}
        />
        <p className="text-xs text-muted-foreground mt-1">{form.question.length}/{QUESTION_MAX}</p>
      </div>
      <div>
        <Label htmlFor="cq-domain">Domain (optional)</Label>
        <Select value={form.domain} onValueChange={(v) => set({ domain: v })}>
          <SelectTrigger id="cq-domain"><SelectValue placeholder="No domain" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_DOMAIN}>No domain</SelectItem>
            {DOMAINS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label htmlFor="cq-tjc">TJC citation</Label><Input id="cq-tjc" value={form.tjc} maxLength={CITATION_MAX} onChange={(e) => set({ tjc: e.target.value })} placeholder="Optional" /></div>
        <div><Label htmlFor="cq-cap">CAP citation</Label><Input id="cq-cap" value={form.cap} maxLength={CITATION_MAX} onChange={(e) => set({ cap: e.target.value })} placeholder="Optional" /></div>
        <div><Label htmlFor="cq-cfr">CFR citation</Label><Input id="cq-cfr" value={form.cfr} maxLength={CITATION_MAX} onChange={(e) => set({ cfr: e.target.value })} placeholder="Optional" /></div>
        <div><Label htmlFor="cq-aabb">AABB citation</Label><Input id="cq-aabb" value={form.aabb} maxLength={CITATION_MAX} onChange={(e) => set({ aabb: e.target.value })} placeholder="Optional" /></div>
        <div><Label htmlFor="cq-cola">COLA citation</Label><Input id="cq-cola" value={form.cola} maxLength={CITATION_MAX} onChange={(e) => set({ cola: e.target.value })} placeholder="Optional" /></div>
      </div>
    </div>
  );
}
