// The page an email verification link opens (server/emailVerification.ts). The person enters the password they chose at
// sign-up, then goes to sign in. Opening the link alone confirms nothing, so a link they didn't ask for can't turn on an
// account someone else set up with their address.
import { useState } from "react";
import { useSearch, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function VerifyEmailPage() {
  const token = new URLSearchParams(useSearch()).get("token") || "";
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<{ message: string; dead: boolean } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/verify-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setDone(true);
      else setError({ message: d.error || "That didn't work. Please try again.", dead: d.code === "VERIFY_LINK_INVALID" || d.code === "VERIFY_LINK_EXPIRED" });
    } catch {
      setError({ message: "Something went wrong. Please try again.", dead: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{done ? "Your email is confirmed" : "Confirm your email"}</CardTitle>
          <CardDescription>
            {done ? "You can sign in now." : token ? "Enter the password you chose when you created this account." : "This link is missing its code. Sign in to send a new one."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {done || !token || error?.dead ? (
            <div className="space-y-3">
              {error?.dead && <p role="alert" data-testid="verify-error" className="text-sm text-red-700 dark:text-red-400">{error.message}</p>}
              <Button asChild className="w-full" data-testid="verify-sign-in"><Link href="/login">Go to sign in</Link></Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="verify-password">Password</Label>
                <Input id="verify-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="verify-password" />
              </div>
              {error && <p role="alert" data-testid="verify-error" className="text-sm text-red-700 dark:text-red-400">{error.message}</p>}
              <Button type="submit" className="w-full" disabled={busy || !password} data-testid="verify-submit">{busy ? "Confirming..." : "Confirm my email"}</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
