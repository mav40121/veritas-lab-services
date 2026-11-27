// client/src/components/MethodSignOffPanel.tsx
//
// Per-method sign-off (2026-10-13, Michael Q156/Q158): sign ONE method's competency for one person, from the person
// page (By tech) or the instrument page (By instrument). Shows the method's sign-off history and next due date, who can
// sign it (from shared/competencySignoff.ts), and Unlock for the most recent sign-off. The server re-checks every rule.
// "View signed entries" (and each earlier sign-off) opens the entries the method was signed on, read-only (SignedEntries,
// Michael 2026-11-02).
// B5 (signatures mock 2, 2026-11-27; shared/competencyObservation.ts): the evaluator signs as themselves, with their own name
// and password or their hospital sign-in (SignaturePrompt), matched by the server to their own VeritaStaff™ person
// (useCompetencySigner), dated today. "Enter a sign-off from paper instead" (Q1 = 1) is for someone with edit on VeritaComp™: the
// paper's evaluator from the list, where the paper is, and the record keeps who entered it. A Pass waits for the observer's own
// signature on Elements 1 and 4 entered after this went live (Q2 = 1). Unlock asks a reason. Each sign-off says how it was signed.
//   POST /api/labs/:labId/competency/employee/:employeeId/test-system/:instrumentId/sign
//   POST /api/labs/:labId/competency/employee/:employeeId/test-system/:instrumentId/signoffs/:signoffId/revoke
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { MILESTONE_LABEL, MONTH_NAMES, initialsOf, milestonesForComplexity, type MethodMilestone, type SignerOption } from "@shared/competencySignoff";
import { NEEDS_REVIEW } from "@shared/competencyStatus";
import { howSignedText, fingerprintGroups, UNLOCK_REASON_MAX, type ObserverState } from "@shared/competencyObservation";
import SignedEntries from "@/components/SignedEntries";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SignaturePrompt, useSignatureCredential } from "@/components/SignaturePrompt";
import { useCompetencySigner, refreshCompetencyReads } from "@/hooks/useCompetencySigner";
import { labDayOf } from "@/lib/labDate";

// BUG-051 (2026-10-14): the Overall Determination from the whole-record form, now on each method's sign-off.
export type Determination = "pass" | "fail" | "remediation";
export const DETERMINATION_LABEL: Record<Determination, string> = { pass: "Pass", fail: "Fail", remediation: "Remediation Required" };

export interface MethodSignoff {
  id: number | null; legacy: boolean; milestone: MethodMilestone | null; signedDate: string | null;
  signerName: string | null; signerRole: string | null; signerInitials: string | null; documentation: string | null;
  determination?: Determination; remediationPlan?: string | null; remediationTargetDate?: string | null;
  // BUG-120: a record from a named technical program (Bulk Import history or an older program record).
  imported?: boolean; importedFrom?: string | null;
  // A past date loaded through Bulk Import (competency_method_history), which an editor can take back.
  historyId?: number | null;
  // Michael 2026-11-02: the entries the method was signed on, shown read-only (SignedEntries). hasEntries is false for
  // imported history, whose entries live in the program record.
  elements?: Array<{ num: number; status: string; na?: boolean; naJustification?: string; observerName?: string | null; observer?: ObserverState | null; [k: string]: any }>;
  waivedPassed?: number | null;
  waivedMethods?: Array<{ num: number; name: string; date: string; status: string; evidence?: string; initials?: string; passed?: boolean }>;
  hasEntries?: boolean;
  // B5: how it was signed, when, and the server's fingerprint of the entries.
  signedWith?: string | null; provider?: string | null; signedAt?: string | null; signedAtText?: string | null;
  fromPaper?: boolean; paperLocation?: string | null; recordedByName?: string | null; recordedDate?: string | null;
  fingerprint?: string | null; fingerprintHolds?: boolean | null;
}
export interface MethodSignState {
  instrumentId: number; instrumentName: string; complexity: string; waived?: boolean; department?: string | null;
  // signable: a sign-off of some kind can be recorded (Fail and Remediation Required allow unmarked entries). readyToSign: it can be
  // signed as a Pass. needsReview: complete but with entries nobody has marked. passBlockMessage: why a Pass is refused, the
  // server's own text (Michael Q179 = 1).
  signable: boolean; readyToSign?: boolean; needsReview?: boolean; passBlockMessage?: string | null;
  // B5, Q2 = 1: Elements 1 and 4 waiting for their observer's own signature, and the server's text for why a Pass waits.
  observersWaiting?: Array<{ num: number; observerName: string | null }>; observerPassBlock?: string | null;
  complete: boolean; hasData: boolean; fromLegacyProgram?: boolean;
  signoffs: MethodSignoff[]; lastSignoff: MethodSignoff | null; needsRemediation?: boolean;
  elements?: Array<{ num: number; status: string; na?: boolean; observer?: ObserverState | null; samples?: Array<{ acceptable: boolean | null }> }>;
  waivedMethods?: Array<{ num: number; name: string; status: string }>;
  nextMilestone: MethodMilestone; nextDue: { targetDate: string | null; latest: string | null; naturalTargetDate?: string | null; annualMonth?: number | null } | null;
  overdue: boolean; signedCurrent: boolean; signers: SignerOption[];
  groupId?: number | null; groupMembers?: Array<{ id: number; name: string }> | null;
}

const ROLE_NAME: Record<string, string> = { LD: "Laboratory Director", TC: "Technical Consultant", TS: "Technical Supervisor", GS: "General Supervisor" };
const RULE_TEXT: Record<string, string> = {
  MODERATE: "Moderate complexity: a technical consultant or technical supervisor for the specialty, or the laboratory director, can sign (42 CFR 493.1413(b)(8), 493.1407(a)).",
  HIGH: "High complexity: a technical supervisor, a general supervisor with a signed delegation for competency, or the laboratory director can sign (42 CFR 493.1451(b)(8), 493.1463(b)(4), 493.1445(a)).",
  WAIVED: "Waived: a general supervisor, technical consultant, technical supervisor or the laboratory director can sign.",
  UNSPECIFIED: "Complexity is not set for this instrument in VeritaMap®: a technical consultant, technical supervisor or the laboratory director can sign.",
};
const fmt = (iso: string | null | undefined) => {
  if (!iso) return "";
  const [y, m, d] = labDayOf(iso).split("-");
  return y && m && d ? `${m}/${d}/${y}` : iso;
};
const localToday = () => new Date().toLocaleDateString("en-CA");
const optKey = (o: SignerOption) => (o.staffEmployeeId != null ? `e${o.staffEmployeeId}` : `md`);
const elementList = (nums: number[]) => (nums.length === 1 ? `Element ${nums[0]}` : `Elements ${nums.slice(0, -1).join(", ")} and ${nums[nums.length - 1]}`);

export function signoffSummary(ts: MethodSignState): { label: string; tone: "green" | "teal" | "amber" | "red" | "muted" } {
  const last = ts.lastSignoff;
  if (last && ts.needsRemediation && !ts.signable) {
    const what = last.milestone ? MILESTONE_LABEL[last.milestone] : "Competency";
    return last.determination === "fail" ? { label: `${what} failed`, tone: "red" } : { label: `${what}: remediation required`, tone: "amber" };
  }
  if (last && ts.overdue) return { label: `${ts.nextMilestone ? MILESTONE_LABEL[ts.nextMilestone] : "Next"} overdue`, tone: "red" };
  if (ts.needsReview) return { label: `${MILESTONE_LABEL[ts.nextMilestone]} needs review`, tone: "amber" };
  if (ts.signable && ts.observersWaiting?.length) return { label: `${MILESTONE_LABEL[ts.nextMilestone]} waiting for the observer`, tone: "amber" };
  if (ts.signable) return { label: `${MILESTONE_LABEL[ts.nextMilestone]} ready to sign`, tone: "teal" };
  if (last) return { label: last.legacy ? `Signed ${fmt(last.signedDate)}` : `${MILESTONE_LABEL[last.milestone as MethodMilestone]} signed ${fmt(last.signedDate)}`, tone: "green" };
  if (ts.hasData) return { label: `${MILESTONE_LABEL[ts.nextMilestone]} in progress`, tone: "amber" };
  return { label: "Not started", tone: "muted" };
}

/** The observers who have signed this method's working entries, grouped by person: "Elements 1 and 4 signed by Casey Tate, TC, ...". */
function observerSignedLines(ts: MethodSignState): string[] {
  const by = new Map<string, { nums: number[]; text: string }>();
  for (const e of ts.elements || []) {
    const s = e.observer?.signed;
    if (!s) continue;
    const key = `${s.name}|${s.signedAtText}`;
    const cur = by.get(key) || { nums: [], text: `${s.name}${s.role ? `, ${s.role}` : ""}, ${s.signedAtText}` };
    cur.nums.push(e.num);
    by.set(key, cur);
  }
  return Array.from(by.values()).map((v) => `${elementList(v.nums)} signed by ${v.text}.`);
}

// part: "status" = the signed banner only (top of the method), "sign" = the sign form only (under the elements), "all" = both.
// openSignoffId: open that sign-off's entries on arrival (a row on the Signed competencies list links here with it).
// readOnly: the viewer can't change the record (no paper entry, no unlock). Someone who may sign the method still signs as
// themselves (Q3 = 1); the server decides.
export default function MethodSignOffPanel({ labId, employeeId, employeeName, ts, readOnly, onChanged, part = "all", openSignoffId }: {
  labId: number | string; employeeId: number; employeeName: string; ts: MethodSignState; readOnly: boolean; onChanged: () => void;
  part?: "status" | "sign" | "all"; openSignoffId?: number | null;
}) {
  const showStatus = part !== "sign";
  const showSign = part !== "status";
  const { toast } = useToast();
  const qc = useQueryClient();
  const firstName = employeeName.split(" ")[0] || employeeName;
  const { data: signerData } = useCompetencySigner(labId);
  const me = signerData?.me ?? null;
  const canRecordPaper = !readOnly && !!signerData?.canRecordPaper;
  const myOption = me ? ts.signers.find((o) => o.staffEmployeeId === me.staffEmployeeId) || null : null;
  const eligible = useMemo(() => ts.signers.filter((o) => o.eligible), [ts.signers]);
  const [mode, setMode] = useState<"self" | "paper">("self");
  const [paperSignerKey, setPaperSignerKey] = useState<string>("");
  const [initials, setInitials] = useState("");
  const [signedDate, setSignedDate] = useState(localToday());
  const [milestone, setMilestone] = useState<MethodMilestone>(ts.nextMilestone);
  const [paperLocation, setPaperLocation] = useState("");
  // Michael Q179 = 1: the evaluator chooses, every time. Nothing stored tells a failure from an entry nobody has marked (passed = 0 is
  // every row's default), so unmarked entries no longer open this on Remediation Required, and it never opens on Pass either.
  const [determination, setDetermination] = useState<Determination | "">("");
  const [remediationPlan, setRemediationPlan] = useState("");
  const [remediationTargetDate, setRemediationTargetDate] = useState("");
  const [typedName, setTypedName] = useState("");
  const cred = useSignatureCredential("competency_method");
  const allowed = milestonesForComplexity(ts.complexity);

  useEffect(() => {
    const first = eligible[0];
    setMode("self");
    setPaperSignerKey(first ? optKey(first) : "");
    setInitials(myOption ? initialsOf(myOption.name) : "");
    setSignedDate(localToday());
    setMilestone(ts.nextMilestone);
    setPaperLocation("");
    setDetermination("");
    setRemediationPlan("");
    setRemediationTargetDate("");
    setTypedName("");
    cred.reset();
  }, [ts.instrumentId, employeeId, ts.nextMilestone, eligible.length, me?.staffEmployeeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const paper = mode === "paper";
  const paperSigner = ts.signers.find((o) => optKey(o) === paperSignerKey) || null;
  const signer = paper ? paperSigner : myOption;
  const notPass = determination === "fail" || determination === "remediation";
  const passBlocked = determination === "pass" && !!ts.passBlockMessage;
  const observerBlocked = determination === "pass" && !paper && !!ts.observerPassBlock;
  // The one stored negative mark: a sample someone marked not acceptable. It is stated as a fact beside the choice, not chosen for them.
  const sampleNotAcceptable = !!ts.elements?.some((e) => e.num === 5 && (e.samples || []).some((s) => s.acceptable === false));
  // A waived method with entries but no Pass: the required-methods rule decides the Pass, so it doesn't block, but it's frozen as signed.
  const waivedUnmarked = (ts.waivedMethods || []).filter((m) => m.status === NEEDS_REVIEW);
  const base = `${API_BASE}/api/labs/${labId}/competency/employee/${employeeId}/test-system/${ts.instrumentId}`;
  const signedLines = observerSignedLines(ts);
  const waiting = ts.observersWaiting || [];
  // The sign form shows for someone who may sign this method as themselves, and for an editor who may enter one from paper.
  const canSignHere = !!myOption?.eligible;
  const showForm = showSign && ts.signable && (canSignHere || canRecordPaper || !readOnly);
  const others = ts.signers.filter((o) => o.eligible && (!myOption || optKey(o) !== optKey(myOption)));
  const cannot = ts.signers.filter((o) => !o.eligible && (!myOption || optKey(o) !== optKey(myOption)));

  const sign = useMutation({
    mutationFn: async () => {
      if (!signer) throw new Error(paper ? "Choose who signed the paper." : "You aren't one of the people who can sign this method.");
      const common = {
        milestone, determination, signerInitials: initials,
        remediationPlan: notPass ? remediationPlan : undefined, remediationTargetDate: notPass ? (remediationTargetDate || undefined) : undefined,
      };
      const body = paper
        ? { ...common, fromPaper: true, paperLocation, signedDate, signerStaffEmployeeId: signer.staffEmployeeId, signerIsMedicalDirector: signer.staffEmployeeId == null }
        : { ...common, typedName, ...cred.body() };
      const r = await fetch(`${base}/sign`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.incomplete?.length ? `${d.error} ${d.incomplete.join("; ")}` : (d.error || `HTTP ${r.status}`));
      return d;
    },
    onSuccess: () => {
      toast({ title: paper ? "Recorded from paper" : "Signed", description: `${ts.instrumentName} ${MILESTONE_LABEL[milestone]} for ${firstName}: ${determination ? DETERMINATION_LABEL[determination] : ""}.` });
      refreshCompetencyReads(qc);
      onChanged();
    },
    onError: (e: any) => { cred.setPassword(""); toast({ title: "Not signed", description: String(e?.message || e), variant: "destructive" }); },
  });
  const [unlocking, setUnlocking] = useState(false);
  const [unlockReason, setUnlockReason] = useState("");
  const unlock = useMutation({
    mutationFn: async (signoffId: number) => {
      const r = await fetch(`${base}/signoffs/${signoffId}/revoke`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ reason: unlockReason }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      return d;
    },
    onSuccess: () => { setUnlocking(false); setUnlockReason(""); toast({ title: "Unlocked", description: `${ts.instrumentName} is open for changes again.` }); refreshCompetencyReads(qc); onChanged(); },
    onError: (e: any) => toast({ title: "Could not unlock", description: String(e?.message || e), variant: "destructive" }),
  });

  const removeHistory = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${API_BASE}/api/labs/${labId}/competency/method-history/${id}`, { method: "DELETE", headers: authHeaders() });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      return d;
    },
    onSuccess: () => { toast({ title: "Date removed", description: `${ts.instrumentName}: the loaded date was taken back.` }); onChanged(); },
    onError: (e: any) => toast({ title: "Could not remove it", description: String(e?.message || e), variant: "destructive" }),
  });

  const last = ts.lastSignoff;
  // Which sign-off's entries are open (read-only, SignedEntries): keyed by id, or by position for one with no id
  // (signed on the whole record, or imported history).
  const viewKey = (s: MethodSignoff, idx: number) => (s.id != null ? `id${s.id}` : `i${idx}`);
  const [viewing, setViewing] = useState<string | null>(null);
  const toggleView = (k: string) => setViewing((cur) => (cur === k ? null : k));
  useEffect(() => {
    setViewing(openSignoffId != null && ts.signoffs.some((s) => s.id === openSignoffId) ? `id${openSignoffId}` : null);
  }, [ts.instrumentId, employeeId, openSignoffId]); // eslint-disable-line react-hooks/exhaustive-deps
  const viewedSignoff = viewing ? ts.signoffs.find((s, i) => viewKey(s, i) === viewing) || null : null;
  const lastNotPass = !!last && !!last.determination && last.determination !== "pass";
  const warn = ts.overdue || lastNotPass;
  const nameOk = typedName.trim().length >= 2;
  const signDisabled = sign.isPending || !determination || passBlocked || observerBlocked || !signer?.eligible || (notPass && !remediationPlan.trim())
    || (paper ? !paperLocation.trim() : (!nameOk || !cred.ready));
  const lbl = "text-[10px] text-muted-foreground uppercase tracking-wide";
  return (
    <div className="space-y-3" data-testid="method-signoff">
      {showStatus && last && (
        <div className={`rounded-md border p-3 text-sm flex items-start justify-between gap-3 flex-wrap ${lastNotPass && last.determination === "remediation" && !ts.overdue ? "border-amber-300 dark:border-amber-800" : warn ? "border-red-300 dark:border-red-800" : "border-emerald-300 dark:border-emerald-800"}`} data-testid="method-signed">
          <div className="flex items-start gap-2 min-w-0">
            {warn ? <AlertTriangle size={16} className={`${lastNotPass && last.determination === "remediation" && !ts.overdue ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"} mt-0.5 shrink-0`} /> : <CheckCircle2 size={16} className="text-emerald-600 mt-0.5 shrink-0" />}
            <div className="min-w-0">
              <div className="font-semibold">
                {last.legacy ? "Signed" : `${MILESTONE_LABEL[last.milestone as MethodMilestone]} signed`} {fmt(last.signedDate)}
                {last.signerName ? ` by ${last.signerName}${last.signerRole ? `, ${ROLE_NAME[last.signerRole] || last.signerRole}` : ""}` : ""}
                {last.determination && <span data-testid="method-determination">: {DETERMINATION_LABEL[last.determination]}</span>}
              </div>
              {!last.imported && (
                <div className="text-xs text-muted-foreground mt-0.5 break-words" data-testid="method-how-signed">
                  {howSignedText(last)}{last.signedAtText && !last.fromPaper ? `, ${last.signedAtText}` : ""}
                  {last.fingerprint ? <span data-testid="method-fingerprint">. Record {fingerprintGroups(last.fingerprint)}{last.fingerprintHolds === false ? " (the entries no longer match it)" : ""}</span> : null}
                </div>
              )}
              {lastNotPass && (
                <div className="text-xs mt-1 space-y-0.5" data-testid="method-remediation">
                  <div className="text-amber-700 dark:text-amber-400 font-medium">{firstName} may not perform patient testing on this method unsupervised until remediation is complete and the {MILESTONE_LABEL[ts.nextMilestone].toLowerCase()} is signed again with Pass.</div>
                  {last.remediationPlan && <div className="text-muted-foreground">Action plan: {last.remediationPlan}</div>}
                  {last.remediationTargetDate && <div className="text-muted-foreground">Target completion: {fmt(last.remediationTargetDate)}</div>}
                </div>
              )}
              {ts.nextDue?.targetDate && (
                <div className={`text-xs mt-0.5 ${ts.overdue ? "text-red-600 font-medium" : "text-muted-foreground"}`} data-testid="method-next-due">
                  {MILESTONE_LABEL[ts.nextMilestone]} due {fmt(ts.nextDue.targetDate)}{ts.overdue ? " (overdue)" : ""}
                  {ts.nextDue.naturalTargetDate && ts.nextDue.annualMonth && (
                    <span data-testid="method-annual-month-note"> (moved earlier into the lab's annual month, {MONTH_NAMES[ts.nextDue.annualMonth - 1]}; {fmt(ts.nextDue.naturalTargetDate)} without it)</span>
                  )}
                </div>
              )}
              {last.legacy && <div className="text-xs text-muted-foreground mt-0.5">Signed on the whole record before per-method sign-off.</div>}
              {last.imported && (
                <div className="text-xs text-muted-foreground mt-0.5" data-testid="method-imported">
                  Imported history from {last.importedFrom}. The next sign-off is recorded on this page.
                  {last.historyId && !readOnly && (
                    <ConfirmDialog title="Remove this date?" message={`Take back the ${last.signedDate} date loaded for ${employeeName} on ${ts.instrumentName}? The due date goes back to what it was without it.`} confirmLabel="Remove" onConfirm={() => removeHistory.mutate(last.historyId as number)}>
                      <button type="button" className="ml-1 underline hover:text-foreground" disabled={removeHistory.isPending} data-testid="method-history-remove">Remove this date</button>
                    </ConfirmDialog>
                  )}
                </div>
              )}
              {ts.signoffs.length > 1 && (
                <div className="text-[11px] text-muted-foreground mt-1" data-testid="method-earlier">
                  Earlier:{" "}
                  {ts.signoffs.slice(1).map((s, i) => (
                    <span key={`${s.id ?? "x"}-${i}`}>
                      {i > 0 ? "; " : ""}
                      <button type="button" className="underline decoration-dotted hover:text-primary" onClick={() => toggleView(viewKey(s, i + 1))}
                        aria-expanded={viewing === viewKey(s, i + 1)} data-testid="method-earlier-view">
                        {`${s.milestone ? MILESTONE_LABEL[s.milestone] : "Signed"} ${fmt(s.signedDate)}${s.determination && s.determination !== "pass" ? ` ${DETERMINATION_LABEL[s.determination]}` : ""}${s.signerName ? ` (${s.signerName})` : ""}`}
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="outline" onClick={() => toggleView(viewKey(last, 0))} aria-expanded={viewing === viewKey(last, 0)} data-testid="method-view-entries">
              {viewing === viewKey(last, 0) ? <ChevronUp className="mr-1" size={12} /> : <ChevronDown className="mr-1" size={12} />} View signed entries
            </Button>
            {!readOnly && last.id != null && !ts.hasData && (
              <Button size="sm" variant="outline" onClick={() => setUnlocking((u) => !u)} aria-expanded={unlocking} data-testid="method-unlock">Unlock</Button>
            )}
          </div>
          {unlocking && !readOnly && last.id != null && (
            <div className="w-full rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-2.5 space-y-2" data-testid="method-unlock-box">
              <label className={lbl} htmlFor={`unlock-reason-${ts.instrumentId}`}>Why is this sign-off being unlocked? (required)</label>
              <Textarea id={`unlock-reason-${ts.instrumentId}`} className="text-xs" rows={2} maxLength={UNLOCK_REASON_MAX} placeholder="For example: wrong specimen ID entered on Element 1" value={unlockReason} onChange={(e) => setUnlockReason(e.target.value)} data-testid="method-unlock-reason" />
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" onClick={() => unlock.mutate(last.id as number)} disabled={unlock.isPending || !unlockReason.trim()} data-testid="method-unlock-confirm">
                  {unlock.isPending && <Loader2 className="animate-spin mr-1" size={12} />} Unlock {ts.instrumentName}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setUnlocking(false); setUnlockReason(""); }}>Cancel</Button>
              </div>
              <p className="text-[11px] text-muted-foreground">The signed record and the reason stay in the audit trail. The method is signed again once it's corrected.</p>
            </div>
          )}
        </div>
      )}
      {showStatus && viewedSignoff && (
        <div>
          <div className="text-xs font-medium mb-1" data-testid="signed-entries-title">
            {viewedSignoff.legacy ? "Signed" : `${MILESTONE_LABEL[viewedSignoff.milestone as MethodMilestone]} signed`} {fmt(viewedSignoff.signedDate)}
            {viewedSignoff.signerName ? ` by ${viewedSignoff.signerName}${viewedSignoff.signerRole ? `, ${ROLE_NAME[viewedSignoff.signerRole] || viewedSignoff.signerRole}` : ""}` : ""}
            {viewedSignoff.determination ? `: ${DETERMINATION_LABEL[viewedSignoff.determination]}` : ""}
          </div>
          <SignedEntries signoff={viewedSignoff} waived={ts.waived} />
        </div>
      )}

      {showSign && ts.fromLegacyProgram && (
        <p className="text-[11px] text-muted-foreground">These entries come from an earlier program record. Save them on this screen to sign this method.</p>
      )}

      {showSign && !ts.waived && (signedLines.length > 0 || waiting.length > 0) && (
        <div className="space-y-1.5" data-testid="observer-status">
          {signedLines.map((l) => (
            <p key={l} className="text-xs rounded-md border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-900 dark:text-emerald-200 px-2.5 py-1.5" data-testid="observer-signed">{l}</p>
          ))}
          {waiting.length > 0 && (
            <p className="text-xs rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200 px-2.5 py-1.5" data-testid="observer-waiting">
              Waiting for the observer: {waiting.map((w) => `Element ${w.num} (${w.observerName || "no observer named"})`).join(" and ")}. They sign under Observations to sign. A Pass is signed once they have; Fail and Remediation Required can be signed now.
            </p>
          )}
        </div>
      )}

      {showForm && (
        <div className="rounded-lg border-2 border-primary/60 bg-primary/5 p-3 space-y-3" data-testid="method-sign-form">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-sm font-semibold text-primary">{paper ? "Enter a sign-off from paper" : "Sign off this method"}</div>
            {canRecordPaper && (
              <button type="button" className="text-xs underline text-primary" onClick={() => setMode(paper ? "self" : "paper")} data-testid="sign-mode-toggle">
                {paper ? "Sign as yourself instead" : "Enter a sign-off from paper instead"}
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[1.6fr_.9fr] gap-2">
            {paper ? (
              <div>
                <label className={lbl} htmlFor={`paper-signer-${ts.instrumentId}`}>Signed on paper by</label>
                <select id={`paper-signer-${ts.instrumentId}`} className="w-full h-8 text-xs rounded-md border bg-background px-2" value={paperSignerKey} data-testid="paper-signer-select"
                  onChange={(e) => { setPaperSignerKey(e.target.value); const o = ts.signers.find((x) => optKey(x) === e.target.value); if (o) setInitials(initialsOf(o.name)); }}>
                  {!eligible.length && <option value="">No eligible signer on file</option>}
                  {ts.signers.map((o) => (
                    <option key={optKey(o)} value={optKey(o)} disabled={!o.eligible}>{o.name}, {o.roleLabel}{o.eligible ? "" : ` (${o.reason})`}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <div className={lbl}>You sign as</div>
                <div className="min-h-8 text-xs rounded-md border bg-muted/50 px-2 py-1.5 break-words" data-testid="sign-as">
                  {!me ? "Your sign-in isn't linked to a person in VeritaStaff™ in this lab, so it can't sign here. Ask your lab owner to link it."
                    : myOption ? `${myOption.name}, ${myOption.roleLabel}${ts.department ? `, ${ts.department}` : ""}${myOption.eligible ? "" : ` (can't sign: ${myOption.reason})`}`
                    : `${me.name} (can't sign this method: no laboratory director, technical consultant, technical supervisor or general supervisor role in VeritaStaff™)`}
                </div>
              </div>
            )}
            <div>
              <label className={lbl} htmlFor={`milestone-${ts.instrumentId}`}>Competency</label>
              <select id={`milestone-${ts.instrumentId}`} className="w-full h-8 text-xs rounded-md border bg-background px-2" value={milestone} data-testid="milestone-select"
                onChange={(e) => setMilestone(e.target.value as MethodMilestone)}>
                {allowed.map((m) => <option key={m} value={m}>{MILESTONE_LABEL[m]}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl} htmlFor={`signed-date-${ts.instrumentId}`}>Date signed</label>
              {paper
                ? <Input id={`signed-date-${ts.instrumentId}`} type="date" className="h-8 text-xs" value={signedDate} max={localToday()} onChange={(e) => setSignedDate(e.target.value)} data-testid="signed-date" />
                : <div className="h-8 text-xs rounded-md border bg-muted/50 px-2 flex items-center" data-testid="signed-date-today">{fmt(localToday())}, today</div>}
            </div>
            <div className="grid grid-cols-[1fr_5rem] gap-2">
              <div>
                <label className={lbl} htmlFor={`determination-${ts.instrumentId}`}>Overall determination</label>
                <select id={`determination-${ts.instrumentId}`} className={`w-full h-8 text-xs rounded-md border px-2 ${determination === "pass" || determination === "" ? "bg-background" : determination === "fail" ? "bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-800" : "bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800"}`}
                  value={determination} data-testid="determination-select" onChange={(e) => setDetermination(e.target.value as Determination)}>
                  <option value="" disabled>Choose one</option>
                  {(["pass", "fail", "remediation"] as const).map((d) => <option key={d} value={d}>{DETERMINATION_LABEL[d]}</option>)}
                </select>
              </div>
              <div>
                <label className={lbl} htmlFor={`initials-${ts.instrumentId}`}>Initials</label>
                <Input id={`initials-${ts.instrumentId}`} className="h-8 text-xs" value={initials} maxLength={6} onChange={(e) => setInitials(e.target.value)} data-testid="signer-initials" />
              </div>
            </div>
          </div>
          {ts.passBlockMessage && !notPass && (
            <p className={`text-xs rounded-md border p-2 ${passBlocked ? "font-medium text-red-700 dark:text-red-300 border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30" : "text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20"}`} data-testid="pass-blocked">
              {ts.passBlockMessage}
            </p>
          )}
          {observerBlocked && (
            <p className="text-xs rounded-md border p-2 font-medium text-red-700 dark:text-red-300 border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30" data-testid="observer-pass-blocked">{ts.observerPassBlock}</p>
          )}
          {sampleNotAcceptable && (
            <p className="text-xs text-amber-800 dark:text-amber-300" data-testid="sample-not-acceptable">Element 5 has a sample marked not acceptable.</p>
          )}
          {waivedUnmarked.length > 0 && (
            <p className="text-xs text-amber-800 dark:text-amber-300" data-testid="waived-unmarked-note">
              {waivedUnmarked.map((m) => `Method ${m.num}`).join(" and ")} {waivedUnmarked.length === 1 ? "has an entry" : "have entries"} with no Pass. {waivedUnmarked.length === 1 ? "It doesn't" : "They don't"} count toward the required methods and will be kept on the signed record as not passed.
            </p>
          )}
          {notPass && (
            <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-2.5 space-y-2" data-testid="remediation-box">
              <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                {firstName} requires additional training and may not perform patient testing on this method unsupervised until remediation is complete.
              </p>
              <div>
                <label className={lbl}>Action plan (required)</label>
                <Textarea className="text-xs" rows={3} placeholder="Retraining, observation and reassessment planned..." value={remediationPlan} onChange={(e) => setRemediationPlan(e.target.value)} data-testid="remediation-plan" />
              </div>
              <div>
                <label className={lbl}>Target completion date</label>
                <Input type="date" className="h-8 text-xs w-44" value={remediationTargetDate} onChange={(e) => setRemediationTargetDate(e.target.value)} data-testid="remediation-target-date" />
              </div>
            </div>
          )}
          {paper ? (
            <div className="space-y-2">
              <div>
                <label className={lbl} htmlFor={`paper-location-${ts.instrumentId}`}>Where the signed paper is kept (required)</label>
                <Input id={`paper-location-${ts.instrumentId}`} className="h-8 text-xs" placeholder="For example: Binder C-4, Chemistry office" maxLength={300} value={paperLocation} onChange={(e) => setPaperLocation(e.target.value)} data-testid="paper-location" />
              </div>
              <p className="text-[11px] text-muted-foreground">The record says From paper, where the paper is, and that you recorded it today. The paper holds the evaluator's and the observer's signatures.</p>
            </div>
          ) : (
            <SignaturePrompt cred={cred} typedName={typedName} onTypedName={setTypedName} layout="grid"
              labels={{ name: "Full name", password: "Your password" }} ids={{ name: `method-sign-name-${ts.instrumentId}`, password: `method-sign-password-${ts.instrumentId}` }}
              testIds={{ name: "method-sign-name", password: "method-sign-password", hospital: "method-sign-hospital" }} />
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <Button size="sm" className="whitespace-normal h-auto min-h-8 py-1.5 text-left" onClick={() => sign.mutate()} disabled={signDisabled} data-testid="sign-method">
              {sign.isPending && <Loader2 className="animate-spin mr-1" size={12} />} {paper ? "Record sign-off from paper" : "Sign"}
            </Button>
            <span className="text-[11px] text-muted-foreground" data-testid="sign-covers">
              {paper ? "Records" : "Signs"} {ts.instrumentName} {MILESTONE_LABEL[milestone].toLowerCase()} for {firstName}{determination ? `: ${DETERMINATION_LABEL[determination]}` : ""}. {ts.groupMembers?.length ? `Covers ${ts.groupMembers.map((m) => m.name).join(" and ")}. ` : ""}Locks this method only.
            </span>
          </div>
          {(others.length > 0 || cannot.length > 0) && (
            <div className="text-[11px] text-muted-foreground space-y-0.5 border-t pt-2" data-testid="signer-others">
              {others.length > 0 && <div><span className="font-semibold text-foreground">Others who can:</span> {others.map((o) => `${o.name}, ${o.roleLabel}`).join("; ")}</div>}
              {cannot.length > 0 && <div><span className="font-semibold text-foreground">Can't:</span> {cannot.map((o) => `${o.name} (${o.reason})`).join(". ")}</div>}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded px-2 py-1.5">
            {RULE_TEXT[ts.complexity] || RULE_TEXT.UNSPECIFIED} Who can sign comes from VeritaStaff&trade; roles. Each person signs as themselves, with their own name and password.
          </p>
        </div>
      )}
      {showSign && !readOnly && !ts.signable && !ts.fromLegacyProgram && (
        <p className="text-[11px] text-muted-foreground" data-testid="method-not-signable">
          {ts.waived
            ? `${last ? `Enter the ${MILESTONE_LABEL[ts.nextMilestone].toLowerCase()} competency below when it is done. ` : ""}Two methods need to be marked Pass, with their dates, before this method can be signed.`
            : last ? `Enter the ${MILESTONE_LABEL[ts.nextMilestone].toLowerCase()} competency below when it is done; it can be signed once every element has data or N/A. A Pass needs every element marked Pass or N/A.`
            : "Every element needs data or N/A before this method can be signed. A Pass needs every element marked Pass or N/A."}
        </p>
      )}
    </div>
  );
}
