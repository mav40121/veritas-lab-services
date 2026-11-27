// client/src/components/SignaturePrompt.tsx
//
// The one signature prompt (S0, 2026-11-27; server/eSignature.ts). The typed name, then the signer's own password, or, for someone
// whose email domain signs in through their hospital (server/sso.ts), a "Sign with <hospital>" button that asks for that sign-in
// again, fresh, at the moment of signing: only the button where the domain requires single sign-on, the password or the button
// where it is optional. Every signing screen uses it (VeritaDC approve, reject, bulk approve, re-certify and attest, the staff
// login's approvals, the VeritaMaintain™ monthly review), and B4, B5, BUG-188 and B12 part 2 reuse it. Each screen keeps its own
// labels, ids and layout, so a password user sees what they saw before.
//
// useSignatureCredential holds the password or the hospital sign-in proof and gives the request body. The hospital sign-in opens in
// its own window; its last page (/sso/sign-done, SsoSignDonePage.tsx) hands back a one-time code on this site only, and this
// screen's own session trades it for the proof (single use, this person, this purpose, two minutes). No token rides in a URL.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { SIGN_SSO_ERRORS, type SignatureMethod, type SignatureMethodInfo, type SignaturePurpose } from "@shared/eSignature";

export const SIGN_SSO_CHANNEL = "va-signature-sso";

// One read of what this person signs with per session, shared by every prompt on the page. A failed read isn't kept.
const methodCache = new Map<string, Promise<SignatureMethodInfo | null>>();
function readMethod(headers: Record<string, string>): Promise<SignatureMethodInfo | null> {
  const key = headers.Authorization || "";
  if (!key) return Promise.resolve(null);
  let p = methodCache.get(key);
  if (!p) {
    p = fetch(`${API_BASE}/api/auth/signature/method`, { headers })
      .then((r) => (r.ok ? (r.json() as Promise<SignatureMethodInfo>) : null))
      .catch(() => null)
      .then((m) => { if (!m) methodCache.delete(key); return m; });
    methodCache.set(key, p);
  }
  return p;
}

function newWaiter(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface SignatureCredential {
  purpose: SignaturePurpose;
  /** What this person signs with; null until read (the password field shows meanwhile, as before). */
  method: SignatureMethodInfo | null;
  password: string;
  setPassword: (v: string) => void;
  /** Their hospital's sign-in, when their domain has one. */
  hospital: { name: string; required: boolean } | null;
  /** A password can sign (false where the domain requires single sign-on). */
  passwordAllowed: boolean;
  /** The hospital sign-in was just done for this signature. */
  proofReady: boolean;
  /** This signature will be made with the hospital sign-in. */
  usesHospital: boolean;
  /** A credential is there to send. The typed name is the screen's own check. */
  ready: boolean;
  busy: boolean;
  error: string | null;
  startHospitalSignIn: () => void;
  reset: () => void;
  /** The credential for the request, camelCase (ssoProof) or snake_case (sso_proof). A proof is used once, so it is cleared here. */
  body: (style?: "camel" | "snake") => Record<string, string>;
}

export function useSignatureCredential(purpose: SignaturePurpose, opts: { headers?: () => Record<string, string> } = {}): SignatureCredential {
  const headersFn = opts.headers ?? authHeaders;
  const headersRef = useRef(headersFn);
  headersRef.current = headersFn;
  const authKey = headersFn().Authorization || "";
  const [method, setMethod] = useState<SignatureMethodInfo | null>(null);
  const [password, setPassword] = useState("");
  const [proof, setProof] = useState<{ token: string; until: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const waiterRef = useRef<string | null>(null);
  const popupRef = useRef<Window | null>(null);

  useEffect(() => {
    let live = true;
    readMethod(headersRef.current()).then((m) => { if (live) setMethod(m); });
    return () => { live = false; };
  }, [authKey]);

  // A proof not used in time goes, and the screen says so.
  useEffect(() => {
    if (!proof) return;
    const t = setTimeout(() => {
      setProof(null);
      setError("Your hospital sign-in for this signature expired. Sign in again to sign.");
    }, Math.max(0, proof.until - Date.now()));
    return () => clearTimeout(t);
  }, [proof]);

  const receive = useCallback(async (data: any) => {
    if (!data || data.type !== SIGN_SSO_CHANNEL || !waiterRef.current || data.waiter !== waiterRef.current) return;
    waiterRef.current = null;
    try { popupRef.current?.close(); } catch { /* already closed */ }
    if (data.error || !data.handoff) {
      setBusy(false);
      setError(SIGN_SSO_ERRORS[String(data.error)] || SIGN_SSO_ERRORS.provider_unavailable);
      return;
    }
    try {
      const r = await fetch(`${API_BASE}/api/auth/signature/sso/complete`, {
        method: "POST",
        headers: { ...headersRef.current(), "Content-Type": "application/json" },
        body: JSON.stringify({ code: data.handoff }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.proof || j.purpose !== purpose) throw new Error(j.error || SIGN_SSO_ERRORS.expired);
      // A few seconds short of the server's limit, so a click at the last moment isn't refused.
      setProof({ token: String(j.proof), until: Date.now() + (Number(j.expiresInSeconds) || 120) * 1000 - 5000 });
      setError(null);
    } catch (e: any) {
      setError(e?.message || SIGN_SSO_ERRORS.expired);
    } finally {
      setBusy(false);
    }
  }, [purpose]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => { if (e.origin === window.location.origin) void receive(e.data); };
    window.addEventListener("message", onMessage);
    let bc: BroadcastChannel | null = null;
    try { bc = new BroadcastChannel(SIGN_SSO_CHANNEL); bc.onmessage = (e) => void receive(e.data); } catch { /* window.opener carries it */ }
    return () => { window.removeEventListener("message", onMessage); try { bc?.close(); } catch { /* closed */ } };
  }, [receive]);

  // The person closed the window without finishing: the button comes back. A code that still arrives is still taken.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => {
      const w = popupRef.current;
      if (w && w.closed) setTimeout(() => { if (popupRef.current === w) setBusy(false); }, 1500);
    }, 800);
    return () => clearInterval(t);
  }, [busy]);

  const startHospitalSignIn = useCallback(() => {
    setError(null);
    setProof(null);
    // Opened now, inside the click, so a pop-up blocker lets it through; it goes to the hospital once the server answers.
    const w = window.open("", "va-signature-sso", "popup,width=520,height=720");
    if (!w) { setError("Your browser blocked the sign-in window. Allow pop-ups for this site, then try again."); return; }
    try {
      w.document.title = "Hospital sign-in";
      w.document.body.style.fontFamily = "system-ui, sans-serif";
      w.document.body.style.padding = "16px";
      w.document.body.textContent = "Opening your hospital sign-in...";
    } catch { /* not ours to write */ }
    popupRef.current = w;
    const waiter = newWaiter();
    waiterRef.current = waiter;
    setBusy(true);
    void (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/auth/signature/sso/start`, {
          method: "POST",
          headers: { ...headersRef.current(), "Content-Type": "application/json" },
          body: JSON.stringify({ purpose, waiter }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.url) throw new Error(j.error || "Your hospital sign-in couldn't be opened. Try again.");
        w.location.href = j.url;
      } catch (e: any) {
        if (waiterRef.current === waiter) waiterRef.current = null;
        try { w.close(); } catch { /* closed */ }
        setBusy(false);
        setError(e?.message || "Your hospital sign-in couldn't be opened. Try again.");
      }
    })();
  }, [purpose]);

  const reset = useCallback(() => {
    setPassword("");
    setProof(null);
    setError(null);
    setBusy(false);
    waiterRef.current = null;
  }, []);

  const body = useCallback((style: "camel" | "snake" = "camel"): Record<string, string> => {
    if (proof && Date.now() < proof.until) {
      setProof(null);
      return style === "snake" ? { sso_proof: proof.token } : { ssoProof: proof.token };
    }
    return { password };
  }, [proof, password]);

  const hospital = method?.sso ?? null;
  const passwordAllowed = method ? method.password : true;
  const proofReady = !!proof;
  return {
    purpose, method, password, setPassword, hospital, passwordAllowed, proofReady,
    usesHospital: proofReady || (!!hospital && !passwordAllowed),
    ready: proofReady || (passwordAllowed && password.length > 0),
    busy, error, startHospitalSignIn, reset, body,
  };
}

export interface SignaturePromptProps {
  cred: SignatureCredential;
  typedName: string;
  onTypedName: (v: string) => void;
  /** What the signature means, shown first. A function is told how this signature will be made. */
  reason?: ReactNode | ((how: SignatureMethod) => ReactNode);
  /** "ui": the app's Label and Input. "plain": bare label and input, for the staff login's screens. */
  variant?: "ui" | "plain";
  /** "grid": name and credential side by side from small screens up. */
  layout?: "stack" | "grid";
  labels?: { name?: string; password?: string; namePlaceholder?: string; passwordPlaceholder?: string };
  labelClassName?: string;
  inputClassName?: string;
  /** A red asterisk after each label. */
  required?: boolean;
  ids?: { name?: string; password?: string };
  testIds?: { name?: string; password?: string; hospital?: string };
}

export function SignaturePrompt({
  cred, typedName, onTypedName, reason, variant = "ui", layout = "stack", labels = {}, labelClassName = "text-xs",
  inputClassName = "w-full border border-input rounded-md px-3 py-2 text-sm bg-background mb-3", required = false, ids = {}, testIds = {},
}: SignaturePromptProps) {
  const L = { name: "Type your full name", password: "Your password", ...labels };
  const tid = { name: testIds.name ?? ids.name, password: testIds.password ?? ids.password, hospital: testIds.hospital ?? "sign-with-hospital" };
  const how: SignatureMethod = cred.usesHospital ? "sso" : "password";
  const reasonNode = typeof reason === "function" ? reason(how) : reason;
  const star = required ? <> <span className="text-red-600">*</span></> : null;
  const showPassword = cred.passwordAllowed && !cred.proofReady;
  const hospital = cred.hospital;
  const plain = variant === "plain";
  const plainLabel = "text-xs text-muted-foreground block mb-1";

  const nameField = plain ? (
    <>
      <label className={plainLabel} htmlFor={ids.name}>{L.name}{star}</label>
      <input id={ids.name} className={inputClassName} value={typedName} onChange={(e) => onTypedName(e.target.value)} placeholder={L.namePlaceholder} data-testid={tid.name} />
    </>
  ) : (
    <div>
      <Label className={labelClassName} htmlFor={ids.name}>{L.name}{star}</Label>
      <Input id={ids.name} value={typedName} onChange={(e) => onTypedName(e.target.value)} placeholder={L.namePlaceholder} data-testid={tid.name} />
    </div>
  );

  const passwordField = !showPassword ? null : plain ? (
    <>
      <label className={plainLabel} htmlFor={ids.password}>{L.password}{star}</label>
      <input id={ids.password} type="password" autoComplete="current-password" className={inputClassName} value={cred.password} onChange={(e) => cred.setPassword(e.target.value)} placeholder={L.passwordPlaceholder} data-testid={tid.password} />
    </>
  ) : (
    <div>
      <Label className={labelClassName} htmlFor={ids.password}>{L.password}{star}</Label>
      <Input id={ids.password} type="password" value={cred.password} onChange={(e) => cred.setPassword(e.target.value)} placeholder={L.passwordPlaceholder} autoComplete="current-password" data-testid={tid.password} />
    </div>
  );

  const hospitalField = !hospital ? null : (
    <div className={`min-w-0 ${plain ? "mb-3" : ""} ${layout === "grid" && showPassword ? "sm:col-span-2" : ""}`} data-testid={`${tid.hospital}-field`}>
      {plain
        ? <div className={plainLabel}>{cred.passwordAllowed ? `Or sign with your ${hospital.name} sign-in` : `Your ${hospital.name} sign-in`}{cred.passwordAllowed ? null : star}</div>
        : <Label className={labelClassName}>{cred.passwordAllowed ? `Or sign with your ${hospital.name} sign-in` : `Your ${hospital.name} sign-in`}{cred.passwordAllowed ? null : star}</Label>}
      {cred.proofReady ? (
        <p className="flex items-start gap-1.5 text-xs text-emerald-700 dark:text-emerald-400" role="status" data-testid={`${tid.hospital}-done`}>
          <CheckCircle2 size={14} className="shrink-0 mt-px" />
          <span className="min-w-0">
            Signed in with {hospital.name} just now. Finish signing within 2 minutes.{" "}
            <button type="button" className="underline text-muted-foreground whitespace-nowrap" onClick={cred.startHospitalSignIn}>Sign in again</button>
          </span>
        </p>
      ) : plain ? (
        <button type="button" onClick={cred.startHospitalSignIn} disabled={cred.busy} className="w-full font-semibold py-2 px-3 rounded-md border border-border disabled:opacity-50 [overflow-wrap:anywhere]" data-testid={tid.hospital}>
          {cred.busy ? "Waiting for your hospital sign-in..." : `Sign with ${hospital.name}`}
        </button>
      ) : (
        <Button type="button" variant="outline" className="w-full h-auto min-h-9 py-2 whitespace-normal [overflow-wrap:anywhere]" onClick={cred.startHospitalSignIn} disabled={cred.busy} data-testid={tid.hospital}>
          {cred.busy && <Loader2 className="animate-spin mr-1 shrink-0" size={14} />}
          {cred.busy ? "Waiting for your hospital sign-in..." : `Sign with ${hospital.name}`}
        </Button>
      )}
      {!cred.proofReady && (
        <p className="text-xs text-muted-foreground mt-1">
          {cred.busy
            ? "Finish signing in to your hospital in the window that opened."
            : `${hospital.name} asks you to sign in again now. That sign-in and your typed name are your signature.`}
        </p>
      )}
      {cred.error && <p role="alert" className="text-xs text-red-700 dark:text-red-400 mt-1" data-testid={`${tid.hospital}-error`}>{cred.error}</p>}
    </div>
  );

  const reasonEl = reasonNode == null ? null : plain
    ? <p className="text-xs text-muted-foreground mb-3">{reasonNode}</p>
    : <p className="text-sm text-muted-foreground">{reasonNode}</p>;

  if (layout === "grid" && !plain) {
    return (
      <>
        {reasonEl}
        <div className="grid gap-3 sm:grid-cols-2">
          {nameField}
          {passwordField}
          {hospitalField}
        </div>
      </>
    );
  }
  return (
    <>
      {reasonEl}
      {nameField}
      {passwordField}
      {hospitalField}
    </>
  );
}
