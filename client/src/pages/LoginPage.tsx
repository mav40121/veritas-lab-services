import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/components/AuthContext";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { FlaskConical, Search, Building2, CheckCircle, AlertTriangle } from "lucide-react";

interface CLIAResult {
  clia_number: string;
  facility_name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  lab_director: string;
  certificate_type: string;
  specialty_count: number;
  valid_through: string | null;
  tier: string;
  base_price: number;
}

const TIER_LABELS: Record<string, string> = {
  waived: "Waived",
  community: "Community",
  hospital: "Hospital",
  large_hospital: "Large Hospital",
  veritacheck_only: "VeritaCheck\u2122 Unlimited",
};

export default function LoginPage() {
  const { login } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [registerForm, setRegisterForm] = useState({ name: "", email: "", password: "" });

  // CLIA lookup state
  const [regStep, setRegStep] = useState<"clia" | "form">("clia");
  const [cliaInput, setCliaInput] = useState("");
  const [cliaLooking, setCliaLooking] = useState(false);
  const [cliaResult, setCliaResult] = useState<CLIAResult | null>(null);
  const [cliaConfirmed, setCliaConfirmed] = useState(false);
  const [skipClia, setSkipClia] = useState(false);

  // Session conflict state
  const [sessionConflict, setSessionConflict] = useState(false);
  const [conflictData, setConflictData] = useState<any>(null);

  async function handleCLIALookup() {
    if (!cliaInput.trim()) return;
    setCliaLooking(true);
    setCliaResult(null);
    try {
      const res = await apiRequest("POST", "/api/clia/lookup", { clia_number: cliaInput.trim() });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error || "CLIA lookup failed", variant: "destructive" });
        return;
      }
      setCliaResult(data);
    } catch {
      toast({ title: "CLIA lookup failed. Please try again.", variant: "destructive" });
    } finally {
      setCliaLooking(false);
    }
  }

  function handleConfirmLab() {
    setCliaConfirmed(true);
    setRegStep("form");
  }

  function handleSkipClia() {
    setSkipClia(true);
    setRegStep("form");
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setSessionConflict(false);
    try {
      const res = await apiRequest("POST", "/api/auth/login", loginForm);
      const data = await res.json();
      if (!res.ok) { toast({ title: data.error || "Login failed", variant: "destructive" }); return; }

      if (data.session_conflict) {
        setSessionConflict(true);
        setConflictData(data);
        return;
      }

      // Store session token
      if (data.session_token) {
        localStorage.setItem("veritas_session_token", data.session_token);
      }
      login(data.token, data.user);
      navigate("/dashboard");
    } catch { toast({ title: "Login failed", variant: "destructive" }); }
    finally { setLoading(false); }
  }

  async function handleForceLogout() {
    if (!conflictData?.token) return;
    setLoading(true);
    try {
      const res = await fetch("/api/auth/force-logout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${conflictData.token}` },
      });
      const data = await res.json();
      if (data.ok) {
        if (data.session_token) {
          localStorage.setItem("veritas_session_token", data.session_token);
        }
        login(conflictData.token, conflictData.user);
        navigate("/dashboard");
      }
    } catch {
      toast({ title: "Force logout failed", variant: "destructive" });
    } finally {
      setLoading(false);
      setSessionConflict(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/register", registerForm);
      const data = await res.json();
      if (!res.ok) { toast({ title: data.error || "Registration failed", variant: "destructive" }); return; }

      // Store session token
      if (data.session_token) {
        localStorage.setItem("veritas_session_token", data.session_token);
      }

      // If CLIA was confirmed, save it to the user's account
      if (cliaConfirmed && cliaResult) {
        try {
          await fetch("/api/clia/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${data.token}` },
            body: JSON.stringify({
              clia_number: cliaResult.clia_number,
              facility_name: cliaResult.facility_name,
              address: cliaResult.address,
              lab_director: cliaResult.lab_director,
              specialty_count: cliaResult.specialty_count,
              certificate_type: cliaResult.certificate_type,
              tier: cliaResult.tier,
            }),
          });
        } catch {}
      } else if (skipClia) {
        // VeritaCheck-only tier
        try {
          await fetch("/api/clia/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${data.token}` },
            body: JSON.stringify({
              clia_number: "",
              tier: "veritacheck_only",
            }),
          });
        } catch {}
      }

      login(data.token, data.user);
      navigate("/dashboard");
    } catch { toast({ title: "Registration failed", variant: "destructive" }); }
    finally { setLoading(false); }
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <FlaskConical size={22} className="text-primary" />
          </div>
          <h1 className="font-serif text-2xl font-bold">VeritaAssure&#8482; Account</h1>
          <p className="text-sm text-muted-foreground mt-1">Sign in to save and access your studies</p>
        </div>
        <Card>
          <CardContent className="pt-5">
            <Tabs defaultValue="login">
              <TabsList className="grid grid-cols-2 w-full mb-5">
                <TabsTrigger value="login">Sign In</TabsTrigger>
                <TabsTrigger value="register">Create Account</TabsTrigger>
              </TabsList>
              <TabsContent value="login">
                {sessionConflict ? (
                  <div className="space-y-4">
                    <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="text-amber-600 mt-0.5 shrink-0" size={20} />
                        <div>
                          <p className="font-medium text-amber-800 dark:text-amber-200 text-sm">Another session is active</p>
                          <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                            Device: {conflictData?.active_device?.substring(0, 60) || "Unknown"}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">Log out the other device and try again, or force logout below.</p>
                        </div>
                      </div>
                    </div>
                    <Button onClick={handleForceLogout} disabled={loading} className="w-full" variant="destructive">
                      {loading ? "Logging out other device..." : "Force Logout Other Device"}
                    </Button>
                    <Button onClick={() => setSessionConflict(false)} variant="outline" className="w-full">Cancel</Button>
                  </div>
                ) : (
                  <form onSubmit={handleLogin} className="space-y-4">
                    <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={loginForm.email} onChange={e => setLoginForm(f => ({ ...f, email: e.target.value }))} placeholder="you@lab.com" required /></div>
                    <div className="space-y-1.5"><Label>Password</Label><Input type="password" value={loginForm.password} onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))} required /></div>
                    <Button type="submit" disabled={loading} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">{loading ? "Signing in..." : "Sign In"}</Button>
                    <p className="text-center text-xs text-muted-foreground"><a href="/#/reset-password" className="text-primary hover:underline">Forgot your password?</a></p>
                  </form>
                )}
              </TabsContent>
              <TabsContent value="register">
                {regStep === "clia" ? (
                  <div className="space-y-4">
                    <div className="text-center mb-2">
                      <Building2 size={28} className="mx-auto text-primary mb-2" />
                      <p className="text-sm font-medium">Step 1: Look up your laboratory</p>
                      <p className="text-xs text-muted-foreground">Your CLIA certificate determines your tier and pricing</p>
                    </div>

                    <div className="space-y-1.5">
                      <Label>CLIA Number</Label>
                      <div className="flex gap-2">
                        <Input
                          value={cliaInput}
                          onChange={e => setCliaInput(e.target.value)}
                          placeholder="e.g. 05D2187634"
                          className="flex-1"
                        />
                        <Button type="button" onClick={handleCLIALookup} disabled={cliaLooking || !cliaInput.trim()}>
                          {cliaLooking ? <Search className="animate-spin" size={16} /> : <Search size={16} />}
                          <span className="ml-1.5">{cliaLooking ? "Looking up..." : "Look Up"}</span>
                        </Button>
                      </div>
                    </div>

                    {cliaResult && (
                      <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg p-4 space-y-2">
                        <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
                          <CheckCircle size={16} />
                          <span className="font-medium text-sm">We found your laboratory:</span>
                        </div>
                        <div className="text-sm space-y-1 text-foreground">
                          <p className="font-semibold">{cliaResult.facility_name}</p>
                          <p className="text-muted-foreground text-xs">{cliaResult.address}</p>
                          <p className="text-xs">CLIA: {cliaResult.clia_number}</p>
                          <p className="text-xs">Certificate Type: {cliaResult.certificate_type}</p>
                          {cliaResult.lab_director && <p className="text-xs">Laboratory Director: {cliaResult.lab_director}</p>}
                          <p className="text-xs">Certified Specialties: {cliaResult.specialty_count}</p>
                          {cliaResult.valid_through && <p className="text-xs">Certificate Valid Through: {cliaResult.valid_through}</p>}
                          <div className="mt-2 pt-2 border-t border-emerald-200 dark:border-emerald-700">
                            <p className="font-medium text-primary">
                              Your tier: {TIER_LABELS[cliaResult.tier] || cliaResult.tier} - ${cliaResult.base_price}/yr
                              <span className="text-xs text-muted-foreground ml-1">(includes first seat)</span>
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2 mt-3">
                          <Button onClick={handleConfirmLab} className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground">
                            This is my lab - Continue
                          </Button>
                          <Button variant="outline" onClick={() => { setCliaResult(null); setCliaInput(""); }} className="shrink-0">
                            Search again
                          </Button>
                        </div>
                      </div>
                    )}

                    <div className="text-center pt-2 border-t">
                      <button
                        type="button"
                        onClick={handleSkipClia}
                        className="text-xs text-primary hover:underline"
                      >
                        Purchasing VeritaCheck&#8482; only? Click here - no CLIA number required.
                      </button>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleRegister} className="space-y-4">
                    {(cliaConfirmed && cliaResult) && (
                      <div className="bg-muted rounded-lg p-3 text-xs space-y-0.5">
                        <p className="font-medium">{cliaResult.facility_name}</p>
                        <p className="text-muted-foreground">CLIA: {cliaResult.clia_number} | Tier: {TIER_LABELS[cliaResult.tier]}</p>
                      </div>
                    )}
                    {skipClia && (
                      <div className="bg-muted rounded-lg p-3 text-xs">
                        <p className="font-medium">VeritaCheck&#8482; Unlimited - $299/yr</p>
                        <p className="text-muted-foreground">Single user, method validation suite</p>
                      </div>
                    )}
                    <div className="space-y-1.5"><Label>Full Name</Label><Input value={registerForm.name} onChange={e => setRegisterForm(f => ({ ...f, name: e.target.value }))} placeholder="Your name" required /></div>
                    <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={registerForm.email} onChange={e => setRegisterForm(f => ({ ...f, email: e.target.value }))} placeholder="you@lab.com" required /></div>
                    <div className="space-y-1.5"><Label>Password</Label><Input type="password" value={registerForm.password} onChange={e => setRegisterForm(f => ({ ...f, password: e.target.value }))} placeholder="Min 6 characters" required /></div>
                    <Button type="submit" disabled={loading} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">{loading ? "Creating account..." : "Create Account"}</Button>
                    <button type="button" onClick={() => { setRegStep("clia"); setCliaConfirmed(false); setSkipClia(false); }} className="text-xs text-muted-foreground hover:underline w-full text-center">
                      Back to CLIA lookup
                    </button>
                  </form>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
        <p className="text-xs text-center text-muted-foreground mt-4">You can also run a study as a guest without an account.</p>
      </div>
    </div>
  );
}
