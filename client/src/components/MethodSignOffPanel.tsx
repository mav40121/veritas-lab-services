// client/src/components/MethodSignOffPanel.tsx
//
// Per-method sign-off (2026-10-13, Michael Q156/Q158): sign ONE method's competency for one person, from the person
// page (By tech) or the instrument page (By instrument). Shows the method's sign-off history and next due date, the
// "Signed by" list (eligible people first; the rest greyed out with the reason, from shared/competencySignoff.ts), and
// Unlock for the most recent sign-off. The server re-checks every rule.
//   POST /api/labs/:labId/competency/employee/:employeeId/test-system/:instrumentId/sign
//   POST /api/labs/:labId/competency/employee/:employeeId/test-system/:instrumentId/signoffs/:signoffId/revoke
import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { MILESTONE_LABEL, MONTH_NAMES, initialsOf, milestonesForComplexity, type MethodMilestone, type SignerOption } from "@shared/competencySignoff";

export interface MethodSignoff {
  id: number | null; legacy: boolean; milestone: MethodMilestone | null; signedDate: string | null;
  signerName: string | null; signerRole: string | null; signerInitials: string | null; documentation: string | null;
}
export interface MethodSignState {
  instrumentId: number; instrumentName: string; complexity: string;
  signable: boolean; complete: boolean; hasData: boolean; fromLegacyProgram?: boolean;
  signoffs: MethodSignoff[]; lastSignoff: MethodSignoff | null;
  nextMilestone: MethodMilestone; nextDue: { targetDate: string | null; latest: string | null; naturalTargetDate?: string | null; annualMonth?: number | null } | null;
  overdue: boolean; signedCurrent: boolean; signers: SignerOption[];
  groupId?: number | null; groupMembers?: Array<{ id: number; name: string }> | null;
}

const ROLE_NAME: Record<string, string> = { LD: "Laboratory Director", TC: "Technical Consultant", TS: "Technical Supervisor", GS: "General Supervisor" };
const RULE_TEXT: Record<string, string> = {
  MODERATE: "Moderate complexity: a technical consultant or technical supervisor for the specialty, or the laboratory director, can sign (42 CFR 493.1413(b)(8), 493.1407(a)).",
  HIGH: "High complexity: a technical supervisor, a general supervisor with a signed delegation for competency, or the laboratory director can sign (42 CFR 493.1451(b)(8), 493.1463(b)(4), 493.1445(a)).",
  WAIVED: "Waived: a general supervisor, technical consultant, technical supervisor or the laboratory director can sign.",
  UNSPECIFIED: "Complexity is not set for this instrument in VeritaMap™: a technical consultant, technical supervisor or the laboratory director can sign.",
};
const fmt = (iso: string | null | undefined) => {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${m}/${d}/${y}` : iso;
};
const localToday = () => new Date().toLocaleDateString("en-CA");
const optKey = (o: SignerOption) => (o.staffEmployeeId != null ? `e${o.staffEmployeeId}` : `md`);

export function signoffSummary(ts: MethodSignState): { label: string; tone: "green" | "teal" | "amber" | "red" | "muted" } {
  const last = ts.lastSignoff;
  if (last && ts.overdue) return { label: `${ts.nextMilestone ? MILESTONE_LABEL[ts.nextMilestone] : "Next"} overdue`, tone: "red" };
  if (ts.signable) return { label: `${MILESTONE_LABEL[ts.nextMilestone]} ready to sign`, tone: "teal" };
  if (last) return { label: last.legacy ? `Signed ${fmt(last.signedDate)}` : `${MILESTONE_LABEL[last.milestone as MethodMilestone]} signed ${fmt(last.signedDate)}`, tone: "green" };
  if (ts.hasData) return { label: `${MILESTONE_LABEL[ts.nextMilestone]} in progress`, tone: "amber" };
  return { label: "Not started", tone: "muted" };
}

// part: "status" = the signed banner only (top of the method), "sign" = the sign form only (under the elements), "all" = both.
export default function MethodSignOffPanel({ labId, employeeId, employeeName, ts, readOnly, onChanged, part = "all" }: {
  labId: number | string; employeeId: number; employeeName: string; ts: MethodSignState; readOnly: boolean; onChanged: () => void;
  part?: "status" | "sign" | "all";
}) {
  const showStatus = part !== "sign";
  const showSign = part !== "status";
  const { toast } = useToast();
  const firstName = employeeName.split(" ")[0] || employeeName;
  const eligible = useMemo(() => ts.signers.filter((o) => o.eligible), [ts.signers]);
  const [signerKey, setSignerKey] = useState<string>("");
  const [initials, setInitials] = useState("");
  const [signedDate, setSignedDate] = useState(localToday());
  const [milestone, setMilestone] = useState<MethodMilestone>(ts.nextMilestone);
  const [documentation, setDocumentation] = useState("");
  const allowed = milestonesForComplexity(ts.complexity);

  useEffect(() => {
    const first = eligible[0];
    setSignerKey(first ? optKey(first) : "");
    setInitials(first ? initialsOf(first.name) : "");
    setSignedDate(localToday());
    setMilestone(ts.nextMilestone);
    setDocumentation("");
  }, [ts.instrumentId, employeeId, ts.nextMilestone, eligible.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const signer = ts.signers.find((o) => optKey(o) === signerKey) || null;
  const backdated = signedDate !== localToday();
  const base = `${API_BASE}/api/labs/${labId}/competency/employee/${employeeId}/test-system/${ts.instrumentId}`;

  const sign = useMutation({
    mutationFn: async () => {
      if (!signer) throw new Error("Choose who is signing.");
      const r = await fetch(`${base}/sign`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          signerStaffEmployeeId: signer.staffEmployeeId, signerIsMedicalDirector: signer.staffEmployeeId == null,
          signerInitials: initials, signedDate, milestone, documentation: backdated ? documentation : undefined,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.incomplete?.length ? `${d.error} ${d.incomplete.join("; ")}` : (d.error || `HTTP ${r.status}`));
      return d;
    },
    onSuccess: () => { toast({ title: "Signed", description: `${ts.instrumentName} ${MILESTONE_LABEL[milestone]} signed for ${firstName}.` }); onChanged(); },
    onError: (e: any) => toast({ title: "Could not sign", description: String(e?.message || e), variant: "destructive" }),
  });
  const unlock = useMutation({
    mutationFn: async (signoffId: number) => {
      const r = await fetch(`${base}/signoffs/${signoffId}/revoke`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      return d;
    },
    onSuccess: () => { toast({ title: "Unlocked", description: `${ts.instrumentName} is open for changes again.` }); onChanged(); },
    onError: (e: any) => toast({ title: "Could not unlock", description: String(e?.message || e), variant: "destructive" }),
  });

  const last = ts.lastSignoff;
  return (
    <div className="space-y-3" data-testid="method-signoff">
      {showStatus && last && (
        <div className={`rounded-md border p-3 text-sm flex items-start justify-between gap-3 flex-wrap ${ts.overdue ? "border-red-300 dark:border-red-800" : "border-emerald-300 dark:border-emerald-800"}`} data-testid="method-signed">
          <div className="flex items-start gap-2">
            {ts.overdue ? <AlertTriangle size={16} className="text-red-600 mt-0.5 shrink-0" /> : <CheckCircle2 size={16} className="text-emerald-600 mt-0.5 shrink-0" />}
            <div>
              <div className="font-semibold">
                {last.legacy ? "Signed" : `${MILESTONE_LABEL[last.milestone as MethodMilestone]} signed`} {fmt(last.signedDate)}
                {last.signerName ? ` by ${last.signerName}${last.signerRole ? `, ${ROLE_NAME[last.signerRole] || last.signerRole}` : ""}` : ""}
              </div>
              {ts.nextDue?.targetDate && (
                <div className={`text-xs mt-0.5 ${ts.overdue ? "text-red-600 font-medium" : "text-muted-foreground"}`} data-testid="method-next-due">
                  {MILESTONE_LABEL[ts.nextMilestone]} due {fmt(ts.nextDue.targetDate)}{ts.overdue ? " (overdue)" : ""}
                  {ts.nextDue.naturalTargetDate && ts.nextDue.annualMonth && (
                    <span data-testid="method-annual-month-note"> (moved earlier into the lab's annual month, {MONTH_NAMES[ts.nextDue.annualMonth - 1]}; {fmt(ts.nextDue.naturalTargetDate)} without it)</span>
                  )}
                </div>
              )}
              {last.legacy && <div className="text-xs text-muted-foreground mt-0.5">Signed on the whole record before per-method sign-off.</div>}
              {ts.signoffs.length > 1 && (
                <div className="text-[11px] text-muted-foreground mt-1">
                  Earlier: {ts.signoffs.slice(1).map((s) => `${s.milestone ? MILESTONE_LABEL[s.milestone] : "Signed"} ${fmt(s.signedDate)}${s.signerName ? ` (${s.signerName})` : ""}`).join("; ")}
                </div>
              )}
            </div>
          </div>
          {!readOnly && last.id != null && !ts.hasData && (
            <Button size="sm" variant="outline" onClick={() => unlock.mutate(last.id as number)} disabled={unlock.isPending} data-testid="method-unlock">
              {unlock.isPending && <Loader2 className="animate-spin mr-1" size={12} />} Unlock
            </Button>
          )}
        </div>
      )}

      {showSign && ts.fromLegacyProgram && (
        <p className="text-[11px] text-muted-foreground">These entries come from an earlier program record. Save them on this screen to sign this method.</p>
      )}

      {showSign && !readOnly && ts.signable && (
        <div className="rounded-lg border-2 border-primary/60 bg-primary/5 p-3 space-y-2" data-testid="method-sign-form">
          <div className="text-sm font-semibold text-primary">Sign off this method</div>
          <div className="grid grid-cols-1 sm:grid-cols-[1.6fr_.9fr] gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Signed by</label>
              <select className="w-full h-8 text-xs rounded-md border bg-background px-2" value={signerKey} data-testid="signer-select"
                onChange={(e) => { setSignerKey(e.target.value); const o = ts.signers.find((x) => optKey(x) === e.target.value); if (o) setInitials(initialsOf(o.name)); }}>
                {!eligible.length && <option value="">No eligible signer on file</option>}
                {ts.signers.map((o) => (
                  <option key={optKey(o)} value={optKey(o)} disabled={!o.eligible}>
                    {o.name}, {o.roleLabel}{o.eligible ? "" : ` (${o.reason})`}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Competency</label>
              <select className="w-full h-8 text-xs rounded-md border bg-background px-2" value={milestone} data-testid="milestone-select"
                onChange={(e) => setMilestone(e.target.value as MethodMilestone)}>
                {allowed.map((m) => <option key={m} value={m}>{MILESTONE_LABEL[m]}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Initials</label>
              <Input className="h-8 text-xs" value={initials} onChange={(e) => setInitials(e.target.value)} data-testid="signer-initials" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Date signed</label>
              <Input type="date" className="h-8 text-xs" value={signedDate} max={localToday()} onChange={(e) => setSignedDate(e.target.value)} data-testid="signed-date" />
            </div>
          </div>
          {backdated && (
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Documentation (required for an earlier date)</label>
              <Input className="h-8 text-xs" placeholder="Where the signed paper record is kept" value={documentation} onChange={(e) => setDocumentation(e.target.value)} data-testid="signed-documentation" />
            </div>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <Button size="sm" onClick={() => sign.mutate()} disabled={sign.isPending || !signer?.eligible || (backdated && !documentation.trim())} data-testid="sign-method">
              {sign.isPending && <Loader2 className="animate-spin mr-1" size={12} />} Sign {ts.instrumentName} {MILESTONE_LABEL[milestone].toLowerCase()} for {firstName}
            </Button>
            <span className="text-[11px] text-muted-foreground" data-testid="sign-covers">{ts.groupMembers?.length ? `Covers ${ts.groupMembers.map((m) => m.name).join(" and ")}. ` : ""}Locks this method only. {firstName}'s other methods stay open.</span>
          </div>
          <p className="text-[11px] text-muted-foreground bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded px-2 py-1.5">
            {RULE_TEXT[ts.complexity] || RULE_TEXT.UNSPECIFIED} The list comes from VeritaStaff&trade; roles; people who cannot sign this method are shown greyed out with the reason.
          </p>
        </div>
      )}
      {showSign && !readOnly && !ts.signable && !ts.fromLegacyProgram && (
        <p className="text-[11px] text-muted-foreground" data-testid="method-not-signable">
          {last ? `Enter the ${MILESTONE_LABEL[ts.nextMilestone].toLowerCase()} competency below when it is done; it can be signed once every element has data or N/A.`
            : "Every element needs data or N/A (two passed methods for waived) before this method can be signed."}
        </p>
      )}
    </div>
  );
}
