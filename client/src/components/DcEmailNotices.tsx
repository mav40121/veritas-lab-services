// DcEmailNotices.tsx
//
// The VeritaDC email notices a lab can turn on (B13; server/policyNotices.ts sends them, server/policyDocumentControl.ts holds the
// choice). Both are off until the lab's owner or an admin turns one on; everyone else sees what is on.

import { useMutation, useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage, apiRequest, getQueryFn, queryClient } from "@/lib/queryClient";

interface Settings { approvalEmails: boolean; overdueEmails: boolean; overdueDays: number; dayChoices: number[]; canEdit: boolean }

export function DcEmailNotices({ labId }: { labId: number }) {
  const { toast } = useToast();
  const key = `/api/labs/${labId}/veritapolicy/settings/email-notices`;
  const { data } = useQuery<Settings>({ queryKey: [key], queryFn: getQueryFn({ on401: "throw" }), refetchOnMount: "always" });
  const save = useMutation({
    mutationFn: async (body: Partial<Settings>) => (await apiRequest("PUT", key, body)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [key] });
      toast({ title: "Saved" });
    },
    onError: (e) => toast({ title: "Not saved", description: apiErrorMessage(e, "Try again."), variant: "destructive" }),
  });
  if (!data) return null;
  const locked = !data.canEdit || save.isPending;
  return (
    <div className="border rounded p-3 space-y-3" data-testid="email-notices">
      <div>
        <div className="font-medium text-sm">Email notices</div>
        <p className="text-xs text-muted-foreground">
          Both are off until the lab's owner or an admin turns them on. They go only to people with an active login.
          {!data.canEdit && " Ask your owner or an admin to change them."}
        </p>
      </div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm">Waiting for approval</div>
          <p className="text-xs text-muted-foreground">
            When a document reaches an approval step, email the person who signs it, or each member of its group. One email per
            step each time it is submitted. Someone standing in for a reviewer gets it too.
          </p>
        </div>
        <Switch checked={data.approvalEmails} disabled={locked} onCheckedChange={(v) => save.mutate({ approvalEmails: v })} aria-label="Email approvers" data-testid="notice-approvals" />
      </div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm">Overdue read-and-sign</div>
          <p className="text-xs text-muted-foreground">
            Email each person the documents they are overdue to sign, and each document's owner how many people are overdue.
            Never more than one email to a person in 7 days.
          </p>
        </div>
        <Switch checked={data.overdueEmails} disabled={locked} onCheckedChange={(v) => save.mutate({ overdueEmails: v })} aria-label="Email overdue read-and-sign" data-testid="notice-overdue" />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>A document with no due date is overdue</span>
        <Select value={String(data.overdueDays)} onValueChange={(v) => save.mutate({ overdueDays: Number(v) })} disabled={locked}>
          <SelectTrigger className="h-8 w-28 text-xs" aria-label="Days until overdue" data-testid="notice-days"><SelectValue /></SelectTrigger>
          <SelectContent>
            {data.dayChoices.map((d) => <SelectItem key={d} value={String(d)}>{d} days</SelectItem>)}
          </SelectContent>
        </Select>
        <span>after someone first owes it.</span>
      </div>
    </div>
  );
}
