import { useState } from "react";
import { useSearch, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/components/AuthContext";
import { useLabRoute } from "@/hooks/useLabRoute";
import { passwordProblem, PASSWORD_RULE_TEXT } from "@shared/passwordRule";

const API_BASE = ""; // same-origin: works on the lab site and the separate VeritaStock deployment

export default function ResetPasswordPage() {
  const labRoute = useLabRoute();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const token = params.get("token");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [done, setDone] = useState(false);
  // Two-factor: a reset link proves the email, not the second step, so a person with
  // two-factor on signs in again through the code step.
  const [signInNext, setSignInNext] = useState(false);
  // System security settings: an account turned off for inactivity keeps the new password but stays off.
  const [inactiveNote, setInactiveNote] = useState<string | null>(null);
  const { toast } = useToast();
  const { login } = useAuth();

  // Step 1: Request reset email
  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    try {
      await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      setSent(true);
    } catch {
      toast({ title: "Error", description: "Something went wrong. Please try again.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Set new password
  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    const pwProblem = passwordProblem(password);
    if (pwProblem) {
      toast({ title: "Pick a stronger password", description: pwProblem, variant: "destructive" });
      return;
    }
    if (password !== confirm) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reset failed");
      if (data.inactive) setInactiveNote(data.message || null);
      if (data.sign_in_required || !data.token) { setSignInNext(true); setDone(true); return; }
      if (data.session_token) { try { localStorage.setItem("veritas_session_token", data.session_token); } catch {} }
      login(data.token, data.user);
      setDone(true);
    } catch (err: any) {
      toast({ title: "Reset failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card className="w-full max-w-sm text-center">
          <CardContent className="pt-8 pb-6">
            <div className="text-4xl mb-4">✓</div>
            <h2 className="font-semibold text-lg mb-2">Password updated</h2>
            <p className="text-sm text-muted-foreground mb-4">{inactiveNote || (signInNext ? "Sign in with your new password. You'll be asked for your two-factor code." : "You're now logged in.")}</p>
            <Button asChild className="w-full bg-primary text-primary-foreground">
              {signInNext ? <Link href="/login">Sign in</Link> : <Link href={labRoute("/dashboard")}>Go to My Studies</Link>}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card className="w-full max-w-sm text-center">
          <CardContent className="pt-8 pb-6">
            <div className="text-4xl mb-4">📧</div>
            <h2 className="font-semibold text-lg mb-2">Check your email</h2>
            <p className="text-sm text-muted-foreground mb-4">
              If an account exists for <strong>{email}</strong>, a password reset link is on its way. It can take a few minutes to arrive, and on hospital or corporate email it may land in your spam or quarantine folder, so check there too.
            </p>
            <p className="text-xs text-muted-foreground">The link is good for 4 hours. If it has expired by the time you find it, just request a new one and it should arrive faster.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Token present — show new password form
  if (token) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-xl">Set new password</CardTitle>
            <CardDescription>Enter a new password for your account.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleReset} className="space-y-4">
              <div className="space-y-1.5">
                <Label>New Password</Label>
                <Input type="password" placeholder="At least 8 characters" value={password}
                  onChange={e => setPassword(e.target.value)} required minLength={8} />
                <p className="text-xs text-muted-foreground">{PASSWORD_RULE_TEXT}</p>
              </div>
              <div className="space-y-1.5">
                <Label>Confirm Password</Label>
                <Input type="password" placeholder="Repeat password" value={confirm}
                  onChange={e => setConfirm(e.target.value)} required />
              </div>
              <Button type="submit" className="w-full bg-primary text-primary-foreground" disabled={loading}>
                {loading ? "Updating…" : "Update Password"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // No token — show request form
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Forgot password?</CardTitle>
          <CardDescription>Enter your email and we'll send you a reset link.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleRequest} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Email address</Label>
              <Input type="email" placeholder="you@example.com" value={email}
                onChange={e => setEmail(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full bg-primary text-primary-foreground" disabled={loading}>
              {loading ? "Sending…" : "Send Reset Link"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              <Link href="/login" className="text-primary hover:underline">Back to sign in</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
