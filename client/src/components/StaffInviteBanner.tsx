// client/src/components/StaffInviteBanner.tsx
//
// A lab has invited this person to its read-and-sign staff login (B3, BUG-193, 2026-11-24). Nothing is granted until they accept here or
// from the emailed link. Accepting adds the lab to their switcher and opens it; what they can do in any other lab doesn't change.
import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import { setActiveLabId } from "@/lib/auth";
import { isStockHost } from "@/lib/host";

export interface StaffInvite { id: number; labName: string; invitedAt: string; expiresAt: string }
const KEY = "/api/me/staff-invites";

/** After accepting: the new lab is in the switcher, and the person is looking at it. */
export async function openAcceptedLab(labId: number, navigate: (to: string) => void): Promise<void> {
  setActiveLabId(labId);
  queryClient.invalidateQueries({ queryKey: [KEY] });
  await Promise.all([
    queryClient.refetchQueries({ queryKey: ["/api/labs/me"] }),
    queryClient.refetchQueries({ queryKey: ["/api/auth/me"] }),
  ]);
  navigate(`/labs/${labId}/${isStockHost() ? "veritastock" : "dashboard"}`);
}

export function StaffInviteBanner() {
  const { isLoggedIn, user } = useAuth();
  const [location, navigate] = useLocation();
  const { toast } = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  const { data } = useQuery<StaffInvite[]>({ queryKey: [KEY], enabled: isLoggedIn && !!user, refetchOnMount: "always" });

  // The join page shows the same invitation itself.
  if (!isLoggedIn || !Array.isArray(data) || data.length === 0 || location.startsWith("/join")) return null;

  async function answer(inv: StaffInvite, verb: "accept" | "decline") {
    if (verb === "decline" && !window.confirm(`Decline the staff login at ${inv.labName}? The lab can invite you again.`)) return;
    setBusy(inv.id);
    try {
      const r = await (await apiRequest("POST", `${KEY}/${inv.id}/${verb}`, {})).json();
      if (verb === "accept") {
        toast({ title: `You're on staff at ${inv.labName}`, description: "Switch labs from the lab menu at the top." });
        await openAcceptedLab(Number(r.labId), navigate);
      } else {
        queryClient.invalidateQueries({ queryKey: [KEY] });
      }
    } catch (err) {
      toast({ title: apiErrorMessage(err, "That didn't work. Try again."), variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: [KEY] });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="border-b border-border bg-card" data-testid="staff-invite-banner">
      <div className="max-w-7xl mx-auto px-4 divide-y divide-border">
        {data.map((inv) => (
          <div key={inv.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-3" data-testid={`staff-invite-${inv.id}`}>
            <UserPlus size={16} className="text-primary shrink-0 hidden sm:block" />
            <p className="text-sm flex-1 min-w-0">
              <span className="font-medium break-words">{inv.labName}</span> invited you to a staff login (read and sign). Your access in other labs stays as it is.
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <Button size="sm" disabled={busy != null} onClick={() => answer(inv, "accept")} data-testid={`staff-invite-accept-${inv.id}`}>
                {busy === inv.id ? "Working..." : "Accept"}
              </Button>
              <Button size="sm" variant="outline" disabled={busy != null} onClick={() => answer(inv, "decline")} data-testid={`staff-invite-decline-${inv.id}`}>
                Decline
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
