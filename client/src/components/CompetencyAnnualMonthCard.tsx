// client/src/components/CompetencyAnnualMonthCard.tsx
//
// VeritaComp "Annual competency month" setting (2026-10-13, Michael Q157 = 1; Sampson REQ-057: "I want all my repeat
// annual competencies due the end of October each year"). Optional. A repeat annual already due in that month stays;
// any other moves earlier to the end of the last such month before it, never later. Initial, 6-month and first
// annual are not moved. Saving re-figures the stored VeritaStaff annual due dates for the lab.
//   GET/PUT /api/labs/:labId/competency/annual-month
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CalendarClock, Loader2 } from "lucide-react";
import { MONTH_NAMES } from "@shared/competencySignoff";

export function CompetencyAnnualMonthCard() {
  const activeLabId = useActiveLabId();
  const readOnly = useIsReadOnly("veritacomp");
  const { toast } = useToast();
  const qc = useQueryClient();
  const url = activeLabId ? `/api/labs/${activeLabId}/competency/annual-month` : null;
  const { data } = useQuery<{ month: number | null; staffLabConfigured: boolean }>({
    queryKey: [url ?? "no-lab"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}${url}`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    enabled: !!url,
  });
  const [month, setMonth] = useState<string>("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setMonth(data?.month ? String(data.month) : ""); }, [data?.month]);
  const dirty = (data?.month ? String(data.month) : "") !== month;

  const save = async () => {
    if (!url) return;
    setSaving(true);
    try {
      const r = await fetch(`${API_BASE}${url}`, {
        method: "PUT", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ month: month ? Number(month) : null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      toast({
        title: d.month ? `Annual month set to ${MONTH_NAMES[d.month - 1]}` : "Annual month turned off",
        description: `${d.updated} annual due date${d.updated === 1 ? "" : "s"} re-figured in VeritaStaff™.`,
      });
      qc.invalidateQueries();
    } catch (e: any) {
      toast({ title: "Could not save", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card data-testid="annual-month-card">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <CalendarClock size={16} className="text-primary" />
            <span className="font-semibold text-sm">Annual competency month</span>
            <span className="text-xs text-muted-foreground">(optional)</span>
          </div>
          <div className="flex items-center gap-2">
            <select className="h-8 text-xs rounded-md border bg-background px-2" value={month} disabled={readOnly || !data?.staffLabConfigured}
              onChange={(e) => setMonth(e.target.value)} data-testid="annual-month-select">
              <option value="">Off: each person's own anniversary</option>
              {MONTH_NAMES.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
            </select>
            {!readOnly && (
              <Button size="sm" onClick={save} disabled={!dirty || saving || !data?.staffLabConfigured} data-testid="annual-month-save">
                {saving && <Loader2 className="animate-spin mr-1" size={12} />} Save
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Puts every repeat annual competency due in one month. An annual already due in that month stays where it is. Any
          other moves earlier, to the end of the last such month before it, never later, so nothing goes overdue. Initial,
          6-month and first-annual dates are not moved.
        </p>
        {data && !data.staffLabConfigured && (
          <p className="text-xs text-amber-700 dark:text-amber-400">Set up this lab in VeritaStaff&trade; first; the annual month is kept with its staff records.</p>
        )}
      </CardContent>
    </Card>
  );
}
