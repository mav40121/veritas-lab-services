// client/src/components/VerificationPlanAndSignature.tsx
//
// B4 (2026-11-27; mock 1 of the 11/24 signatures mocks; server/verificationSignatures.ts). The Plan tab and the Director or
// Designee Approval tab of a VeritaCheck(R) verification package:
//   - the plan: what each element tests, for which analytes, its acceptance criterion and specimens, written by the lab and signed
//     by the medical director or a designee before testing; a change after signing is a new version
//   - testing before the plan is signed is allowed and marked (BeforePlanNotice)
//   - the finished package: what the signature covers, then the LABORATORY DIRECTOR OR DESIGNEE REVIEW signed with name, password,
//     role and Accepted or Not accepted; a change afterwards keeps the old signature and asks for a new one
// Everything here is read from GET /api/veritacheck/verifications/:id/signing and decided again on the server.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { labLocaleDate, labStampLabel } from "@/lib/labDate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ESignatureForm, postSignature, type SignAs } from "@/components/ESignatureForm";
import { Download } from "lucide-react";

export interface PlanRow { element: string; analyte_ids: number[] | null; tested: string; criterion: string; specimens: string }
export interface PlanVersion {
  id: number; version: number; rows: PlanRow[]; rows_hash: string; created_at: string; updated_at: string;
  signed_at: string | null; typed_signature: string | null; capacity_label: string | null; superseded_at: string | null;
  signed_with: string | null; signed_with_provider: string | null;
}
/** How it was signed (S0's signed_with): "with name and password" or "with <hospital> sign-in". */
const how = (method: string | null | undefined, provider: string | null | undefined) => (method === "sso" ? `with ${provider || "hospital"} sign-in` : "with name and password");
export interface PackageSignatureRow {
  id: number; signed_at: string; typed_signature: string; title: string | null; capacity_label: string; decision: "accepted" | "not_accepted";
  signed_with: string | null; signed_with_provider: string | null; replaces_signature_id: number | null; covers: any;
}
export interface Signing {
  plan: PlanVersion | null; versions: PlanVersion[]; planSigned: boolean; firstSignedAt: string | null;
  required: Array<{ slotId: number; label: string; state: string; date: string | null; passed: number | null }>;
  missing: string[]; beforePlan: Array<{ slotId: number; label: string; date: string }>;
  leftOut: Array<{ element: string; label: string; reason: string }>; units: string[];
  parts: Array<{ key: string; label: string; hash: string }>; fingerprint: string; short: string;
  history: PackageSignatureRow[]; current: boolean; changed: string[];
  covers: { studies: { total: number; signed: number; pass: number } };
  analytes: Array<{ id: number; name: string; lifecycle_state: string }>;
  signAs: SignAs; whoCanSign: Array<{ name: string; role: string }>; analyteSignAs: Record<string, SignAs>;
  legacyApproval: { name: string | null; title: string | null; date: string | null } | null;
}
export interface ElementInfo { key: string; label: string; samples: string }

export const signingKey = (id: number) => [`/api/veritacheck/verifications/${id}/signing`];

export function useVerificationSigning(id: number) {
  return useQuery<Signing>({
    queryKey: signingKey(id),
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/veritacheck/verifications/${id}/signing`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });
}

const AMBER = "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200";
const RED = "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200";
const GREEN = "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200";
const usDay = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}` : d || "");

/** The package's signing state as one chip for the header. */
export function SigningChip({ signing }: { signing: Signing | undefined }) {
  if (!signing) return null;
  if (signing.current) return <Badge variant="outline" className={GREEN} data-testid="chip-package-signed">Signed</Badge>;
  if (signing.history.length) return <Badge variant="outline" className={RED} data-testid="chip-package-changed">Changed since it was signed</Badge>;
  if (!signing.planSigned) return <Badge variant="outline" className={AMBER} data-testid="chip-plan-not-signed">Plan not signed</Badge>;
  return <Badge variant="outline" className={GREEN} data-testid="chip-plan-signed">Plan signed</Badge>;
}

/** Testing before the plan is signed (Q1): allowed, and marked here and on the printed page. */
export function BeforePlanNotice({ signing }: { signing: Signing | undefined }) {
  if (!signing) return null;
  const rows = signing.beforePlan;
  if (signing.planSigned && !rows.length) return null;
  return (
    <div className="space-y-2" data-testid="before-plan-notice">
      {!signing.planSigned && (
        <div className={`rounded-md border px-3 py-2 text-sm ${AMBER}`}>
          This package's plan isn't signed. You can enter results. A study dated before the plan's signature is marked here and on the printed page.
        </div>
      )}
      {rows.length > 0 && (
        <div className="rounded-md border border-border divide-y divide-border/60 bg-card">
          {rows.map((b) => (
            <div key={b.slotId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>{b.label}</span>
              <span className="text-muted-foreground">{usDay(b.date)}</span>
              <Badge variant="outline" className={AMBER}>Before the plan was signed</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function defaultRows(included: string[], info: ElementInfo[]): PlanRow[] {
  return info.filter((e) => included.includes(e.key)).map((e) => ({ element: e.key, analyte_ids: null, tested: "", criterion: "", specimens: e.samples }));
}

/** The Plan tab. */
export function PlanTab({ verificationId, included, elementInfo, signing, readOnly, onChanged }: {
  verificationId: number; included: string[]; elementInfo: ElementInfo[]; signing: Signing; readOnly: boolean; onChanged: () => void;
}) {
  const plan = signing.plan;
  const signed = !!plan?.signed_at;
  const [changing, setChanging] = useState(false);
  // Reset the form only when the stored plan (or, with none, the package's elements) changes, not on every render.
  const planKey = plan ? `${plan.id}:${plan.updated_at}:${plan.signed_at ?? ""}` : `none:${included.join(",")}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const base = useMemo(() => (plan ? plan.rows : defaultRows(included, elementInfo)), [planKey]);
  const [rows, setRows] = useState<PlanRow[]>(base);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setRows(base); }, [base]);
  const editable = !readOnly && (!signed || changing);
  const dirty = JSON.stringify(rows) !== JSON.stringify(plan?.rows ?? null);
  const labelOf = (key: string) => elementInfo.find((e) => e.key === key)?.label ?? key;
  const set = (i: number, patch: Partial<PlanRow>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const toggleAnalyte = (i: number, id: number) => setRows((rs) => rs.map((r, k) => {
    if (k !== i) return r;
    const all = signing.analytes.map((a) => a.id);
    const now = new Set(r.analyte_ids ?? all);
    if (now.has(id)) now.delete(id); else now.add(id);
    const list = all.filter((x) => now.has(x));
    return { ...r, analyte_ids: list.length === all.length ? null : list };
  }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`${API_BASE}/api/veritacheck/verifications/${verificationId}/plan`, {
        method: "PUT", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ rows }),
      });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok) { setError(j.error || `Not saved (HTTP ${r.status}).`); return; }
      setChanging(false);
      onChanged();
    } catch {
      setError("Not saved (network error).");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="plan-tab">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="font-semibold text-sm">The plan{plan && plan.version > 1 ? `, version ${plan.version}` : ""}</h4>
          <p className="text-xs text-muted-foreground">What will be tested, for which analytes, against what criterion, approved before testing.</p>
        </div>
        {signed && plan
          ? <Badge variant="outline" className={GREEN} data-testid="plan-signed-chip">Plan signed {labLocaleDate(plan.signed_at)}</Badge>
          : <Badge variant="outline" className={AMBER} data-testid="plan-not-signed-chip">Plan not signed</Badge>}
      </div>

      {rows.map((r, i) => (
        <Card key={r.element} data-testid={`plan-row-${r.element}`}>
          <CardContent className="p-4 space-y-3">
            <div className="font-semibold text-sm">{labelOf(r.element)}</div>
            {editable ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <Label className="text-xs mb-1 block">What will be tested</Label>
                  <Textarea rows={2} value={r.tested} onChange={(e) => set(i, { tested: e.target.value })} className="text-sm" data-testid={`plan-tested-${r.element}`} />
                </div>
                <div>
                  <Label className="text-xs mb-1 block">Acceptance criterion</Label>
                  <Input value={r.criterion} onChange={(e) => set(i, { criterion: e.target.value })} className="text-sm" data-testid={`plan-criterion-${r.element}`} />
                </div>
                <div>
                  <Label className="text-xs mb-1 block">Specimens</Label>
                  <Input value={r.specimens} onChange={(e) => set(i, { specimens: e.target.value })} className="text-sm" data-testid={`plan-specimens-${r.element}`} />
                </div>
                {r.element !== "carryover" && signing.analytes.length > 0 && (
                  <div className="sm:col-span-2">
                    <Label className="text-xs mb-1 block">Studies planned for</Label>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {signing.analytes.map((a) => (
                        <label key={a.id} className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
                          <input type="checkbox" className="h-4 w-4 accent-primary" checked={r.analyte_ids == null || r.analyte_ids.includes(a.id)} onChange={() => toggleAnalyte(i, a.id)} />
                          {a.name}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <dl className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">What will be tested</dt><dd>{r.tested || "Not written"}</dd>
                <dt className="text-muted-foreground">Studies planned for</dt><dd>{r.element === "carryover" ? "Instrument-wide" : r.analyte_ids == null ? "Every analyte on this package" : signing.analytes.filter((a) => r.analyte_ids!.includes(a.id)).map((a) => a.name).join(", ") || "None"}</dd>
                <dt className="text-muted-foreground">Acceptance criterion</dt><dd>{r.criterion || "Not written"}</dd>
                <dt className="text-muted-foreground">Specimens</dt><dd>{r.specimens || "Not written"}</dd>
              </dl>
            )}
          </CardContent>
        </Card>
      ))}

      {signing.leftOut.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Left out, each with its reason: {signing.leftOut.map((l) => `${l.label} (${l.reason || "no reason recorded"})`).join("; ")}
        </p>
      )}

      {editable && (
        <div className="space-y-2">
          {signed && <p className={`rounded-md border px-3 py-2 text-xs ${AMBER}`}>The signed version stays on the record. Your change is saved as version {(plan?.version ?? 0) + 1}, which needs its own signature.</p>}
          {error && <p className={`rounded-md border px-3 py-2 text-sm ${RED}`} role="alert">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={save} disabled={saving || !dirty || rows.length === 0} data-testid="plan-save">{saving ? "Saving..." : plan && !signed ? "Save the plan" : signed ? "Save as a new version" : "Save the plan"}</Button>
            {changing && <Button size="sm" variant="outline" onClick={() => { setChanging(false); setRows(base); }}>Cancel</Button>}
          </div>
        </div>
      )}
      {signed && !changing && !readOnly && (
        <Button size="sm" variant="outline" onClick={() => setChanging(true)} data-testid="plan-change">Change the plan</Button>
      )}

      {plan && (
        <Card>
          <CardContent className="p-4 space-y-3" data-testid="plan-sign-card">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <b className="text-sm">{signed ? "Plan approval" : "Sign this plan"}</b>
              {!signed && signing.whoCanSign.length > 0 && (
                <span className="text-xs text-muted-foreground">Can sign: {signing.whoCanSign.map((p) => `${p.name} (${p.role})`).join("; ")}</span>
              )}
            </div>
            <p className="text-sm">I approve this plan for verifying the performance of this instrument/test.</p>
            {signed ? (
              <div className={`rounded-md border px-3 py-2 text-sm ${GREEN}`} data-testid="plan-signed">
                Signed {labStampLabel(plan.signed_at)} by {plan.typed_signature}, {plan.capacity_label}, {how(plan.signed_with, plan.signed_with_provider)}.
              </div>
            ) : (
              <ESignatureForm
                purpose="verification_plan"
                signAs={signing.signAs}
                withDecision={false}
                submitLabel="Sign plan"
                testId="plan-sign"
                disabledReason={dirty ? "Save the plan before signing it." : null}
                onSign={async (fields) => {
                  const refused = await postSignature(`${API_BASE}/api/veritacheck/verifications/${verificationId}/plan/sign`, authHeaders(), { ...fields, expect_rows_hash: plan.rows_hash });
                  if (!refused) onChanged();
                  return refused;
                }}
              />
            )}
          </CardContent>
        </Card>
      )}

      {signing.versions.length > 1 && (
        <div className="text-xs text-muted-foreground space-y-1" data-testid="plan-versions">
          {signing.versions.filter((p) => p.id !== plan?.id).map((p) => (
            <div key={p.id}>Version {p.version}{p.signed_at ? `, signed ${labLocaleDate(p.signed_at)} by ${p.typed_signature}` : ", not signed"}, replaced by a later version.</div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The Director or Designee Approval tab. */
export function PackageApprovalTab({ verificationId, instrumentName, signing, readOnly, onChanged }: {
  verificationId: number; instrumentName: string; signing: Signing; readOnly: boolean; onChanged: () => void;
}) {
  const latest = signing.history.length ? signing.history[signing.history.length - 1] : null;
  const plan = signing.plan;
  const { total, signed, pass } = signing.covers.studies;
  const downloadSigned = async (sigId: number) => {
    const r = await fetch(`${API_BASE}/api/veritacheck/verifications/${verificationId}/signatures/${sigId}/pdf`, { method: "POST", headers: authHeaders() });
    if (!r.ok) return;
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `VeritaCheck_Verification_${instrumentName.replace(/[^a-zA-Z0-9]/g, "_")}_signed.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const coverRow = (k: string, v: ReactNode) => (
    <div className="grid grid-cols-1 sm:grid-cols-[11rem_1fr] gap-x-3 py-1.5 border-b border-border/60 last:border-0 text-sm">
      <div className="text-muted-foreground">{k}</div><div>{v}</div>
    </div>
  );
  return (
    <div className="space-y-4" data-testid="approval-tab">
      <Card>
        <CardContent className="p-4">
          <div className="font-semibold text-sm mb-1">What this signature covers</div>
          {coverRow("Plan", plan ? (plan.signed_at ? `Signed ${labStampLabel(plan.signed_at)}${plan.version > 1 ? `, version ${plan.version}` : ""}` : `Version ${plan.version}, not signed`) : "No plan yet")}
          {coverRow("Studies", `${signed} of ${total} signed, ${pass} pass`)}
          {coverRow("Tested before the plan", signing.beforePlan.length ? `${signing.beforePlan.length} (${signing.beforePlan.map((b) => `${b.label}, ${usDay(b.date)}`).join("; ")})` : signing.planSigned ? "None" : "The plan isn't signed yet")}
          {coverRow("Left out", signing.leftOut.length ? `${signing.leftOut.map((l) => l.label).join(", ")} (reasons given)` : "Nothing")}
          {coverRow(signing.units.length === 1 ? "Unit" : "Units", signing.units.length ? signing.units.map((s) => `S/N ${s}`).join(", ") : "None listed")}
          {coverRow("Record fingerprint", <span><code className="text-xs">{signing.short}</code> <span className="text-muted-foreground">made by the server</span></span>)}
        </CardContent>
      </Card>

      {signing.current && latest && (
        <div className={`rounded-md border px-3 py-2 text-sm ${GREEN}`} data-testid="package-signed">
          <b>Signed.</b> {labStampLabel(latest.signed_at)} by {latest.typed_signature}, {latest.capacity_label}, {how(latest.signed_with, latest.signed_with_provider)}: {latest.decision === "accepted" ? "Accepted for patient testing" : "Not accepted"}.
          <Button size="sm" variant="outline" className="ml-2 h-7 text-xs gap-1" onClick={() => downloadSigned(latest.id)}><Download size={12} /> The signed page</Button>
        </div>
      )}
      {!signing.current && latest && (
        <div className={`rounded-md border px-3 py-2 text-sm ${RED}`} data-testid="package-changed">
          <b>Changed since it was signed.</b> The {labLocaleDate(latest.signed_at)} signature stays on the record and no longer covers this package. It needs to be signed again.
          {signing.changed.length > 0 && <div className="mt-1 text-xs">Changed: {signing.changed.join(", ")}</div>}
        </div>
      )}
      {signing.history.length > 0 && (
        <div className="rounded-md border border-border divide-y divide-border/60 bg-card text-sm" data-testid="package-history">
          {signing.history.map((h) => (
            <div key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span className="text-muted-foreground whitespace-nowrap">{labStampLabel(h.signed_at)}</span>
              <span className="flex-1 min-w-0">
                Signed by {h.typed_signature}, {h.capacity_label}, {h.decision === "accepted" ? "Accepted" : "Not accepted"}
                {h.replaces_signature_id ? `. Replaces ${labLocaleDate(signing.history.find((x) => x.id === h.replaces_signature_id)?.signed_at)}` : ""}
              </span>
              <button className="text-xs underline text-muted-foreground" onClick={() => downloadSigned(h.id)}>Page as signed</button>
            </div>
          ))}
        </div>
      )}
      {signing.legacyApproval && (
        <p className="text-xs text-muted-foreground" data-testid="legacy-approval">
          Recorded before signing in VeritaCheck&reg;, typed with no password: {[signing.legacyApproval.name, signing.legacyApproval.title, signing.legacyApproval.date].filter(Boolean).join(", ")}.
        </p>
      )}

      {!signing.current && (
        <Card>
          <CardContent className="p-4 space-y-3" data-testid="package-sign-card">
            <p className="text-sm font-semibold text-primary tracking-wide">LABORATORY DIRECTOR OR DESIGNEE REVIEW</p>
            <p className="text-sm text-muted-foreground">I have reviewed the verification study results for the instrument/test identified above and find that the performance specifications have been adequately verified.</p>
            {signing.missing.length > 0 && (
              <div className={`rounded-md border px-3 py-2 text-xs ${AMBER}`} data-testid="package-missing">
                <b>Before it can be signed:</b>
                <ul className="list-disc pl-4 mt-1">{signing.missing.map((m) => <li key={m}>{m}</li>)}</ul>
              </div>
            )}
            {!plan?.signed_at && <p className={`rounded-md border px-3 py-2 text-xs ${AMBER}`}>The plan is signed first, on the Plan tab.</p>}
            {/* Signing is decided by the signer's qualification, not edit access: a director on a view-only seat signs here. */}
            {(
              <ESignatureForm
                purpose="verification_package"
                signAs={signing.signAs}
                withDecision
                withTitle
                submitLabel="Sign package"
                testId="package-sign"
                onSign={async (fields) => {
                  const refused = await postSignature(`${API_BASE}/api/veritacheck/verifications/${verificationId}/sign`, authHeaders(), { ...fields, expect: { fingerprint: signing.fingerprint, parts: signing.parts } });
                  if (!refused) onChanged();
                  return refused;
                }}
              />
            )}
            <p className="text-xs text-muted-foreground">Nothing is chosen for you. Signing needs every study in the plan signed or left out with a reason. If anything moved since this screen opened, it isn't signed and says what moved.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
