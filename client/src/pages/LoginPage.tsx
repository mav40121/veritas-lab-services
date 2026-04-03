import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/components/AuthContext";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { FlaskConical, Search, Building2, CheckCircle, AlertTriangle } from "lucide-react";

// Hospital result from /api/lookup/hospital
interface HospitalResult {
  name: string;
  state: string;
  zip: string;
  beds: number;
  ccn: string;
  facilityType: string;
  suggestedTier: string;
  tierLabel: string;
  tierPrice: number;
  tierSeats: number;
}

// Tier definitions for self-selection
const TIER_OPTIONS = [
  { id: "clinic",     label: "Clinic",     price: 499,  seats: 2,  beds: "0-25 beds",    desc: "Solo director or designee + one tech" },
  { id: "community",  label: "Community",  price: 799,  seats: 5,  beds: "26-100 beds",  desc: "Community hospital lab" },
  { id: "hospital",   label: "Hospital",   price: 1299, seats: 15, beds: "101-300 beds", desc: "Regional or acute care hospital" },
  { id: "enterprise", label: "Enterprise", price: 1999, seats: 25, beds: "300+ beds",    desc: "Multi-dept or health system" },
];
const TIER_UNIT = "yr";

// Lab type options
type LabType = "hospital" | "independent" | "pol" | "other";
const LAB_TYPE_OPTIONS: { id: LabType; label: string; desc: string }[] = [
  { id: "hospital",     label: "Hospital / Health System",  desc: "Search by hospital name to get a recommended plan" },
  { id: "independent",  label: "Independent / Reference Lab", desc: "Stand-alone reference or send-out lab" },
  { id: "pol",          label: "Physician Office Lab (POL)", desc: "Lab in a physician practice" },
  { id: "other",        label: "FQHC / Tribal / Other",     desc: "Federally qualified health center, tribal lab, or other" },
];

// US States for dropdown
const US_STATES = [
  "AK","AL","AR","AZ","CA","CO","CT","DC","DE","FL","GA","HI","IA","ID","IL","IN","KS","KY",
  "LA","MA","MD","ME","MI","MN","MO","MS","MT","NC","ND","NE","NH","NJ","NM","NV","NY","OH",
  "OK","OR","PA","RI","SC","SD","TN","TX","UT","VA","VT","WA","WI","WV","WY",
];

export default function LoginPage() {
  const { login } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [registerForm, setRegisterForm] = useState({ name: "", email: "", password: "" });
  const [hipaaAcknowledged, setHipaaAcknowledged] = useState(false);
  const [hipaaError, setHipaaError] = useState("");

  // Registration step: "labtype" | "hospital-search" | "self-select" | "form"
  const [regStep, setRegStep] = useState<"labtype" | "hospital-search" | "self-select" | "form">("labtype");
  const [labType, setLabType] = useState<LabType | null>(null);

  // Hospital search state
  const [hospitalQuery, setHospitalQuery] = useState("");
  const [hospitalState, setHospitalState] = useState("");
  const [hospitalSearching, setHospitalSearching] = useState(false);
  const [hospitalResults, setHospitalResults] = useState<HospitalResult[]>([]);
  const [selectedHospital, setSelectedHospital] = useState<HospitalResult | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Self-selection state
  const [selectedTier, setSelectedTier] = useState<string | null>(null);

  // Session conflict state
  const [sessionConflict, setSessionConflict] = useState(false);
  const [conflictData, setConflictData] = useState<any>(null);

  // Debounced hospital search
  useEffect(() => {
    if (hospitalQuery.length < 3) {
      setHospitalResults([]);
      setShowDropdown(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setHospitalSearching(true);
      try {
        const params = new URLSearchParams({ name: hospitalQuery });
        if (hospitalState) params.set("state", hospitalState);
        const res = await fetch(`/api/lookup/hospital?${params.toString()}`);
        const data = await res.json();
        setHospitalResults(data.results || []);
        setShowDropdown((data.results || []).length > 0);
      } catch {
        setHospitalResults([]);
      } finally {
        setHospitalSearching(false);
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [hospitalQuery, hospitalState]);

  function handleLabTypeSelect(lt: LabType) {
    setLabType(lt);
    if (lt === "hospital") {
      setRegStep("hospital-search");
    } else {
      setRegStep("self-select");
    }
  }

  function handleSelectHospital(h: HospitalResult) {
    setSelectedHospital(h);
    setHospitalQuery(h.name);
    setShowDropdown(false);
    setHospitalResults([]);
  }

  function handleConfirmHospital() {
    if (!selectedHospital) return;
    setSelectedTier(selectedHospital.suggestedTier);
    setRegStep("form");
  }

  function handleChooseDifferentTier() {
    setSelectedHospital(null);
    setRegStep("self-select");
  }

  function handleTierSelect(tierId: string) {
    setSelectedTier(tierId);
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
        if (data.session_token) localStorage.setItem("veritas_session_token", data.session_token);
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
    if (!hipaaAcknowledged) {
      setHipaaError("You must agree to the data use policy to create an account.");
      return;
    }
    setHipaaError("");
    setLoading(true);
    try {
      const payload: Record<string, any> = {
        ...registerForm,
        hipaa_acknowledged: true,
        plan: selectedTier || "free",
      };
      if (selectedHospital) {
        payload.hospital_name = selectedHospital.name;
        payload.hospital_state = selectedHospital.state;
        payload.bed_count = selectedHospital.beds;
      }

      const res = await apiRequest("POST", "/api/auth/register", payload);
      const data = await res.json();
      if (!res.ok) { toast({ title: data.error || "Registration failed", variant: "destructive" }); return; }

      if (data.session_token) {
        localStorage.setItem("veritas_session_token", data.session_token);
      }

      login(data.token, data.user);
      navigate("/dashboard");
    } catch { toast({ title: "Registration failed", variant: "destructive" }); }
    finally { setLoading(false); }
  }

  // Summary chip for form step header
  function getFormSummary() {
    if (selectedHospital) {
      const tier = TIER_OPTIONS.find(t => t.id === selectedTier);
      return {
        name: selectedHospital.name,
        sub: `${selectedHospital.state} - ${selectedHospital.beds} beds - ${tier?.label || selectedTier} Plan - $${tier?.price || 0}/yr - ${tier?.seats || 0} seats`,
      };
    }
    const tier = TIER_OPTIONS.find(t => t.id === selectedTier);
    const lt = LAB_TYPE_OPTIONS.find(l => l.id === labType);
    return {
      name: lt?.label || "Laboratory",
      sub: tier ? `${tier.label} Plan - $${tier.price}/yr - ${tier.seats} seats` : "Plan not selected",
    };
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

              {/* ── LOGIN TAB ── */}
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

              {/* ── REGISTER TAB ── */}
              <TabsContent value="register">

                {/* STEP 1: Lab type selection */}
                {regStep === "labtype" && (
                  <div className="space-y-4">
                    <div className="text-center mb-1">
                      <Building2 size={26} className="mx-auto text-primary mb-2" />
                      <p className="text-sm font-medium">Step 1: What type of lab do you operate?</p>
                      <p className="text-xs text-muted-foreground">This helps us recommend the right pricing tier</p>
                    </div>
                    <div className="space-y-2">
                      {LAB_TYPE_OPTIONS.map(lt => (
                        <button
                          key={lt.id}
                          type="button"
                          onClick={() => handleLabTypeSelect(lt.id)}
                          className="w-full text-left border rounded-lg px-4 py-3 hover:border-primary hover:bg-primary/5 transition-colors"
                        >
                          <p className="text-sm font-medium">{lt.label}</p>
                          <p className="text-xs text-muted-foreground">{lt.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* STEP 2A: Hospital name search */}
                {regStep === "hospital-search" && (
                  <div className="space-y-4">
                    <div className="text-center mb-1">
                      <Search size={24} className="mx-auto text-primary mb-2" />
                      <p className="text-sm font-medium">Step 2: Find your hospital</p>
                      <p className="text-xs text-muted-foreground">We will look up your licensed bed count and suggest a plan</p>
                    </div>

                    <div className="flex gap-2">
                      <select
                        value={hospitalState}
                        onChange={e => setHospitalState(e.target.value)}
                        className="border rounded-md px-2 py-1.5 text-sm bg-background w-20 shrink-0"
                      >
                        <option value="">State</option>
                        {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <div className="relative flex-1">
                        <Input
                          value={hospitalQuery}
                          onChange={e => { setHospitalQuery(e.target.value); setSelectedHospital(null); }}
                          placeholder="Type hospital name..."
                          className="w-full"
                          autoComplete="off"
                        />
                        {hospitalSearching && (
                          <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground animate-spin" />
                        )}
                        {showDropdown && (
                          <div className="absolute z-50 w-full mt-1 bg-background border rounded-lg shadow-lg max-h-56 overflow-y-auto">
                            {hospitalResults.map((h, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => handleSelectHospital(h)}
                                className="w-full text-left px-3 py-2.5 hover:bg-muted text-sm border-b last:border-b-0"
                              >
                                <p className="font-medium truncate">{h.name}</p>
                                <p className="text-xs text-muted-foreground">{h.state} - {h.beds} beds - {h.tierLabel} recommended</p>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Tier suggestion card */}
                    {selectedHospital && (
                      <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg p-4 space-y-2">
                        <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
                          <CheckCircle size={15} />
                          <span className="font-medium text-sm">Hospital found</span>
                        </div>
                        <p className="font-semibold text-sm">{selectedHospital.name}</p>
                        <p className="text-xs text-muted-foreground">{selectedHospital.state} - {selectedHospital.beds} licensed beds</p>
                        <div className="mt-2 pt-2 border-t border-emerald-200 dark:border-emerald-700">
                          <p className="text-xs text-muted-foreground mb-0.5">Recommended plan:</p>
                          <p className="font-semibold text-primary">
                            {selectedHospital.tierLabel} - ${selectedHospital.tierPrice}/yr
                          </p>
                          <p className="text-xs text-muted-foreground">{selectedHospital.tierSeats} seats included</p>
                        </div>
                        <div className="flex gap-2 pt-1">
                          <Button onClick={handleConfirmHospital} className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground text-sm">
                            Continue with {selectedHospital.tierLabel}
                          </Button>
                          <Button variant="outline" onClick={handleChooseDifferentTier} className="text-sm shrink-0">
                            Choose different
                          </Button>
                        </div>
                      </div>
                    )}

                    {hospitalQuery.length >= 3 && !hospitalSearching && hospitalResults.length === 0 && !selectedHospital && !showDropdown && (
                      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm">
                        <p className="font-medium text-amber-800 dark:text-amber-300 text-xs">No match found</p>
                        <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">Try a different name or state, or select your plan below.</p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-2 w-full text-xs"
                          onClick={() => { setRegStep("self-select"); }}
                        >
                          Select plan manually
                        </Button>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => setRegStep("labtype")}
                      className="text-xs text-muted-foreground hover:underline w-full text-center pt-1"
                    >
                      Back to lab type
                    </button>
                  </div>
                )}

                {/* STEP 2B: Self-selection for non-hospital or no-match */}
                {regStep === "self-select" && (
                  <div className="space-y-3">
                    <div className="text-center mb-1">
                      <p className="text-sm font-medium">Step 2: Choose your plan</p>
                      <p className="text-xs text-muted-foreground">All plans include a 14-day trial period</p>
                    </div>
                    <div className="space-y-2">
                      {TIER_OPTIONS.map(t => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => handleTierSelect(t.id)}
                          className={`w-full text-left border rounded-lg px-4 py-3 transition-colors hover:border-primary hover:bg-primary/5 ${selectedTier === t.id ? "border-primary bg-primary/5" : ""}`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-semibold">{t.label}</p>
                              <p className="text-xs text-muted-foreground">{t.beds} - {t.seats} seats</p>
                              <p className="text-xs text-muted-foreground">{t.desc}</p>
                            </div>
                            <p className="text-sm font-semibold text-primary shrink-0 ml-3">${t.price}/yr</p>
                          </div>
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setRegStep("labtype")}
                      className="text-xs text-muted-foreground hover:underline w-full text-center"
                    >
                      Back to lab type
                    </button>
                  </div>
                )}

                {/* STEP 3: Registration form */}
                {regStep === "form" && (
                  <form onSubmit={handleRegister} className="space-y-4">
                    {(() => { const s = getFormSummary(); return (
                      <div className="bg-muted rounded-lg p-3 text-xs space-y-0.5">
                        <p className="font-medium">{s.name}</p>
                        <p className="text-muted-foreground">{s.sub}</p>
                      </div>
                    ); })()}
                    <div className="space-y-1.5"><Label>Full Name</Label><Input value={registerForm.name} onChange={e => setRegisterForm(f => ({ ...f, name: e.target.value }))} placeholder="Your name" required /></div>
                    <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={registerForm.email} onChange={e => setRegisterForm(f => ({ ...f, email: e.target.value }))} placeholder="you@lab.com" required /></div>
                    <div className="space-y-1.5"><Label>Password</Label><Input type="password" value={registerForm.password} onChange={e => setRegisterForm(f => ({ ...f, password: e.target.value }))} placeholder="Min 6 characters" required /></div>
                    <div className="space-y-2">
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={hipaaAcknowledged}
                          onChange={e => { setHipaaAcknowledged(e.target.checked); if (e.target.checked) setHipaaError(""); }}
                          className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary shrink-0"
                        />
                        <span className="text-sm text-foreground leading-relaxed">
                          I understand that VeritaAssure&#8482; is not a HIPAA-covered platform and is not designed to store, process, or transmit protected health information (PHI). I agree to use only de-identified data, sample IDs, QC lot numbers, and non-patient-identifiable information when entering data into any VeritaAssure&#8482; module.
                        </span>
                      </label>
                      {hipaaError && <p className="text-sm text-red-600">{hipaaError}</p>}
                    </div>
                    <Button type="submit" disabled={loading || !hipaaAcknowledged} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">
                      {loading ? "Creating account..." : "Create Account"}
                    </Button>
                    <button
                      type="button"
                      onClick={() => {
                        setRegStep(labType === "hospital" ? "hospital-search" : "self-select");
                        setSelectedTier(null);
                      }}
                      className="text-xs text-muted-foreground hover:underline w-full text-center"
                    >
                      Back to plan selection
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
