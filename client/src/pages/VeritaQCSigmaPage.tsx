// VeritaQC: the sigma metric per test, level and lot (B12, 2026-11-24). Worked out on the server (server/qcSigma.ts); this page states the
// formula and every input beside the number. The number only: no grade and no color by value.
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/components/AuthContext";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { labDayOf } from "@/lib/labDate";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Lock, Sigma as SigmaIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { plural, SELECT, sendJson } from "@/components/qcimport/importShared";
import { SIGMA_FORMULA, type SigmaResult } from "@shared/qcSigma";

interface Allowable { preset_label: string | null; percent: number | null; units_value: number | null; unit: string | null; set_by_name: string | null; set_at: string }
interface Row {
  control_lot_id: number; analyte: string; level: string; lot_number: string; status: string; mfr_mean: number; peer_mean: { value: number; note: string | null; set_by_name: string | null; set_at: string } | null;
  analyzers: string[]; first_run: string | null; last_run: string | null; left_out: number; result: SigmaResult;
}
interface Data { formula: string; can_set: boolean; rows: Row[]; analytes: Array<{ analyte: string; allowable: Allowable | null; criteria: Array<{ label: string; cfr: string }> }> }

const n2 = (x: number | null) => (x === null ? "" : x.toFixed(2));
const n4 = (x: number | null) => (x === null ? "" : String(Number(x.toPrecision(5))));
const allowableText = (a: Allowable | null) => (!a ? "Not set" : a.preset_label ? a.preset_label : a.percent !== null ? `${a.percent}%` : `${a.units_value} ${a.unit ?? ""}`.trim());

export default function VeritaQCSigmaPage() {
  const { user, isLoggedIn } = useAuth();
  const isReadOnly = useIsReadOnly("veritaqc");
  const labId = useActiveLabId();
  const { toast } = useToast();
  const hasPlanAccess = !!user && [
    "annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "clinic", "waived", "community", "hospital", "large_hospital", "enterprise",
  ].includes(user.plan);
  const allowed = isLoggedIn && hasPlanAccess && !!labId && !isReadOnly;
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);
  const [old, setOld] = useState(false);
  const [setting, setSetting] = useState<string | null>(null);
  const [kind, setKind] = useState<"preset" | "percent" | "units">("percent");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("");
  const [peerFor, setPeerFor] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!labId) return;
    try {
      const r = await fetch(`${API_BASE}/api/labs/${labId}/qc/sigma`, { headers: authHeaders() });
      if (!r.ok) throw new Error();
      setData(await r.json()); setError(false);
    } catch { setError(true); }
  }
  useEffect(() => { setData(null); if (allowed) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [labId, allowed]);

  function openAllowable(analyte: string) {
    const a = data?.analytes.find((x) => x.analyte === analyte);
    const cur = a?.allowable ?? null;
    setKind(cur ? (cur.preset_label ? "preset" : cur.percent !== null ? "percent" : "units") : a?.criteria.length ? "preset" : "percent");
    setValue(cur ? String(cur.preset_label ?? cur.percent ?? cur.units_value ?? "") : "");
    setUnit(cur?.unit ?? ""); setSetting(analyte);
  }
  async function put(url: string, body: unknown, done: string) {
    setBusy(true);
    try {
      const r = await sendJson(`${API_BASE}/api/labs/${labId}/qc/sigma/${url}`, "PUT", body);
      if (!r.ok) { toast({ title: r.data.error || "Could not save", variant: "destructive" }); return false; }
      toast({ title: done }); await load(); return true;
    } finally { setBusy(false); }
  }

  if (!allowed) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-12"><Card><CardContent className="py-10 text-center">
        <Lock className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <h2 className="mb-1 text-lg font-semibold">{!isLoggedIn ? "Sign in to use VeritaQC™" : !hasPlanAccess ? "VeritaQC™ requires a subscription" : !labId ? "Select a lab first" : "The sigma metric needs VeritaQC™ edit access"}</h2>
        {labId && <Button asChild variant="outline" size="sm" className="mt-4"><Link href={`/labs/${labId}/veritaqc-app`}>Back to VeritaQC™</Link></Button>}
      </CardContent></Card></div>
    );
  }

  const rows = (data?.rows ?? []).filter((r) => old || r.status === "active");
  const groups = (data?.analytes ?? []).map((a) => ({ ...a, rows: rows.filter((r) => r.analyte === a.analyte) })).filter((g) => g.rows.length);
  const open = data?.analytes.find((a) => a.analyte === setting) ?? null;
  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SigmaIcon className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Sigma metric</h1>
        <Button asChild variant="outline" size="sm" className="ml-auto"><Link href={`/labs/${labId}/veritaqc-app`}>Back to VeritaQC™</Link></Button>
      </div>
      <Card className="mb-4"><CardContent className="space-y-1 py-4 text-sm" data-testid="sigma-formula">
        <p className="font-semibold">{SIGMA_FORMULA}</p>
        <p>Bias % is the size of the difference between your mean and the target, as a percent of the target. The target is the peer mean you enter for the lot, or the manufacturer's mean on the lot when there is none. Your own mean is never the target.</p>
        <p>CV % is your SD as a percent of your mean, from the runs on file: voided runs, and runs left out of the QC baseline by a corrective action, aren't used. Every analyzer's runs on a lot are taken together.</p>
        <p className="text-muted-foreground">The allowable error is the laboratory's choice. The number is for the laboratory director or designee to interpret.</p>
      </CardContent></Card>
      <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={old} onChange={(e) => setOld(e.target.checked)} data-testid="sigma-old" />Include lots that are retired or on hold</label>
      {error && <p className="text-sm">The sigma metric couldn't load. <Button size="sm" variant="outline" onClick={load}>Retry</Button></p>}
      {!data && !error && <p className="text-sm text-muted-foreground">Loading...</p>}
      {data && groups.length === 0 && <p className="text-sm text-muted-foreground">No control lots yet.</p>}
      {groups.map((g) => (
        <Card key={g.analyte} className="mb-4" data-testid={`sigma-${g.analyte}`}>
          <CardHeader className="flex flex-col gap-2 space-y-0 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">{g.analyte}</CardTitle>
            <div className="flex flex-wrap items-center gap-2 text-sm"><span data-testid={`sigma-allowable-${g.analyte}`}>Allowable error: <span className="font-medium">{allowableText(g.allowable)}</span></span>
              {data!.can_set && <Button size="sm" variant="outline" onClick={() => openAllowable(g.analyte)} data-testid={`sigma-set-${g.analyte}`}>{g.allowable ? "Change" : "Set"}</Button>}</div>
          </CardHeader>
          <CardContent className="space-y-3">
            {g.rows.map((r) => {
              const s = r.result;
              return (
                <div key={r.control_lot_id} className="rounded-md border p-3" data-testid={`sigma-lot-${r.control_lot_id}`}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="font-medium">{r.level}, lot {r.lot_number}{r.status !== "active" ? ` (${r.status})` : ""}</div>
                      <div className="text-xs text-muted-foreground">{s.n ? `From ${plural(s.n, "run")}, ${r.first_run} to ${r.last_run}${r.analyzers.length ? `, on ${r.analyzers.join(", ")}` : ""}.` : "No runs."}{r.left_out ? ` ${plural(r.left_out, "run")} left out of the baseline.` : ""}</div>
                    </div>
                    <div className="sm:text-right" data-testid={`sigma-value-${r.control_lot_id}`}>
                      {s.sigma !== null
                        ? <><div className="text-2xl font-bold tabular-nums">{s.sigma.toFixed(2)}</div>{s.from_few_runs && <div className="text-xs">from {plural(s.n, "run")}</div>}</>
                        : <div className="max-w-sm text-sm"><div className="font-medium">Not enough to compute</div><div className="text-xs text-muted-foreground">Missing: {s.missing.join("; ")}.</div></div>}
                    </div>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                    <div><dt className="text-muted-foreground">Allowable error %</dt><dd className="tabular-nums">{n2(s.allowable_percent)}</dd></div>
                    <div><dt className="text-muted-foreground">Bias %</dt><dd className="tabular-nums">{n2(s.bias_percent)}</dd></div>
                    <div><dt className="text-muted-foreground">CV %</dt><dd className="tabular-nums">{n2(s.cv_percent)}</dd></div>
                    <div><dt className="text-muted-foreground">Your mean, SD</dt><dd className="tabular-nums">{s.mean === null ? "" : `${n4(s.mean)}${s.sd === null ? "" : `, ${n4(s.sd)}`}`}</dd></div>
                    <div className="col-span-2"><dt className="text-muted-foreground">Target</dt><dd>{r.peer_mean ? `Peer mean ${r.peer_mean.value}${r.peer_mean.note ? ` (${r.peer_mean.note})` : ""}, entered by ${r.peer_mean.set_by_name ?? "the laboratory"} ${labDayOf(r.peer_mean.set_at)}` : `Manufacturer's mean on the lot, ${r.mfr_mean}`}
                      {data!.can_set && <button type="button" className="ml-2 text-primary underline" onClick={() => { setPeerFor(r); setValue(r.peer_mean ? String(r.peer_mean.value) : ""); setUnit(r.peer_mean?.note ?? ""); }} data-testid={`sigma-peer-${r.control_lot_id}`}>{r.peer_mean ? "Change peer mean" : "Enter a peer mean"}</button>}</dd></div>
                    {s.allowable_how && <div className="col-span-2"><dt className="text-muted-foreground">Allowable error from</dt><dd>{s.allowable_how}</dd></div>}
                  </dl>
                  {s.sigma !== null && <p className="mt-2 text-xs tabular-nums text-muted-foreground" data-testid={`sigma-math-${r.control_lot_id}`}>({n2(s.allowable_percent)} - {n2(Math.abs(s.bias_percent!))}) / {n2(s.cv_percent)} = {s.sigma.toFixed(2)}</p>}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      <Dialog open={!!open} onOpenChange={(o) => { if (!o) setSetting(null); }}>
        <DialogContent className="max-w-lg" data-testid="sigma-allowable-dialog">
          <DialogHeader><DialogTitle>Allowable error for {setting}</DialogTitle><DialogDescription>The laboratory chooses it. Enter your own, or pick one of the 42 CFR 493 Subpart I criteria in the app for this test.</DialogDescription></DialogHeader>
          {open && (
            <div className="space-y-3">
              <div className="space-y-1 text-sm">
                {([["preset", "A regulatory criterion"], ["percent", "A percent"], ["units", "An amount in the test's units"]] as const).map(([k, label]) => (
                  <label key={k} className="flex items-center gap-2"><input type="radio" name="sigma-kind" checked={kind === k} disabled={k === "preset" && !open.criteria.length} onChange={() => { setKind(k); setValue(""); }} data-testid={`sigma-kind-${k}`} />{label}{k === "preset" && !open.criteria.length ? " (none in the app for this test)" : ""}</label>
                ))}
              </div>
              {kind === "preset" ? (
                <select className={SELECT} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Criterion" data-testid="sigma-preset"><option value="">Choose...</option>{open.criteria.map((c) => <option key={c.label} value={c.label}>{c.label}, {c.cfr}</option>)}</select>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <div><Label className="text-xs" htmlFor="sigma-value">{kind === "percent" ? "Percent" : "Amount"}</Label><Input id="sigma-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} data-testid="sigma-value" /></div>
                  {kind === "units" && <div><Label className="text-xs" htmlFor="sigma-unit">Units</Label><Input id="sigma-unit" maxLength={24} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. mmol/L" data-testid="sigma-unit" /></div>}
                </div>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                {open.allowable && <Button size="sm" variant="ghost" disabled={busy} onClick={async () => { if (await put("allowable-error", { analyte: setting, clear: true }, "Allowable error cleared")) setSetting(null); }}>Clear</Button>}
                <Button size="sm" variant="outline" onClick={() => setSetting(null)}>Cancel</Button>
                <Button size="sm" disabled={busy || !value.trim()} data-testid="sigma-save" onClick={async () => {
                  const body = kind === "preset" ? { analyte: setting, preset_label: value } : kind === "percent" ? { analyte: setting, percent: value } : { analyte: setting, units_value: value, unit };
                  if (await put("allowable-error", body, "Allowable error saved")) setSetting(null);
                }}>Save</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!peerFor} onOpenChange={(o) => { if (!o) setPeerFor(null); }}>
        <DialogContent className="max-w-md" data-testid="sigma-peer-dialog">
          <DialogHeader><DialogTitle>Peer mean</DialogTitle><DialogDescription>{peerFor ? `${peerFor.analyte} ${peerFor.level}, lot ${peerFor.lot_number}. From your peer group report, in the same units as the runs.` : ""}</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs" htmlFor="sigma-peer-value">Peer group mean</Label><Input id="sigma-peer-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} data-testid="sigma-peer-value" /></div>
            <div><Label className="text-xs" htmlFor="sigma-peer-note">Where it is from</Label><Input id="sigma-peer-note" maxLength={200} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. Peer report, October 2026" data-testid="sigma-peer-note" /></div>
            <div className="flex flex-wrap justify-end gap-2">
              {peerFor?.peer_mean && <Button size="sm" variant="ghost" disabled={busy} onClick={async () => { if (await put("peer-mean", { control_lot_id: peerFor.control_lot_id, peer_mean: null }, "Peer mean cleared")) setPeerFor(null); }}>Clear</Button>}
              <Button size="sm" variant="outline" onClick={() => setPeerFor(null)}>Cancel</Button>
              <Button size="sm" disabled={busy || !value.trim()} data-testid="sigma-peer-save" onClick={async () => { if (peerFor && await put("peer-mean", { control_lot_id: peerFor.control_lot_id, peer_mean: value, note: unit }, "Peer mean saved")) setPeerFor(null); }}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
