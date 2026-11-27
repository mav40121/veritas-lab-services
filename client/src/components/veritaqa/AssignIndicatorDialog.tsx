// client/src/components/veritaqa/AssignIndicatorDialog.tsx
//
// Assigning an account-wide VeritaQA indicator to the laboratory being worked in (B15; server/veritaqaPi.ts). One confirm that
// names what moves; the server refuses if the count has changed since.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { API_BASE, responseErrorText } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

interface Preview { name: string; lab_name: string | null; entries: number; first: string | null; last: string | null; other_labs: number }

export default function AssignIndicatorDialog({ labId, metricId, onClose, onAssigned }: { labId: number; metricId: number; onClose: () => void; onAssigned: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const url = `/api/labs/${labId}/veritaqa/pi/metrics/${metricId}/assign`;
  const { data, error, refetch } = useQuery<Preview>({
    queryKey: [url], refetchOnMount: "always", gcTime: 0,
    queryFn: async () => {
      const r = await fetch(`${API_BASE}${url}`, { headers: authHeaders() });
      if (!r.ok) throw new Error(await responseErrorText(r, "Could not look this indicator up"));
      return r.json();
    },
  });
  async function assign() {
    if (!data) return;
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}${url}`, { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ expected_entries: data.entries }) });
      if (!r.ok) { const msg = await responseErrorText(r, "Could not assign this indicator"); toast({ title: "Not assigned", description: msg, variant: "destructive" }); refetch(); return; }
      toast({ title: `Assigned to ${data.lab_name || "this laboratory"}` });
      onAssigned();
    } finally { setBusy(false); }
  }
  const lab = data?.lab_name || "this laboratory";
  const entries = data ? (data.entries === 0 ? "It has no entries yet." : `Its ${data.entries} ${data.entries === 1 ? "entry" : "entries"}${data.first ? ` (${data.first}${data.last && data.last !== data.first ? ` to ${data.last}` : ""})` : ""} ${data.entries === 1 ? "goes" : "go"} with it.`) : "";
  const others = data && data.other_labs > 0 ? `It stops showing in the account's ${data.other_labs === 1 ? "other laboratory" : `${data.other_labs} other laboratories`}.` : "";
  return (
    <AlertDialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <AlertDialogContent data-testid="qa-assign-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{data ? `Assign "${data.name}" to ${lab}?` : "Assign this indicator"}</AlertDialogTitle>
          <AlertDialogDescription>
            {error ? (error as Error).message : data ? `${entries} ${others} Check that every one of those numbers is ${lab}'s: this screen has no way to move it back.` : "Looking up what moves..."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={assign} disabled={busy || !data} className="bg-[#01696F] text-white hover:bg-[#015458]" data-testid="qa-assign-confirm">{busy ? "Assigning..." : "Assign"}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
