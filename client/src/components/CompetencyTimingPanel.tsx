// "How competency timing works" (Michael Q74 = 1, plan part C, 2026-10-11). The rule Michael set on 10/11:
// orientation/training documented first; the initial competency before patient testing with no deadline from hire;
// the clock starts at the initial (6-month at initial + 6, 1st annual at initial + 12, then annual); a method or
// instrument added later is reevaluated before reporting. CFR text is quoted verbatim (eCFR 2026-10-01); TJC is
// cited by number only. Collapsed state is a per-viewer convenience in localStorage.
import { useState } from "react";
import { ChevronDown, ChevronUp, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const KEY = "competency_timing_panel_open";

export function CompetencyTimingPanel() {
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(KEY) !== "0"; } catch { return true; }
  });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(KEY, next ? "1" : "0"); } catch {}
  };
  return (
    <Card className="mb-6" data-testid="competency-timing-panel">
      <CardContent className="p-4">
        <button type="button" onClick={toggle} className="w-full flex items-center justify-between text-left" aria-expanded={open} data-testid="competency-timing-toggle">
          <span className="flex items-center gap-2 font-semibold text-sm"><Clock size={16} className="text-primary" /> How competency timing works</span>
          {open ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
        </button>
        {open && (
          <div className="mt-3 space-y-3 text-sm">
            <ol className="space-y-1.5 list-decimal pl-5">
              <li><span className="font-medium">Orientation and training first.</span> They are completed and documented before the initial competency.</li>
              <li><span className="font-medium">Initial competency before patient testing.</span> There is no deadline from the hire date; the person does not test patients until it is done.</li>
              <li><span className="font-medium">The clock starts at the initial.</span> 6-month competency at initial + 6 months, 1st annual at initial + 12 months, then annually. Year one has three competencies. Waived testing: initial, then annually.</li>
              <li><span className="font-medium">New method or instrument later.</span> The person is reevaluated on it before reporting patient results on it.</li>
              <li><span className="font-medium">Existing staff.</span> People already testing before these records: enter their most recent competency; the schedule runs from it.</li>
            </ol>
            <div className="rounded-md bg-muted/50 p-3 text-xs space-y-1.5 text-muted-foreground">
              <p><span className="font-medium text-foreground">Example:</span> hired January 5, initial competency April 6 (three months later). 6-month due October 6; 1st annual due April 6 of the next year; annual after that.</p>
              <p>42 CFR §493.1445(e)(12) / §493.1407(e)(11): "Ensure that prior to testing patients' specimens, all personnel have the appropriate education and experience, receive the appropriate training for the type and complexity of the services offered, and have demonstrated that they can perform all testing operations reliably to provide and report accurate results".</p>
              <p>42 CFR §493.1451(b)(9) / §493.1413(b)(9): "at least semiannually during the first year the individual tests patient specimens. Thereafter, evaluations must be performed at least annually unless test methodology or instrumentation changes, in which case, prior to reporting patient test results, the individual's performance must be reevaluated to include the use of the new test methodology or instrumentation."</p>
              <p>The Joint Commission: HR.01.04.01 and HR.01.06.01 (see the current TJC standard).</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
