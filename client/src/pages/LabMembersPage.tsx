import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthContext";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useMemberships } from "@/hooks/useMemberships";
import { apiRequest, queryClient, getQueryFn, API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { isStockHost } from "@/lib/host";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, UserPlus, ShieldCheck, ShieldOff, Trash2, Crown, ArrowRightLeft, Clock, Link as LinkIcon, RotateCw, X, KeyRound, Copy, Check, MapPin, Stethoscope, Pencil, Download } from "lucide-react";
import { labLocaleDate } from "@/lib/labDate";

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
  invitee_name?: string | null;
  invite_role?: "admin" | "staff";
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
  // A designated Medical Director is a distinct class: it is disrespectful to
  // render the lab's director as "Staff". Rendered for the member whose email
  // matches labs.medical_director_email.
  medical_director: "bg-teal-100 text-teal-900 border-teal-300",
};

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  staff: "Staff",
  medical_director: "Medical Director",
};

function roleBadge(role: string) {
  return (
    <span
      title={role === "medical_director" ? "Designated Laboratory Medical Director. Policy approvals that route to the medical director go to this person." : undefined}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${ROLE_BADGE_CLASS[role] || ROLE_BADGE_CLASS.staff}`}
    >
      {role === "owner" && <Crown size={11} />}
      {role === "admin" && <ShieldCheck size={11} />}
      {role === "medical_director" && <Stethoscope size={11} />}
      {ROLE_LABEL[role] || (role.charAt(0).toUpperCase() + role.slice(1))}
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

// Designated Laboratory Medical Director badge. Shown on whichever member (or
// pending invite) matches labs.medical_director_email. VeritaPolicy approval
// steps that route to the medical director resolve to this person once they
// are an active member.
function medicalDirectorBadge(pending?: boolean) {
  return (
    <span
      data-testid="medical-director-badge"
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border bg-teal-100 text-teal-900 border-teal-300"
      title="Designated Laboratory Medical Director. Policy approvals that route to the medical director go to this person."
    >
      <Stethoscope size={11} /> Medical Director{pending ? " (invite pending)" : ""}
    </span>
  );
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  try { return labLocaleDate(s); } catch { return s; }
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

  const { data, isLoading } = useQuery<{ members: LabMember[]; pendingInvites?: PendingInvite[]; seatLimits?: SeatLimits; seatCounts?: SeatCounts; staffPortal?: { band: "small" | "medium" | "large" | null; maxStaff: number | null; used: number } | null; medicalDirector?: { email: string; name: string | null } | null }>({
    queryKey: [`/api/labs/${activeLabId}/members`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!activeLabId,
  });
  const members = data?.members || [];
  const pendingInvites = data?.pendingInvites || [];
  const seatLimits = data?.seatLimits;
  const seatCounts = data?.seatCounts;
  // Bug 4 (2026-10-09): the lab's Staff Portal band, so staff show as used of it.
  const staffPortal = data?.staffPortal ?? null;
  const bandLabel = staffPortal?.band ? `${staffPortal.band.charAt(0).toUpperCase()}${staffPortal.band.slice(1)} band` : null;
  // Designated Laboratory Medical Director (may be an active member or, as with
  // a director who has not accepted yet, a pending invite). Matched by email.
  const mdEmail = (data?.medicalDirector?.email || "").trim().toLowerCase();
  const isMedicalDirector = (email?: string | null) => !!email && !!mdEmail && email.trim().toLowerCase() === mdEmail;

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "staff" | "medical_director">("staff");
  // 2026-10-01: "Staff" now means a read-and-sign Staff Portal seat (drawn from
  // the Staff Portal band, NOT the active writer cap). A new read-and-sign person
  // is added by name + email here and auto-rostered in VeritaStaff. Admin stays an
  // active writer seat; Medical Director stays the one free seat.
  const [inviteFirstName, setInviteFirstName] = useState("");
  const [inviteLastName, setInviteLastName] = useState("");
  // Read-and-sign (Staff Portal) seats for this lab, for the count + list. Owner/
  // admin only; a non-manager's query simply returns nothing and the UI hides it.
  const { data: staffPortalData } = useQuery<{ invites?: Array<{ id: number; email: string; status: string; employee_name: string | null; employee_title: string | null }> }>({
    queryKey: [`/api/labs/${activeLabId}/staff-portal-invites`],
    enabled: !!activeLabId,
  });
  const staffPortalInvites = staffPortalData?.invites ?? [];
  // parking-lot #33 PR 2: seat-type split at invite time. 'active' = writer
  // (counts against tier cap); 'view_only' = reviewer (medical director,
  // technical consultant, supervisor; capped per tier 1/2/3 with $99/yr
  // add-on for extras). Default 'active'.
  // 2026-06-12: seat type is pinned to "active" — the view-only seat model
  // (PLAN_VIEW_ONLY_SEATS + $99/yr extras) was retired 2026-06-08 for the
  // Staff Portal flat bands; the dropdown that set this was removed.
  const inviteSeatType = "active" as const;
  // Names are required only for read-and-sign Staff (that invite creates the VeritaStaff roster entry); Admin and
  // Medical Director give their name on the join page.
  const namesRequired = inviteRole === "staff";

  const invalidate = () => queryClient.invalidateQueries({ queryKey: [`/api/labs/${activeLabId}/members`] });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      if (inviteRole === "staff") {
        // Read-and-sign Staff Portal seat (Staff Portal band, not the active cap).
        // Sends name + email; the server auto-creates the VeritaStaff roster stub.
        const res = await apiRequest("POST", `/api/labs/${activeLabId}/staff-portal-invites`, {
          firstName: inviteFirstName, lastName: inviteLastName, email: inviteEmail,
        });
        return res.json();
      }
      // Bug 2 (2026-10-09): every invite carries the person's name, not only Staff.
      const res = await apiRequest("POST", `/api/labs/${activeLabId}/members`, {
        email: inviteEmail, role: inviteRole, seatType: inviteSeatType, firstName: inviteFirstName, lastName: inviteLastName,
      });
      return res.json();
    },
    onSuccess: (r) => {
      toast({ title: "Invitation sent", description: r.emailSent === false ? `Invite created. Email delivery failed; share the invite link manually.` : `Email sent to ${inviteEmail}` });
      setInviteEmail("");
      setInviteFirstName("");
      setInviteLastName("");
      setInviteRole("staff");
      invalidate();
      queryClient.invalidateQueries({ queryKey: [`/api/labs/${activeLabId}/staff-portal-invites`] });
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

  // Inline email correction. Fixes a member's login email in place instead of
  // remove + re-invite, which would detach their existing attestations.
  const [editEmailFor, setEditEmailFor] = useState<number | null>(null);
  const [editEmailValue, setEditEmailValue] = useState("");
  const emailMutation = useMutation({
    mutationFn: async ({ memberId, email }: { memberId: number; email: string }) => {
      const res = await apiRequest("PATCH", `/api/labs/${activeLabId}/members/${memberId}/email`, { email });
      return res.json();
    },
    onSuccess: () => { toast({ title: "Email updated" }); setEditEmailFor(null); setEditEmailValue(""); invalidate(); },
    onError: (err: any) => toast({ title: "Email change failed", description: String(err?.message || err), variant: "destructive" }),
  });

  // Inline name correction (2026-10-08): fixes a typo'd display name, e.g. a
  // last name mistyped at signup. Same owner/admin gate as Edit email.
  const [editNameFor, setEditNameFor] = useState<number | null>(null);
  const [editNameValue, setEditNameValue] = useState("");
  const nameMutation = useMutation({
    mutationFn: async ({ memberId, name }: { memberId: number; name: string }) => {
      const res = await apiRequest("PATCH", `/api/labs/${activeLabId}/members/${memberId}/name`, { name });
      return res.json();
    },
    onSuccess: () => { toast({ title: "Name updated" }); setEditNameFor(null); setEditNameValue(""); invalidate(); },
    onError: (err: any) => toast({ title: "Name change failed", description: String(err?.message || err), variant: "destructive" }),
  });

  // Set (or clear) the lab's Laboratory Medical Director. Identified by email so it
  // can name a current member, the owner, or a pending invite; the MD gets one free
  // seat. Invoked from the per-member row actions below and from an invite with the
  // Medical Director role. (The standalone "Designate" card was retired 2026-09-30
  // when MD became a first-class role in the invite + member-row controls.)
  const mdMutation = useMutation({
    mutationFn: async ({ email, name }: { email: string; name: string }) => {
      const res = await apiRequest("PUT", `/api/labs/${activeLabId}/medical-director`, { email, name });
      return res.json();
    },
    onSuccess: (_data, variables) => { toast({ title: variables.email && variables.email.trim() ? "Medical director set" : "Medical director cleared" }); invalidate(); },
    onError: (err: any) => toast({ title: "Could not set medical director", description: String(err?.message || err), variant: "destructive" }),
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
              {/* 2026-06-12: the view-only seat counter retired (Michael's
                  "what is going on with the 0 out of 5 view only slots?").
                  The per-seat view-only model (PLAN_VIEW_ONLY_SEATS + $99/yr
                  extras) was retired 2026-06-08 in favor of Staff Portal
                  flat bands; this page kept rendering it. Read-and-sign
                  staff belong in the Staff Portal, not seats. */}
              <div className="flex items-center gap-3">
                <div>
                  <div className="font-medium" data-testid="staff-portal-count">
                    {staffPortal?.maxStaff
                      ? `${staffPortal.used} of ${staffPortal.maxStaff} read-and-sign staff (${bandLabel})`
                      : `${staffPortal ? staffPortal.used : staffPortalInvites.length} read-and-sign staff`}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Bench staff who read and sign policies, record QC, and take inventory. They draw from your staff seat band, not your active seats, so adding them never uses an active seat. Add one above with the Staff (read and sign) role.
                  </div>
                </div>
              </div>
            </div>
            {seatCounts.active >= seatLimits.activeIncluded && (
              <div className="mt-3 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1 dark:text-amber-200 dark:bg-amber-950/40 dark:border-amber-800" data-testid="seats-full-notice">
                All active seats are in use. Inviting another writer requires a tier upgrade or an additional seat.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 2026-09-30: The standalone "Designate Medical Director" card was retired.
          Medical Director is now a first-class seat type: pick it in "Invite a new
          member" for a new person, or use "Make medical director" on any existing
          member row below (the owner included). It remains one free seat, identified
          by email, and is who VeritaPolicy approvals and QC co-sign route to. */}

      {canManage && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><UserPlus size={16} /> Invite a new member</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {/* 2026-06-12: Seat type dropdown retired with the view-only seat
                model. Every invited member is an active (writer) seat; the
                mutation pins seatType to "active". Read-and-sign people use
                the Staff Portal instead of a seat. */}
            <div className="space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_190px_auto] gap-2">
                <div>
                  <Label htmlFor="invite-email" className="text-xs">Email</Label>
                  <Input id="invite-email" type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="member@example.com" />
                </div>
                <div>
                  <Label htmlFor="invite-role" className="text-xs">Role</Label>
                  <select id="invite-role" value={inviteRole} onChange={e => setInviteRole(e.target.value as "admin" | "staff" | "medical_director")} className="w-full h-10 border border-input bg-background rounded-md px-3 text-sm" data-testid="invite-role-select">
                    <option value="staff">Staff (read and sign)</option>
                    <option value="admin" disabled={!isOwner}>Admin / active{!isOwner ? " (owner only)" : ""}</option>
                    <option value="medical_director" disabled={!isOwner}>Medical Director (free){!isOwner ? " (owner only)" : ""}</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <Button
                    onClick={() => inviteMutation.mutate()}
                    disabled={inviteMutation.isPending || !inviteEmail.includes("@") || (namesRequired && (!inviteFirstName.trim() || !inviteLastName.trim()))}
                    data-testid="invite-send-btn"
                  >
                    {inviteMutation.isPending && <Loader2 className="animate-spin mr-1" size={14} />} Send invite
                  </Button>
                </div>
              </div>
              {/* Bug 2 (2026-10-09): first and last name for EVERY role. They were
                  Staff-only, a holdover from the retired kiosk.
                  2026-10-22 (Michael: "we should be able to invite without the first and last name, they just get
                  prompted to fill those in on acceptance"): optional for Admin and Medical Director, whose join page asks
                  for the full name (pre-filled when given). Still required for read-and-sign Staff, because that invite
                  creates the person's VeritaStaff roster entry right away. */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="invite-first" className="text-xs">First name{namesRequired ? "" : " (optional)"}</Label>
                    <Input id="invite-first" value={inviteFirstName} onChange={e => setInviteFirstName(e.target.value)} placeholder="First name" data-testid="invite-first-name" />
                  </div>
                  <div>
                    <Label htmlFor="invite-last" className="text-xs">Last name{namesRequired ? "" : " (optional)"}</Label>
                    <Input id="invite-last" value={inviteLastName} onChange={e => setInviteLastName(e.target.value)} placeholder="Last name" data-testid="invite-last-name" />
                  </div>
                </div>
                {!namesRequired && (
                  <p className="text-xs text-muted-foreground" data-testid="invite-names-optional-hint">They enter their name when they accept.</p>
                )}
            </div>
            <p className="text-xs text-muted-foreground">
              Three kinds of access. Admin / active seats are your writers: they create studies, upload policies, and enter or review data, and they count against your tier's active-seat cap. Staff seats are read and sign: bench staff who read and sign policies, record QC, and take inventory. They draw from your staff seat band, not your active seats, so adding them does not use an active seat. Medical Director is one free seat and is the person VeritaPolicy approvals and QC co-sign route to. The owner can also set or change the Medical Director on any existing member in the table below, the owner included.
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
            <div className="overflow-auto max-h-[70vh]">
              <table className="w-full text-sm">
                <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-muted">
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
                          {editNameFor === m.membership_id ? (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Input
                                value={editNameValue}
                                onChange={e => setEditNameValue(e.target.value)}
                                className="h-8 w-56 text-sm"
                                placeholder="First Last"
                                autoFocus
                                aria-label="Corrected name"
                                data-testid={`edit-name-input-${m.membership_id}`}
                                onKeyDown={e => {
                                  if (e.key === "Enter" && editNameValue.trim()) nameMutation.mutate({ memberId: m.membership_id, name: editNameValue.trim() });
                                  if (e.key === "Escape") { setEditNameFor(null); setEditNameValue(""); }
                                }}
                              />
                              <Button size="sm" data-testid={`edit-name-save-${m.membership_id}`} onClick={() => nameMutation.mutate({ memberId: m.membership_id, name: editNameValue.trim() })} disabled={nameMutation.isPending || !editNameValue.trim()}>
                                {nameMutation.isPending && <Loader2 className="animate-spin mr-1" size={12} />} Save
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => { setEditNameFor(null); setEditNameValue(""); }}>Cancel</Button>
                            </div>
                          ) : editEmailFor === m.membership_id ? (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Input
                                type="email"
                                value={editEmailValue}
                                onChange={e => setEditEmailValue(e.target.value)}
                                className="h-8 w-56 text-sm"
                                placeholder="name@example.com"
                                autoFocus
                                aria-label="New email address"
                                onKeyDown={e => {
                                  if (e.key === "Enter" && editEmailValue.includes("@")) emailMutation.mutate({ memberId: m.membership_id, email: editEmailValue.trim() });
                                  if (e.key === "Escape") { setEditEmailFor(null); setEditEmailValue(""); }
                                }}
                              />
                              <Button size="sm" onClick={() => emailMutation.mutate({ memberId: m.membership_id, email: editEmailValue.trim() })} disabled={emailMutation.isPending || !editEmailValue.includes("@")}>
                                {emailMutation.isPending && <Loader2 className="animate-spin mr-1" size={12} />} Save
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => { setEditEmailFor(null); setEditEmailValue(""); }}>Cancel</Button>
                            </div>
                          ) : (
                            <>
                              <div className="font-medium flex items-center gap-2 flex-wrap">
                                {m.name || m.email}{isSelf && <span className="text-xs text-muted-foreground">(you)</span>}
                              </div>
                              {m.name && <div className="text-xs text-muted-foreground">{m.email}</div>}
                            </>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-1 flex-wrap">
                            {roleBadge(m.role)}
                            {isMedicalDirector(m.email) && medicalDirectorBadge()}
                          </div>
                        </td>
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
                          {/* Medical Director is an additive designation (one free seat),
                              not a role swap, so it is available on ANY member row, the
                              owner included. Designating the director is an OWNER action
                              (bug 3, 2026-10-09; the server route has been owner-only since
                              2026-10-03), so admins see the badge but not the buttons. */}
                          {isOwner && (
                            isMedicalDirector(m.email) ? (
                              <Button size="sm" variant="ghost" data-testid="clear-md-btn" onClick={() => mdMutation.mutate({ email: "", name: "" })} disabled={mdMutation.isPending} title="Remove this person as the lab's Medical Director">
                                <Stethoscope size={12} className="mr-1" /> Clear medical director
                              </Button>
                            ) : (
                              <Button size="sm" variant="outline" data-testid="make-md-btn" onClick={() => mdMutation.mutate({ email: m.email, name: m.name || "" })} disabled={mdMutation.isPending} title="Make this person the lab's Medical Director (one free seat)">
                                <Stethoscope size={12} className="mr-1" /> Make medical director
                              </Button>
                            )
                          )}
                          {canManage && !isMemberOwner && editNameFor !== m.membership_id && (
                            <Button size="sm" variant="ghost" data-testid={`edit-name-${m.membership_id}`} onClick={() => { setEditEmailFor(null); setEditNameFor(m.membership_id); setEditNameValue(m.name || ""); }} disabled={nameMutation.isPending} title="Correct this member's name in place">
                              <Pencil size={12} className="mr-1" /> Edit name
                            </Button>
                          )}
                          {canManage && !isMemberOwner && editEmailFor !== m.membership_id && (
                            <Button size="sm" variant="ghost" onClick={() => { setEditNameFor(null); setEditEmailFor(m.membership_id); setEditEmailValue(m.email); }} disabled={emailMutation.isPending} title="Correct this member's login email in place">
                              <Pencil size={12} className="mr-1" /> Edit email
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
                      <tr key={`p-${inv.seat_id}`} className="border-b last:border-b-0 bg-amber-50/30 dark:bg-amber-500/10" data-testid="pending-invite-row">
                        <td className="py-2 pr-3">
                          {inv.invitee_name && (
                            <div className="font-medium flex items-center gap-2 flex-wrap" data-testid="pending-invitee-name">{inv.invitee_name}</div>
                          )}
                          <div className="font-medium text-muted-foreground dark:text-slate-300 italic flex items-center gap-2 flex-wrap" data-testid="pending-invite-email">
                            {inv.seat_email}
                            {isMedicalDirector(inv.seat_email) && medicalDirectorBadge(true)}
                          </div>
                          <div className="text-xs text-muted-foreground dark:text-slate-300">
                            Invited {fmtDate(inv.invited_at)} ({daysPending}d ago)
                          </div>
                        </td>
                        <td className="py-2 pr-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${expired ? "bg-red-100 text-red-900 border-red-300" : "bg-amber-100 text-amber-900 border-amber-300"}`}>
                            <Clock size={11} />
                            {expired ? `Expired (${daysPending}d)` : "Pending invitation"}
                          </span>
                          {inv.invite_role === "admin" && (
                            <span className="ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border bg-teal-50 text-teal-800 border-teal-200 dark:bg-teal-500/15 dark:text-teal-200 dark:border-teal-500/40" data-testid="pending-invite-role">
                              <ShieldCheck size={11} /> Admin
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3">{seatTypeBadge(inv.seat_type || "active")}</td>
                        <td className="py-2 pr-3 text-muted-foreground dark:text-slate-300" data-testid="pending-invite-date">{fmtDate(inv.invited_at)}</td>
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
                          {isOwner && (
                            isMedicalDirector(inv.seat_email) ? (
                              <Button size="sm" variant="ghost" onClick={() => mdMutation.mutate({ email: "", name: "" })} disabled={mdMutation.isPending} title="Remove this pending invite as the lab's Medical Director">
                                <Stethoscope size={12} className="mr-1" /> Clear medical director
                              </Button>
                            ) : (
                              <Button size="sm" variant="outline" onClick={() => mdMutation.mutate({ email: inv.seat_email, name: inv.invitee_name || "" })} disabled={mdMutation.isPending} title="Make this pending invite the lab's Medical Director (one free seat)">
                                <Stethoscope size={12} className="mr-1" /> Make medical director
                              </Button>
                            )
                          )}
                          {canManage && (
                            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive dark:text-red-400 dark:hover:text-red-300" data-testid="pending-invite-dismiss" onClick={() => {
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

      {canManage && activeLabId && <MemberLocationsCard labId={activeLabId} />}

      {activeLabId && <VeritasSupportCard labId={activeLabId} />}

      {canManage && activeLabId && <TwoFactorLabCard labId={activeLabId} />}

      {canManage && activeLabId && <AccountStatusCard labId={activeLabId} />}

      {canManage && activeLabId && <AccessReportCard labId={activeLabId} />}

      {isOwner && activeLabId && <ExportAllCard labId={activeLabId} />}

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

// ── Member locations + default (VeritaStock multi-location) ──────────────
// Demo feedback 2026-06-23: "when a user is built we need a default location
// and which locations they can access (the ED person should only access ED)."
// Membership = the allowlist: this grid grants a member access to chosen
// enterprise locations and sets their default. ADDITIVE only here (you cannot
// uncheck an existing location), so it can never lock anyone out; to remove a
// location, use the per-location Remove on that lab's Members page. Owner/admin
// only, shown on the VeritaStock deployment when the enterprise has >1 location.

// Download all of this lab's records (exit terms, Q47 = 1 and Q50 = 1). Owner only. Builds one zip in the
// background (records for every module, stored files, the app's reports); the finished file is kept 24 hours.
// It keeps working after a subscription ends. Server: server/exportAll.ts. The file is fetched with a plain
// anchor download from a short-lived link (never fetch + blob; see downloadPdfToken in lib/utils).
interface ExportAllStatus {
  job: { id: string; status: "running" | "done" | "failed"; step: string; startedAt: string; error?: string } | null;
  ready: Array<{ id: string; filename: string; size: number; createdAt: string; expiresAt: string; weekly?: boolean }>;
  weekly?: boolean;
}
const fmtBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
function ExportAllCard({ labId }: { labId: number }) {
  const { toast } = useToast();
  const key = `/api/labs/${labId}/export-all`;
  const { data } = useQuery<ExportAllStatus>({
    queryKey: [key],
    queryFn: getQueryFn({ on401: "throw" }),
    retry: false,
    refetchInterval: (q: any) => (q.state.data?.job?.status === "running" ? 2000 : false),
  });
  const running = data?.job?.status === "running";
  const start = useMutation({
    mutationFn: async () => (await apiRequest("POST", key, {})).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [key] }),
    onError: (err: any) => toast({ title: "Could not start the download", description: cleanErr(err), variant: "destructive" }),
  });
  const download = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `${key}/${id}/download-token`, {})).json(),
    onSuccess: (r: { url: string; filename: string }) => {
      const a = document.createElement("a");
      a.href = r.url;
      a.download = r.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    },
    onError: (err: any) => toast({ title: "Could not download", description: cleanErr(err), variant: "destructive" }),
  });
  const setWeekly = useMutation({
    mutationFn: async (enabled: boolean) => (await apiRequest("PUT", `${key}/weekly`, { enabled })).json(),
    onSuccess: (r: { weekly: boolean }) => {
      queryClient.invalidateQueries({ queryKey: [key] });
      toast({ title: r.weekly ? "Weekly copy turned on" : "Weekly copy turned off", description: r.weekly ? "A new copy is built every Monday and you get an email when it is ready." : undefined });
    },
    onError: (err: any) => toast({ title: "Could not change the weekly copy", description: cleanErr(err), variant: "destructive" }),
  });
  const weeklyOn = !!data?.weekly;
  const latest = data?.ready?.[0];
  return (
    <Card data-testid="export-all-card">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Download size={16} /> Download all of this lab's records</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          One zip with every record this lab keeps in VeritaAssure®: a workbook per module, stored documents including every policy version, and the reports the modules produce. It works after a subscription ends. Only the lab owner can build or download it, and each download is kept for 24 hours.
        </p>
        <div className="rounded-md border border-border p-3 flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold">Build a copy every week</p>
            <p className="text-xs text-muted-foreground" data-testid="export-all-weekly-text">
              {weeklyOn
                ? "On. Every Monday a new copy is built and kept for 7 days, and you get an email when it is ready. The email has no download link: sign in here to download."
                : "Off. Turn it on to keep a recent copy of your records without having to remember to build one."}
            </p>
          </div>
          <button type="button" role="switch" aria-checked={weeklyOn} aria-label="Build a copy every week" data-testid="export-all-weekly-toggle"
            disabled={!data || setWeekly.isPending} onClick={() => setWeekly.mutate(!weeklyOn)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${weeklyOn ? "bg-primary" : "bg-muted-foreground/30"}`}>
            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${weeklyOn ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => start.mutate()} disabled={running || start.isPending} data-testid="export-all-build">
            {(running || start.isPending) && <Loader2 className="animate-spin mr-1" size={14} />}
            {running ? "Building..." : latest ? "Build a new download" : "Build the download"}
          </Button>
          {latest && !running && (
            <Button size="sm" variant="outline" onClick={() => download.mutate(latest.id)} disabled={download.isPending} data-testid="export-all-download">
              <Download size={14} className="mr-1" /> Download ({fmtBytes(latest.size)})
            </Button>
          )}
        </div>
        {running && <p className="text-xs text-muted-foreground" data-testid="export-all-step">{data?.job?.step}...</p>}
        {data?.job?.status === "failed" && <p className="text-xs text-destructive" data-testid="export-all-error">{data.job.error}</p>}
        {latest && !running && (
          <p className="text-xs text-muted-foreground" data-testid="export-all-ready">
            {latest.weekly ? "Weekly copy built" : "Built"} {new Date(latest.createdAt).toLocaleString("en-US")}. Available until {new Date(latest.expiresAt).toLocaleString("en-US")}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// Two-factor sign-in for the lab (Stage 2, mock Q171 = 1). The owner or an admin requires it for
// everyone, allows or switches off "Remember this computer" (shared computers), sees who has it on,
// and resets a person who is locked out. Server: server/twoFactorRoutes.ts.
interface TwoFactorLabResponse {
  labName: string; required: boolean; requiredAt: string | null; requiredByName: string | null; allowRemember: boolean;
  requiredBySystem: string | null; // the owner whose Account settings switch covers their whole system
  people: Array<{ userId: number; name: string; role: string; status: "on" | "on_email" | "setup_next" | "off"; lastSignIn: string | null; canReset: boolean }>;
}
const TF_STATUS: Record<string, { label: string; cls: string }> = {
  on: { label: "On", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  on_email: { label: "On (email codes)", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  setup_next: { label: "Set up at next sign-in", cls: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200" },
  off: { label: "Off", cls: "bg-muted text-muted-foreground" },
};
const cleanErr = (err: any) => String(err?.message || err).replace(/^\d+:\s*/, "");
function TwoFactorLabCard({ labId }: { labId: number }) {
  const { toast } = useToast();
  const key = `/api/labs/${labId}/two-factor`;
  const { data } = useQuery<TwoFactorLabResponse>({ queryKey: [key], queryFn: getQueryFn({ on401: "throw" }), enabled: !!labId, retry: false });
  const [confirmReset, setConfirmReset] = useState<number | null>(null);
  const save = useMutation({
    mutationFn: async (body: { required?: boolean; allowRemember?: boolean }) => (await apiRequest("PUT", key, body)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [key] }),
    onError: (err: any) => toast({ title: "Could not change two-factor settings", description: cleanErr(err), variant: "destructive" }),
  });
  const reset = useMutation({
    mutationFn: async (userId: number) => (await apiRequest("POST", `${key}/reset/${userId}`, {})).json(),
    onSuccess: () => { toast({ title: "Two-factor reset. They set it up again at their next sign-in." }); setConfirmReset(null); queryClient.invalidateQueries({ queryKey: [key] }); },
    onError: (err: any) => toast({ title: "Could not reset", description: cleanErr(err), variant: "destructive" }),
  });
  if (!data) return null;
  const toggle = (on: boolean, onClick: () => void, testId: string, label: string, locked = false) => (
    <button type="button" role="switch" aria-checked={on} aria-label={label} data-testid={testId} disabled={save.isPending || locked} onClick={onClick}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${on ? "bg-primary" : "bg-muted-foreground/30"}`}>
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
    </button>
  );
  return (
    <Card data-testid="two-factor-lab-card">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><KeyRound size={16} /> Two-factor sign-in</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="rounded-md border border-border p-3 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold">Require two-factor sign-in for everyone in {data.labName}</p>
              <p className="text-xs text-muted-foreground" data-testid="two-factor-require-text">
                {data.requiredBySystem
                  ? `On for the whole system: ${data.requiredBySystem} turned it on as the lab owner, in Account settings. People without it set it up at their next sign-in.`
                  : data.required
                  ? `On since ${data.requiredAt ? new Date(data.requiredAt).toLocaleDateString("en-US") : ""}${data.requiredByName ? ` by ${data.requiredByName}` : ""}. People without it set it up at their next sign-in.`
                  : "Off. Anyone can still turn it on for their own account."}
              </p>
            </div>
            {toggle(data.required, () => save.mutate({ required: !data.required }), "two-factor-require-toggle", "Require two-factor sign-in", !!data.requiredBySystem)}
          </div>
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs text-muted-foreground">Allow "Remember this computer for 30 days" (switch off for shared computers)</p>
            {toggle(data.allowRemember, () => save.mutate({ allowRemember: !data.allowRemember }), "two-factor-remember-toggle", "Allow remember this computer")}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-border" data-testid="two-factor-people">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="text-left p-2">Person</th><th className="text-left p-2">Role</th><th className="text-left p-2">Two-factor</th><th className="text-left p-2">Last sign-in</th><th className="p-2"></th></tr>
            </thead>
            <tbody>
              {data.people.map((p) => (
                <tr key={p.userId} className="border-t border-border">
                  <td className="p-2">{p.name}</td>
                  <td className="p-2">{p.role}</td>
                  <td className="p-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${TF_STATUS[p.status]?.cls || ""}`}>{TF_STATUS[p.status]?.label || p.status}</span></td>
                  <td className="p-2 whitespace-nowrap">{p.lastSignIn ? new Date(p.lastSignIn).toLocaleDateString("en-US") : ""}</td>
                  <td className="p-2 text-right whitespace-nowrap">
                    {p.canReset && (confirmReset === p.userId ? (
                      <span className="inline-flex gap-1">
                        <Button size="sm" variant="destructive" disabled={reset.isPending} onClick={() => reset.mutate(p.userId)}>Confirm reset</Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmReset(null)}>Cancel</Button>
                      </span>
                    ) : (
                      <Button size="sm" variant="ghost" className="text-primary" onClick={() => setConfirmReset(p.userId)}>Reset</Button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          Reset clears the person's app and recovery codes and signs them out everywhere; they set it up again at their next sign-in. Recorded in the audit trail. Veritas Lab Services resets a lab owner's.
        </p>
      </CardContent>
    </Card>
  );
}

// System security settings (server/securityPolicy.ts; Michael Q27 = 1, 2026-10-25): people locked out
// after wrong passwords, or turned off after the owner's inactivity limit, with a button to turn them back
// on. Shows nothing when nobody is affected.
function AccountStatusCard({ labId }: { labId: number }) {
  const { toast } = useToast();
  const key = `/api/labs/${labId}/account-status`;
  const { data } = useQuery<{ people: Array<{ userId: number; name: string; locked: boolean; inactive: boolean }> }>({
    queryKey: [key], queryFn: getQueryFn({ on401: "throw" }), enabled: !!labId, retry: false,
  });
  const reenable = useMutation({
    mutationFn: async (userId: number) => (await apiRequest("POST", `/api/labs/${labId}/members/${userId}/reenable`, {})).json(),
    onSuccess: (r: any) => { toast({ title: `${r?.name || "Account"} can sign in again` }); queryClient.invalidateQueries({ queryKey: [key] }); },
    onError: (err: any) => toast({ title: "Could not turn the account back on", description: cleanErr(err), variant: "destructive" }),
  });
  if (!data || !data.people.length) return null;
  return (
    <Card data-testid="account-status-card">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><KeyRound size={16} /> Accounts that can't sign in</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <ul className="space-y-2">
          {data.people.map((p) => (
            <li key={p.userId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2" data-testid={`account-status-${p.userId}`}>
              <span>
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-muted-foreground"> · {[p.locked ? "locked after wrong passwords" : "", p.inactive ? "turned off after a long time without signing in" : ""].filter(Boolean).join(" and ")}</span>
              </span>
              <Button size="sm" variant="outline" disabled={reenable.isPending} onClick={() => reenable.mutate(p.userId)} data-testid={`reenable-${p.userId}`}>
                Turn back on
              </Button>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">These rules come from your system's security settings (Account settings). Turning someone back on is recorded in the audit trail.</p>
      </CardContent>
    </Card>
  );
}

// Access report (server/recordViews.ts; Lifepoint IPS III.1(i)): who opened which records in this lab, newest
// first, filterable by person and period, with an Excel download. Owner or admin only; this lab's rows only.
interface AccessReportResponse {
  days: number; from: string; total: number; shown: number;
  rows: Array<{ viewedAt: string; userId: number; name: string; email: string; module: string; entityId: string | null; path: string; ipAddress: string | null; veritasSupport: boolean }>;
  people: Array<{ id: number; name: string }>;
}
function AccessReportCard({ labId }: { labId: number }) {
  const { toast } = useToast();
  const [days, setDays] = useState(30);
  const [person, setPerson] = useState<number | 0>(0);
  const [busy, setBusy] = useState(false);
  const qs = `days=${days}${person ? `&userId=${person}` : ""}`;
  const key = `/api/labs/${labId}/access-report?${qs}`;
  const { data } = useQuery<AccessReportResponse>({ queryKey: [key], queryFn: getQueryFn({ on401: "throw" }), enabled: !!labId, retry: false });
  async function download() {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/labs/${labId}/access-report.xlsx?${qs}`, { headers: authHeaders() });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.error || `HTTP ${res.status}`); }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || "Access_Report.xlsx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err: any) {
      toast({ title: "Could not download the access report", description: String(err?.message || err), variant: "destructive" });
    } finally { setBusy(false); }
  }
  if (!data) return null;
  return (
    <Card data-testid="access-report-card">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><ShieldCheck size={16} /> Access report</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">
          Who opened which records in this lab. The same person opening the same page within 10 minutes is listed once. Changes,
          approvals and signatures are in the audit trail. Kept for two years.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="access-days">Period</Label>
            <select id="access-days" data-testid="access-days" className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last year</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="access-person">Person</Label>
            <select id="access-person" data-testid="access-person" className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" value={person} onChange={(e) => setPerson(Number(e.target.value))}>
              <option value={0}>Everyone</option>
              {data.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void download()} data-testid="access-download">
            {busy ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Download size={14} className="mr-1" />} Download (Excel)
          </Button>
        </div>
        <p className="text-xs text-muted-foreground" data-testid="access-count">
          {data.total === 0 ? "No records opened in this period." : `${data.total} record ${data.total === 1 ? "view" : "views"}${data.shown < data.total ? `, newest ${data.shown} shown; the download has them all` : ""}.`}
        </p>
        {data.rows.length > 0 && (
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-sm border border-border" data-testid="access-rows">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground sticky top-0">
                <tr><th className="text-left p-2">When</th><th className="text-left p-2">Person</th><th className="text-left p-2">Module</th><th className="text-left p-2">Record</th><th className="text-left p-2">From</th></tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="p-2 whitespace-nowrap">{new Date(r.viewedAt).toLocaleString("en-US")}</td>
                    <td className="p-2">{r.name}{r.veritasSupport ? <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">Veritas support</span> : null}</td>
                    <td className="p-2">{r.module}</td>
                    <td className="p-2 font-mono text-xs break-all" title={r.path}>{r.entityId ? `#${r.entityId}` : r.path.replace(/^\/api\/labs\/\d+\//, "")}</td>
                    <td className="p-2 font-mono text-xs">{r.ipAddress || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Veritas support access (docs/design/VLS_Support_Access_Design.docx). Every
// member sees whether Veritas support can reach this lab, who that is, and what
// Veritas changed here; only the owner can turn it off or on.
interface VlsSupportResponse {
  enabled: boolean;
  people: Array<{ name: string }>;
  activity: Array<{ created_at: string; method: string; path: string; status: number | null; note?: string | null; who: string | null }>;
  canToggle: boolean;
  viewerIsVlsSupport: boolean;
}
const VLS_VERB: Record<string, string> = { POST: "Added", PUT: "Changed", PATCH: "Changed", DELETE: "Removed" };
// Plain words for what a Veritas change touched. Most specific path first.
const VLS_THINGS: Array<[RegExp, string]> = [
  [/^\/qc\/period-reviews\/md-cosign/, "the medical director QC co-sign"],
  [/^\/qc\/period-reviews/, "the monthly QC review sign-off"],
  [/^\/qc\/control-lots\/\d+\/establish/, "a QC lot's established mean and SD"],
  [/^\/qc\/control-lots/, "a QC control lot"],
  [/^\/qc\/results/, "a QC result"],
  [/^\/qc\/rule-settings|^\/qc\/settings/, "QC rule settings"],
  [/^\/qc/, "VeritaQC"],
  [/^\/medical-director/, "the medical director designation"],
  [/^\/transfer-ownership/, "lab ownership"],
  [/^\/vls-support/, "Veritas support access"],
  [/^\/members\/\d+\/name/, "a member's name"],
  [/^\/members\/\d+\/email/, "a member's email"],
  [/^\/members/, "lab members"],
  [/^\/veritamap/, "VeritaMap"],
  [/^\/competency|^\/veritacomp/, "VeritaComp"],
  [/^\/veritascan/, "VeritaScan"],
  [/^\/staff/, "VeritaStaff"],
  [/^\/equipment/, "VeritaMaintain"],
  [/^\/veritatrack/, "VeritaTrack"],
  [/^\/veritastock/, "VeritaStock"],
  [/^\/veritapolicy/, "VeritaPolicy"],
  [/^\/studies|^\/veritacheck/, "VeritaCheck"],
  [/^\/findings/, "VeritaResponse"],
  [/^\/iqcp/, "the IQCP"],
  [/^\/pt\//, "VeritaPT"],
  [/^\/seat-invites|^\/staff-portal-invites/, "invitations"],
  [/^\/director-delegations/, "a medical director delegation"],
];
function vlsActivityLabel(method: string, path: string, refused: boolean, note?: string | null): string {
  // A refused attempt carries the exact reason the server recorded.
  if (refused && note) return `Tried to ${note} (refused)`;
  const thing = VLS_THINGS.find(([re]) => re.test(path))?.[1] || "lab settings";
  // Failed for another reason (validation, seat limit): not a Veritas refusal.
  if (refused) return `Tried to change ${thing} (did not go through)`;
  return `${VLS_VERB[method] || "Changed"} ${thing}`;
}
function VeritasSupportCard({ labId }: { labId: number }) {
  const { toast } = useToast();
  const [showActivity, setShowActivity] = useState(false);
  const key = `/api/labs/${labId}/vls-support`;
  const { data } = useQuery<VlsSupportResponse>({ queryKey: [key], queryFn: getQueryFn({ on401: "throw" }), enabled: !!labId });
  const toggle = useMutation({
    mutationFn: async (enabled: boolean) => (await apiRequest("PATCH", key, { enabled })).json(),
    onSuccess: (_d, enabled) => { toast({ title: enabled ? "Veritas support access turned on" : "Veritas support access turned off" }); queryClient.invalidateQueries({ queryKey: [key] }); },
    onError: (err: any) => toast({ title: "Could not change Veritas support access", description: String(err?.message || err), variant: "destructive" }),
  });
  if (!data) return null;
  const names = data.people.map((p) => p.name).join(", ");
  return (
    <Card data-testid="vls-support-card">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><ShieldCheck size={16} /> Veritas support access</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p data-testid="vls-support-status">
          <strong>{data.enabled ? "On" : "Off"}</strong>
          {data.enabled && names ? ` (${names})` : ""}
        </p>
        <p className="text-muted-foreground">
          Veritas Lab Services staff can help with setup in this lab: building maps, adding control lots, fixing settings. They are not one of your seats, are never billed, and never sign anything for the lab. Every change they make is listed below.
        </p>
        {data.viewerIsVlsSupport && (
          <p className="text-muted-foreground" data-testid="vls-support-viewer-note">You are here as Veritas support. Signatures, attestations, approvals and ownership stay with the lab.</p>
        )}
        <div className="flex flex-wrap gap-2">
          {data.canToggle && (
            <Button size="sm" variant={data.enabled ? "outline" : "default"} data-testid="vls-support-toggle" disabled={toggle.isPending} onClick={() => toggle.mutate(!data.enabled)}>
              {toggle.isPending && <Loader2 className="animate-spin mr-1" size={12} />}
              {data.enabled ? "Turn off Veritas support access" : "Turn on Veritas support access"}
            </Button>
          )}
          <Button size="sm" variant="ghost" data-testid="vls-support-activity-btn" onClick={() => setShowActivity((v) => !v)}>
            {showActivity ? "Hide" : "Show"} what Veritas changed ({data.activity.length})
          </Button>
        </div>
        {showActivity && (
          data.activity.length === 0 ? (
            <p className="text-muted-foreground" data-testid="vls-support-activity-empty">No changes by Veritas support in this lab.</p>
          ) : (
            <ul className="space-y-1" data-testid="vls-support-activity">
              {data.activity.map((a, i) => (
                <li key={i} className="flex flex-wrap gap-x-3 text-xs">
                  <span className="text-muted-foreground">{String(a.created_at).replace("T", " ").slice(0, 16)}</span>
                  <span>{a.who || "Veritas support"}</span>
                  <span className={a.status != null && a.status >= 400 ? "text-destructive" : undefined}>{vlsActivityLabel(a.method, a.path, a.status != null && a.status >= 400, a.note)}</span>
                </li>
              ))}
            </ul>
          )
        )}
      </CardContent>
    </Card>
  );
}

interface TeamLocation { labId: number; name: string }
interface TeamMember {
  userId: number; email: string; name: string | null; role: string;
  isOwner: boolean; locationIds: number[]; defaultLocationId: number | null;
}
interface TeamResponse { locations: TeamLocation[]; members: TeamMember[]; owner: number | null }

function MemberLocationsCard({ labId }: { labId: number }) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<TeamResponse>({
    queryKey: [`/api/labs/${labId}/veritastock/team`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!labId,
  });
  const locations = data?.locations || [];
  const members = data?.members || [];

  // Per-member edit state: the set of locations to grant + the default.
  // Seeded from the server data; existing grants stay checked + locked.
  const [edits, setEdits] = useState<Record<number, { checked: number[]; def: number }>>({});
  useEffect(() => {
    if (!members.length) return;
    const next: Record<number, { checked: number[]; def: number }> = {};
    for (const m of members) {
      next[m.userId] = {
        checked: [...m.locationIds],
        def: m.defaultLocationId ?? m.locationIds[0] ?? locations[0]?.labId,
      };
    }
    setEdits(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(members.map((m) => [m.userId, m.locationIds, m.defaultLocationId]))]);

  const saveMutation = useMutation({
    mutationFn: async ({ userId, locationIds, defaultLocationId }: { userId: number; locationIds: number[]; defaultLocationId: number }) => {
      const res = await apiRequest("POST", `/api/labs/${labId}/veritastock/members/${userId}/locations`, { locationIds, defaultLocationId });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Locations updated" });
      queryClient.invalidateQueries({ queryKey: [`/api/labs/${labId}/veritastock/team`] });
      queryClient.invalidateQueries({ queryKey: ["/api/labs/me"] });
    },
    onError: (err: any) => toast({ title: "Update failed", description: String(err?.message || err), variant: "destructive" }),
  });

  // Only meaningful on the VeritaStock deployment with a multi-location enterprise.
  if (!isStockHost()) return null;
  if (isLoading) return null;
  if (locations.length < 2) return null;

  const locName = (id: number) => locations.find((l) => l.labId === id)?.name || `Location ${id}`;

  function toggle(userId: number, locId: number, wasGranted: boolean) {
    if (wasGranted) return; // existing grants are locked (no revoke here)
    setEdits((prev) => {
      const cur = prev[userId] || { checked: [], def: locId };
      const has = cur.checked.includes(locId);
      const checked = has ? cur.checked.filter((x) => x !== locId) : [...cur.checked, locId];
      // keep default valid (within checked)
      const def = checked.includes(cur.def) ? cur.def : (checked[0] ?? locId);
      return { ...prev, [userId]: { checked, def } };
    });
  }

  return (
    <Card data-testid="member-locations-card">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><MapPin size={16} /> Locations &amp; access</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Choose which locations each member can access, and the location they land on by default. A member only sees locations they are granted here. Granting is additive; to remove access to a location, use Remove on that location&apos;s Members page.
        </p>
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-muted">
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="py-2 pr-3">Member</th>
                {locations.map((l) => <th key={l.labId} className="py-2 px-2 text-center">{l.name}</th>)}
                <th className="py-2 px-2">Default</th>
                <th className="py-2 pr-3 text-right">Save</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const e = edits[m.userId] || { checked: m.locationIds, def: m.defaultLocationId ?? m.locationIds[0] };
                const originalSet = new Set(m.locationIds);
                const editedSet = new Set(e.checked);
                const dirty = !m.isOwner && (e.checked.length !== m.locationIds.length || e.checked.some((id) => !originalSet.has(id)) || e.def !== (m.defaultLocationId ?? m.locationIds[0]));
                return (
                  <tr key={m.userId} className="border-b last:border-b-0" data-testid={`member-locations-row-${m.userId}`}>
                    <td className="py-2 pr-3">
                      <div className="font-medium">{m.name || m.email}{m.isOwner && <span className="ml-1 text-xs text-amber-700">(owner)</span>}</div>
                      {m.name && <div className="text-xs text-muted-foreground">{m.email}</div>}
                    </td>
                    {locations.map((l) => {
                      const wasGranted = originalSet.has(l.labId) || m.isOwner;
                      const isChecked = m.isOwner || editedSet.has(l.labId);
                      return (
                        <td key={l.labId} className="py-2 px-2 text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-teal-600"
                            checked={isChecked}
                            disabled={m.isOwner || wasGranted}
                            onChange={() => toggle(m.userId, l.labId, wasGranted)}
                            data-testid={`member-loc-${m.userId}-${l.labId}`}
                            title={m.isOwner ? "The owner has access to every location" : wasGranted ? "Already has access (remove on that location's Members page)" : `Grant access to ${l.name}`}
                          />
                        </td>
                      );
                    })}
                    <td className="py-2 px-2">
                      <select
                        className="h-8 border border-input bg-background rounded-md px-2 text-xs"
                        value={m.isOwner ? (m.defaultLocationId ?? "") : e.def}
                        disabled={m.isOwner}
                        onChange={(ev) => setEdits((prev) => ({ ...prev, [m.userId]: { ...(prev[m.userId] || { checked: e.checked }), def: Number(ev.target.value) } }))}
                        data-testid={`member-default-${m.userId}`}
                      >
                        {(m.isOwner ? m.locationIds : e.checked).map((id) => <option key={id} value={id}>{locName(id)}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pr-3 text-right">
                      {!m.isOwner && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!dirty || saveMutation.isPending || e.checked.length === 0}
                          onClick={() => saveMutation.mutate({ userId: m.userId, locationIds: e.checked, defaultLocationId: e.def })}
                          data-testid={`member-locations-save-${m.userId}`}
                        >
                          {saveMutation.isPending && <Loader2 className="animate-spin mr-1" size={12} />} Save
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
