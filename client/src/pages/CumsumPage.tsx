import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/components/AuthContext";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { authHeaders } from "@/lib/auth";
import { downloadPdfToken } from "@/lib/utils";
import { saveAs } from "file-saver";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { PlusCircle, ArrowLeft, FileDown, Trash2, AlertTriangle, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Link } from "wouter";
import { geometricMean } from "@/lib/calculations";

const API_BASE = "https://www.veritaslabservices.com";

interface Tracker {
  id: number;
  instrument_name: string;
  analyte: string;
  created_at: string;
  lastCumsum: number;
  lastVerdict: string;
  lastEntryDate: string | null;
}

interface Entry {
  id: number;
  tracker_id: number;
  year: number;
  lot_label: string;
  old_lot_number: string;
  new_lot_number: string;
  old_lot_geomean: number | null;
  new_lot_geomean: number | null;
  difference: number | null;
  cumsum: number | null;
  verdict: string | null;
  specimen_data: string | null;
  notes: string;
  created_at: string;
}

interface SpecimenRow {
  specimenId: string;
  oldLot: string;
  newLot: string;
}

export default function CumsumPage() {
  const { isLoggedIn } = useAuth();
  const { toast } = useToast();
  const readOnly = useIsReadOnly();

  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [selectedTracker, setSelectedTracker] = useState<(Tracker & { entries: Entry[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNewTracker, setShowNewTracker] = useState(false);
  const [newInstrument, setNewInstrument] = useState("");
  const [newAnalyte, setNewAnalyte] = useState("PTT");

  // Add Lot Change state
  const [showAddEntry, setShowAddEntry] = useState(false);
  const [entryYear, setEntryYear] = useState(new Date().getFullYear());
  const [entryOldLot, setEntryOldLot] = useState("");
  const [entryNewLot, setEntryNewLot] = useState("");
  const [entryNotes, setEntryNotes] = useState("");
  const [isInstallLot, setIsInstallLot] = useState(false);
  const [specimens, setSpecimens] = useState<SpecimenRow[]>(
    Array.from({ length: 20 }, (_, i) => ({ specimenId: `S${String(i + 1).padStart(3, "0")}`, oldLot: "", newLot: "" }))
  );
  const [saving, setSaving] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [excelLoading, setExcelLoading] = useState(false);

  const fetchTrackers = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/veritacheck/cumsum/trackers`, { headers: authHeaders() });
      if (res.ok) setTrackers(await res.json());
    } catch { }
    setLoading(false);
  }, []);

  useEffect(() => { if (isLoggedIn) fetchTrackers(); else setLoading(false); }, [isLoggedIn, fetchTrackers]);

  const fetchTracker = async (id: number) => {
    const res = await fetch(`${API_BASE}/api/veritacheck/cumsum/trackers/${id}`, { headers: authHeaders() });
    if (res.ok) {
      const data = await res.json();
      setSelectedTracker(data);
    }
  };

  const createTracker = async () => {
    if (!newInstrument.trim()) { toast({ title: "Enter instrument name", variant: "destructive" }); return; }
    const res = await fetch(`${API_BASE}/api/veritacheck/cumsum/trackers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ instrumentName: newInstrument.trim(), analyte: newAnalyte }),
    });
    if (res.ok) {
      const tracker = await res.json();
      await fetchTrackers();
      setShowNewTracker(false);
      setNewInstrument("");
      fetchTracker(tracker.id);
    }
  };

  const deleteTracker = async (id: number) => {
    await fetch(`${API_BASE}/api/veritacheck/cumsum/trackers/${id}`, { method: "DELETE", headers: authHeaders() });
    setSelectedTracker(null);
    fetchTrackers();
  };

  // Parse specimens into numeric values for geometric mean calculation
  const parseSpecimenValues = (specimens: SpecimenRow[], field: "oldLot" | "newLot"): number[] => {
    return specimens
      .map(s => s[field].trim())
      .filter(v => v !== "" && v.toLowerCase() !== ">150" && !isNaN(parseFloat(v)))
      .map(v => parseFloat(v));
  };

  const computePreview = () => {
    if (isInstallLot) {
      const newVals = parseSpecimenValues(specimens, "newLot");
      if (newVals.length === 0) return null;
      const gm = geometricMean(newVals);
      return { oldGeoMean: null, newGeoMean: gm, difference: null, cumsum: 0, verdict: "BASELINE" };
    }
    const oldVals = parseSpecimenValues(specimens, "oldLot");
    const newVals = parseSpecimenValues(specimens, "newLot");
    if (oldVals.length === 0 || newVals.length === 0) return null;
    const oldGM = geometricMean(oldVals);
    const newGM = geometricMean(newVals);
    const diff = newGM - oldGM;
    const prevCumsum = selectedTracker?.entries?.length
      ? (selectedTracker.entries[selectedTracker.entries.length - 1].cumsum ?? 0)
      : 0;
    const cumsum = prevCumsum + diff;
    const verdict = Math.abs(cumsum) <= 7.0 ? "ACCEPT" : "ACTION REQUIRED";
    return { oldGeoMean: oldGM, newGeoMean: newGM, difference: diff, cumsum, verdict };
  };

  const saveEntry = async () => {
    if (!selectedTracker) return;
    const preview = computePreview();
    if (!preview) { toast({ title: "Enter specimen data", variant: "destructive" }); return; }

    const filledSpecimens = specimens.filter(s => s.oldLot.trim() || s.newLot.trim());
    if (!isInstallLot && filledSpecimens.length < 15) {
      if (!confirm(`Only ${filledSpecimens.length} specimens entered. Minimum 15 recommended. Continue?`)) return;
    }

    setSaving(true);
    try {
      const body = {
        year: entryYear,
        lotLabel: isInstallLot ? "Install Lot" : `${entryOldLot} → ${entryNewLot}`,
        oldLotNumber: isInstallLot ? null : entryOldLot,
        newLotNumber: isInstallLot ? entryNewLot || "Install" : entryNewLot,
        oldLotGeomean: preview.oldGeoMean,
        newLotGeomean: preview.newGeoMean,
        difference: preview.difference,
        cumsum: preview.cumsum,
        verdict: isInstallLot ? "BASELINE" : preview.verdict,
        specimenData: filledSpecimens,
        notes: entryNotes,
      };
      const res = await fetch(`${API_BASE}/api/veritacheck/cumsum/trackers/${selectedTracker.id}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        await fetchTracker(selectedTracker.id);
        setShowAddEntry(false);
        setSpecimens(Array.from({ length: 20 }, (_, i) => ({ specimenId: `S${String(i + 1).padStart(3, "0")}`, oldLot: "", newLot: "" })));
        setEntryOldLot(""); setEntryNewLot(""); setEntryNotes(""); setIsInstallLot(false);
        toast({ title: "Entry saved" });
        fetchTrackers();
      }
    } catch { toast({ title: "Failed to save", variant: "destructive" }); }
    setSaving(false);
  };

  const downloadExcel = async () => {
    if (!selectedTracker) return;
    setExcelLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/veritacheck/cumsum/trackers/${selectedTracker.id}/excel`, { headers: authHeaders() });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      saveAs(blob, `CUMSUM_${selectedTracker.instrument_name}.xlsx`);
    } catch { toast({ title: "Excel export failed", variant: "destructive" }); }
    setExcelLoading(false);
  };

  const downloadPDF = async () => {
    if (!selectedTracker) return;
    setPdfLoading(true);
    try {
      const lastEntry = selectedTracker.entries?.[selectedTracker.entries.length - 1];
      const specimenData = lastEntry?.specimen_data ? JSON.parse(lastEntry.specimen_data) : [];
      const res = await fetch(`${API_BASE}/api/veritacheck/cumsum/trackers/${selectedTracker.id}/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ currentSpecimens: specimenData }),
      });
      if (!res.ok) throw new Error();
      const { token } = await res.json();
      downloadPdfToken(token, `CUMSUM_${selectedTracker.instrument_name}.pdf`);
    } catch { toast({ title: "PDF export failed", variant: "destructive" }); }
    setPdfLoading(false);
  };

  const preview = showAddEntry ? computePreview() : null;

  if (!isLoggedIn) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16 text-center">
        <h2 className="text-2xl font-serif font-bold mb-4">VeritaCheck™ CUMSUM</h2>
        <p className="text-muted-foreground mb-4">Sign in to access the CUMSUM study type for monitoring PTT heparin sensitivity across lot changes.</p>
        <Button asChild><Link href="/login">Sign In</Link></Button>
      </div>
    );
  }

  // Tracker detail view
  if (selectedTracker) {
    return (
      <div>
        <section className="border-b border-border bg-primary/5">
          <div className="container-default py-10">
            <div className="flex items-center gap-2 mb-3">
              <Button variant="ghost" size="sm" onClick={() => setSelectedTracker(null)} className="-ml-2"><ArrowLeft size={14} className="mr-1" />All Trackers</Button>
            </div>
            <h1 className="font-serif text-3xl font-bold mb-1">CUMSUM Tracker: {selectedTracker.instrument_name}</h1>
            <p className="text-muted-foreground">Analyte: {selectedTracker.analyte} | Cumulative summation of PTT lot-to-lot differences</p>
          </div>
        </section>

        <section className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
          <div className="flex items-center gap-3 flex-wrap">
            <Button onClick={() => { setShowAddEntry(true); setIsInstallLot(selectedTracker.entries.length === 0); }} disabled={showAddEntry}>
              <PlusCircle size={14} className="mr-1.5" />{selectedTracker.entries.length === 0 ? "Add Install Lot" : "Add Lot Change"}
            </Button>
            <Button variant="outline" onClick={downloadExcel} disabled={excelLoading || selectedTracker.entries.length === 0}>
              <FileDown size={14} className="mr-1.5" />{excelLoading ? "Exporting..." : "Export Excel"}
            </Button>
            <Button variant="outline" onClick={downloadPDF} disabled={pdfLoading || selectedTracker.entries.length === 0}>
              <FileDown size={14} className="mr-1.5" />{pdfLoading ? "Generating..." : "Export PDF"}
            </Button>
            <ConfirmDialog
              title="Delete Tracker?"
              message="Delete this tracker and all its entries? This cannot be undone."
              confirmLabel="Delete"
              onConfirm={() => deleteTracker(selectedTracker.id)}
            >
              <Button variant="ghost" size="sm" className="text-destructive ml-auto">
                <Trash2 size={14} className="mr-1" />Delete Tracker
              </Button>
            </ConfirmDialog>
          </div>

          {/* History table */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">CUMSUM History</CardTitle></CardHeader>
            <CardContent>
              {selectedTracker.entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">No entries yet. Add the Install Lot to establish the baseline.</p>
              ) : (
                <div className="overflow-x-auto w-full">
                  <table className="min-w-[600px] w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 pr-3 text-xs text-muted-foreground font-medium">Year</th>
                        <th className="text-left py-2 pr-3 text-xs text-muted-foreground font-medium">Old Lot</th>
                        <th className="text-left py-2 pr-3 text-xs text-muted-foreground font-medium">New Lot</th>
                        <th className="text-right py-2 pr-3 text-xs text-muted-foreground font-medium">Old GeoMean</th>
                        <th className="text-right py-2 pr-3 text-xs text-muted-foreground font-medium">New GeoMean</th>
                        <th className="text-right py-2 pr-3 text-xs text-muted-foreground font-medium">New−Old</th>
                        <th className="text-right py-2 pr-3 text-xs text-muted-foreground font-medium">CumSum</th>
                        <th className="text-left py-2 text-xs text-muted-foreground font-medium">Verdict</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedTracker.entries.map((e, idx) => (
                        <tr key={e.id} className={`border-b border-border/50 ${e.verdict === "ACTION REQUIRED" ? "bg-red-50 dark:bg-red-950/20" : e.verdict === "ACCEPT" ? "bg-green-50/50 dark:bg-green-950/10" : ""}`}>
                          <td className="py-2 pr-3">{e.year}</td>
                          <td className="py-2 pr-3 font-mono text-xs">{e.old_lot_number || "-"}</td>
                          <td className="py-2 pr-3 font-mono text-xs">{e.new_lot_number || "-"}</td>
                          <td className="py-2 pr-3 text-right font-mono">{e.old_lot_geomean != null ? Number(e.old_lot_geomean).toFixed(1) : "-"}</td>
                          <td className="py-2 pr-3 text-right font-mono">{e.new_lot_geomean != null ? Number(e.new_lot_geomean).toFixed(1) : "-"}</td>
                          <td className="py-2 pr-3 text-right font-mono">{e.difference != null ? (e.difference >= 0 ? "+" : "") + Number(e.difference).toFixed(1) : "-"}</td>
                          <td className="py-2 pr-3 text-right font-mono font-semibold">{e.cumsum != null ? Number(e.cumsum).toFixed(1) : "-"}</td>
                          <td className="py-2">
                            {e.verdict === "ACCEPT" && <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-0">ACCEPT</Badge>}
                            {e.verdict === "ACTION REQUIRED" && <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-0">ACTION REQUIRED</Badge>}
                            {e.verdict === "BASELINE" && <Badge variant="outline">BASELINE</Badge>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-xs text-muted-foreground mt-2 sm:hidden">Scroll horizontally to see all columns</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Add lot change panel */}
          {showAddEntry && (
            <Card className="border-primary/30">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>{isInstallLot ? "Install Lot (Baseline)" : "Add Lot Change"}</span>
                  <Button variant="ghost" size="sm" onClick={() => setShowAddEntry(false)}>Cancel</Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label>Year</Label>
                    <Input type="number" value={entryYear} onChange={e => setEntryYear(parseInt(e.target.value) || new Date().getFullYear())} />
                  </div>
                  {!isInstallLot && (
                    <div className="space-y-1.5">
                      <Label>Old Lot #</Label>
                      <Input value={entryOldLot} onChange={e => setEntryOldLot(e.target.value)} placeholder="e.g. N0724170" />
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label>{isInstallLot ? "Install Lot #" : "New Lot #"}</Label>
                    <Input value={entryNewLot} onChange={e => setEntryNewLot(e.target.value)} placeholder="e.g. N0824180" />
                  </div>
                </div>

                {selectedTracker.entries.length > 0 && !isInstallLot && (
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={isInstallLot} onChange={e => setIsInstallLot(e.target.checked)} className="rounded" />
                    This is an install lot (baseline, no comparison)
                  </label>
                )}

                <div className="space-y-2">
                  <div className="text-sm font-medium">Specimen Data - {selectedTracker.analyte} (seconds)</div>
                  <p className="text-xs text-muted-foreground">Enter &gt;150 to exclude a specimen from geometric mean calculation. Minimum 15 specimens recommended.</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 pr-3 text-xs text-muted-foreground font-medium w-24">Specimen</th>
                          {!isInstallLot && <th className="text-left py-2 pr-3 text-xs text-muted-foreground font-medium">Old Lot (sec)</th>}
                          <th className="text-left py-2 pr-3 text-xs text-muted-foreground font-medium">{isInstallLot ? "Lot (sec)" : "New Lot (sec)"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {specimens.map((s, idx) => (
                          <tr key={idx} className="border-b border-border/50">
                            <td className="py-1 pr-3">
                              <Input value={s.specimenId} onChange={e => { const d = [...specimens]; d[idx] = { ...d[idx], specimenId: e.target.value }; setSpecimens(d); }} className="h-7 text-xs w-20" />
                            </td>
                            {!isInstallLot && (
                              <td className="py-1 pr-3">
                                <Input placeholder="-" value={s.oldLot} onChange={e => { const d = [...specimens]; d[idx] = { ...d[idx], oldLot: e.target.value }; setSpecimens(d); }} className="h-7 text-xs w-24" />
                              </td>
                            )}
                            <td className="py-1 pr-3">
                              <Input placeholder="-" value={s.newLot} onChange={e => { const d = [...specimens]; d[idx] = { ...d[idx], newLot: e.target.value }; setSpecimens(d); }} className="h-7 text-xs w-24" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setSpecimens([...specimens, { specimenId: `S${String(specimens.length + 1).padStart(3, "0")}`, oldLot: "", newLot: "" }])}>
                    <PlusCircle size={12} className="mr-1" />Add Row
                  </Button>
                </div>

                <div className="space-y-1.5">
                  <Label>Notes (optional)</Label>
                  <Input value={entryNotes} onChange={e => setEntryNotes(e.target.value)} placeholder="Any observations..." />
                </div>

                {/* Preview */}
                {preview && (
                  <div className="rounded-md border p-4 space-y-2 bg-muted/30">
                    <div className="text-sm font-medium">Preview</div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                      {preview.oldGeoMean != null && <div><span className="text-muted-foreground">Old GeoMean:</span> <span className="font-mono font-semibold">{preview.oldGeoMean.toFixed(1)}</span></div>}
                      <div><span className="text-muted-foreground">{isInstallLot ? "GeoMean:" : "New GeoMean:"}</span> <span className="font-mono font-semibold">{preview.newGeoMean!.toFixed(1)}</span></div>
                      {preview.difference != null && <div><span className="text-muted-foreground">Difference:</span> <span className="font-mono font-semibold">{(preview.difference >= 0 ? "+" : "")}{preview.difference.toFixed(1)}</span></div>}
                      <div><span className="text-muted-foreground">CumSum:</span> <span className="font-mono font-semibold">{preview.cumsum.toFixed(1)}</span></div>
                    </div>
                    {!isInstallLot && (
                      <div className="mt-2">
                        {preview.verdict === "ACCEPT" ? (
                          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-0"><CheckCircle2 size={12} className="mr-1" />ACCEPT - |CumSum| ≤ 7.0 sec</Badge>
                        ) : (
                          <div className="space-y-2">
                            <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-0"><XCircle size={12} className="mr-1" />ACTION REQUIRED - |CumSum| &gt; 7.0 sec</Badge>
                            <Alert variant="destructive">
                              <AlertTriangle size={14} />
                              <AlertDescription>A new Heparin Response Curve is required. Contact instrument technical support.</AlertDescription>
                            </Alert>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {!isInstallLot && specimens.filter(s => s.oldLot.trim() || s.newLot.trim()).length < 15 && (
                  <p className="text-xs text-amber-500 flex items-center gap-1"><AlertTriangle size={12} />Fewer than 15 specimens entered. Minimum 15 recommended</p>
                )}

                <Button onClick={saveEntry} disabled={saving || !preview} className="w-full">
                  {saving ? <><Loader2 size={14} className="mr-1.5 animate-spin" />Saving...</> : "Save Entry"}
                </Button>
              </CardContent>
            </Card>
          )}
        </section>
      </div>
    );
  }

  // Tracker list view
  return (
    <div>
      <section className="border-b border-border bg-primary/5">
        <div className="container-default py-14">
          <div className="flex items-center gap-2 mb-4">
            <Badge className="bg-primary/10 text-primary border-0">VeritaCheck</Badge>
          </div>
          <h1 className="font-serif text-4xl font-bold mb-3">VeritaCheck™ CUMSUM</h1>
          <p className="text-muted-foreground text-lg max-w-2xl leading-relaxed">
            Persistent cumulative summation tracking for PTT lot-to-lot changes. Monitor heparin sensitivity across the instrument lifecycle. ACCEPT when |CumSum| ≤ 7.0 seconds, ACTION REQUIRED otherwise.
          </p>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div className="flex items-center gap-3">
          <Button onClick={() => setShowNewTracker(true)} disabled={showNewTracker || readOnly} title={readOnly ? "Resubscribe to add new records" : undefined}>
            <PlusCircle size={14} className="mr-1.5" />New Tracker
          </Button>
          <Button asChild variant="outline"><Link href="/veritacheck">Back to VeritaCheck</Link></Button>
        </div>

        {showNewTracker && (
          <Card className="border-primary/30">
            <CardHeader className="pb-3"><CardTitle className="text-base">New CUMSUM Tracker</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Instrument Name</Label>
                  <Input value={newInstrument} onChange={e => setNewInstrument(e.target.value)} placeholder="e.g. ACL TOP 351" />
                </div>
                <div className="space-y-1.5">
                  <Label>Analyte</Label>
                  <Select value={newAnalyte} onValueChange={setNewAnalyte}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PTT">PTT</SelectItem>
                      <SelectItem value="APTT">APTT</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={createTracker}>Create Tracker</Button>
                <Button variant="ghost" onClick={() => setShowNewTracker(false)}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {loading ? (
          <div className="py-12 text-center text-muted-foreground"><Loader2 size={24} className="animate-spin mx-auto mb-2" />Loading trackers...</div>
        ) : trackers.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground mb-2">No CUMSUM trackers yet.</p>
              <p className="text-sm text-muted-foreground">Create a tracker for each instrument to monitor PTT lot-to-lot cumulative differences.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {trackers.map(t => (
              <Card key={t.id} className="cursor-pointer hover:border-primary/40 transition-colors" onClick={() => fetchTracker(t.id)}>
                <CardContent className="flex items-center justify-between py-4 px-5">
                  <div>
                    <div className="font-semibold text-base">{t.instrument_name}</div>
                    <div className="text-sm text-muted-foreground">{t.analyte} | Last updated: {t.lastEntryDate ? new Date(t.lastEntryDate).toLocaleDateString() : "Never"}</div>
                  </div>
                  <div className="text-right flex items-center gap-3">
                    <div>
                      <div className="font-mono text-lg font-bold">{Number(t.lastCumsum).toFixed(1)}</div>
                      <div className="text-xs text-muted-foreground">CumSum (sec)</div>
                    </div>
                    {t.lastVerdict === "ACCEPT" && <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-0">ACCEPT</Badge>}
                    {t.lastVerdict === "ACTION REQUIRED" && <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-0">ACTION REQUIRED</Badge>}
                    {t.lastVerdict === "N/A" && <Badge variant="outline">No Data</Badge>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
