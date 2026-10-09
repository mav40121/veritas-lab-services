// VeritaStaff roster prompt (2026-10-08, Michael Q2 option 1). Lists lab members
// who are not on the roster yet. "Add to roster" opens the Add Employee form
// pre-filled from their name (the director confirms title and testing) and ties
// the new entry to their login; "Link to <name>" ties an existing roster entry
// with the same name instead of creating a duplicate; "Not lab personnel" stops
// listing someone who is a member but not lab staff. Veritas support accounts
// are never listed (the server leaves them off).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Link2, EyeOff, ChevronDown, ChevronRight } from "lucide-react";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

export type RosterMember = {
  userId: number;
  name: string | null;
  email: string;
  role: string;
  firstName: string;
  lastName: string;
  match: { employeeId: number; name: string } | null;
};

export const rosterPromptKey = (labId: number) => `/api/labs/${labId}/staff/members-not-on-roster`;

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", staff: "Member" };

export function RosterMembersPrompt({ labId, onAdd }: { labId: number; onAdd: (m: RosterMember) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const key = rosterPromptKey(labId);
  const { data } = useQuery<{ members: RosterMember[]; hidden: RosterMember[] }>({ queryKey: [key] });
  const [showHidden, setShowHidden] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);

  const members = data?.members ?? [];
  const hidden = data?.hidden ?? [];
  if (members.length === 0 && hidden.length === 0) return null;

  async function post(url: string, body: unknown, done: string, userId: number) {
    setBusy(userId);
    try {
      const r = await fetch(`${API_BASE}${url}`, { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      await queryClient.invalidateQueries({ queryKey: [key] });
      await queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).endsWith("/staff/employees") });
      toast({ title: done });
    } catch (err: any) {
      toast({ title: "Could not save", description: err.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  const display = (m: RosterMember) => m.name?.trim() || m.email;

  return (
    <Card className="mb-4 border-primary/30 bg-primary/5" data-testid="roster-prompt">
      <CardContent className="py-4 px-5">
        {members.length > 0 && (
          <>
            <div className="font-semibold text-sm">
              {members.length} lab member{members.length === 1 ? " is" : "s are"} not on the roster yet
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 mb-3">
              They can sign in, but they are not on your personnel record. Add each one and confirm their title and whether they perform testing. The roster entry is linked to their login.
            </p>
            <div className="divide-y divide-border rounded-md border border-border bg-background">
              {members.map((m) => (
                <div key={m.userId} className="flex flex-col sm:flex-row sm:items-center gap-2 px-3 py-2" data-testid={`roster-prompt-row-${m.userId}`}>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{display(m)}</div>
                    <div className="text-xs text-muted-foreground truncate">{m.email} · {ROLE_LABEL[m.role] ?? m.role}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {m.match && (
                      <Button
                        size="sm"
                        disabled={busy === m.userId}
                        onClick={() => post(`/api/labs/${labId}/staff/employees/${m.match!.employeeId}/link-login`, { userId: m.userId }, `Linked to ${m.match!.name}`, m.userId)}
                        data-testid={`roster-link-${m.userId}`}
                      >
                        <Link2 size={14} className="mr-1.5" /> Link to {m.match.name}
                      </Button>
                    )}
                    <Button size="sm" variant={m.match ? "outline" : "default"} disabled={busy === m.userId} onClick={() => onAdd(m)} data-testid={`roster-add-${m.userId}`}>
                      <UserPlus size={14} className="mr-1.5" /> Add to roster
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === m.userId}
                      onClick={() => post(`/api/labs/${labId}/staff/roster-prompt/hidden`, { userId: m.userId, hidden: true }, `${display(m)} will no longer be listed`, m.userId)}
                      title="This person is a member of the lab account but not lab personnel"
                      data-testid={`roster-hide-${m.userId}`}
                    >
                      <EyeOff size={14} className="mr-1.5" /> Not lab personnel
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {hidden.length > 0 && (
          <div className={members.length > 0 ? "mt-3" : ""}>
            <button className="text-xs text-primary hover:underline inline-flex items-center gap-1" onClick={() => setShowHidden(!showHidden)} data-testid="roster-prompt-show-hidden">
              {showHidden ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {hidden.length} member{hidden.length === 1 ? "" : "s"} marked not lab personnel
            </button>
            {showHidden && (
              <div className="mt-2 divide-y divide-border rounded-md border border-border bg-background">
                {hidden.map((m) => (
                  <div key={m.userId} className="flex items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1 text-sm truncate">{display(m)} <span className="text-xs text-muted-foreground">{m.email}</span></div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === m.userId}
                      onClick={() => post(`/api/labs/${labId}/staff/roster-prompt/hidden`, { userId: m.userId, hidden: false }, `${display(m)} is listed again`, m.userId)}
                      data-testid={`roster-unhide-${m.userId}`}
                    >
                      List again
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
