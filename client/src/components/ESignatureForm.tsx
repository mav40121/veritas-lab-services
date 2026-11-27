// client/src/components/ESignatureForm.tsx
//
// B4 (2026-11-27; server/verificationSignatures.ts): the one signing form VeritaCheck uses for a verification plan, a package, a
// single study, a package analyte and a sign-off group. Typed full name and the signer's credential through S0's prompt
// (SignaturePrompt and useSignatureCredential: their own password, or "Sign with <hospital>" where their domain signs in through
// the hospital, asked for again at the moment of signing), the role the server says they sign as, and (where the record takes one)
// Accepted or Not accepted, with nothing chosen for them. The server checks all of it; this form only collects it and shows the
// server's refusal word for word.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SignaturePrompt, useSignatureCredential } from "@/components/SignaturePrompt";
import type { SignaturePurpose } from "@shared/eSignature";

export interface SignAs { canSign: boolean; label: string | null; reason: string | null }
export interface SignatureFields { signature: string; password?: string; ssoProof?: string; decision?: "accepted" | "not_accepted"; title?: string }

export function ESignatureForm({
  purpose, signAs, withDecision, withTitle = false, acceptLabel = "Accepted for patient testing", submitLabel, testId, disabledReason, onSign,
}: {
  /** What the signature is for (shared/eSignature.ts): a hospital sign-in proof is good for this purpose only. */
  purpose: SignaturePurpose;
  signAs: SignAs | null | undefined;
  withDecision: boolean;
  withTitle?: boolean;
  acceptLabel?: string;
  submitLabel: string;
  testId: string;
  /** A reason the form can't be sent yet (for example, unsaved changes), shown instead of enabling the button. */
  disabledReason?: string | null;
  /** Sends the signature. Resolves to the server's refusal, or null when it was recorded. */
  onSign: (fields: SignatureFields) => Promise<string | null>;
}) {
  const cred = useSignatureCredential(purpose);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [decision, setDecision] = useState<"accepted" | "not_accepted" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSign = !!signAs?.canSign;
  const ready = canSign && name.trim().length >= 2 && cred.ready && (!withDecision || !!decision) && !disabledReason;
  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const refused = await onSign({ signature: name.trim(), ...cred.body("camel"), ...(withDecision && decision ? { decision } : {}), ...(withTitle && title.trim() ? { title: title.trim() } : {}) });
      if (refused) setError(refused);
      else { cred.reset(); setName(""); setDecision(null); setTitle(""); }
    } finally {
      setBusy(false);
    }
  };

  const choice = (value: "accepted" | "not_accepted", label: string) => (
    <label className="inline-flex items-center gap-2 text-sm cursor-pointer mr-5" data-testid={`${testId}-${value}`}>
      <input type="radio" name={`${testId}-decision`} className="h-4 w-4 accent-primary" checked={decision === value} onChange={() => setDecision(value)} disabled={!canSign} />
      {label}
    </label>
  );

  return (
    <div className="space-y-3" data-testid={testId}>
      {withDecision && (
        <div className="flex flex-wrap gap-y-1">
          {choice("accepted", acceptLabel)}
          {choice("not_accepted", "Not accepted")}
        </div>
      )}
      {/* The name and credential: S0's prompt. Shown only to someone who can sign here, so nobody else opens a hospital sign-in. */}
      {canSign && (
        <SignaturePrompt
          cred={cred}
          typedName={name}
          onTypedName={setName}
          layout="grid"
          labels={{ name: "Full name", password: "Your password" }}
          ids={{ name: `${testId}-name`, password: `${testId}-password` }}
          testIds={{ name: `${testId}-name`, password: `${testId}-password`, hospital: `${testId}-hospital` }}
        />
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {withTitle && canSign && (
          <div>
            <Label htmlFor={`${testId}-title`} className="text-xs mb-1 block">Title</Label>
            <Input id={`${testId}-title`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={signAs?.label || ""} data-testid={`${testId}-title`} />
          </div>
        )}
        <div>
          <Label htmlFor={`${testId}-as`} className="text-xs mb-1 block">You sign as</Label>
          <Input id={`${testId}-as`} value={signAs ? (signAs.canSign ? signAs.label || "" : "Not able to sign") : "Checking..."} disabled readOnly data-testid={`${testId}-as`} />
        </div>
      </div>
      {signAs && !signAs.canSign && signAs.reason && (
        <p className="text-xs text-muted-foreground" data-testid={`${testId}-cannot`}>{signAs.reason}</p>
      )}
      {disabledReason && canSign && <p className="text-xs text-amber-700 dark:text-amber-300">{disabledReason}</p>}
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200" role="alert" data-testid={`${testId}-error`}>
          {error}
        </div>
      )}
      <Button className="w-full sm:w-auto" onClick={submit} disabled={!ready || busy} data-testid={`${testId}-submit`}>
        {busy ? "Signing..." : submitLabel}
      </Button>
    </div>
  );
}

/** POSTs a signature and returns the server's refusal (with what moved or what is missing), or null when it was recorded. */
export async function postSignature(url: string, headers: Record<string, string>, body: object): Promise<string | null> {
  try {
    const r = await fetch(url, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) return null;
    const e = await r.json().catch(() => ({} as any));
    const extra = Array.isArray(e.missing) && e.missing.length ? ` ${e.missing.join("; ")}.` : "";
    return `${e.error || `Not signed (HTTP ${r.status}).`}${extra}`;
  } catch {
    return "Not signed (network error). Nothing was recorded.";
  }
}
