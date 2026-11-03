// client/src/components/TermsAcceptance.tsx
//
// Terms of Use and Confidentiality Agreement (Michael 2026-11-03, Q141 = 1; server/termsOfUse.ts). Mounted once at
// the app root, like NoPhiAcknowledgment. When the active version has not been accepted, the person reads the
// agreement, types their name and agrees; a lab owner also accepts for the organization. It cannot be dismissed; the
// other choice is to sign out. A session already open when a version is activated is not logged out: the server
// answers its next request with 403 + X-Terms-Required, which this component hears (any fetch) and opens. Public
// marketing pages are never covered.

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/components/AuthContext";
import { apiRequest } from "@/lib/queryClient";
import { isPublicMarketingPath } from "@/lib/auth";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TERMS_SECTIONS, TERMS_TITLE, TERMS_VERSION, TERMS_VERSION_LABEL } from "@shared/termsOfUse";

export const TERMS_REQUIRED_EVENT = "veritas:terms-required";

// Any API answer that says the agreement is needed opens it, including pages that call fetch directly.
if (typeof window !== "undefined" && !(window as any).__veritasTermsFetchHook) {
  (window as any).__veritasTermsFetchHook = true;
  const original = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const res = await original(...args);
    if (res.status === 403 && res.headers.get("X-Terms-Required")) window.dispatchEvent(new Event(TERMS_REQUIRED_EVENT));
    return res;
  };
}

type TermsStatus = { required: boolean; activeVersion: string | null; currentVersion: string; isOwner: boolean; acceptsFor: string[] };

/** Shared with NoPhiAcknowledgment, which waits until the agreement is accepted. */
export function useTermsStatus() {
  const { user, isLoggedIn } = useAuth();
  const userId = user?.id ?? null;
  const key = ["terms-status", userId];
  const query = useQuery<TermsStatus>({
    queryKey: key,
    queryFn: async () => (await apiRequest("GET", "/api/auth/terms")).json(),
    enabled: isLoggedIn && userId != null,
    staleTime: Infinity,
  });
  return { key, ...query };
}

export function TermsAcceptance() {
  const { isLoggedIn, logout } = useAuth();
  const [location, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { key, data, refetch } = useTermsStatus();
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [forOrg, setForOrg] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onRequired = () => { refetch(); };
    window.addEventListener(TERMS_REQUIRED_EVENT, onRequired);
    return () => window.removeEventListener(TERMS_REQUIRED_EVENT, onRequired);
  }, [refetch]);

  const open = isLoggedIn && !!data?.required && !isPublicMarketingPath(location);
  if (!open) return null;
  const needsOrg = !!data?.isOwner;
  const ready = agree && name.trim().length >= 2 && (!needsOrg || forOrg);

  async function accept() {
    if (!ready) { setError(needsOrg && !forOrg ? "Confirm that you accept for your organization." : "Type your full name and check the box to agree."); return; }
    setSaving(true);
    setError("");
    try {
      const r = await apiRequest("POST", "/api/auth/terms/accept", { version: TERMS_VERSION, agree: true, signedName: name, onBehalfOfOrganization: needsOrg ? forOrg : undefined });
      const body = await r.json();
      queryClient.setQueryData(key, body.status);
      queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "terms-status" });
    } catch (e: any) {
      const msg = String(e?.message || "");
      setError(msg.startsWith("409") ? "These Terms were just updated. Reload the page to read the current version." : "That did not save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AlertDialog open>
      <AlertDialogContent data-testid="terms-acceptance" className="max-w-3xl" onEscapeKeyDown={(e) => e.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{TERMS_TITLE}</AlertDialogTitle>
          <AlertDialogDescription>
            Please read and accept these Terms to continue using VeritaAssure&#174;. {TERMS_VERSION_LABEL}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="max-h-[45vh] overflow-y-auto rounded border border-border p-3 text-sm leading-relaxed space-y-3" data-testid="terms-text">
          {TERMS_SECTIONS.map((s) => (
            <section key={s.title}>
              <h3 className="font-semibold mb-1">{s.title}</h3>
              {s.paragraphs.map((p, i) => <p key={i} className="mb-1">{p}</p>)}
            </section>
          ))}
        </div>
        <label className="block text-sm font-medium" htmlFor="terms-signed-name">Type your full name to sign</label>
        <Input id="terms-signed-name" value={name} onChange={(e) => { setName(e.target.value); setError(""); }} placeholder="Full name" autoComplete="name" data-testid="terms-signed-name" />
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={agree} onChange={(e) => { setAgree(e.target.checked); setError(""); }}
            className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary shrink-0" data-testid="terms-agree" />
          <span className="text-sm">I have read and agree to the {TERMS_TITLE}.</span>
        </label>
        {needsOrg && (
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={forOrg} onChange={(e) => { setForOrg(e.target.checked); setError(""); }}
              className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary shrink-0" data-testid="terms-for-org" />
            <span className="text-sm">
              As the account owner, I also accept these Terms on behalf of {data?.acceptsFor?.length ? data.acceptsFor.join(", ") : "my organization"}, and I am authorized to do so.
            </span>
          </label>
        )}
        {error && <p className="text-sm text-red-600" data-testid="terms-error">{error}</p>}
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => { logout(); navigate("/login"); }} data-testid="terms-sign-out">Sign out</Button>
          <Button onClick={accept} disabled={saving || !ready} data-testid="terms-accept">{saving ? "Saving..." : "I agree"}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
