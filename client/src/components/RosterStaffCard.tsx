// Everyone on the VeritaStaff roster, shown on Lab Members as staff of the lab (Michael 2026-11-04: "When staff are added to veritastaff it should also be adding them as a
// staff member"). Inviting from a row uses that person's roster row, so no second row gets made. The roster holds no email, so nobody is contacted until the director types one.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE, getQueryFn } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Row = { employeeId: number; name: string; title: string | null; status: "login" | "invited" | "not_invited"; email: string | null };
type RosterStatus = { people: Row[]; counts: { total: number; login: number; invited: number; not_invited: number } };

export function RosterStaffCard({ labId }: { labId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const key = `/api/labs/${labId}/staff-roster-status`;
  const { data } = useQuery<RosterStatus>({ queryKey: [key], queryFn: getQueryFn({ on401: "throw" }) });
  const [emails, setEmails] = useState<Record<number, string>>({});
  const [sending, setSending] = useState<number | null>(null);
  const [openOnly, setOpenOnly] = useState(true);
  if (!data || data.counts.total === 0) return null;

  async function invite(row: Row) {
    const email = (emails[row.employeeId] || "").trim();
    if (!email.includes("@")) { toast({ title: "Enter their email address", variant: "destructive" }); return; }
    setSending(row.employeeId);
    try {
      const r = await fetch(`${API_BASE}/api/labs/${labId}/staff-portal-invites`, {
        method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ staff_employee_id: row.employeeId, email }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast({ title: "Invite failed", description: j.error || `HTTP ${r.status}`, variant: "destructive" }); return; }
      toast({ title: "Invitation sent", description: j.emailSent === false ? "Invite created. Email delivery failed; share the invite link manually." : `Email sent to ${email}` });
      setEmails((s) => { const n = { ...s }; delete n[row.employeeId]; return n; });
      queryClient.invalidateQueries({ queryKey: [key] });
      queryClient.invalidateQueries({ queryKey: [`/api/labs/${labId}/staff-portal-invites`] });
      queryClient.invalidateQueries({ queryKey: [`/api/labs/${labId}/members`] });
    } finally { setSending(null); }
  }

  const people = openOnly ? data.people.filter((p) => p.status === "not_invited") : data.people;
  return (
    <Card data-testid="roster-staff-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Users size={16} /> Staff from your VeritaStaff roster</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm" data-testid="roster-staff-counts">
            {data.counts.total} on the roster: {data.counts.login} with a login, {data.counts.invited} invited, {data.counts.not_invited} not invited yet
          </div>
          <label className="text-xs text-muted-foreground flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} data-testid="roster-staff-open-only" />
            Only who hasn't been invited
          </label>
        </div>
        <p className="text-xs text-muted-foreground">Everyone you add in VeritaStaff shows up here. Type an address to send a staff login. Nobody is emailed until you do.</p>
        {people.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="roster-staff-none">Everyone on the roster has a login or an invite.</p>
        ) : (
          <div className="border rounded divide-y max-h-96 overflow-y-auto">
            {people.map((p) => (
              <div key={p.employeeId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm" data-testid={`roster-staff-row-${p.employeeId}`}>
                <div className="flex-1 min-w-[10rem]">
                  <div className="font-medium break-words">{p.name}</div>
                  {p.title && <div className="text-xs text-muted-foreground">{p.title}</div>}
                </div>
                {p.status === "not_invited" ? (
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <Input
                      type="email" className="h-8 text-sm flex-1 sm:w-56" placeholder="their@email.com" aria-label={`Email for ${p.name}`}
                      value={emails[p.employeeId] || ""} onChange={(e) => setEmails((s) => ({ ...s, [p.employeeId]: e.target.value }))}
                      data-testid={`roster-staff-email-${p.employeeId}`}
                    />
                    <Button size="sm" onClick={() => invite(p)} disabled={sending === p.employeeId} data-testid={`roster-staff-invite-${p.employeeId}`}>
                      {sending === p.employeeId ? "Sending..." : "Invite"}
                    </Button>
                  </div>
                ) : p.status === "invited" ? (
                  <span className="text-xs text-amber-800 dark:text-amber-300">Invited{p.email ? `: ${p.email}` : ""}</span>
                ) : (
                  <span className="text-xs text-green-800 dark:text-green-300">Has a login</span>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
