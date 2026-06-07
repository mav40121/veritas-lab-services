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
import { Loader2, UserPlus, ShieldCheck, ShieldOff, Trash2, Crown, ArrowRightLeft, Clock, Link as LinkIcon, RotateCw, X, KeyRound, Copy, Check } from "lucide-react";

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
  seat_type: "active" | "view_only";
}

interface PendingInvite {
  seat_id: number;
  seat_email: string;
  invited_at: string;
  status: string;
  invite_token: string | null;
  seat_type: "active" | "view_only";
}

interface SeatLimits {
  activeIncluded: number;
  viewOnlyIncluded: number;
  addOnRatePerYear: number;
}

interface SeatCounts {
  active: number;
  viewOnly: number;
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

// parking-lot #33 PR 4: seat-type chip distinguishes writers (active) from
// reviewers (view-only). Reviewers are medical director or designee,
// technical consultant, technical supervisor, general supervisor — they
// read and approve but do not enter data.
function seatTypeBadge(seatType: "active" | "view_only") {
  if (seatType === "view_only") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border bg-violet-100 text-violet-900 border-violet-300">
        View only
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border bg-emerald-100 text-emerald-900 border-emerald-300">
      Active
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

  const { data, isLoading } = useQuery<{ members: LabMember[]; pendingInvites?: PendingInvite[]; seatLimits?: SeatLimits; seatCounts?: SeatCounts }>({
    queryKey: [`/api/labs/${activeLabId}/members`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!activeLabId,
  });
  const members = data?.members || [];
  const pendingInvites = data?.pendingInvites || [];
  const seatLimits = data?.seatLimits;
  const seatCounts = data?.seatCounts;

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "staff">("staff");
  // parking-lot #33 PR 2: seat-type split at invite time. 'active' = writer
  // (counts against tier cap); 'view_only' = reviewer (medical director,
  // technical consultant, supervisor; capped per tier 1/2/3 with $99/yr
  // add-on for extras). Default 'active'.
  const [inviteSeatType, setInviteSeatType] = useState<"active" | "view_only">("active");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: [`/api/labs/${activeLabId}/members`] });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/labs/${activeLabId}/members`, { email: inviteEmail, role: inviteRole, seatType: inviteSeatType });
      return res.json();
    },
    onSuccess: (r) => {
      toast({ title: "Invitation sent", description: r.emailSent ? `Email delivered to ${inviteEmail}` : `Seat created. Email delivery failed — share the invite link manually.` });
      setInviteEmail("");
      setInviteRole("staff");
      setInviteSeatType("active");
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

      {seatLimits && seatCounts && (
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-3">
                {seatTypeBadge("active")}
                <div>
                  <div className="font-medium">
                    {seatCounts.active} of {seatLimits.activeIncluded} active seats used
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Writers: techs and supervisors who enter data. Owner counts as 1 active seat.
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {seatTypeBadge("view_only")}
                <div>
                  <div className="font-medium">
                    {seatCounts.viewOnly} of {seatLimits.viewOnlyIncluded} view-only seats used
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Reviewers: medical director or designee, technical consultant, technical supervisor. Extras are ${seatLimits.addOnRatePerYear} per year.
                  </div>
                </div>
              </div>
            </div>
            {(seatCounts.active >= seatLimits.activeIncluded || seatCounts.viewOnly >= seatLimits.viewOnlyIncluded) && (
              <div className="mt-3 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                You are at a seat cap. Inviting another seat of that type will require a tier upgrade (active) or a ${seatLimits.addOnRatePerYear} per year add-on (view-only).
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {canManage && (
        <InventoryPinCard labId={activeLabId} />
      )}

      {canManage && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><UserPlus size={16} /> Invite a new member</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_160px_auto] gap-2">
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
              <div>
                <Label htmlFor="invite-seat-type" className="text-xs">Seat type</Label>
                <select id="invite-seat-type" value={inviteSeatType} onChange={e => setInviteSeatType(e.target.value as "active" | "view_only")} className="w-full h-10 border border-input bg-background rounded-md px-3 text-sm">
                  <option value="active">Active (writer)</option>
                  <option value="view_only">View-only (reviewer)</option>
                </select>
              </div>
              <div className="flex items-end">
                <Button onClick={() => inviteMutation.mutate()} disabled={inviteMutation.isPending || !inviteEmail.includes("@")}>
                  {inviteMutation.isPending && <Loader2 className="animate-spin mr-1" size={14} />} Send invite
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Active seats (writers: techs, supervisors who enter data) count against the tier seat cap. View-only seats (medical director or designee, technical consultant, supervisor reviewers) are included per tier: 1 Clinic, 2 Community, 3 Hospital; additional view-only seats are $99 per year. Admins can invite/remove members and manage lab settings. They cannot change billing or transfer ownership. Staff get operational access only.
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
                    <th className="py-2 pr-3">Seat type</th>
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
                        <td className="py-2 pr-3">{seatTypeBadge(m.seat_type || "active")}</td>
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
                        <td className="py-2 pr-3">{seatTypeBadge(inv.seat_type || "active")}</td>
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

// ── Wave K4: Inventory Kiosk PIN management card ─────────────────────────
// Owner/admin only. Reads K1's /api/labs/:labId/inventory-pin/status and
// rotates via /api/labs/:labId/inventory-pin/regenerate. New PIN is shown
// ONCE in a modal with a Copy button; closing the modal forgets the PIN.
interface PinStatus {
  has_pin: boolean;
  last_rotated_at: string | null;
  failed_attempts: number;
  locked_until: string | null;
  is_locked: boolean;
}

function InventoryPinCard({ labId }: { labId: number }) {
  const { toast } = useToast();
  const { data: status, isLoading } = useQuery<PinStatus>({
    queryKey: ["/api/labs", labId, "inventory-pin/status"],
    queryFn: getQueryFn({ on401: "throw" }),
  });
  const [revealOpen, setRevealOpen] = useState(false);
  const [revealedPin, setRevealedPin] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const rotateMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/labs/${labId}/inventory-pin/regenerate`, {});
      return r as unknown as { pin: string; updated_at: string };
    },
    onSuccess: (data) => {
      setRevealedPin(data.pin);
      setRevealOpen(true);
      setConfirmOpen(false);
      setCopied(false);
      queryClient.invalidateQueries({ queryKey: ["/api/labs", labId, "inventory-pin/status"] });
    },
    onError: (err: any) => {
      toast({ title: "PIN rotation failed", description: err.message || "Try again.", variant: "destructive" });
    },
  });

  function copyPin() {
    if (!revealedPin) return;
    navigator.clipboard.writeText(revealedPin).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      toast({ title: "Copy failed", description: "Highlight the PIN manually.", variant: "destructive" });
    });
  }

  function closeReveal() {
    setRevealOpen(false);
    setRevealedPin(null);
    setCopied(false);
  }

  return (
    <Card data-testid="inventory-pin-card">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <KeyRound size={16} /> Inventory Kiosk PIN
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Bench techs sign into the kiosk at <code className="font-mono text-xs bg-slate-100 px-1 rounded">/inventory</code> with the lab's CLIA and this 6-digit PIN. They can adjust quantities on hand with their initials; they cannot reach any other module. Rotate the PIN if it leaks or a tech leaves.
        </p>

        {isLoading ? (
          <div className="text-xs text-muted-foreground">Loading status...</div>
        ) : !status?.has_pin ? (
          <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-2" data-testid="inventory-pin-status">
            No PIN set. Generate one to enable kiosk access.
          </div>
        ) : (
          <div className="text-xs text-slate-700 space-y-1" data-testid="inventory-pin-status">
            <div>
              <span className="font-medium">Status:</span>{" "}
              {status.is_locked
                ? <span className="text-rose-700">Locked out after 5 failed attempts until {status.locked_until ? new Date(status.locked_until).toLocaleTimeString() : "soon"}. Rotate to clear.</span>
                : <span className="text-emerald-700">Active</span>}
            </div>
            <div>
              <span className="font-medium">Last rotated:</span>{" "}
              {status.last_rotated_at ? new Date(status.last_rotated_at).toLocaleString() : "never"}
            </div>
            {status.failed_attempts > 0 && !status.is_locked && (
              <div className="text-amber-900">
                {status.failed_attempts} failed attempt{status.failed_attempts === 1 ? "" : "s"} since last rotation.
              </div>
            )}
          </div>
        )}

        <div>
          <Button
            size="sm"
            onClick={() => setConfirmOpen(true)}
            disabled={rotateMutation.isPending}
            data-testid="inventory-pin-rotate-button"
          >
            {rotateMutation.isPending && <Loader2 className="animate-spin mr-1" size={14} />}
            {status?.has_pin ? "Rotate PIN" : "Generate PIN"}
          </Button>
        </div>
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{status?.has_pin ? "Rotate inventory PIN?" : "Generate inventory PIN?"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-700">
            {status?.has_pin
              ? "The current PIN will stop working immediately. Anyone using the kiosk will need the new PIN on their next sign-in."
              : "A new 6-digit PIN will be generated and shown once. Share it with the bench techs who need to take inventory."}
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={() => rotateMutation.mutate()} disabled={rotateMutation.isPending} data-testid="inventory-pin-confirm-button">
              {rotateMutation.isPending && <Loader2 className="animate-spin mr-1" size={14} />}
              {status?.has_pin ? "Rotate now" : "Generate now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={revealOpen} onOpenChange={(o) => { if (!o) closeReveal(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New inventory PIN</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              Write this down or copy it now. It will not be shown again. Closing this dialog erases it from this screen.
            </p>
            <div className="bg-slate-100 border border-slate-300 rounded p-4 flex items-center justify-between" data-testid="inventory-pin-reveal">
              <div className="text-3xl font-mono font-bold tracking-widest">{revealedPin}</div>
              <Button size="sm" variant="outline" onClick={copyPin} data-testid="inventory-pin-copy-button">
                {copied ? <><Check size={14} className="mr-1" /> Copied</> : <><Copy size={14} className="mr-1" /> Copy</>}
              </Button>
            </div>
            <div className="text-xs text-slate-500">
              Bench techs sign in at <code className="font-mono text-xs bg-slate-100 px-1 rounded">/inventory</code> using the lab's CLIA + this PIN.
            </div>
          </div>
          <DialogFooter>
            <Button size="sm" onClick={closeReveal} data-testid="inventory-pin-dismiss-button">I've recorded it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
