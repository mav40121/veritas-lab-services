// VeritaDC approval routes (Michael 2026-11-04; parity plan Phase 1 item 3). A route is a workflow and its steps; a step goes to
// a role, one named person, or any one member of a lab group. Owners and admins change routes, every change is audited on the
// server, and a route with documents in review is locked. Everyone else sees the routes read-only.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { LabGroupsDialog, useLabGroups } from "@/components/LabGroupsDialog";

export interface RouteStep {
  id: number;
  step_order: number;
  step_name: string;
  required_role: string;
  specific_user_id: number | null;
  approver_group_id?: number | null;
  allow_self_approval: number;
  who?: string;
}
export interface Route {
  id: number;
  name: string;
  description: string | null;
  is_default: number;
  locked_reason?: string | null;
  steps: RouteStep[];
}

const WHO_OPTIONS: { value: string; label: string }[] = [
  { value: "group", label: "Any one member of a group" },
  { value: "specific_user", label: "A named person" },
  { value: "medical_director", label: "Medical director or designee" },
  { value: "technical_consultant", label: "Technical consultant" },
  { value: "technical_supervisor", label: "Technical supervisor" },
  { value: "general_supervisor", label: "General supervisor" },
  { value: "any_active_seat", label: "Anyone with an editing seat" },
];

// The server answers {"error": "..."} after the status; show the sentence.
function errorSentence(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  const json = raw.slice(raw.indexOf("{"));
  try { return JSON.parse(json)?.error || raw; } catch { return raw; }
}

function StepForm({ labId, initial, saving, onSave, onCancel }: {
  labId: number;
  initial?: RouteStep;
  saving: boolean;
  onSave: (body: { stepName: string; requiredRole: string; specificUserId?: number; approverGroupId?: number }) => void;
  onCancel: () => void;
}) {
  const apiBase = `/api/labs/${labId}/veritapolicy`;
  const { data: groups } = useLabGroups(apiBase);
  const { data: people } = useQuery<{ people: { user_id: number; name: string; email: string; staff_login: boolean }[] }>({
    queryKey: [`${apiBase}/route-people`],
    queryFn: getQueryFn({ on401: "throw" }),
  });
  const [name, setName] = useState(initial?.step_name ?? "");
  const [role, setRole] = useState(initial?.required_role ?? "group");
  const [personId, setPersonId] = useState(initial?.specific_user_id ? String(initial.specific_user_id) : "");
  const [groupId, setGroupId] = useState(initial?.approver_group_id ? String(initial.approver_group_id) : "");
  const activeGroups = (groups?.groups || []).filter(g => !g.retired);
  const options = WHO_OPTIONS.some(o => o.value === role) ? WHO_OPTIONS : [...WHO_OPTIONS, { value: role, label: role.replace(/_/g, " ") }];
  const ready = name.trim() && (role !== "group" || groupId) && (role !== "specific_user" || personId);
  return (
    <div className="space-y-2 rounded-lg bg-muted/40 p-2.5" data-testid="route-step-form">
      <Input value={name} onChange={e => setName(e.target.value)} placeholder="Step name, e.g. Supervisor review" className="h-8 text-sm" data-testid="route-step-name" />
      <Select value={role} onValueChange={setRole}>
        <SelectTrigger className="h-8 text-sm" data-testid="route-step-who"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {role === "group" && (
        <Select value={groupId} onValueChange={setGroupId}>
          <SelectTrigger className="h-8 text-sm" data-testid="route-step-group"><SelectValue placeholder={activeGroups.length ? "Pick a group" : "No groups yet: build one with Manage groups"} /></SelectTrigger>
          <SelectContent>
            {activeGroups.map(g => <SelectItem key={g.id} value={String(g.id)}>{`${g.name} (${g.signer_count} can sign)`}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {role === "specific_user" && (
        <Select value={personId} onValueChange={setPersonId}>
          <SelectTrigger className="h-8 text-sm" data-testid="route-step-person"><SelectValue placeholder="Pick a person" /></SelectTrigger>
          <SelectContent>
            {(people?.people || []).map(p => <SelectItem key={p.user_id} value={String(p.user_id)}>{p.staff_login ? `${p.name} (staff login)` : p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" className="h-7 text-xs" disabled={saving || !ready} data-testid="route-step-save"
          onClick={() => onSave({
            stepName: name.trim(), requiredRole: role,
            ...(role === "specific_user" ? { specificUserId: Number(personId) } : {}),
            ...(role === "group" ? { approverGroupId: Number(groupId) } : {}),
          })}>
          {saving && <Loader2 className="animate-spin mr-1" size={12} />}Save step
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

export function ApprovalRoutesDialog({ labId, routes, canEdit, open, onOpenChange }: {
  labId: number;
  routes: Route[];
  canEdit: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const apiBase = `/api/labs/${labId}/veritapolicy`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Which step form is open: "add-<routeId>" or "edit-<stepId>".
  const [form, setForm] = useState<string | null>(null);
  const [newRoute, setNewRoute] = useState("");

  const act = async (method: string, path: string, body?: unknown, after?: () => void) => {
    setBusy(true); setError("");
    try {
      await apiRequest(method, `${apiBase}${path}`, body);
      qc.invalidateQueries({ queryKey: [`${apiBase}/workflows`] });
      qc.invalidateQueries({ queryKey: [`${apiBase}/pending-reviews`] });
      after?.();
    } catch (e) {
      setError(errorSentence(e));
    } finally {
      setBusy(false);
    }
  };
  const move = (route: Route, index: number, by: number) => {
    const ids = route.steps.map(s => s.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + by, 0, id);
    act("POST", `/workflows/${route.id}/steps/reorder`, { stepIds: ids });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setForm(null); setError(""); } onOpenChange(o); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Approval routes</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 min-w-0">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <p className="text-sm text-muted-foreground flex-1 min-w-[220px]">
              A route is the steps a document goes through before it is approved. A step can go to a role, a named person, or any one member of a group, and whoever signs first completes it.
            </p>
            <LabGroupsDialog apiBase={apiBase} forApprovals />
          </div>
          {error && <p className="text-xs text-destructive" data-testid="route-error">{error}</p>}
          {routes.map((route) => {
            const locked = !!route.locked_reason;
            const editable = canEdit && !locked;
            return (
              <div key={route.id} className="rounded-md border p-3 min-w-0" data-testid="approval-steps-workflow">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium flex-1 min-w-[160px]">{route.name}{route.is_default ? <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">Default</span> : null}</span>
                  {canEdit && !route.is_default && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy || locked} data-testid="route-make-default"
                      onClick={() => act("PUT", `/workflows/${route.id}`, { isDefault: true })}>Make default</Button>
                  )}
                  {canEdit && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy || locked} data-testid="route-archive"
                      onClick={() => act("DELETE", `/workflows/${route.id}`)}>Archive</Button>
                  )}
                </div>
                {route.description && <div className="text-xs text-muted-foreground mb-1">{route.description}</div>}
                {locked && <p className="text-xs text-amber-700 dark:text-amber-400 my-1" data-testid="route-locked">{route.locked_reason}</p>}
                <ul className="space-y-2 mt-2">
                  {route.steps.map((s, i) => (
                    <li key={s.id} className="text-sm" data-testid="route-step-row">
                      {form === `edit-${s.id}` ? (
                        <StepForm labId={labId} initial={s} saving={busy} onCancel={() => setForm(null)}
                          onSave={(body) => act("PUT", `/workflows/${route.id}/steps/${s.id}`, body, () => setForm(null))} />
                      ) : (
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <span className="flex-1 min-w-[180px]">
                            {s.step_order}. {s.step_name}
                            <span className="block text-xs text-muted-foreground" data-testid="route-step-who-label">{s.who || s.required_role.replace(/_/g, " ")}</span>
                          </span>
                          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                            <input type="checkbox" className="w-3.5 h-3.5" checked={!!s.allow_self_approval} disabled={busy || !canEdit} data-testid="author-may-approve"
                              onChange={(e) => act("PATCH", `/workflows/${route.id}/steps/${s.id}`, { allowSelfApproval: e.target.checked })} />
                            Author may approve
                          </label>
                          {editable && (
                            <span className="flex items-center gap-0.5">
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Move up" disabled={busy || i === 0} onClick={() => move(route, i, -1)} data-testid="route-step-up"><ArrowUp size={13} /></Button>
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Move down" disabled={busy || i === route.steps.length - 1} onClick={() => move(route, i, 1)} data-testid="route-step-down"><ArrowDown size={13} /></Button>
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Change this step" disabled={busy} onClick={() => { setForm(`edit-${s.id}`); setError(""); }} data-testid="route-step-edit"><Pencil size={13} /></Button>
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Remove this step" disabled={busy || route.steps.length === 1} onClick={() => act("DELETE", `/workflows/${route.id}/steps/${s.id}`)} data-testid="route-step-remove"><Trash2 size={13} /></Button>
                            </span>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                {editable && (form === `add-${route.id}` ? (
                  <div className="mt-2">
                    <StepForm labId={labId} saving={busy} onCancel={() => setForm(null)}
                      onSave={(body) => act("POST", `/workflows/${route.id}/steps`, body, () => setForm(null))} />
                  </div>
                ) : (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 mt-2" onClick={() => { setForm(`add-${route.id}`); setError(""); }} data-testid="route-step-add"><Plus size={12} />Add a step</Button>
                ))}
              </div>
            );
          })}
          {canEdit && (
            <div className="flex items-center gap-2">
              <Input value={newRoute} onChange={e => setNewRoute(e.target.value)} placeholder="New route, e.g. Supervisor then director" className="h-8 text-sm flex-1" data-testid="route-new-name" />
              <Button size="sm" className="h-8 text-xs gap-1" disabled={busy || !newRoute.trim()} data-testid="route-add"
                onClick={() => act("POST", "/workflows", { name: newRoute.trim() }, () => setNewRoute(""))}><Plus size={12} />Add route</Button>
            </div>
          )}
          {!canEdit && <p className="text-xs text-muted-foreground" data-testid="route-read-only">Only a lab owner or admin can change approval routes.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
