// client/src/pages/SsoSignDonePage.tsx
//
// The hospital sign-in window's last page when signing (S0, 2026-11-27; server/ssoRoutes.ts, components/SignaturePrompt.tsx). It
// hands the one-time code, or why there is none, to the signing screen that opened the window, on this site only (BroadcastChannel,
// and window.opener with this origin), takes the code out of the address bar and closes. The code is worth nothing without that
// person's own session, and only once, within a minute. Rendered without the site's navigation; never indexed (server/static.ts).
import { useEffect, useState } from "react";
import { SIGN_SSO_ERRORS } from "@shared/eSignature";

const CHANNEL = "va-signature-sso";

export default function SsoSignDonePage() {
  const [result] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    const out = { handoff: q.get("h"), error: q.get("error"), waiter: q.get("w") };
    try { window.history.replaceState(null, "", window.location.pathname); } catch { /* keep going */ }
    return out;
  });

  useEffect(() => {
    const msg = { type: CHANNEL, ...result };
    try { const bc = new BroadcastChannel(CHANNEL); bc.postMessage(msg); bc.close(); } catch { /* window.opener carries it */ }
    try { window.opener?.postMessage(msg, window.location.origin); } catch { /* no opener */ }
    const t = setTimeout(() => { try { window.close(); } catch { /* the person closes it */ } }, 800);
    return () => clearTimeout(t);
  }, [result]);

  const failed = !result.handoff;
  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-5 text-sm" data-testid="sso-sign-done">
        <p className="font-semibold mb-1">{failed ? "Not signed in" : "Hospital sign-in done"}</p>
        <p className="text-muted-foreground">
          {failed
            ? `${SIGN_SSO_ERRORS[result.error || ""] || SIGN_SSO_ERRORS.provider_unavailable} Close this window and go back to VeritaAssure®.`
            : "Go back to VeritaAssure® to finish signing. This window closes by itself; if it doesn't, close it."}
        </p>
      </div>
    </main>
  );
}
