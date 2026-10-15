// Two-factor sign-in screens (Stage 2; Michael Q170 = 1, mock Q171 = 1, 2026-10-14).
//   TwoFactorSignIn  the step after the password: authenticator code, "Email me a code instead",
//                    "Use a recovery code", "Remember this computer for 30 days"
//   TwoFactorSetup   first-time setup (QR + key + code, or email codes), then the 10 recovery codes;
//                    used at sign-in (mfaToken) and from Account settings (signed-in session)
// Server: server/twoFactorRoutes.ts.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { authHeaders } from "@/lib/auth";
import { Loader2 } from "lucide-react";

const DEVICE_KEY = "veritas_mfa_devices";

/** The remembered-computer token for this email, if this browser has one. */
export function rememberedDeviceToken(email: string): string | undefined {
  try { return JSON.parse(localStorage.getItem(DEVICE_KEY) || "{}")[String(email).toLowerCase().trim()] || undefined; } catch { return undefined; }
}
export function storeRememberedDevice(email: string, token: string | undefined) {
  if (!token) return;
  try {
    const m = JSON.parse(localStorage.getItem(DEVICE_KEY) || "{}");
    m[String(email).toLowerCase().trim()] = token;
    localStorage.setItem(DEVICE_KEY, JSON.stringify(m));
  } catch {}
}

async function post(path: string, body: Record<string, unknown>, withSession = false) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(withSession ? authHeaders() : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function SixDigits({ value, onChange, onDone, testId }: { value: string; onChange: (v: string) => void; onDone?: () => void; testId: string }) {
  return (
    <InputOTP maxLength={6} value={value} onChange={(v) => onChange(v.replace(/\D/g, ""))} onComplete={onDone} inputMode="numeric" autoFocus data-testid={testId}>
      <InputOTPGroup className="gap-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <InputOTPSlot key={i} index={i} className="h-11 w-10 rounded-md border text-lg font-semibold first:rounded-md last:rounded-md" />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}

// ── The step after the password ─────────────────────────────────────────
export function TwoFactorSignIn({ step, email, onDone, onCancel }: {
  step: { mfa_token: string; method: "totp" | "email" | null; email_hint: string; allow_remember: boolean };
  email: string;
  onDone: (signIn: any) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<"app" | "email" | "recovery">(step.method === "email" ? "email" : "app");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function sendEmail() {
    setError(null);
    const r = await post("/api/auth/mfa/email-code", { mfa_token: step.mfa_token });
    if (r.ok) setSentTo(r.data.email_hint || step.email_hint);
    else setError(r.data?.error || "We couldn't send the email.");
  }
  useEffect(() => { if (step.method === "email") void sendEmail(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function verify() {
    const c = mode === "recovery" ? recovery : code;
    if (!c) return;
    setBusy(true);
    setError(null);
    const r = await post("/api/auth/mfa/verify", { mfa_token: step.mfa_token, code: c, kind: mode, remember: step.allow_remember && remember });
    setBusy(false);
    if (!r.ok) {
      setCode("");
      setError(r.status === 401 ? "This sign-in step expired. Go back and sign in again." : (r.data?.error || "That code didn't work."));
      return;
    }
    storeRememberedDevice(email, r.data.device_token);
    onDone(r.data);
  }

  const switchTo = async (m: "app" | "email" | "recovery") => {
    setMode(m); setCode(""); setRecovery(""); setError(null);
    if (m === "email" && !sentTo) await sendEmail();
  };

  return (
    <div className="space-y-4" data-testid="two-factor-signin">
      {mode === "app" && (
        <div>
          <h2 className="text-lg font-semibold">Enter your 6-digit code</h2>
          <p className="text-sm text-muted-foreground">Open your authenticator app and enter the code shown for VeritaAssure™ ({email}).</p>
        </div>
      )}
      {mode === "email" && (
        <div>
          <h2 className="text-lg font-semibold">Check your email</h2>
          <p className="text-sm text-muted-foreground">{sentTo ? `We sent a 6-digit code to ${sentTo}. It works for 10 minutes.` : "Sending a 6-digit code to your email..."}</p>
        </div>
      )}
      {mode === "recovery" && (
        <div>
          <h2 className="text-lg font-semibold">Use a recovery code</h2>
          <p className="text-sm text-muted-foreground">Enter one of the recovery codes you saved when you set up two-factor sign-in. Each works once.</p>
        </div>
      )}

      {mode === "recovery" ? (
        <Input value={recovery} onChange={(e) => setRecovery(e.target.value)} placeholder="XXXX-XXXX" autoFocus className="font-mono uppercase" data-testid="recovery-code-input" onKeyDown={(e) => { if (e.key === "Enter") void verify(); }} />
      ) : (
        <SixDigits value={code} onChange={setCode} onDone={() => void verify()} testId="mfa-code-input" />
      )}

      {step.allow_remember && (
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 accent-primary" />
          Remember this computer for 30 days
        </label>
      )}

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

      <Button className="w-full" onClick={() => void verify()} disabled={busy || (mode === "recovery" ? recovery.trim().length < 8 : code.length !== 6)}>
        {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
        Verify and sign in
      </Button>

      <div className="flex flex-col items-start gap-1.5 text-sm">
        {mode !== "email" && <button type="button" className="text-primary hover:underline" onClick={() => void switchTo("email")}>Email me a code instead</button>}
        {mode === "email" && <button type="button" className="text-primary hover:underline" onClick={() => void sendEmail()}>Send a new code</button>}
        {mode !== "app" && step.method === "totp" && <button type="button" className="text-primary hover:underline" onClick={() => void switchTo("app")}>Use my authenticator app</button>}
        {mode !== "recovery" && <button type="button" className="text-primary hover:underline" onClick={() => void switchTo("recovery")}>Use a recovery code</button>}
        <button type="button" className="text-muted-foreground hover:underline" onClick={onCancel}>Back to sign in</button>
      </div>
    </div>
  );
}

// ── Recovery codes, shown once ──────────────────────────────────────────
export function RecoveryCodesPanel({ codes, onContinue, continueLabel = "I saved them, continue" }: { codes: string[]; onContinue: () => void; continueLabel?: string }) {
  const text = `VeritaAssure recovery codes\nEach code works once. Keep them somewhere safe.\n\n${codes.join("\n")}\n`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url; a.download = "VeritaAssure-recovery-codes.txt"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const print = () => {
    const w = window.open("", "_blank", "width=480,height=600");
    if (!w) return;
    w.document.write(`<pre style="font:14px monospace;padding:24px">${text.replace(/</g, "&lt;")}</pre>`);
    w.document.close(); w.focus(); w.print();
  };
  return (
    <div className="space-y-3" data-testid="recovery-codes">
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold">Save your recovery codes</h3>
        <span className="text-xs text-muted-foreground">each works once</span>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border border-border bg-muted/40 p-3 font-mono text-sm">
        {codes.map((c) => <span key={c}>{c}</span>)}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={download}>Download</Button>
        <Button type="button" variant="outline" size="sm" onClick={print}>Print</Button>
        <Button type="button" size="sm" onClick={onContinue} data-testid="recovery-codes-continue">{continueLabel}</Button>
      </div>
      <p className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        Shown once. Use one if you lose your phone. The lab owner can also reset your two-factor.
      </p>
    </div>
  );
}

// ── First-time setup (or moving to a new phone) ─────────────────────────
export function TwoFactorSetup({ mfaToken, requiredBy, emailHint, allowRemember, password, requireSystem, onDone, onCancel }: {
  mfaToken?: string;               // sign-in setup; absent = from Account settings (session)
  requiredBy?: string;
  emailHint?: string;
  allowRemember?: boolean;
  password?: string;               // Account settings: needed to move an existing two-factor
  requireSystem?: boolean;         // Account settings, lab owner: also require it for everyone in their labs
  onDone: (result: any) => void;   // sign-in: the sign-in payload; Account settings: { ok: true }
  onCancel: () => void;
}) {
  const withSession = !mfaToken;
  const [method, setMethod] = useState<"app" | "email">("app");
  const [setup, setSetup] = useState<{ key: string; qr_svg: string } | null>(null);
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    void (async () => {
      const r = await post("/api/auth/mfa/setup/start", { mfa_token: mfaToken, password }, withSession);
      if (r.ok) setSetup(r.data);
      else setError(r.data?.error || "Could not start setup.");
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function useEmail() {
    setMethod("email"); setCode(""); setError(null);
    const r = await post("/api/auth/mfa/email-code", { mfa_token: mfaToken }, withSession);
    if (r.ok) setEmailSent(r.data.email_hint || emailHint || "your email");
    else setError(r.data?.error || "We couldn't send the email.");
  }

  async function turnOn() {
    if (code.length !== 6) return;
    setBusy(true); setError(null);
    const r = await post("/api/auth/mfa/setup/confirm", { mfa_token: mfaToken, code, method, remember: !!allowRemember && remember, require_system: !!requireSystem }, withSession);
    setBusy(false);
    if (!r.ok) { setCode(""); setError(r.status === 401 ? "This step expired. Start again." : (r.data?.error || "That code didn't work.")); return; }
    setResult(r.data);
  }

  if (result) {
    return (
      <RecoveryCodesPanel
        codes={result.recovery_codes || []}
        onContinue={() => onDone(result)}
      />
    );
  }

  const who = requiredBy === "Veritas Lab Services" ? "Veritas Lab Services accounts require" : requiredBy ? `${requiredBy} requires` : "Two-factor sign-in adds";
  return (
    <div className="space-y-4" data-testid="two-factor-setup">
      <div>
        <h2 className="text-lg font-semibold">Set up two-factor sign-in</h2>
        <p className="text-sm text-muted-foreground">{who} a second step at sign-in. This takes about a minute.</p>
      </div>

      {method === "app" ? (
        <>
          <div className="rounded-md border border-border p-3 space-y-2">
            <h3 className="text-sm font-semibold">1. Scan with your authenticator app</h3>
            <div className="flex flex-wrap items-center gap-4">
              <div className="h-36 w-36 shrink-0 rounded border border-border bg-white p-1 [&_svg]:h-full [&_svg]:w-full" data-testid="mfa-qr"
                dangerouslySetInnerHTML={{ __html: setup?.qr_svg || "" }} />
              <div className="text-xs text-muted-foreground space-y-1 min-w-0">
                <p>Microsoft Authenticator, Google Authenticator, or any similar app.</p>
                <p className="uppercase tracking-wide">Can't scan? Enter this key</p>
                <p className="font-mono text-sm text-foreground break-all" data-testid="mfa-key">{setup?.key || "..."}</p>
              </div>
            </div>
          </div>
          <div className="rounded-md border border-border p-3 space-y-2">
            <h3 className="text-sm font-semibold">2. Enter the 6-digit code the app shows</h3>
            <SixDigits value={code} onChange={setCode} testId="mfa-setup-code" />
          </div>
        </>
      ) : (
        <div className="rounded-md border border-border p-3 space-y-2">
          <h3 className="text-sm font-semibold">Enter the code we emailed you</h3>
          <p className="text-xs text-muted-foreground">{emailSent ? `We sent a 6-digit code to ${emailSent}. It works for 10 minutes. Each time you sign in, we'll email you a new one.` : "Sending..."}</p>
          <SixDigits value={code} onChange={setCode} testId="mfa-setup-code" />
        </div>
      )}

      {allowRemember && !withSession && (
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 accent-primary" />
          Remember this computer for 30 days
        </label>
      )}

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

      <Button onClick={() => void turnOn()} disabled={busy || code.length !== 6} data-testid="mfa-turn-on">
        {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
        Turn on
      </Button>

      <div className="flex flex-col items-start gap-1.5 text-sm">
        {method === "app"
          ? <button type="button" className="text-primary hover:underline" onClick={() => void useEmail()}>No phone at the bench? Use email codes instead</button>
          : <button type="button" className="text-primary hover:underline" onClick={() => { setMethod("app"); setCode(""); setError(null); }}>Use an authenticator app instead</button>}
        {method === "email" && emailSent && <button type="button" className="text-primary hover:underline" onClick={() => void useEmail()}>Send a new code</button>}
        <button type="button" className="text-muted-foreground hover:underline" onClick={onCancel}>{withSession ? "Cancel" : "Back to sign in"}</button>
      </div>
    </div>
  );
}
