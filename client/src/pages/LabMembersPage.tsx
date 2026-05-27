import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthContext";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useMemberships } from "@/hooks/useMemberships";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, UserPlus, ShieldCheck, ShieldOff, Trash2, Crown, ArrowRightLeft, Clock, Link as LinkIcon, RotateCw, X } from "lucide-react";

interface LabMember {
  membership_id: number;
  user_id: number;
  role: "owner" | "admin" | "staff";
  is_primary_lab: 0 | 1;
  status: string;
  accepted_at: string | null;
  created_at: string;
  last_active_at: string | null;
  name: string | null;
  email: string;
}

interface PendingInvite {
  seat_id: number;
  seat_email: string;
  invited_at: string;
  status: string;
  invite_token: string | null;
}

const ROLE_BADGE_CLASS: Record<string, string> = {
  owner: "bg-amber-100 text-amber-900 border-amber-300",
  admin: "bg-teal-100 text-teal-900 border-teal-300",
  staff: "bg-slate-100 text-slate-700 border-slate-300",
};

function roleBadge(role: string) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${ROLE_BADGE_CLASS[role] || ROLE_BADGE_CLASS.staff}`}>
      {role === "owner" && <Crown size={11} />}
      {role === "admin" && <ShieldCheck size={11} />}
      {role.charAt(0).toUpperCase() + role.slice(1)}
    </span>
  );
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  try { return new Date(s).toLocaleDateString(); } catch { return s; }
}

export default function LabMembersPage() {
  const { user } = useAuth();
  const activeLabId = useActiveLabId();
  const { data: memberships } = useMemberships();
  const { toast } = useToast();

  const currentMembership = memberships?.find(m => m.labId === activeLabId);
  const myRole = currentMembership?.role || "staff";
  const isOwner = myRole === "owner";
  const canManage = myRole === "owner" || myRole === "admin";

  const { data, isLoading } = useQuery<{ members: LabMember[]; pendingInvites?: PendingInvite[] }>({
    queryKey: [`/api/labs/${activeLabId}/members`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!activeLabId,
  });
  const members = data?.members || [];
  const pendingInvites = data?.pendingInvites || [];

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "staff">("staff");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: [`/api/labs/${activeLabId}/members`] });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/labs/${activeLabId}/members`, { email: inviteEmail, role: inviteRole });
      return res.json();
    },
    onSuccess: (r) => {
      toast({ title: "Invitation sent", description: r.emailSent ? `Email delivered to ${inviteEmail}` : `Seat created. Email delivery failed — share the invite link manually.` });
      setInviteEmail("");
      setInviteRole("staff");
      invalidate();
    },
    onError: (err: any) => toast({ title: "Invite failed", description: String(err?.message || err), variant: "destructive" }),
  });

  const roleMutation = useMutation({
    mutationFn: async ({ memberId, role }: { memberId: number; role: "admin" | "staff" }) => {
      const res = await apiRequest("PATCH", `/api/labs/${activeLabId}/members/${memberId}`, { role });
      return res.json();
    },
    onSuccess: () => { toast({ title: "Role updated" }); invalidate(); },
    onError: (err: any) => toast({ title: "Role change failed", description: String(err?.message || err), variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async (memberId: number) => {
      const res = await apiRequest("DELETE", `/api/labs/${activeLabId}/members/${memberId}`);
      return res.json();
    },
    onSuccess: () => { toast({ title: "Member removed" }); invalidate(); },
    onError: (err: any) => toast({ title: "Remove failed", description: String(err?.message || err), variant: "destructive" }),
  });

  const reissueMutation = useMutation({
    mutationFn: async (seatId: number) => {
      const res = await apiRequest("POST", `/api/labs/${activeLabId}/seat-invites/${seatId}/reissue`);
      return res.json();
    },
    onSuccess: (r: any) => {
      if (r?.joinUrl) navigator.clipboard.writeText(r.joinUrl).catch(() => {});
      toast({ title: "Invite reissued", description: "Fresh 30-day link copied to clipboard." });
      invalidate();
    },
    onError: (err: any) => toast({ title: "Reissue failed", description: String(err?.message || err), variant: "destructive" }),
  });

  const dismissMutation = useMutation({
    mutationFn: async (seatId: number) => {
      const res = await apiRequest("POST", `/api/labs/${activeLabId}/seat-invites/${seatId}/dismiss`);
      return res.json();
    },
    onSuccess: () => { toast({ title: "Invite dismissed" }); invalidate(); },
    onError: (err: any) => toast({ title: "Dismiss failed", description: String(err?.message || err), variant: "destructive" }),
  });

  // Transfer ownership state
  const [transferTargetId, setTransferTargetId] = useState<number | null>(null);
  const [transferConfirmText, setTransferConfirmText] = useState("");
  const [transferOpen, setTransferOpen] = useState(false);

  const transferMutation = useMutation({
    mutationFn: async () => {
      if (transferTargetId == null) throw new Error("Pick a target member first");
      const res = await apiRequest("POST", `/api/labs/${activeLabId}/transfer-ownership`, {
        newOwnerUserId: transferTargetId,
        confirm: true,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Ownership transferred", description: "You are now an admin on this lab; billing email is unchanged." });
      setTransferOpen(false);
      setTransferConfirmText("");
      setTransferTargetId(null);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["/api/labs/me"] });
    },
    onError: (err: any) => toast({ title: "Transfer failed", description: String(err?.message || err), variant: "destructive" }),
  });

  if (!activeLabId) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <Card><CardContent className="p-6">Pick a lab from the lab switcher to manage its members.</CardContent></Card>
      </div>
    );
  }

  const transferEligible = members.filter(m => m.role !== "owner" && m.user_id !== user?.id);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Lab Members</h1>
        <p className="text-sm text-muted-foreground">
          Your role on this lab: {roleBadge(myRole)}
          {!canManage && " — read-only view. Only the owner or an admin can invite or remove members."}
        </p>
      </div>

      {canManage && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><UserPlus size={16} /> Invite a new member</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_auto] gap-2">
              <div>
                <Label htmlFor="invite-email" className="text-xs">Email</Label>
                <Input id="invite-email" type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="member@example.com" />
              </div>
              <div>
                <Label htmlFor="invite-role" className="text-xs">Role</Label>
                <select id="invite-role" value={inviteRole} onChange={e => setInviteRole(e.target.value as "admin" | "staff")} className="w-full h-10 border border-input bg-background rounded-md px-3 text-sm" disabled={!isOwner && inviteRole === "admin"}>
                  <option value="staff">Staff</option>
                  <option value="admin" disabled={!isOwner}>Admin{!isOwner ? " (owner only)" : ""}</option>
                </select>
              </div>
              <div className="flex items-end">
                <Button onClick={() => inviteMutation.mutate()} disabled={inviteMutation.isPending || !inviteEmail.includes("@")}>
                  {inviteMutation.isPending && <Loader2 className="animate-spin mr-1" size={14} />} Send invite
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Admins can invite/remove members and manage lab settings. They cannot change billing or transfer ownership. Staff get operational access only.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Members ({members.length}{pendingInvites.length > 0 && (
              <span className="ml-1 text-xs font-normal text-muted-foreground">+ {pendingInvites.length} pending</span>
            )})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="animate-spin" size={14} /> Loading...</div>
          ) : (members.length === 0 && pendingInvites.length === 0) ? (
            <div className="text-sm text-muted-foreground">No members yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-3">Name / Email</th>
                    <th className="py-2 pr-3">Role</th>
                    <th className="py-2 pr-3">Last active</th>
                    <th className="py-2 pr-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map(m => {
                    const isSelf = m.user_id === user?.id;
                    const isMemberOwner = m.role === "owner";
                    return (
                      <tr key={`m-${m.membership_id}`} className="border-b last:border-b-0">
                        <td className="py-2 pr-3">
                          <div className="font-medium">{m.name || m.email}{isSelf && <span className="text-xs text-muted-foreground ml-1">(you)</span>}</div>
                          {m.name && <div className="text-xs text-muted-foreground">{m.email}</div>}
                        </td>
                        <td className="py-2 pr-3">{roleBadge(m.role)}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{fmtDate(m.last_active_at || m.accepted_at)}</td>
                        <td className="py-2 pr-3 text-right space-x-1">
                          {isOwner && !isMemberOwner && m.role === "staff" && (
                            <Button size="sm" variant="outline" onClick={() => roleMutation.mutate({ memberId: m.membership_id, role: "admin" })} disabled={roleMutation.isPending}>
                              <ShieldCheck size={12} className="mr-1" /> Promote to admin
                            </Button>
                          )}
                          {isOwner && !isMemberOwner && m.role === "admin" && (
                            <Button size="sm" variant="outline" onClick={() => roleMutation.mutate({ memberId: m.membership_id, role: "staff" })} disabled={roleMutation.isPending}>
                              <ShieldOff size={12} className="mr-1" /> Demote to staff
                            </Button>
                          )}
                          {canManage && !isMemberOwner && (
                            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => {
                              if (confirm(`Remove ${m.name || m.email} from this lab? Their seat under the lab owner will also be deactivated.`)) {
                                removeMutation.mutate(m.membership_id);
                              }
                            }} disabled={removeMutation.isPending}>
                              <Trash2 size={12} className="mr-1" /> Remove
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {pendingInvites.map(inv => {
                    const daysPending = Math.floor((Date.now() - new Date(inv.invited_at).getTime()) / (1000 * 60 * 60 * 24));
                    const expired = daysPending > 30;
                    return (
                      <tr key={`p-${inv.seat_id}`} className="border-b last:border-b-0 bg-amber-50/30">
                        <td className="py-2 pr-3">
                          <div className="font-medium text-muted-foreground italic">{inv.seat_email}</div>
                          <div className="text-xs text-muted-foreground">
                            Invited {fmtDate(inv.invited_at)} ({daysPending}d ago)
                          </div>
                        </td>
                        <td className="py-2 pr-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${expired ? "bg-red-100 text-red-900 border-red-300" : "bg-amber-100 text-amber-900 border-amber-300"}`}>
                            <Clock size={11} />
                            {expired ? `Expired (${daysPending}d)` : "Pending invitation"}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground">{fmtDate(inv.invited_at)}</td>
                        <td className="py-2 pr-3 text-right space-x-1">
                          {canManage && inv.invite_token && !expired && (
                            <Button size="sm" variant="ghost" onClick={() => {
                              const url = `${window.location.origin}/join?token=${inv.invite_token}`;
                              navigator.clipboard.writeText(url).catch(() => {});
                              toast({ title: "Invite link copied to clipboard" });
                            }}>
                              <LinkIcon size={12} className="mr-1" /> Copy link
                            </Button>
                          )}
                          {canManage && (
                            <Button size="sm" variant="outline" onClick={() => reissueMutation.mutate(inv.seat_id)} disabled={reissueMutation.isPending}>
                              <RotateCw size={12} className="mr-1" /> Reissue
                            </Button>
                          )}
                          {canManage && (
                            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => {
                              if (confirm(`Dismiss the invitation for ${inv.seat_email}? They won't get any further emails. You can re-invite them later if needed.`)) {
                                dismissMutation.mutate(inv.seat_id);
                              }
                            }} disabled={dismissMutation.isPending}>
                              <X size={12} className="mr-1" /> Dismiss
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {isOwner && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><ArrowRightLeft size={16} /> Transfer ownership</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Transfer this lab's ownership to another active member. You will be demoted to admin. If this lab is currently your primary lab, the primary flag will move to the new owner (so you stop being free on it and they take the paid-seat slot).
              <br /><br />
              <strong>Billing is NOT migrated automatically.</strong> The Stripe customer email stays attached to the lab. Update the billing email in the Stripe portal separately if you want invoices to follow the new owner.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
              <select value={transferTargetId ?? ""} onChange={e => setTransferTargetId(e.target.value ? Number(e.target.value) : null)} className="h-10 border border-input bg-background rounded-md px-3 text-sm">
                <option value="">Pick new owner...</option>
                {transferEligible.map(m => (
                  <option key={m.membership_id} value={m.user_id}>{(m.name || m.email)} ({m.role})</option>
                ))}
              </select>
              <Button variant="destructive" disabled={transferTargetId == null} onClick={() => setTransferOpen(true)}>
                Transfer ownership
              </Button>
            </div>
            {transferEligible.length === 0 && (
              <p className="text-xs text-muted-foreground">No eligible members. Invite someone first.</p>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Transfer ownership of this lab</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>This action cannot be undone from the UI. The new owner will need to transfer it back to you.</p>
            <p>Type <strong>TRANSFER</strong> below to confirm:</p>
            <Input value={transferConfirmText} onChange={e => setTransferConfirmText(e.target.value)} placeholder="TRANSFER" />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setTransferOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={transferConfirmText !== "TRANSFER" || transferMutation.isPending}
              onClick={() => transferMutation.mutate()}
            >
              {transferMutation.isPending && <Loader2 className="animate-spin mr-1" size={14} />} Transfer ownership
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
