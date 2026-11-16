// Manage roll-up groups (Michael 2026-11-16, Phase 1; server/rollupGroups.ts). A group is a named set of labs the Inspection
// Readiness command center can be broken out by: a region, or a consultant's labs. "My network" groups belong to the
// signed-in person and hold labs they belong to; a system's groups belong to an organization they run and hold that
// organization's labs. A group only arranges the roll-up: it never opens a lab to anyone.
import { useMemo, useState } from "react";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ROLLUP_GROUP_KIND_LABEL } from "@/lib/readinessRollup";

export interface RollupGroupView {
  id: number;
  name: string;
  kind: string;
  scope: "organization" | "personal";
  organization_id: number | null;
  organization_name: string | null;
  lab_ids: number[];
}
export interface RollupGroupsData {
  groups: RollupGroupView[];
  can_build: { personal: { lab_ids: number[] }; organizations: { id: number; name: string; lab_ids: number[] }[] };
}

const KINDS = ["consultant", "region", "other"];
const selectCls = "h-9 rounded-md border border-input bg-background px-2 text-sm";

async function send(method: string, path: string, body?: unknown) {
  const r = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `Request failed (${r.status})`);
  return j;
}

type Draft = { id: number | null; name: string; kind: string; scope: string; labIds: Set<number> };

export function RollupGroupsDialog({ open, onOpenChange, data, labNames, onChanged }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  data: RollupGroupsData;
  labNames: Map<number, string>;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const scopes = useMemo(() => [
    { value: "personal", label: "My network", labIds: data.can_build.personal.lab_ids },
    ...data.can_build.organizations.map((o) => ({ value: `org:${o.id}`, label: o.name, labIds: o.lab_ids })),
  ].filter((s) => s.labIds.length > 0), [data]);

  const eligible = (scope: string) => scopes.find((s) => s.value === scope)?.labIds ?? [];
  const nameOf = (id: number) => labNames.get(id) || `Lab ${id}`;
  const scopeOf = (g: RollupGroupView) => (g.scope === "organization" ? `org:${g.organization_id}` : "personal");

  const startNew = () => { setError(""); setDraft({ id: null, name: "", kind: "consultant", scope: scopes[0]?.value ?? "personal", labIds: new Set() }); };
  const startEdit = (g: RollupGroupView) => { setError(""); setDraft({ id: g.id, name: g.name, kind: g.kind, scope: scopeOf(g), labIds: new Set(g.lab_ids) }); };

  const save = async () => {
    if (!draft) return;
    setBusy(true); setError("");
    try {
      const labIds = [...draft.labIds].sort((a, b) => a - b);
      if (draft.id == null) {
        const organizationId = draft.scope.startsWith("org:") ? Number(draft.scope.slice(4)) : undefined;
        await send("POST", "/api/rollup-groups", { name: draft.name, kind: draft.kind, organizationId, labIds });
      } else {
        await send("PATCH", `/api/rollup-groups/${draft.id}`, { name: draft.name, kind: draft.kind });
        await send("PUT", `/api/rollup-groups/${draft.id}/labs`, { labIds });
      }
      setDraft(null);
      onChanged();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    setBusy(true); setError("");
    try {
      await send("DELETE", `/api/rollup-groups/${id}`);
      setConfirmDelete(null);
      onChanged();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setDraft(null); setConfirmDelete(null); setError(""); } onOpenChange(v); }}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto" data-testid="rollup-group-dialog">
        <DialogHeader>
          <DialogTitle>Lab groups</DialogTitle>
          <DialogDescription>
            Group labs by region or by consultant to see subtotals for each group. A group only arranges this view. It doesn't give anyone access to a lab.
          </DialogDescription>
        </DialogHeader>

        {!draft && (
          <div className="space-y-2">
            {data.groups.length === 0 && <p className="text-sm text-muted-foreground">No groups yet.</p>}
            {data.groups.map((g) => (
              <div key={g.id} className="rounded-md border p-2.5" data-testid={`rollup-group-row-${g.id}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{g.name}</span>
                  <span className="text-xs rounded bg-muted px-1.5 py-0.5">{ROLLUP_GROUP_KIND_LABEL[g.kind] || "Group"}</span>
                  <span className="text-xs text-muted-foreground">{g.scope === "organization" ? g.organization_name || "System" : "My network"} · {g.lab_ids.length} {g.lab_ids.length === 1 ? "lab" : "labs"}</span>
                  <span className="ml-auto flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => startEdit(g)} data-testid={`rollup-group-edit-${g.id}`}>Edit</Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(g.id)} data-testid={`rollup-group-delete-${g.id}`}>Delete</Button>
                  </span>
                </div>
                {confirmDelete === g.id && (
                  <div className="mt-2 flex items-center gap-2 flex-wrap text-sm">
                    <span>Delete "{g.name}"? Its labs and their records stay as they are.</span>
                    <Button size="sm" variant="destructive" disabled={busy} onClick={() => remove(g.id)} data-testid={`rollup-group-delete-confirm-${g.id}`}>Delete group</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                  </div>
                )}
              </div>
            ))}
            {scopes.length > 0 ? (
              <Button size="sm" onClick={startNew} data-testid="rollup-group-new">New group</Button>
            ) : (
              <p className="text-xs text-muted-foreground">You need to be a member of two or more labs to group them.</p>
            )}
          </div>
        )}

        {draft && (
          <div className="space-y-3" data-testid="rollup-group-form">
            <div className="grid gap-1">
              <label className="text-sm font-medium" htmlFor="rollup-group-name">Group name</label>
              <Input id="rollup-group-name" value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="For example, Northern Maine or Consultant: J. Smith" data-testid="rollup-group-name" />
            </div>
            <div className="flex gap-3 flex-wrap">
              <div className="grid gap-1">
                <label className="text-sm font-medium" htmlFor="rollup-group-kind">Type</label>
                <select id="rollup-group-kind" className={selectCls} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} data-testid="rollup-group-kind">
                  {KINDS.map((k) => <option key={k} value={k}>{ROLLUP_GROUP_KIND_LABEL[k]}</option>)}
                </select>
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium" htmlFor="rollup-group-scope">Belongs to</label>
                <select id="rollup-group-scope" className={selectCls} value={draft.scope} disabled={draft.id != null}
                  onChange={(e) => setDraft({ ...draft, scope: e.target.value, labIds: new Set() })} data-testid="rollup-group-scope">
                  {draft.id != null && !scopes.some((s) => s.value === draft.scope) && <option value={draft.scope}>{draft.scope === "personal" ? "My network" : "System"}</option>}
                  {scopes.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>
            <div className="grid gap-1">
              <span className="text-sm font-medium">Labs in this group</span>
              <div className="rounded-md border max-h-64 overflow-y-auto divide-y">
                {eligible(draft.scope).map((id) => (
                  <label key={id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm cursor-pointer hover:bg-muted/50">
                    <input type="checkbox" checked={draft.labIds.has(id)} data-testid={`rollup-group-lab-${id}`}
                      onChange={(e) => { const next = new Set(draft.labIds); if (e.target.checked) next.add(id); else next.delete(id); setDraft({ ...draft, labIds: next }); }} />
                    <span>{nameOf(id)}</span>
                  </label>
                ))}
              </div>
              <span className="text-xs text-muted-foreground">{draft.scope === "personal" ? "My network groups can hold only labs you belong to." : "A system's groups can hold only that system's labs."}</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy || !draft.name.trim()} onClick={save} data-testid="rollup-group-save">{draft.id == null ? "Create group" : "Save"}</Button>
              <Button size="sm" variant="ghost" onClick={() => { setDraft(null); setError(""); }}>Cancel</Button>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive" data-testid="rollup-group-error">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
