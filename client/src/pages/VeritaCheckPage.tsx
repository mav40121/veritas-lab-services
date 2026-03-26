import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PlusCircle, Trash2, FlaskConical, CheckCircle2, DollarSign, Loader2, XCircle } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { calculateStudy, type DataPoint } from "@/lib/calculations";
import { useAuth } from "@/components/AuthContext";
import { authHeaders } from "@/lib/auth";
import type { InsertStudy } from "@shared/schema";

const API_BASE = "https://www.veritaslabservices.com";

const CLIA_PRESETS = [
  { label: "Creatinine (±0.3 mg/dL or 7.5%)", value: 0.075, cfr: "CFR 493.931" },
  { label: "Glucose (±10%)", value: 0.10, cfr: "CFR 493.931" },
  { label: "Hemoglobin (±7%)", value: 0.07, cfr: "CFR 493.941" },
  { label: "Sodium (±4 mEq/L or 4%)", value: 0.04, cfr: "CFR 493.931" },
  { label: "Potassium (±5%)", value: 0.05, cfr: "CFR 493.931" },
  { label: "TSH (±3 SDs or 3 mIU/L)", value: 0.10, cfr: "CFR 493.933" },
  { label: "Custom", value: 0, cfr: "" },
];
const MIN_LEVELS = 3;
const MAX_LEVELS = 40;
const DEFAULT_LEVELS = 10;

function makeEmptyPoints(instruments: string[], count: number): DataPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    level: i + 1,
    expectedValue: null,
    instrumentValues: Object.fromEntries(instruments.map(n => [n, null])),
  }));
}

function resizeDataPoints(prev: DataPoint[], instruments: string[], newCount: number): DataPoint[] {
  if (newCount > prev.length) {
    // Add empty rows at the end
    const extras = Array.from({ length: newCount - prev.length }, (_, i) => ({
      level: prev.length + i + 1,
      expectedValue: null,
      instrumentValues: Object.fromEntries(instruments.map(n => [n, null])),
    }));
    return [...prev, ...extras];
  }
  // Trim rows from the end, renumber
  return prev.slice(0, newCount).map((dp, i) => ({ ...dp, level: i + 1 }));
}

const plans = [
  { name: "Per Study", price: "$9", unit: "per report", description: "Pay only when you need a study.", features: ["Single study run", "Full PDF report", "Cal ver + method comparison", "CLIA pass/fail evaluation"], cta: "Buy a Study", highlight: false },
  { name: "Annual Lab", price: "$149", unit: "per year", description: "Unlimited studies for your lab.", features: ["Unlimited studies", "All PDF reports", "Multi-instrument comparison", "Study history dashboard", "Priority support"], cta: "Subscribe — Best Value", highlight: true },
];

export default function VeritaCheckPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const { isLoggedIn } = useAuth();
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<"success" | "cancelled" | null>(null);

  // Check URL params for payment result after Stripe redirect
  useEffect(() => {
    const params = new URLSearchParams(search);
    const payment = params.get("payment");
    if (payment === "success") {
      setPaymentStatus("success");
      // Refresh user data to pick up new plan/credits
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    } else if (payment === "cancelled") {
      setPaymentStatus("cancelled");
    }
  }, [search]);

  const handleBuy = async (priceType: "perStudy" | "annual") => {
    if (!isLoggedIn) {
      toast({ title: "Sign in required", description: "Please create a free account to purchase.", variant: "destructive" });
      navigate("/login");
      return;
    }
    setCheckoutLoading(priceType);
    try {
      const res = await fetch(`${API_BASE}/api/stripe/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ priceType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Checkout failed");
      // Redirect to Stripe Checkout
      window.location.href = data.url;
    } catch (err: any) {
      toast({ title: "Payment error", description: err.message, variant: "destructive" });
      setCheckoutLoading(null);
    }
  };

  const [testName, setTestName] = useState("");
  const [analyst, setAnalyst] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [studyType, setStudyType] = useState<"cal_ver" | "method_comparison">("cal_ver");
  const [instrumentNames, setInstrumentNames] = useState<string[]>(["Instrument 1", "Instrument 2"]);
  const [cliaPreset, setCliaPreset] = useState(0);
  const [customClia, setCustomClia] = useState(0.075);
  const [numLevels, setNumLevels] = useState(DEFAULT_LEVELS);
  const [dataPoints, setDataPoints] = useState<DataPoint[]>(makeEmptyPoints(["Instrument 1", "Instrument 2"], DEFAULT_LEVELS));

  const handleNumLevelsChange = (val: string) => {
    const n = parseInt(val);
    setNumLevels(n);
    setDataPoints(prev => resizeDataPoints(prev, instrumentNames, n));
  };

  // Ref map: gridRefs[row][col] → the actual <input> DOM element
  const gridRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const setGridRef = useCallback((row: number, col: number) => (el: HTMLInputElement | null) => {
    const key = `${row}-${col}`;
    if (el) gridRefs.current.set(key, el);
    else gridRefs.current.delete(key);
  }, []);

  const cliaValue = CLIA_PRESETS[cliaPreset].value !== 0 ? CLIA_PRESETS[cliaPreset].value : customClia;

  const handleGridKeyDown = (e: React.KeyboardEvent, row: number, col: number) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    e.stopPropagation();
    const numRows = dataPoints.length;
    const numCols = instrumentNames.length + 1; // +1 for Expected
    let nextRow = row;
    let nextCol = col;
    if (e.shiftKey) {
      // Shift+Tab: go up
      nextRow = row - 1;
      if (nextRow < 0) { nextRow = numRows - 1; nextCol = col - 1; }
      if (nextCol < 0) return; // exit grid
    } else {
      // Tab: go down
      nextRow = row + 1;
      if (nextRow >= numRows) { nextRow = 0; nextCol = col + 1; }
      if (nextCol >= numCols) return; // exit grid
    }
    const next = gridRefs.current.get(`${nextRow}-${nextCol}`);
    next?.focus();
  };

  const updateInstrumentName = (idx: number, name: string) => {
    const oldName = instrumentNames[idx];
    const newNames = [...instrumentNames]; newNames[idx] = name; setInstrumentNames(newNames);
    setDataPoints(prev => prev.map(dp => { const vals = { ...dp.instrumentValues }; vals[name] = vals[oldName] ?? null; delete vals[oldName]; return { ...dp, instrumentValues: vals }; }));
  };

  const addInstrument = () => {
    if (instrumentNames.length >= 3) { toast({ title: "Maximum 3 instruments supported" }); return; }
    const newName = `Instrument ${instrumentNames.length + 1}`;
    setInstrumentNames([...instrumentNames, newName]);
    setDataPoints(prev => prev.map(dp => ({ ...dp, instrumentValues: { ...dp.instrumentValues, [newName]: null } })));
  };

  const addLevel = () => {
    if (dataPoints.length >= MAX_LEVELS) return;
    const n = dataPoints.length + 1;
    setNumLevels(n);
    setDataPoints(prev => [...prev, { level: n, expectedValue: null, instrumentValues: Object.fromEntries(instrumentNames.map(name => [name, null])) }]);
  };

  const removeLastLevel = () => {
    if (dataPoints.length <= MIN_LEVELS) return;
    const n = dataPoints.length - 1;
    setNumLevels(n);
    setDataPoints(prev => prev.slice(0, n));
  };

  const removeInstrument = (idx: number) => {
    if (instrumentNames.length <= 1) return;
    const name = instrumentNames[idx];
    setInstrumentNames(instrumentNames.filter((_, i) => i !== idx));
    setDataPoints(prev => prev.map(dp => { const vals = { ...dp.instrumentValues }; delete vals[name]; return { ...dp, instrumentValues: vals }; }));
  };

  const updateDataPoint = (levelIdx: number, field: string, value: string) => {
    const num = value === "" ? null : parseFloat(value);
    setDataPoints(prev => prev.map((dp, i) => {
      if (i !== levelIdx) return dp;
      if (field === "expectedValue") return { ...dp, expectedValue: num };
      return { ...dp, instrumentValues: { ...dp.instrumentValues, [field]: num } };
    }));
  };

  const filledLevels = dataPoints.filter(dp => dp.expectedValue !== null && instrumentNames.some(n => dp.instrumentValues[n] !== null)).length;

  const saveMutation = useMutation({
    mutationFn: async (study: InsertStudy) => {
      const headers: Record<string, string> = { "Content-Type": "application/json", ...authHeaders() };
      return fetch("/api/studies", { method: "POST", headers, body: JSON.stringify(study) });
    },
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/studies"] });
      navigate(`/study/${data.id}/results`);
    },
    onError: () => toast({ title: "Failed to save study", variant: "destructive" }),
  });

  const handleSubmit = () => {
    if (!testName.trim()) { toast({ title: "Please enter a test name", variant: "destructive" }); return; }
    if (filledLevels < MIN_LEVELS) { toast({ title: "Please enter at least 3 data points", variant: "destructive" }); return; }
    const results = calculateStudy(dataPoints, instrumentNames, cliaValue, studyType);
    const study: InsertStudy = {
      testName: testName.trim(), instrument: instrumentNames.join(", "), analyst: analyst.trim() || "—",
      date, studyType, cliaAllowableError: cliaValue, dataPoints: JSON.stringify(dataPoints),
      instruments: JSON.stringify(instrumentNames), status: results.overallPass ? "pass" : "fail",
      createdAt: new Date().toISOString(), userId: null,
    };
    saveMutation.mutate(study);
  };

  return (
    <div>
      {/* Hero */}
      <section className="border-b border-border bg-primary/5">
        <div className="container-default py-14">
          <div className="flex items-center gap-2 mb-4">
            <FlaskConical size={20} className="text-primary" />
            <Badge className="bg-primary/10 text-primary border-0">VeritaCheck</Badge>
          </div>
          <h1 className="font-serif text-4xl font-bold mb-3">The studies your lab has always run — finally done right.</h1>
          <p className="text-muted-foreground text-lg max-w-2xl leading-relaxed">
            Calibration verification and method comparison, automated and browser-based. CLIA-compliant PDF reports with scatter plots, percent recovery charts, and pass/fail evaluation — no desktop software required.
          </p>
        </div>
      </section>

      {/* Study Tool */}
      <section className="section-padding border-b border-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-serif text-2xl font-bold">New Study</h2>
            {!isLoggedIn && (
              <p className="text-xs text-muted-foreground">
                <a href="/#/login" className="text-primary hover:underline">Sign in</a> to save study history
              </p>
            )}
          </div>

          <Tabs defaultValue="setup" className="space-y-6">
            <TabsList className="grid grid-cols-2 w-full max-w-xs">
              <TabsTrigger value="setup">Setup</TabsTrigger>
              <TabsTrigger value="data">Data Entry</TabsTrigger>
            </TabsList>

            <TabsContent value="setup" className="space-y-5">
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">Study Information</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5"><Label>Test Name *</Label><Input placeholder="e.g. GC1 CREAT" value={testName} onChange={e => setTestName(e.target.value)} data-testid="input-test-name" /></div>
                    <div className="space-y-1.5"><Label>Analyst</Label><Input placeholder="Name or initials" value={analyst} onChange={e => setAnalyst(e.target.value)} /></div>
                    <div className="space-y-1.5"><Label>Study Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
                    <div className="space-y-1.5"><Label>Study Type</Label>
                      <Select value={studyType} onValueChange={v => setStudyType(v as any)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cal_ver">Calibration Verification</SelectItem>
                          <SelectItem value="method_comparison">Method Comparison</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base flex items-center justify-between">
                  Instruments / Methods
                  <Button variant="outline" size="sm" onClick={addInstrument} disabled={instrumentNames.length >= 3}><PlusCircle size={13} className="mr-1" />Add</Button>
                </CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {instrumentNames.map((name, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Badge variant="outline" className="w-7 justify-center shrink-0 text-xs">{idx + 1}</Badge>
                      <Input value={name} onChange={e => updateInstrumentName(idx, e.target.value)} placeholder={`Instrument ${idx + 1}`} />
                      {instrumentNames.length > 1 && <Button variant="ghost" size="icon" onClick={() => removeInstrument(idx)} className="text-muted-foreground hover:text-destructive shrink-0 w-8 h-8"><Trash2 size={13} /></Button>}
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">CLIA Total Allowable Error</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <Select value={String(cliaPreset)} onValueChange={v => setCliaPreset(parseInt(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CLIA_PRESETS.map((p, i) => <SelectItem key={i} value={String(i)}>{p.label}</SelectItem>)}</SelectContent>
                  </Select>
                  {CLIA_PRESETS[cliaPreset].value === 0 && (
                    <div className="flex items-center gap-2">
                      <Input type="number" step="0.005" min="0.01" max="0.5" value={customClia} onChange={e => setCustomClia(parseFloat(e.target.value) || 0.075)} className="max-w-[120px]" />
                      <span className="text-sm text-muted-foreground">= {(customClia * 100).toFixed(1)}% allowable error</span>
                    </div>
                  )}
                  {CLIA_PRESETS[cliaPreset].cfr && <p className="text-xs text-muted-foreground">Reference: {CLIA_PRESETS[cliaPreset].cfr}</p>}
                  <div className="rounded-md bg-primary/5 border border-primary/20 p-3">
                    <p className="text-xs text-primary font-medium">Active TEa: ±{(cliaValue * 100).toFixed(1)}% ({cliaValue.toFixed(4)})</p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="data">
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base flex items-center justify-between">
                  <span>Data Points</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground font-normal">Levels:</span>
                    <Select value={String(numLevels)} onValueChange={handleNumLevelsChange}>
                      <SelectTrigger className="h-7 w-20 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: MAX_LEVELS - MIN_LEVELS + 1 }, (_, i) => i + MIN_LEVELS).map(n => (
                          <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="outline" size="icon" className="h-7 w-7" onClick={removeLastLevel} disabled={dataPoints.length <= MIN_LEVELS} title="Remove last level">
                      <span className="text-base leading-none">−</span>
                    </Button>
                    <Button variant="outline" size="icon" className="h-7 w-7" onClick={addLevel} disabled={dataPoints.length >= MAX_LEVELS} title="Add level">
                      <PlusCircle size={13} />
                    </Button>
                    <Badge variant="outline">{filledLevels} / {dataPoints.length} filled</Badge>
                  </div>
                </CardTitle></CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-border">
                        <th className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium w-12">Lvl</th>
                        <th className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium">{studyType === "method_comparison" ? "Reference" : "Expected"}</th>
                        {instrumentNames.map(n => <th key={n} className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium">{n}</th>)}
                      </tr></thead>
                      <tbody>
                        {dataPoints.map((dp, idx) => (
                          <tr key={idx} className="border-b border-border/50">
                            <td className="py-1.5 pr-4"><span className="text-xs text-muted-foreground font-mono">L{dp.level}</span></td>
                            <td className="py-1.5 pr-4"><Input type="number" step="any" placeholder="—" value={dp.expectedValue ?? ""} onChange={e => updateDataPoint(idx, "expectedValue", e.target.value)} className="h-8 text-sm w-28" ref={setGridRef(idx, 0)} onKeyDown={e => handleGridKeyDown(e, idx, 0)} /></td>
                            {instrumentNames.map((n, colIdx) => <td key={n} className="py-1.5 pr-4"><Input type="number" step="any" placeholder="—" value={dp.instrumentValues[n] ?? ""} onChange={e => updateDataPoint(idx, n, e.target.value)} className="h-8 text-sm w-28" ref={setGridRef(idx, colIdx + 1)} onKeyDown={e => handleGridKeyDown(e, idx, colIdx + 1)} /></td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
              <div className="mt-4 flex items-center gap-3">
                <Button variant="outline" size="sm" onClick={() => {
                  setTestName("GC1 CREAT"); setAnalyst("SED"); setDate("2025-02-06");
                  const names = ["ATELLICA 2 Run 1", "ATELLICA 2 Run 2"]; setInstrumentNames(names); setCliaPreset(0);
                const demoData = [
                    { level: 1, expectedValue: 0.3, instrumentValues: { "ATELLICA 2 Run 1": 0.31, "ATELLICA 2 Run 2": 0.29 } },
                    { level: 2, expectedValue: 7.0, instrumentValues: { "ATELLICA 2 Run 1": 7.37, "ATELLICA 2 Run 2": 7.37 } },
                    { level: 3, expectedValue: 13.8, instrumentValues: { "ATELLICA 2 Run 1": 14.25, "ATELLICA 2 Run 2": 14.21 } },
                    { level: 4, expectedValue: 20.5, instrumentValues: { "ATELLICA 2 Run 1": 20.88, "ATELLICA 2 Run 2": 20.91 } },
                    { level: 5, expectedValue: 27.3, instrumentValues: { "ATELLICA 2 Run 1": 27.22, "ATELLICA 2 Run 2": 27.11 } },
                    ...Array.from({ length: 5 }, (_, i) => ({ level: i + 6, expectedValue: null, instrumentValues: { "ATELLICA 2 Run 1": null, "ATELLICA 2 Run 2": null } })),
                  ];
                  setNumLevels(10);
                  setDataPoints(demoData);
                }}>
                  <FlaskConical size={13} className="mr-1.5" />Load Demo Data
                </Button>
                <span className="text-xs text-muted-foreground">Milford creatinine calibration verification example</span>
              </div>
            </TabsContent>
          </Tabs>

          <div className="mt-8 flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {filledLevels >= 3 ? <span className="text-green-600 dark:text-green-400">✓ {filledLevels} levels ready</span> : <span>{filledLevels} / 3 minimum levels filled</span>}
            </div>
            <Button onClick={handleSubmit} disabled={saveMutation.isPending || filledLevels < 3 || !testName.trim()} size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold" data-testid="button-submit-study">
              {saveMutation.isPending ? "Calculating…" : "Run Study & Generate Report"}
            </Button>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="section-padding bg-secondary/20" id="pricing">
        <div className="container-default max-w-4xl">
          <div className="flex items-center justify-center gap-2 mb-3">
            <DollarSign size={18} className="text-primary" />
            <h2 className="font-serif text-2xl font-bold">Simple Pricing</h2>
          </div>
          <p className="text-muted-foreground text-center mb-6">No hidden fees. Cancel anytime.</p>

          {/* Payment result banners */}
          {paymentStatus === "success" && (
            <Alert className="mb-6 max-w-2xl mx-auto border-green-500/30 bg-green-500/10">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-700 dark:text-green-400 font-medium">
                Payment successful — your account has been updated. Thank you!
              </AlertDescription>
            </Alert>
          )}
          {paymentStatus === "cancelled" && (
            <Alert className="mb-6 max-w-2xl mx-auto border-yellow-500/30 bg-yellow-500/10">
              <XCircle className="h-4 w-4 text-yellow-600" />
              <AlertDescription className="text-yellow-700 dark:text-yellow-400">
                Payment cancelled — no charge was made.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid sm:grid-cols-2 gap-6 max-w-2xl mx-auto">
            {plans.map(plan => {
              const priceType = plan.name === "Per Study" ? "perStudy" : "annual";
              const isLoading = checkoutLoading === priceType;
              return (
                <Card key={plan.name} className={`relative border-2 ${plan.highlight ? "border-primary bg-primary/5" : "border-border"}`}>
                  {plan.highlight && <div className="absolute -top-3 left-1/2 -translate-x-1/2"><Badge className="bg-primary text-primary-foreground">Most Popular</Badge></div>}
                  <CardContent className="p-6">
                    <h3 className="font-bold text-lg mb-1">{plan.name}</h3>
                    <div className="flex items-baseline gap-1 mb-2">
                      <span className="text-3xl font-bold">{plan.price}</span>
                      <span className="text-sm text-muted-foreground">/{plan.unit.split("per ")[1]}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-4">{plan.description}</p>
                    <ul className="space-y-2 mb-5">
                      {plan.features.map(f => <li key={f} className="flex items-center gap-2 text-sm"><CheckCircle2 size={13} className="text-primary shrink-0" />{f}</li>)}
                    </ul>
                    <Button
                      className={`w-full ${plan.highlight ? "bg-primary hover:bg-primary/90 text-primary-foreground" : ""}`}
                      variant={plan.highlight ? "default" : "outline"}
                      disabled={isLoading || checkoutLoading !== null}
                      onClick={() => handleBuy(priceType)}
                    >
                      {isLoading ? <><Loader2 size={14} className="mr-2 animate-spin" />Redirecting…</> : plan.cta}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <p className="text-center text-xs text-muted-foreground mt-6">
            Questions? <a href="/#/contact" className="text-primary hover:underline">Contact us</a> — we're happy to help.
          </p>
        </div>
      </section>
    </div>
  );
}
