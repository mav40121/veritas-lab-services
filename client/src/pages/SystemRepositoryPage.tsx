import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useAuth } from "@/components/AuthContext";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { FolderOpen, Plus, ExternalLink, Trash2, Lock, Building2, FileText } from "lucide-react";

// Plan gate: explicit allowlist (NOT a blocklist), per the canonical module pattern.
const SUITE_PLANS = ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "clinic", "waived", "community", "hospital", "large_hospital", "enterprise"];

interface SystemDoc {
  id: number; title: string; description: string | null; category: string | null;
  url: string; added_by_user_id: number | null; added_by_name: string | null;
  created_at: string; updated_at: string;
}

export default function SystemRepositoryPage() {
  const { user, isLoggedIn } = useAuth();
  const activeLabId = useActiveLabId();
  const hasPlanAccess = !!user && SUITE_PLANS.includes(user.plan);

  const [orgId, setOrgId] = useState<number | null>(null);
  const [docs, setDocs] = useState<SystemDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: "", url: "", category: "", description: "" });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function load() {
    if (!activeLabId) return;
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/labs/${activeLabId}/repository/documents`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setOrgId(data.organizationId ?? null);
      setDocs(Array.isArray(data.documents) ? data.documents : []);
      setError(null);
    } catch (e) {
      console.error("Failed to load system repository:", e);
      setError("Could not load the shared repository.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isLoggedIn && hasPlanAccess && activeLabId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, hasPlanAccess, activeLabId]);

  async function addDoc() {
    setSubmitting(true);
    setFormError(null);
    try {
      const r = await fetch(`${API_BASE}/api/labs/${activeLabId}/repository/documents`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setFormError(j.error || "Could not add the document."); return; }
      setForm({ title: "", url: "", category: "", description: "" });
      setShowAdd(false);
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  async function removeDoc(id: number) {
    const r = await fetch(`${API_BASE}/api/labs/${activeLabId}/repository/documents/${id}`, { method: "DELETE", headers: authHeaders() });
    if (r.ok) await load();
  }

  if (!isLoggedIn) {
    return <div className="container max-w-2xl mx-auto py-12 px-4"><Card><CardContent className="py-10 text-center"><Lock className="mx-auto h-10 w-10 text-muted-foreground mb-3" /><h2 className="text-lg font-semibold mb-1">Sign in to view the shared repository</h2><Button asChild className="mt-3"><Link href="/login">Sign in</Link></Button></CardContent></Card></div>;
  }
  if (!hasPlanAccess) {
    return <div className="container max-w-2xl mx-auto py-12 px-4"><Card><CardContent className="py-10 text-center"><Lock className="mx-auto h-10 w-10 text-muted-foreground mb-3" /><h2 className="text-lg font-semibold mb-1">The shared repository requires a subscription</h2><Button asChild className="mt-3"><Link href="/pricing">See plans</Link></Button></CardContent></Card></div>;
  }
  if (!activeLabId) {
    return <div className="container max-w-2xl mx-auto py-12 px-4"><Card><CardContent className="py-10 text-center"><p className="text-sm text-muted-foreground">Select a lab to view the shared repository.</p></CardContent></Card></div>;
  }

  // Group documents by category for display.
  const groups: Record<string, SystemDoc[]> = {};
  for (const d of docs) { const k = d.category || "General"; (groups[k] ||= []).push(d); }
  const groupNames = Object.keys(groups).sort((a, b) => a.localeCompare(b));

  return (
    <div className="container max-w-4xl mx-auto py-8 px-4">
      <div className="mb-2 flex items-center gap-2">
        <FolderOpen className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">System Repository</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-6">Shared documents for your system. Everyone in the system sees the same set. Links point to documents your system hosts; no files are stored here.</p>

      {loading ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Loading...</CardContent></Card>
      ) : error ? (
        <Card><CardContent className="py-8 text-center"><p className="text-destructive font-medium mb-2">{error}</p><Button size="sm" variant="outline" onClick={load}>Retry</Button></CardContent></Card>
      ) : orgId == null ? (
        <Card><CardContent className="py-10 text-center">
          <Building2 className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
          <h2 className="text-base font-semibold mb-1">Available for system accounts</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">The shared repository is for labs that belong to a system (organization). This lab is not part of one yet.</p>
        </CardContent></Card>
      ) : (
        <>
          <div className="mb-4 flex justify-end">
            <Button size="sm" onClick={() => setShowAdd(v => !v)}><Plus size={14} className="mr-1" /> Add document</Button>
          </div>

          {showAdd && (
            <Card className="mb-6 border-primary/20">
              <CardHeader className="pb-2"><CardTitle className="text-base">Add a shared document</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div><Label className="text-xs">Title</Label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. System Chemistry SOP binder" /></div>
                <div><Label className="text-xs">Link (URL)</Label><Input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://..." /></div>
                <div><Label className="text-xs">Category (optional)</Label><Input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="e.g. SOPs, Forms, Policies" /></div>
                <div><Label className="text-xs">Description (optional)</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} /></div>
                {formError && <p className="text-xs text-destructive">{formError}</p>}
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="outline" onClick={() => { setShowAdd(false); setFormError(null); }}>Cancel</Button>
                  <Button size="sm" onClick={addDoc} disabled={submitting || !form.title.trim() || !form.url.trim()}>{submitting ? "Adding..." : "Add"}</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {docs.length === 0 ? (
            <Card><CardContent className="py-10 text-center"><FileText className="mx-auto h-9 w-9 text-muted-foreground mb-2" /><p className="text-sm text-muted-foreground">No shared documents yet. Add the first one with the button above.</p></CardContent></Card>
          ) : (
            <div className="space-y-6">
              {groupNames.map(g => (
                <div key={g}>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{g}</div>
                  <div className="space-y-2">
                    {groups[g].map(d => (
                      <Card key={d.id}>
                        <CardContent className="py-3 flex items-start gap-3">
                          <FileText size={16} className="text-primary shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary hover:underline inline-flex items-center gap-1">
                              {d.title} <ExternalLink size={12} className="shrink-0" />
                            </a>
                            {d.description && <div className="text-xs text-muted-foreground mt-0.5">{d.description}</div>}
                            <div className="text-[11px] text-muted-foreground mt-1">
                              {d.added_by_name ? `Added by ${d.added_by_name}` : "Added"}{d.created_at ? ` on ${d.created_at.slice(0, 10)}` : ""}
                            </div>
                          </div>
                          <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive shrink-0" onClick={() => removeDoc(d.id)} title="Remove">
                            <Trash2 size={14} />
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
