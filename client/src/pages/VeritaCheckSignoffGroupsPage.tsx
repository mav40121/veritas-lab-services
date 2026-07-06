import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useLabRoute } from "@/hooks/useLabRoute";
import { useSEO } from "@/hooks/useSEO";
import { CheckCircle2, Lock, FolderOpen, ChevronLeft } from "lucide-react";

type Group = { id: number; name: string; due_date: string | null; status: string; total: number; finalized: number; draft: number };
type Member = { id: number; test_name: string; instrument: string | null; study_type: string; date: string; analyst: string | null; lifecycle_state: string; status: string };
type GroupDetail = Group & { members: Member[] };

function verdictBadge(status: string) {
  const s = (status || "").toLowerCase();
  if (s === "pass") return <span className="pass-badge text-xs font-semibold">PASS</span>;
  if (s === "fail") return <span className="fail-badge text-xs font-semibold">FAIL</span>;
  return <span className="text-xs text-muted-foreground">{(status || "-").toUpperCase()}</span>;
}

export default function VeritaCheckSignoffGroupsPage() {
  useSEO({ title: "Sign-off Groups | VeritaCheck", description: "Assign studies to a sign-off group and sign the group in one action." });
  const { toast } = useToast();
  const labRoute = useLabRoute();
  const labId = useActiveLabId();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [signOpen, setSignOpen] = useState(false);
  const [signature, setSignature] = useState("");

  const groupsUrl = labId ? `/api/labs/${labId}/veritacheck/signoff-groups` : null;
  const detailUrl = groupsUrl && selectedId ? `${groupsUrl}/${selectedId}` : null;

  const { data: groups } = useQuery<Group[]>({ queryKey: [groupsUrl], enabled: !!groupsUrl });
  const { data: detail } = useQuery<GroupDetail>({ queryKey: [detailUrl], enabled: !!detailUrl });

  const signMut = useMutation({
    mutationFn: () => apiRequest("POST", `${groupsUrl}/${selectedId}/sign`, { signature: signature.trim() }),
    onSuccess: async (res) => {
      const r = await res.json();
      queryClient.invalidateQueries({ queryKey: [groupsUrl] });
      queryClient.invalidateQueries({ queryKey: [detailUrl] });
      setSignOpen(false); setSignature("");
      toast({ title: `Signed and locked ${r.signed} ${r.signed === 1 ? "study" : "studies"}`, description: r.skipped ? `${r.skipped} were already finalized.` : undefined });
    },
    onError: () => toast({ title: "Could not sign the group", variant: "destructive" }),
  });

  if (!labId) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center text-muted-foreground">
        Pick a lab in the NavBar switcher to use sign-off groups.
      </div>
    );
  }

  const draftCount = (detail?.members || []).filter((m) => m.lifecycle_state !== "finalized").length;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
        <Link href={labRoute("/dashboard")} className="hover:text-primary inline-flex items-center gap-1"><ChevronLeft size={14} />Dashboard</Link>
      </div>
      <h1 className="font-serif text-2xl font-bold mb-1">Sign-off Groups</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Add studies to a group as they are drafted and reviewed, then sign the whole group in one action. Each study still gets its own signed record.
      </p>

      <div className="grid gap-2 mb-8">
        {(groups || []).length === 0 && (
          <Card><CardContent className="p-6 text-sm text-muted-foreground">No sign-off groups yet. Use the Group action on a study to create one.</CardContent></Card>
        )}
        {(groups || []).map((g) => (
          <Card key={g.id} className={`cursor-pointer transition-colors ${selectedId === g.id ? "border-primary/50" : "hover:border-primary/30"}`} onClick={() => setSelectedId(g.id)} data-testid={`card-group-${g.id}`}>
            <CardContent className="p-4 flex items-center gap-3">
              <FolderOpen size={18} className="text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{g.name}</span>
                  {g.status === "signed"
                    ? <Badge variant="outline" className="text-xs border-emerald-500/40 text-emerald-600"><Lock size={10} className="mr-1" />Signed</Badge>
                    : <Badge variant="outline" className="text-xs">Open</Badge>}
                  {g.due_date && <span className="text-xs text-muted-foreground">due {g.due_date}</span>}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{g.finalized} of {g.total} signed{g.draft ? `, ${g.draft} pending` : ""}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {detail && (
        <Card data-testid="group-detail">
          <CardContent className="p-5">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <div>
                <div className="font-semibold">{detail.name}</div>
                <div className="text-xs text-muted-foreground">{detail.members.length} {detail.members.length === 1 ? "study" : "studies"}{detail.due_date ? ` · due ${detail.due_date}` : ""}</div>
              </div>
              {detail.status === "open"
                ? <Button disabled={draftCount === 0} onClick={() => setSignOpen(true)} data-testid="button-sign-group"><Lock size={14} className="mr-2" />Sign and Lock all{draftCount ? ` (${draftCount})` : ""}</Button>
                : <Badge variant="outline" className="text-emerald-600 border-emerald-500/40"><CheckCircle2 size={12} className="mr-1" />Signed</Badge>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border">
                    <th className="py-2 pr-3 font-medium">Study</th>
                    <th className="py-2 pr-3 font-medium">Instrument</th>
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Verdict</th>
                    <th className="py-2 pr-3 font-medium">State</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.members.map((m) => (
                    <tr key={m.id} className="border-b border-border/60" data-testid={`member-${m.id}`}>
                      <td className="py-2 pr-3">{m.test_name}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{m.instrument || "-"}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{m.date}</td>
                      <td className="py-2 pr-3">{verdictBadge(m.status)}</td>
                      <td className="py-2 pr-3">{m.lifecycle_state === "finalized" ? <span className="text-emerald-600 text-xs">Signed</span> : <span className="text-amber-500 text-xs">Draft</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={signOpen} onOpenChange={setSignOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Sign and Lock {draftCount} {draftCount === 1 ? "study" : "studies"}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Signing locks each study below with your signature. Review each verdict before signing. Edits after signing require an amendment.
          </p>
          <div className="max-h-56 overflow-y-auto border border-border rounded-md divide-y divide-border/60">
            {(detail?.members || []).filter((m) => m.lifecycle_state !== "finalized").map((m) => (
              <div key={m.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="truncate">{m.test_name}</span>
                <span className="shrink-0 ml-3">{verdictBadge(m.status)}</span>
              </div>
            ))}
          </div>
          <Input placeholder="Type your name to sign" value={signature} onChange={(e) => setSignature(e.target.value)} data-testid="input-group-signature" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSignOpen(false)}>Cancel</Button>
            <Button disabled={!signature.trim() || signMut.isPending || draftCount === 0} onClick={() => signMut.mutate()} data-testid="button-confirm-sign-group">
              <Lock size={14} className="mr-2" />Sign and Lock all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
