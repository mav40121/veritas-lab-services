// client/src/pages/VeritaQCRulesPage.tsx
//
// VeritaQC QC rules (B12 part 2, QC rules mock 4): which of the app's rules a laboratory uses, for the laboratory or one analyte,
// each on or off and a warning or a rejection, and four of them across levels. Every change is a dated version with a reason and
// who; it reaches runs dated from that day and entered after it. Locked, only the medical director or a designee changes the rules,
// signed through S0's prompt (components/SignaturePrompt.tsx: name and password, or their hospital's sign-in). The rules, their
// wording and the checks live in shared/qcRuleSets.ts; the server is server/qcRuleSets.ts (GET/PUT /api/labs/:labId/qc/rule-settings,
// POST .../lock).
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/components/AuthContext";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { SignaturePrompt, useSignatureCredential } from "@/components/SignaturePrompt";
import { Lock, Unlock, FlaskConical, ArrowLeft } from "lucide-react";
import {
  ACROSS_RULES, COUNT_RANGE, MFR_RANGE_TEXT, QC_RULE_CODES, RULE_TEXT, hasRejectionRule, mdy, ruleChanges,
  type QcRuleCode, type QcRuleSet, type QcSeverity,
} from "@shared/qcRuleSets";

interface VersionView {
  id: number | null; kind: string; analyte: string | null; rules: QcRuleSet; effective_from: string; label: string;
  reason: string | null; note: string | null; changed_by_name: string | null; capacity_label: string | null; signed: boolean; at_label: string | null;
  signed_with: string | null;
}
interface ScopeView { analyte: string | null; own: boolean; version: VersionView; can_change: boolean; sign_as: string | null }
interface HistoryEntry {
  type: "rules" | "lock" | "unlock"; id: number; at_label: string | null; scope: string; kind: string | null; text: string;
  reason: string | null; who: string | null; capacity_label: string | null; signed: boolean; signed_with: string | null;
}
interface Settings {
  today: string;
  lock: { locked: boolean; by: string | null; at_label: string | null; reason: string | null; capacity_label: string | null };
  you: { can_edit: boolean; can_lock: boolean; sign_as: string | null };
  laboratory: ScopeView;
  analytes: ScopeView[];
  history: HistoryEntry[];
  establishing_rules: "westgard" | "range";
}

const clone = (s: QcRuleSet): QcRuleSet => JSON.parse(JSON.stringify(s));
const lower = (s: string | null | undefined) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : "");

const chip = "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap";
const chipTeal = `${chip} border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-800 dark:bg-teal-950/50 dark:text-teal-200`;
const chipGray = `${chip} border-border bg-muted text-muted-foreground`;

export default function VeritaQCRulesPage() {
  const { user, isLoggedIn } = useAuth();
  const activeLabId = useActiveLabId();
  const isMobile = useIsMobile();
  const { toast } = useToast();
  // Same explicit plan allowlist as VeritaQCAppPage (CLAUDE.md §8).
  const hasPlanAccess = !!user && [
    "annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp",
    "clinic", "waived", "community", "hospital", "large_hospital", "enterprise",
  ].includes(user.plan);

  const [data, setData] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [scope, setScope] = useState<string | null>(null);
  const [draft, setDraft] = useState<QcRuleSet | null>(null);
  const [useLab, setUseLab] = useState(false);
  const [reason, setReason] = useState("");
  const [typedName, setTypedName] = useState("");
  const [saving, setSaving] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  const [lockReason, setLockReason] = useState("");
  const [lockName, setLockName] = useState("");
  const [locking, setLocking] = useState(false);
  // The password, or the hospital sign-in asked for again (S0). One each, since a hospital sign-in proof signs once.
  const saveCred = useSignatureCredential("qc_rules");
  const lockCred = useSignatureCredential("qc_rules");

  async function load() {
    if (!activeLabId) return;
    setLoadError(false);
    try {
      const r = await fetch(`${API_BASE}/api/labs/${activeLabId}/qc/rule-settings`, { headers: authHeaders() });
      if (!r.ok) throw new Error(String(r.status));
      setData(await r.json());
    } catch {
      setLoadError(true);
    }
  }
  useEffect(() => { load(); }, [activeLabId]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetEdit = () => { setDraft(null); setUseLab(false); setReason(""); setTypedName(""); saveCred.reset(); };
  const current: ScopeView | null = !data ? null : scope == null ? data.laboratory : data.analytes.find((a) => a.analyte === scope) ?? data.laboratory;
  const labRules = data?.laboratory.version.rules ?? null;
  const shown: QcRuleSet | null = useLab ? labRules : draft ?? current?.version.rules ?? null;
  const changes = useMemo(() => {
    if (!current || !shown) return [];
    return ruleChanges(current.version.rules, shown);
  }, [current, shown]);
  const becomesOwn = !!scope && !!current && !current.own && !!draft;
  const pending = useLab || (!!draft && (changes.length > 0 || becomesOwn));
  const noRejection = !!draft && !hasRejectionRule(draft);
  const locked = !!data?.lock.locked;
  const canChange = !!current?.can_change;

  function edit(fn: (s: QcRuleSet) => void) {
    if (!current || !canChange) return;
    setUseLab(false);
    const next = clone(draft ?? current.version.rules);
    fn(next);
    setDraft(next);
  }

  async function save() {
    if (!activeLabId || !current) return;
    if (!reason.trim()) { toast({ title: "Give the reason for the change", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const r = await fetch(`${API_BASE}/api/labs/${activeLabId}/qc/rule-settings`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          analyte: scope, reason: reason.trim(), expect_version_id: current.version.id,
          ...(useLab ? { use_lab: true } : { rules: draft }),
          ...(locked ? { typed_signature: typedName, ...saveCred.body("snake") } : {}),
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast({ title: body.error || "The change wasn't saved", variant: "destructive" });
        if (body.code === "MOVED") { resetEdit(); load(); }
        return;
      }
      setData(body.settings);
      resetEdit();
      toast({ title: "Saved", description: `Runs dated ${mdy(body.effective_from)} on, entered from now, are judged under these rules.` });
    } catch (e: any) {
      toast({ title: e?.message || "The change wasn't saved", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function toggleLock() {
    if (!activeLabId || !data) return;
    setLocking(true);
    try {
      const r = await fetch(`${API_BASE}/api/labs/${activeLabId}/qc/rule-settings/lock`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ locked: !data.lock.locked, reason: lockReason.trim(), typed_signature: lockName, ...lockCred.body("snake") }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { toast({ title: body.error || "Not saved", variant: "destructive" }); return; }
      setData(body.settings);
      setLockOpen(false); setLockReason(""); setLockName(""); lockCred.reset();
      toast({ title: body.locked ? "The QC rules are locked" : "The QC rules are unlocked" });
    } catch (e: any) {
      toast({ title: e?.message || "Not saved", variant: "destructive" });
    } finally {
      setLocking(false);
    }
  }

  if (!isLoggedIn) {
    return <div className="container max-w-2xl mx-auto py-12 px-4"><Card><CardContent className="py-10 text-center text-sm">Sign in to see your lab's QC rules. <Link href="/login" className="text-primary underline">Sign in</Link></CardContent></Card></div>;
  }
  if (!hasPlanAccess) {
    return <div className="container max-w-2xl mx-auto py-12 px-4"><Card><CardContent className="py-10 text-center text-sm">VeritaQC&#8482; requires a subscription. <Link href="/pricing" className="text-primary underline">See plans</Link></CardContent></Card></div>;
  }
  if (!activeLabId) {
    return <div className="container max-w-2xl mx-auto py-12 px-4"><Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Select a lab to see its QC rules.</CardContent></Card></div>;
  }

  const severityButton = (code: QcRuleCode, sev: QcSeverity, label: string) => {
    const on = shown?.rules[code].severity === sev;
    const tone = sev === "warning"
      ? "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200"
      : "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200";
    return (
      <button
        type="button"
        disabled={!canChange}
        aria-pressed={on}
        data-testid={`qc-rule-${code}-${sev}`}
        onClick={() => edit((s) => { s.rules[code].severity = sev; })}
        className={`px-2 py-0.5 text-xs ${on ? `${tone} font-semibold` : "bg-background text-muted-foreground"} ${sev === "rejection" ? "border-l border-border" : ""} disabled:cursor-default`}
      >{label}</button>
    );
  };

  const textCell = (code: QcRuleCode) => {
    const r = shown!.rules[code];
    if (code !== "N-x" && code !== "N-T") return RULE_TEXT[code];
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Input
          type="number" min={COUNT_RANGE.min} max={COUNT_RANGE.max} disabled={!canChange}
          aria-label={`${code}: how many in a row`} data-testid={`qc-rule-${code}-n`}
          className="h-7 w-16 px-2 text-sm" value={String(r.n ?? "")}
          onChange={(ev) => edit((s) => { s.rules[code].n = Number(ev.target.value); })}
        />
        <span>{RULE_TEXT[code].replace("{n} ", "")}</span>
      </span>
    );
  };
  const useCell = (code: QcRuleCode) => (
    <Switch checked={shown!.rules[code].on} disabled={!canChange} aria-label={`Use ${code}`} data-testid={`qc-rule-${code}-on`}
      onCheckedChange={(v) => edit((s) => { s.rules[code].on = v; if (!v) s.rules[code].across = false; })} />
  );
  const sevCell = (code: QcRuleCode) => shown!.rules[code].on ? (
    <span className="inline-flex overflow-hidden rounded-md border border-border">
      {severityButton(code, "warning", "Warning")}
      {severityButton(code, "rejection", "Rejection")}
    </span>
  ) : <span className="text-muted-foreground">Off</span>;
  const acrossCell = (code: QcRuleCode) => ACROSS_RULES.includes(code) && shown!.rules[code].on ? (
    <Switch checked={shown!.rules[code].across} disabled={!canChange} aria-label={`${code} across levels`} data-testid={`qc-rule-${code}-across`}
      onCheckedChange={(v) => edit((s) => { s.rules[code].across = v; })} />
  ) : <span className="text-muted-foreground">No</span>;
  const mfrText = data ? `${MFR_RANGE_TEXT} ${data.establishing_rules === "range" ? "This lab: on." : "This lab: off (the full rules while it establishes)."}` : "";

  return (
    <div className="container max-w-6xl mx-auto py-6 px-4" data-testid="qc-rules-page">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground mb-0.5">
            <Link href={`/labs/${activeLabId}/veritaqc-app`} className="hover:underline inline-flex items-center gap-1"><ArrowLeft className="h-3 w-3" />VeritaQC&#8482;</Link> / QC rules
          </div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><FlaskConical className="h-6 w-6 text-primary" />QC rules</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Which of the app's rules this laboratory uses, and whether each warns or rejects. A change reaches runs dated from the day it is saved and entered after it. A run already judged stays as judged.
          </p>
        </div>
        {data && (
          <span className={data.lock.locked ? chipTeal : chipGray} data-testid="qc-rules-lock-chip">
            {data.lock.locked ? <Lock className="h-3 w-3 mr-1" /> : <Unlock className="h-3 w-3 mr-1" />}
            {data.lock.locked ? `Locked by ${data.lock.by ?? "the medical director or designee"}, ${data.lock.at_label?.slice(0, 10) ?? ""}` : "Unlocked"}
          </span>
        )}
      </div>

      {loadError ? (
        <Card><CardContent className="py-6 text-sm">
          <p className="text-destructive font-medium mb-2">Couldn't load the QC rules.</p>
          <Button size="sm" variant="outline" onClick={load}>Retry</Button>
        </CardContent></Card>
      ) : !data || !current || !shown ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <div className="space-y-4 min-w-0">
            <Card data-testid="qc-rules-card">
              <CardHeader className="pb-2"><CardTitle className="text-base">The rules, for the laboratory or one analyte</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-1.5 text-sm">
                  <span className="text-muted-foreground mr-1">Applies to</span>
                  {[data.laboratory, ...data.analytes].map((s) => {
                    const name = s.analyte ?? "Laboratory";
                    const on = (s.analyte ?? null) === scope;
                    return (
                      <button key={name} type="button" data-testid={`qc-rules-scope-${name}`}
                        onClick={() => { setScope(s.analyte); resetEdit(); }}
                        className={on ? chipTeal : `${chipGray} hover:bg-accent`}>
                        {name}{s.analyte && s.own ? ", own rules" : ""}
                      </button>
                    );
                  })}
                </div>
                {scope && (
                  <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {useLab ? `${scope} goes back to the laboratory's rules when you save.`
                        : current.own ? `${scope} has its own rules, which replace the laboratory's (${current.version.label}).`
                        : draft ? `Saving gives ${scope} its own rules; the laboratory's no longer reach it.`
                        : `${scope} uses the laboratory's rules.`}
                    </span>
                    {canChange && current.own && !useLab && (
                      <Button size="sm" variant="outline" onClick={() => { setDraft(null); setUseLab(true); }} data-testid="qc-rules-use-lab">Use the laboratory's rules</Button>
                    )}
                    {canChange && !current.own && !draft && (
                      <Button size="sm" variant="outline" onClick={() => setDraft(clone(current.version.rules))} data-testid="qc-rules-own">Give {scope} its own rules</Button>
                    )}
                  </div>
                )}
                {isMobile ? (
                  <div className="divide-y divide-border text-sm" data-testid="qc-rules-table">
                    {QC_RULE_CODES.map((code) => (
                      <div key={code} className="py-2.5 space-y-2" data-testid={`qc-rule-row-${code}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0"><div className="font-semibold">{code}</div><div>{textCell(code)}</div></div>
                          <div className="shrink-0 pt-0.5">{useCell(code)}</div>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
                          <span className="inline-flex items-center gap-2"><span className="text-xs text-muted-foreground">A failure is a</span>{sevCell(code)}</span>
                          <span className="inline-flex items-center gap-2"><span className="text-xs text-muted-foreground">Across levels</span>{acrossCell(code)}</span>
                        </div>
                      </div>
                    ))}
                    <div className="py-2.5"><div className="font-semibold">MFR-range</div><div className="text-muted-foreground">{mfrText}</div></div>
                  </div>
                ) : (
                <div className="overflow-x-auto -mx-1 px-1">
                  <table className="w-full min-w-[560px] text-sm" data-testid="qc-rules-table">
                    <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b">
                      <tr>
                        <th className="py-1.5 pr-2 font-semibold">Rule</th>
                        <th className="py-1.5 pr-2 font-semibold">What it looks for</th>
                        <th className="py-1.5 pr-2 font-semibold">Use</th>
                        <th className="py-1.5 pr-2 font-semibold">A failure is a</th>
                        <th className="py-1.5 font-semibold">Across levels</th>
                      </tr>
                    </thead>
                    <tbody>
                      {QC_RULE_CODES.map((code) => (
                        <tr key={code} className="border-b last:border-b-0 align-middle" data-testid={`qc-rule-row-${code}`}>
                          <td className="py-2 pr-2 font-semibold whitespace-nowrap">{code}</td>
                          <td className="py-2 pr-2">{textCell(code)}</td>
                          <td className="py-2 pr-2">{useCell(code)}</td>
                          <td className="py-2 pr-2">{sevCell(code)}</td>
                          <td className="py-2">{acrossCell(code)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td className="py-2 pr-2 font-semibold whitespace-nowrap">MFR-range</td>
                        <td colSpan={4} className="py-2 text-muted-foreground">{mfrText}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                )}
                <p className="text-xs text-muted-foreground">
                  These are the app's rules; none is added. Across levels starts off for every lab: it pairs a run with the latest accepted run of each other level of the same analyte on the same analyzer that day, each judged against its own mean and SD, and flags the later run. An analyte with its own rules doesn't use the laboratory's.
                </p>
                {!canChange && (
                  <p className="text-xs text-muted-foreground" data-testid="qc-rules-readonly">
                    {locked ? "The rules are locked. Only the medical director, or a technical consultant (moderate complexity) or technical supervisor whose signed Letter of Delegation names \"Establish and maintain the QA and QC programs\", can change them." : "You can see the rules. A VeritaQC™ editor changes them."}
                  </p>
                )}
              </CardContent>
            </Card>

            {pending && (
              <Card data-testid="qc-rules-save-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Saving a change <span className="text-sm font-normal text-muted-foreground">a reason every time{locked ? "; locked, so the director or designee signs" : ""}</span></CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b">
                        <tr><th className="py-1.5 pr-2 font-semibold">Change, {scope ? `${scope} rules` : "laboratory rules"}</th><th className="py-1.5 pr-2 font-semibold">Was</th><th className="py-1.5 font-semibold">Will be</th></tr>
                      </thead>
                      <tbody>
                        {changes.length === 0 ? (
                          <tr><td colSpan={3} className="py-2 text-muted-foreground">{useLab ? "The same rules, from the laboratory's set." : "The same rules as the laboratory's, kept as this analyte's own."}</td></tr>
                        ) : changes.map((c) => (
                          <tr key={c.code} className="border-b last:border-b-0"><td className="py-1.5 pr-2">{c.rule}</td><td className="py-1.5 pr-2">{c.was}</td><td className="py-1.5 font-semibold">{c.willBe}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {noRejection && (
                    <p className="text-sm text-red-700 dark:text-red-300" data-testid="qc-rules-no-rejection">At least one rule must stay on as a rejection, or no run could ever ask for a corrective action.</p>
                  )}
                  <div className="grid gap-3 sm:grid-cols-[1.5fr_1fr]">
                    <div>
                      <Label htmlFor="qc-rules-reason" className="text-xs text-muted-foreground">Reason (required)</Label>
                      <Input id="qc-rules-reason" value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} data-testid="qc-rules-reason" />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Applies to</Label>
                      <div className="min-h-9 rounded-md border border-input bg-muted px-3 py-1.5 text-sm text-muted-foreground" data-testid="qc-rules-applies">Runs dated {mdy(data.today)} on, entered from now</div>
                    </div>
                  </div>
                  {locked ? (
                    <div className="space-y-3" data-phi-guard="off">
                      <SignaturePrompt
                        cred={saveCred} typedName={typedName} onTypedName={setTypedName} layout="grid"
                        labelClassName="text-xs text-muted-foreground" labels={{ name: "Full name", password: "Your password" }}
                        ids={{ name: "qc-rules-name", password: "qc-rules-password" }}
                        testIds={{ name: "qc-rules-name", password: "qc-rules-password", hospital: "qc-rules-sign-with-hospital" }}
                      />
                      <div className="sm:max-w-[50%]"><Label className="text-xs text-muted-foreground">You sign as</Label><div className="min-h-9 rounded-md border border-input bg-muted px-3 py-1.5 text-sm text-muted-foreground" data-testid="qc-rules-sign-as">{current.sign_as ?? ""}</div></div>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button variant="outline" onClick={resetEdit} disabled={saving}>Cancel</Button>
                    <Button onClick={save} disabled={saving || noRejection || !reason.trim() || (locked && (!typedName.trim() || !saveCred.ready))} data-testid="qc-rules-save">
                      {saving ? "Saving..." : locked ? "Sign and save" : "Save"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Unlocked: any VeritaQC&#8482; editor saves with a reason. Locked: an editor sees the screen and can't change it. Turning the lock on or off takes the same signature.</p>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-4 min-w-0">
            <Card data-testid="qc-rules-lock-card">
              <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2">{locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}Lock</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>
                  {locked
                    ? <>Locked by {data.lock.by ?? "the medical director or designee"}{data.lock.capacity_label ? `, ${lower(data.lock.capacity_label)}` : ""}, {data.lock.at_label}.{data.lock.reason ? <> &ldquo;{data.lock.reason}&rdquo;</> : null}</>
                    : "Unlocked: any VeritaQC™ editor can change the rules, with a reason."}
                </p>
                {data.you.can_lock ? (
                  lockOpen ? (
                    <div className="space-y-2">
                      <div><Label htmlFor="qc-lock-reason" className="text-xs text-muted-foreground">Reason (required)</Label><Input id="qc-lock-reason" value={lockReason} onChange={(e) => setLockReason(e.target.value)} data-testid="qc-lock-reason" /></div>
                      <div className="space-y-2" data-phi-guard="off">
                        <SignaturePrompt
                          cred={lockCred} typedName={lockName} onTypedName={setLockName} layout="grid"
                          labelClassName="text-xs text-muted-foreground" labels={{ name: "Full name", password: "Your password" }}
                          ids={{ name: "qc-lock-name", password: "qc-lock-password" }}
                          testIds={{ name: "qc-lock-name", password: "qc-lock-password", hospital: "qc-lock-sign-with-hospital" }}
                        />
                      </div>
                      <div><Label className="text-xs text-muted-foreground">You sign as</Label><div className="min-h-9 rounded-md border border-input bg-muted px-3 py-1.5 text-sm text-muted-foreground" data-testid="qc-lock-sign-as">{data.you.sign_as ?? ""}</div></div>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setLockOpen(false)} disabled={locking}>Cancel</Button>
                        <Button size="sm" onClick={toggleLock} disabled={locking || !lockReason.trim() || !lockName.trim() || !lockCred.ready} data-testid="qc-lock-sign">
                          {locking ? "Saving..." : locked ? "Sign and unlock" : "Sign and lock"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setLockOpen(true)} data-testid="qc-lock-open">{locked ? "Unlock the rules" : "Lock the rules"}</Button>
                  )
                ) : (
                  <p className="text-xs text-muted-foreground">Only the medical director, or a technical consultant (moderate complexity) or technical supervisor whose signed Letter of Delegation names &ldquo;Establish and maintain the QA and QC programs&rdquo;, locks or unlocks the rules.</p>
                )}
              </CardContent>
            </Card>

            <Card data-testid="qc-rules-history">
              <CardHeader className="pb-2"><CardTitle className="text-base">Every change, kept</CardTitle></CardHeader>
              <CardContent>
                <ul className="divide-y divide-border text-sm">
                  {data.history.map((h) => (
                    <li key={`${h.type}-${h.id}`} className="py-2 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
                      <span className="text-muted-foreground whitespace-pre-line text-xs">{h.at_label ? h.at_label.replace(" ", "\n") : "Start"}</span>
                      <span className="min-w-0">
                        <b>{h.type === "rules" ? `${h.scope}.` : ""}</b> {h.text}{h.reason ? <> &ldquo;{h.reason}&rdquo;</> : null}
                        {(h.who || h.capacity_label) && (
                          <span className="block text-xs text-muted-foreground">
                            {[h.who, lower(h.capacity_label)].filter(Boolean).join(", ")}{h.signed ? `, ${h.signed_with ?? "name and password"}` : ""}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

