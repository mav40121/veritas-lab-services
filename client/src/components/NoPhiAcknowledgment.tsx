// client/src/components/NoPhiAcknowledgment.tsx
//
// No-PHI acknowledgment at sign-in (BUG-083, Michael Q66 = 1, 2026-10-28). Mounted once at the app root. An account
// whose acknowledgment is not the person's own click (set up by Veritas, or older than the sign-up checkbox) is asked
// once, with the same words as the sign-up form, and the server records the time of that click
// (server/noPhiAcknowledgment.ts). It cannot be dismissed; the other choice is to sign out. Public marketing pages are
// never covered.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/components/AuthContext";
import { apiRequest } from "@/lib/queryClient";
import { isPublicMarketingPath } from "@/lib/auth";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function NoPhiAcknowledgment() {
  const { user, isLoggedIn, logout } = useAuth();
  const [location, navigate] = useLocation();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;
  const key = ["no-phi-acknowledgment", userId];
  const { data } = useQuery<{ needed: boolean }>({
    queryKey: key,
    queryFn: async () => (await apiRequest("GET", "/api/auth/no-phi-acknowledgment")).json(),
    enabled: isLoggedIn && userId != null,
    staleTime: Infinity,
  });
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const open = isLoggedIn && !!data?.needed && !isPublicMarketingPath(location);
  if (!open) return null;

  async function agree() {
    if (!checked) { setError("Check the box to continue."); return; }
    setSaving(true);
    setError("");
    try {
      await apiRequest("POST", "/api/auth/no-phi-acknowledgment", { acknowledged: true });
      queryClient.setQueryData(key, { needed: false });
    } catch {
      setError("That did not save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AlertDialog open>
      <AlertDialogContent data-testid="no-phi-acknowledgment" onEscapeKeyDown={(e) => e.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>One step before you continue</AlertDialogTitle>
          <AlertDialogDescription>
            Your account does not yet have your own acknowledgment of the no-PHI rule on file. You will only be asked once.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => { setChecked(e.target.checked); if (e.target.checked) setError(""); }}
            className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary shrink-0"
            data-testid="no-phi-acknowledgment-check"
          />
          <span className="text-sm text-foreground leading-relaxed">
            I understand that VeritaAssure&#174; is not a HIPAA-covered platform and is not designed to store, process, or transmit protected health information (PHI). I agree to use only de-identified data, sample IDs, QC lot numbers, and non-patient-identifiable information when entering data into any VeritaAssure&#174; module.
          </span>
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => { logout(); navigate("/login"); }}>Sign out</Button>
          <Button onClick={agree} disabled={saving || !checked} data-testid="no-phi-acknowledgment-agree">
            {saving ? "Saving..." : "I agree"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
