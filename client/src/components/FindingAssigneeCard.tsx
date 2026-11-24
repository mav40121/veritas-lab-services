// client/src/components/FindingAssigneeCard.tsx
//
// Who a VeritaResponse finding is assigned to (B6, 2026-11-24; server/inspectionAssign.ts). Everyone who opens
// the finding reads it; someone with edit on VeritaResponse assigns, changes or clears it. It saves on its own, apart from the
// page's Save.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UserRound } from "lucide-react";
import { API_BASE, responseErrorText } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { labDayOf } from "@/lib/labDate";
import { AssignPersonDialog } from "@/components/AssignPersonDialog";

interface AssigneeAnswer {
  assignee: { user_id: number; name: string; on_lab: boolean; assigned_at: string | null; assigned_by: string | null } | null;
  mine: boolean;
  canAssign: boolean;
}

export function FindingAssigneeCard({ labId, findingId, readOnly, onChanged }: { labId: number; findingId: string | number; readOnly: boolean; onChanged?: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);
  const url = `/api/labs/${labId}/findings/${findingId}/assignee`;
  const { data } = useQuery<AssigneeAnswer>({
    queryKey: [url],
    refetchOnMount: "always",
    queryFn: async () => {
      const res = await fetch(`${API_BASE}${url}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(await responseErrorText(res, "Could not load who this is assigned to"));
      return res.json();
    },
  });
  const save = useMutation({
    mutationFn: async (userId: number | null) => {
      const res = await fetch(`${API_BASE}${url}`, { method: "PUT", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ user_id: userId }) });
      if (!res.ok) throw new Error(await responseErrorText(res, "Could not save the assignment"));
      return res.json();
    },
    onSuccess: (r: any) => {
      setPicking(false);
      qc.invalidateQueries({ queryKey: [url] });
      onChanged?.();
      toast(r.assignee
        ? { title: `Assigned to ${r.assignee.name}`, description: r.email === "failed" ? "The email could not be sent. Let them know yourself." : r.email === "sent" ? "They have been emailed." : undefined }
        : { title: "Assignment cleared" });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Assignment not saved", description: e.message }),
  });
  if (!data) return null;
  const a = data.assignee;
  const editable = data.canAssign && !readOnly;
  if (!a && !editable) return null;
  return (
    <Card data-testid="finding-assignee">
      <CardContent className="p-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <UserRound size={16} className="text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-[12rem] text-sm">
          <span className="text-muted-foreground">Assigned to </span>
          <span className="font-medium" data-testid="finding-assignee-name">{a ? `${a.name}${data.mine ? " (you)" : ""}` : "no one"}</span>
          {a && !a.on_lab && <span className="text-amber-700 dark:text-amber-400"> (no longer on this lab, gets no reminders)</span>}
          {a?.assigned_at && (
            <div className="text-xs text-muted-foreground">Assigned {labDayOf(a.assigned_at)}{a.assigned_by ? ` by ${a.assigned_by}` : ""}</div>
          )}
        </div>
        {editable && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setPicking(true)} disabled={save.isPending} data-testid="finding-assign">{a ? "Change" : "Assign"}</Button>
            {a && <Button size="sm" variant="ghost" onClick={() => save.mutate(null)} disabled={save.isPending} data-testid="finding-assign-clear">Clear</Button>}
          </div>
        )}
      </CardContent>
      {picking && (
        <AssignPersonDialog
          labId={labId}
          module="veritaresponse"
          title="Assign this finding"
          note="They get one email, and the due-date reminders while the finding is open."
          currentUserId={a?.user_id ?? null}
          busy={save.isPending}
          onPick={(p) => save.mutate(p.userId)}
          onClose={() => setPicking(false)}
        />
      )}
    </Card>
  );
}
