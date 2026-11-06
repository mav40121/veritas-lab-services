// A lab's groups of people (leads, supervisors, etc.), server/labGroups.ts. VeritaTrack sends reminders to a group and VeritaDC
// approval steps go to any one member, so both modules share this hook and this dialog. apiBase is the module's lab-prefixed
// API root, such as /api/labs/3/veritatrack. `members` and `roster` come back only for the owners and admins who manage groups.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authHeaders } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Users } from "lucide-react";

export interface LabGroupMember { id: number; employee_id: number | null; name: string | null; email: string | null; inactive: boolean; has_login: boolean }
export interface LabGroup { id: number; name: string; retired: boolean; task_count: number; member_count: number; signer_count: number; members?: LabGroupMember[] }
export interface LabGroupsData { groups: LabGroup[]; roster: { id: number; name: string; email: string | null }[]; can_edit: boolean }

const GROUP_NAME_MAX = 60; // the server checks this too (server/labGroups.ts)
const emailValid = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim());
// The server answers {"error": "..."}; show that sentence, not the raw JSON.
function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  try { return JSON.parse(raw)?.error || raw; } catch { return raw; }
}

export function useLabGroups(apiBase: string) {
  return useQuery<LabGroupsData>({
    queryKey: [`${apiBase}/groups`],
    queryFn: async () => {
      const r = await fetch(`${apiBase}/groups`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });
}

function GroupMemberRow({ member, onSend, busy, forApprovals }: {
  member: LabGroupMember;
  onSend: (req: { method: "PUT" | "DELETE"; path: string; body?: unknown }) => void;
  busy: boolean;
  forApprovals: boolean;
}) {
  const [address, setAddress] = useState("");
  return (
    <li className="rounded-lg bg-muted/50 px-3 py-2" data-testid="group-member-row">
      <div className="flex items-center gap-2">
        <span className="flex-1 min-w-0 [overflow-wrap:anywhere]">
          {member.name && <span className="font-medium text-foreground">{member.name} </span>}
          {member.email && <span className="text-muted-foreground">{member.email}</span>}
          {member.inactive && <span className="text-muted-foreground"> (no longer on the active roster, not emailed)</span>}
          {forApprovals && !member.inactive && !member.has_login && <span className="text-amber-700 dark:text-amber-400" data-testid="group-member-no-login"> (no login yet, can't sign)</span>}
        </span>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Take out of this group" disabled={busy}
          onClick={() => onSend({ method: "DELETE", path: `/members/${member.id}` })} data-testid="group-member-remove"><Trash2 size={13} /></Button>
      </div>
      {!member.email && !member.inactive && (
        <div className="flex items-center gap-2 mt-1.5">
          <Input value={address} onChange={e => setAddress(e.target.value)} placeholder="No email on file: enter one" className="h-7 text-xs flex-1" data-testid="group-member-address-input" />
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy || !emailValid(address)}
            onClick={() => onSend({ method: "PUT", path: `/members/${member.id}`, body: { email: address.trim() } })} data-testid="group-member-address-save">Save</Button>
        </div>
      )}
    </li>
  );
}

export function LabGroupsDialog({ apiBase, forApprovals = false }: { apiBase: string; forApprovals?: boolean }) {
  const qc = useQueryClient();
  const { data } = useLabGroups(apiBase);
  const [newName, setNewName] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [pickId, setPickId] = useState("none");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberName, setMemberName] = useState("");
  const send = useMutation({
    mutationFn: async (req: { method: "POST" | "PUT" | "DELETE"; path: string; body?: unknown }) => {
      const r = await fetch(`${apiBase}/groups${req.path}`, {
        method: req.method,
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (fresh) => {
      qc.setQueryData([`${apiBase}/groups`], fresh);
      setNewName(""); setEditId(null); setPickId("none"); setMemberEmail(""); setMemberName("");
    },
  });
  if (!data?.can_edit) return null;
  const picked = data.roster.find(p => String(p.id) === pickId);
  const canAddMember = picked ? (!memberEmail.trim() || emailValid(memberEmail)) : emailValid(memberEmail);
  return (
    <Dialog onOpenChange={() => { send.reset(); setEditId(null); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1" data-testid="groups-manage-button" title="Build this lab's groups, such as leads or supervisors">
          <Users size={12} /> Manage groups
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">Groups</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-1 text-sm min-w-0">
          {data.groups.length === 0 && <p className="text-xs text-muted-foreground">No groups yet. Add one below, such as Leads or Supervisors.</p>}
          <ul className="space-y-2">
            {data.groups.map(g => {
              const members = g.members || [];
              const noEmail = members.filter(m => !m.inactive && !m.email).length;
              const rosterLeft = data.roster.filter(p => !members.some(m => m.employee_id === p.id));
              return (
                <li key={g.id} className="rounded-lg border border-border p-2.5" data-testid={`group-row-${g.id}`}>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {editId === g.id ? (
                      <>
                        <Input value={editName} maxLength={GROUP_NAME_MAX} onChange={e => setEditName(e.target.value)} className="h-7 text-sm flex-1 min-w-[140px]" data-testid="group-rename-input" />
                        <Button size="sm" className="h-7 text-xs" disabled={send.isPending || !editName.trim()}
                          onClick={() => send.mutate({ method: "PUT", path: `/${g.id}`, body: { name: editName } })} data-testid="group-rename-save">Save</Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditId(null)}>Cancel</Button>
                      </>
                    ) : (
                      <>
                        <span className={`flex-1 min-w-[120px] font-medium ${g.retired ? "text-muted-foreground line-through" : "text-foreground"}`}>{g.name}</span>
                        <span className="text-[11px] text-muted-foreground" data-testid="group-counts">
                          {g.member_count} {g.member_count === 1 ? "person" : "people"}
                          {forApprovals ? `, ${g.signer_count} can sign` : `, ${g.task_count} task${g.task_count === 1 ? "" : "s"}`}
                          {g.retired ? ", retired" : ""}
                        </span>
                        {!g.retired && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setOpenId(openId === g.id ? null : g.id); setPickId("none"); setMemberEmail(""); setMemberName(""); send.reset(); }} data-testid="group-members-toggle">People</Button>}
                        {!g.retired && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setEditId(g.id); setEditName(g.name); send.reset(); }} data-testid="group-rename">Rename</Button>}
                        <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={send.isPending}
                          onClick={() => send.mutate({ method: "PUT", path: `/${g.id}`, body: { retired: !g.retired } })}
                          data-testid={g.retired ? "group-restore" : "group-retire"}>{g.retired ? "Restore" : "Retire"}</Button>
                      </>
                    )}
                  </div>
                  {openId === g.id && !g.retired && (
                    <div className="mt-2.5 space-y-2.5">
                      {members.length === 0 && <p className="text-xs text-muted-foreground">Nobody in this group yet.</p>}
                      <ul className="space-y-1.5">
                        {members.map(m => (
                          <GroupMemberRow key={m.id} member={m} busy={send.isPending} forApprovals={forApprovals}
                            onSend={req => send.mutate({ ...req, path: `/${g.id}${req.path}` })} />
                        ))}
                      </ul>
                      {noEmail > 0 && (
                        <p className="text-[11px] text-amber-700 dark:text-amber-400" data-testid="group-no-email-warning">
                          {noEmail} {noEmail === 1 ? "person has" : "people have"} no email on file and won't get reminders until one is entered.
                        </p>
                      )}
                      <div className="space-y-1.5 rounded-lg bg-muted/30 p-2">
                        <Select value={pickId} onValueChange={v => { setPickId(v); setMemberName(""); }}>
                          <SelectTrigger className="h-8 text-sm" data-testid="group-roster-select"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Someone not on the roster</SelectItem>
                            {rosterLeft.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.email ? p.name : `${p.name} (no email on file)`}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {!picked?.email && <Input value={memberEmail} onChange={e => setMemberEmail(e.target.value)} placeholder="name@lab.org" className="h-8 text-sm flex-1 min-w-[150px]" data-testid="group-member-email" />}
                          {!picked && <Input value={memberName} onChange={e => setMemberName(e.target.value)} placeholder="Name (optional)" className="h-8 text-sm flex-1 min-w-[120px]" data-testid="group-member-name" />}
                          <Button size="sm" variant="outline" className="h-8 text-xs gap-1" disabled={send.isPending || !canAddMember}
                            onClick={() => send.mutate({
                              method: "POST", path: `/${g.id}/members`,
                              body: picked ? { employee_id: picked.id, ...(memberEmail.trim() ? { email: memberEmail.trim() } : {}) } : { email: memberEmail.trim(), name: memberName.trim() },
                            })} data-testid="group-member-add"><Plus size={12} />Add</Button>
                        </div>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex items-center gap-2">
            <Input placeholder="New group, e.g. Supervisors" value={newName} maxLength={GROUP_NAME_MAX}
              onChange={e => setNewName(e.target.value)} className="h-8 text-sm flex-1" data-testid="group-new-name"
              onKeyDown={e => { if (e.key === "Enter" && newName.trim()) send.mutate({ method: "POST", path: "", body: { name: newName } }); }} />
            <Button size="sm" className="h-8 text-xs gap-1" disabled={send.isPending || !newName.trim()}
              onClick={() => send.mutate({ method: "POST", path: "", body: { name: newName } })} data-testid="group-add"><Plus size={12} />Add</Button>
          </div>
          {send.isError && <p className="text-xs text-destructive" data-testid="group-error">{errorText(send.error)}</p>}
          <p className="text-[11px] text-muted-foreground">
            {forApprovals
              ? "A person signs with their own login. Someone who leaves the VeritaStaff roster drops out on their own, and someone new to a group owes what the group owes. A group on an approval route, or assigned read-and-sign, can't be retired until it comes off."
              : "Someone who leaves the VeritaStaff roster stops getting reminders on their own. A retired group is no longer offered, and the tasks that name it go back to this lab's recipient list."}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
