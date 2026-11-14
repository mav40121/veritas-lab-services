// client/src/pages/StainLogPage.tsx
//
// VeritaMaintain stain log (Michael Q178 = 1, 2026-11-06). A month grid per instrument, with the lab's own rows and the codes D, C, F, TO and R; a lot and
// expiration on a stain change; a list-style manual stain log with no specimen number; and a page that prints either one. The monthly review stays
// MonthlyRecordReviewPanel on VeritaMaintain. Setup needs VeritaMaintain edit; recording is open to every lab member. Server: server/stainLog.ts.
// Rules shared with the server: shared/stainLogRules.ts.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/components/AuthContext";
import { useCanRecord } from "@/components/SubscriptionBanner";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useLabRoute } from "@/hooks/useLabRoute";
import { labTodayIso, labDayOf } from "@/lib/labDate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, ArrowDown, ArrowUp, Lock, Printer, SlidersHorizontal } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  CODE_LABELS, MANUAL_TYPE_SUGGESTIONS, ROW_FREQUENCIES, ROW_KINDS, STAIN_CODES, STAIN_NO_PHI_NOTICE,
  cleanInitials, cleanManualEntry, cleanRow, codeMark, codesForKind, dailyShortDays, monthDays, needsLot, planRowEntries, rowScheduleLabel, shiftMonth,
} from "@shared/stainLogRules";

type ListInstrument = { id: number; name: string; location: string | null; status: string; rows: number; entries_today: number };
type ListData = { today: string; can_setup: boolean; manual_this_month: number; instruments: ListInstrument[] };
type Row = {
  id: number; name: string; row_kind: string; frequency: string; required_code: string | null; sort_order: number; active: number; retired_at: string | null;
  created_at: string; first_entry_day: string | null; entry_count: number; current_lot?: { lot_number: string; expiration_date: string; log_date: string } | null;
};
type Entry = {
  id: number; row_id: number; log_date: string; code: string; lot_number: string | null; expiration_date: string | null; lot_expired: number; initials: string;
  corrective_action: string | null; recorded_by_user_id: number | null; recorded_by_name: string | null; created_at: string; voided_at: string | null; voided_by_name: string | null; void_reason: string | null;
};
type Review = { typed_signature: string; capacity_label: string; signed_at: string; corrective_action: string | null } | null;
type GridData = {
  month: string; today: string; lab: { name: string | null; clia: string | null };
  equipment: { id: number; name: string; location: string | null; model: string | null; serial_number: string | null; status: string };
  rows: Row[]; all_rows: Row[]; entries: Entry[]; voided: Entry[]; problems: string[]; notes: string[]; used_days: string[];
  solution_events: { event_date: string; performed_by: string | null; notes: string | null }[]; review: Review; can_setup: boolean;
};
type ManualEntry = {
  id: number; log_date: string; specimen_type: string; result: string; test_slide: number; initials: string; comments: string | null; recorded_by_user_id: number | null;
  recorded_by_name: string | null; voided_at: string | null; voided_by_name: string | null; void_reason: string | null;
};
type ManualData = { month: string; today: string; lab: { name: string | null; clia: string | null }; entries: ManualEntry[]; voided: ManualEntry[]; notes: string[]; review: Review };

type RowDraft = { codes: string[]; lot: string; expiration: string; action: string };
const blankDraft = (): RowDraft => ({ codes: [], lot: "", expiration: "", action: "" });

const fieldClass = "h-9 w-full rounded-md border border-border bg-background px-2 text-sm";
const shortDate = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}/${d.slice(0, 4)}`;
const reviewLine = (r: Review) => r ? `Reviewed ${labDayOf(r.signed_at)} by ${r.typed_signature}, ${r.capacity_label}${r.corrective_action ? `. Corrective action: ${r.corrective_action}` : ""}` : "Not reviewed yet";

// Printing never follows the screen's theme: black on white, by inline style, so dark mode can't print white on white.
const P = {
  page: { color: "#000", background: "#fff", fontFamily: "Calibri, Arial, sans-serif", fontSize: "10px" } as const,
  h1: { fontSize: "16px", fontWeight: 700, margin: 0, color: "#000" } as const,
  sub: { fontSize: "10px", margin: "2px 0 6px", color: "#000" } as const,
  table: { width: "100%", borderCollapse: "collapse" as const, tableLayout: "fixed" as const, marginBottom: "6px", color: "#000" },
  th: { border: "1px solid #555", padding: "2px", fontWeight: 700, textAlign: "center" as const, fontSize: "9px", background: "#eee", color: "#000" },
  thLeft: { border: "1px solid #555", padding: "2px 3px", fontWeight: 700, textAlign: "left" as const, fontSize: "9px", background: "#eee", color: "#000" },
  td: { border: "1px solid #555", padding: "2px", textAlign: "center" as const, fontSize: "9px", height: "16px", color: "#000" },
  tdLeft: { border: "1px solid #555", padding: "2px 3px", textAlign: "left" as const, fontSize: "9px", color: "#000", wordBreak: "break-word" as const },
  h2: { fontSize: "11px", fontWeight: 700, margin: "6px 0 2px", color: "#000" } as const,
  line: { fontSize: "9.5px", margin: "1px 0", color: "#000" } as const,
};

export default function StainLogPage() {
  const { user, isLoggedIn } = useAuth();
  const canRecord = useCanRecord();
  const activeLabId = useActiveLabId();
  const labRoute = useLabRoute();
  const { toast } = useToast();

  const hasPlanAccess = !!user && [
    "annual", "professional", "lab", "complete",
    "veritamap", "veritascan", "veritacomp",
    "clinic", "waived", "community", "hospital", "large_hospital", "enterprise",
  ].includes(user.plan);

  const query = useMemo(() => new URLSearchParams(typeof window !== "undefined" ? window.location.search : ""), []);
  const [list, setList] = useState<ListData | null>(null);
  const [view, setView] = useState<string>(query.get("view") === "manual" ? "manual" : query.get("instrument") || "");
  const [month, setMonth] = useState<string>(() => {
    const m = query.get("month");
    return m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : labTodayIso().slice(0, 7);
  });
  const [grid, setGrid] = useState<GridData | null>(null);
  const [manual, setManual] = useState<ManualData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const latestLoad = useRef(0);

  const base =`${API_BASE}/api/labs/${activeLabId}/stain-log`;
  const jsonHeaders = () => ({ ...authHeaders(), "Content-Type": "application/json" });
  const fail = async (r: Response, fallback: string) => {
    const e = await r.json().catch(() => ({}));
    toast({ title: e.error || fallback, variant: "destructive" });
  };

  async function loadList() {
    const r = await fetch(base, { headers: authHeaders() });
    if (!r.ok) return;
    const j: ListData = await r.json();
    setList(j);
    setView((v) => {
      if (v) return v;
      const first = j.instruments.find((i) => i.rows > 0) ?? j.instruments[0];
      return first ? String(first.id) : "manual";
    });
  }
  async function loadView(v = view, m = month) {
    if (!v) return;
    // Moving through months quickly: only the latest answer lands.
    const mine = ++latestLoad.current;
    setLoading(true); setLoadError(null);
    try {
      const r = await fetch(`${base}/${v === "manual" ? "manual" : v}?month=${m}`, { headers: authHeaders() });
      const j = await r.json().catch(() => ({}));
      if (mine !== latestLoad.current) return;
      if (!r.ok) { setLoadError(j.error || "Could not load the stain log"); setGrid(null); setManual(null); return; }
      if (v === "manual") { setManual(j); setGrid(null); } else { setGrid(j); setManual(null); }
    } finally { if (mine === latestLoad.current) setLoading(false); }
  }
  useEffect(() => { if (isLoggedIn && hasPlanAccess && activeLabId) loadList(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [isLoggedIn, hasPlanAccess, activeLabId]);
  useEffect(() => { if (isLoggedIn && hasPlanAccess && activeLabId && view) loadView(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [isLoggedIn, hasPlanAccess, activeLabId, view, month]);

  const today = list?.today ?? labTodayIso();
  const thisMonth = today.slice(0, 7);
  const days = useMemo(() => monthDays(month), [month]);
  const cells = useMemo(() => {
    const out = new Map<string, Entry[]>();
    for (const e of grid?.entries ?? []) {
      const k = `${e.row_id}|${e.log_date}`;
      out.set(k, [...(out.get(k) ?? []), e]);
    }
    return out;
  }, [grid]);
  const initialsByDay = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const e of grid?.entries ?? []) {
      const have = out.get(e.log_date) ?? [];
      if (!have.includes(e.initials)) out.set(e.log_date, [...have, e.initials]);
    }
    return out;
  }, [grid]);
  const shortByRow = useMemo(() => {
    const out = new Map<number, Set<string>>();
    if (grid) for (const r of grid.rows) out.set(r.id, new Set(dailyShortDays(r as any, grid.entries as any, grid.used_days, grid.today)));
    return out;
  }, [grid]);
  const canSetup = !!list?.can_setup && canRecord;

  // ── Record a day ───────────────────────────────────────────────────────────
  const [recOpen, setRecOpen] = useState(false);
  const [recDate, setRecDate] = useState(today);
  const [recInitials, setRecInitials] = useState("");
  const [recDrafts, setRecDrafts] = useState<Record<number, RowDraft>>({});
  const [recSaving, setRecSaving] = useState(false);
  const activeRows = (grid?.rows ?? []).filter((r) => r.active);

  function openRecord(date?: string) {
    const d = date ?? (month === thisMonth ? today : `${month}-01`);
    setRecDate(d); setRecDrafts({}); setRecOpen(true);
  }
  const draftOf = (rowId: number) => recDrafts[rowId] ?? blankDraft();
  const patchDraft = (rowId: number, patch: Partial<RowDraft>) => setRecDrafts((s) => ({ ...s, [rowId]: { ...draftOf(rowId), ...patch } }));
  function toggleCode(row: Row, code: string) {
    const d = draftOf(row.id);
    if (row.row_kind === "check") { patchDraft(row.id, { codes: d.codes[0] === code ? [] : [code] }); return; }
    patchDraft(row.id, { codes: d.codes.includes(code) ? d.codes.filter((c) => c !== code) : [...d.codes, code] });
  }
  async function saveDay() {
    const initials = cleanInitials(recInitials);
    if (initials.error) { toast({ title: initials.error, variant: "destructive" }); return; }
    const items: any[] = [];
    for (const row of activeRows) {
      const d = draftOf(row.id);
      if (!d.codes.length) continue;
      const item = { row_id: row.id, codes: d.codes, lot_number: d.lot.trim() || null, expiration_date: d.expiration || null, corrective_action: d.action.trim() || null };
      const plan = planRowEntries(row, item, recDate);
      if (plan.error) { toast({ title: `${row.name}: ${plan.error}`, variant: "destructive" }); return; }
      items.push(item);
    }
    if (!items.length) { toast({ title: "Mark at least one row", variant: "destructive" }); return; }
    setRecSaving(true);
    try {
      const r = await fetch(`${base}/${grid!.equipment.id}/entries`, { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ log_date: recDate, initials: initials.initials, items }) });
      if (!r.ok) { await fail(r, "Could not save the stain log"); return; }
      toast({ title: `Saved for ${shortDate(recDate)}` });
      setRecOpen(false);
      await Promise.all([loadView(), loadList()]);
    } finally { setRecSaving(false); }
  }

  // ── Void ───────────────────────────────────────────────────────────────────
  const [voidFor, setVoidFor] = useState<{ url: string; label: string } | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidSaving, setVoidSaving] = useState(false);
  function openVoid(url: string, label: string) { setVoidFor({ url, label }); setVoidReason(""); }
  async function saveVoid() {
    if (!voidFor) return;
    if (!voidReason.trim()) { toast({ title: "Enter why this entry is being voided", variant: "destructive" }); return; }
    setVoidSaving(true);
    try {
      const r = await fetch(voidFor.url, { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ reason: voidReason.trim() }) });
      if (!r.ok) { await fail(r, "Could not void the entry"); return; }
      toast({ title: "Entry voided. It stays on the record with the reason." });
      setVoidFor(null);
      await Promise.all([loadView(), loadList()]);
    } finally { setVoidSaving(false); }
  }

  // ── Set up rows ────────────────────────────────────────────────────────────
  const [setupOpen, setSetupOpen] = useState(false);
  const [editRow, setEditRow] = useState<Row | null>(null);
  const [rowName, setRowName] = useState("");
  const [rowKind, setRowKind] = useState<string>("stain");
  const [rowFrequency, setRowFrequency] = useState<string>("as_needed");
  const [rowCode, setRowCode] = useState<string>("C");
  const [rowSaving, setRowSaving] = useState(false);
  const startRow = (row: Row | null) => {
    setEditRow(row);
    setRowName(row?.name ?? ""); setRowKind(row?.row_kind ?? "stain"); setRowFrequency(row?.frequency ?? "as_needed"); setRowCode(row?.required_code ?? "C");
  };
  const allRows = grid?.all_rows ?? [];
  async function saveRow() {
    if (!grid) return;
    const clean = cleanRow({ name: rowName, row_kind: rowKind, frequency: rowFrequency, required_code: rowCode });
    if (clean.error) { toast({ title: clean.error, variant: "destructive" }); return; }
    setRowSaving(true);
    try {
      const r = await fetch(editRow ? `${base}/${grid.equipment.id}/rows/${editRow.id}` : `${base}/${grid.equipment.id}/rows`, { method: editRow ? "PUT" : "POST", headers: jsonHeaders(), body: JSON.stringify(clean.row) });
      if (!r.ok) { await fail(r, "Could not save the row"); return; }
      startRow(null);
      await Promise.all([loadView(), loadList()]);
    } finally { setRowSaving(false); }
  }
  async function setRowActive(row: Row, active: boolean) {
    const r = await fetch(`${base}/${grid!.equipment.id}/rows/${row.id}`, { method: "PUT", headers: jsonHeaders(), body: JSON.stringify({ active }) });
    if (!r.ok) { await fail(r, "Could not change the row"); return; }
    await Promise.all([loadView(), loadList()]);
  }
  async function removeRow(row: Row) {
    const r = await fetch(`${base}/${grid!.equipment.id}/rows/${row.id}`, { method: "DELETE", headers: authHeaders() });
    if (!r.ok) { await fail(r, "Could not remove the row"); return; }
    await Promise.all([loadView(), loadList()]);
  }
  async function moveRow(index: number, delta: number) {
    const ids = allRows.map((r) => r.id);
    const to = index + delta;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to], ids[index]];
    const r = await fetch(`${base}/${grid!.equipment.id}/rows/order`, { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ ids }) });
    if (!r.ok) { await fail(r, "Could not move the row"); return; }
    await loadView();
  }

  // ── Manual stain ───────────────────────────────────────────────────────────
  const [manOpen, setManOpen] = useState(false);
  const [manDate, setManDate] = useState(today);
  const [manType, setManType] = useState("");
  const [manResult, setManResult] = useState<"" | "good" | "problem">("");
  const [manTest, setManTest] = useState(false);
  const [manInitials, setManInitials] = useState("");
  const [manComments, setManComments] = useState("");
  const [manSaving, setManSaving] = useState(false);
  function openManual() {
    setManDate(month === thisMonth ? today : `${month}-01`);
    setManType(""); setManResult(""); setManTest(false); setManInitials(""); setManComments(""); setManOpen(true);
  }
  async function saveManual() {
    const body = { log_date: manDate, specimen_type: manType, result: manResult, test_slide: manTest, comments: manComments };
    const clean = cleanManualEntry(body);
    if (clean.error) { toast({ title: clean.error, variant: "destructive" }); return; }
    const initials = cleanInitials(manInitials);
    if (initials.error) { toast({ title: initials.error, variant: "destructive" }); return; }
    setManSaving(true);
    try {
      const r = await fetch(`${base}/manual`, { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ ...body, initials: initials.initials }) });
      if (!r.ok) { await fail(r, "Could not save the manual stain"); return; }
      toast({ title: "Manual stain recorded" });
      setManOpen(false);
      await Promise.all([loadView(), loadList()]);
    } finally { setManSaving(false); }
  }

  const canVoid = (recordedBy: number | null) => canRecord && (recordedBy === Number(user?.id) || !!list?.can_setup);

  if (!isLoggedIn) {
    return (
      <div className="container max-w-2xl mx-auto py-12 px-4">
        <Card><CardContent className="py-10 text-center">
          <Lock className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
          <h2 className="text-lg font-semibold mb-1">Sign in to use VeritaMaintain&#8482;</h2>
          <Button asChild><Link href="/login">Sign in</Link></Button>
        </CardContent></Card>
      </div>
    );
  }
  if (!hasPlanAccess) {
    return (
      <div className="container max-w-2xl mx-auto py-12 px-4">
        <Card><CardContent className="py-10 text-center">
          <Lock className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
          <h2 className="text-lg font-semibold mb-1">VeritaMaintain&#8482; requires a subscription</h2>
          <Button asChild><Link href="/pricing">See plans</Link></Button>
        </CardContent></Card>
      </div>
    );
  }
  if (!activeLabId) {
    return <div className="container max-w-2xl mx-auto py-12 px-4"><Card><CardContent className="py-10 text-center"><p className="text-sm text-muted-foreground">Select a lab to open its stain log.</p></CardContent></Card></div>;
  }

  const withRows = (list?.instruments ?? []).filter((i) => i.rows > 0);
  const withoutRows = (list?.instruments ?? []).filter((i) => i.rows === 0);
  const expiredNow = (r: Row) => r.row_kind === "stain" && !!r.current_lot && r.current_lot.expiration_date < today;
  const detailEntries = (grid?.entries ?? []).filter((e) => e.lot_number || e.corrective_action);
  const rowNameOf = (id: number) => grid?.all_rows.find((r) => r.id === id)?.name ?? "";
  const lab = grid?.lab ?? manual?.lab;

  return (
    <div className="container max-w-6xl mx-auto py-8 px-4" data-testid="stain-log-page">
      {/* While this page is open, printing runs landscape: a month of day columns needs the width. index.css hides everything but the print area with
          visibility, which still takes up room, so the app's header and footer go too or they print as a blank last page. */}
      <style>{"@media print { @page { size: letter landscape; margin: 0.35in; } header, footer { display: none !important; } .min-h-screen { min-height: 0 !important; } }"}</style>
      <div className="no-print">
        <Link href={labRoute("/equipment-app")} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3">
          <ArrowLeft className="h-4 w-4" /> VeritaMaintain&#8482;
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div>
            <h1 className="text-2xl font-bold leading-tight">Stain log</h1>
            <p className="text-sm text-muted-foreground">What was done to each stain and solution, by day, with the lot and expiration on a stain change.</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => window.print()} disabled={!grid && !manual} data-testid="stain-print"><Printer className="h-4 w-4 mr-1" />Print</Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <select className={`${fieldClass} w-auto max-w-full`} aria-label="Which stain log" value={view} onChange={(e) => setView(e.target.value)} data-testid="stain-view">
            {withRows.length > 0 && <optgroup label="Instruments">{withRows.map((i) => <option key={i.id} value={String(i.id)}>{i.name}{i.status !== "active" ? " (retired)" : ""}</option>)}</optgroup>}
            <optgroup label="List"><option value="manual">Manual stain log</option></optgroup>
            {withoutRows.length > 0 && <optgroup label="No stain log yet">{withoutRows.map((i) => <option key={i.id} value={String(i.id)}>{i.name}</option>)}</optgroup>}
          </select>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setMonth(shiftMonth(month, -1))} data-testid="stain-prev">Previous</Button>
            <span className="text-sm font-medium" data-testid="stain-month">{month}</span>
            <Button size="sm" variant="outline" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonth} data-testid="stain-next">Next</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            {grid && grid.equipment.status === "active" && activeRows.length > 0 && <Button size="sm" onClick={() => openRecord()} disabled={!canRecord} data-testid="stain-record">{month === thisMonth ? "Record today" : "Record a day"}</Button>}
            {grid && grid.equipment.status === "active" && canSetup && <Button size="sm" variant="outline" onClick={() => { startRow(null); setSetupOpen(true); }} data-testid="stain-setup"><SlidersHorizontal className="h-3.5 w-3.5 mr-1" />Set up rows</Button>}
            {manual && <Button size="sm" onClick={openManual} disabled={!canRecord} data-testid="manual-add">Add manual stain</Button>}
          </div>
        </div>

        {loadError && <p className="text-sm text-red-700 dark:text-red-400 mb-3" data-testid="stain-error">{loadError}</p>}
        {loading && !grid && !manual && <p className="text-sm text-muted-foreground">Loading...</p>}

        {list && list.instruments.length === 0 && view !== "manual" && (
          <p className="text-sm text-muted-foreground" data-testid="stain-no-instruments">Add your stainer on <Link href={labRoute("/equipment-app")} className="underline">VeritaMaintain&#8482;</Link> first. Its stain log lives on the instrument.</p>
        )}

        {grid && (
          <Card data-testid="stain-grid-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{grid.equipment.name}{grid.equipment.location ? <span className="text-sm font-normal text-muted-foreground"> · {grid.equipment.location}</span> : null}{grid.equipment.status !== "active" ? <span className="text-sm font-normal text-muted-foreground"> · retired</span> : null}</CardTitle>
            </CardHeader>
            <CardContent>
              {grid.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="stain-no-rows">
                  {canSetup ? "No rows yet. Set up a row for each stain, rinse and daily check on this instrument, in the order you work them." : "No rows yet. Someone who can edit VeritaMaintain sets up this instrument's rows."}
                </p>
              ) : (
                <>
                  <div className="overflow-x-auto rounded-md border border-border" data-testid="stain-grid-wrap">
                    <table className="text-xs border-collapse" data-testid="stain-grid">
                      <thead>
                        <tr className="bg-muted">
                          <th className="sticky left-0 z-10 bg-muted text-left px-2 py-1.5 min-w-[9.5rem] border-b border-r border-border">Row</th>
                          {days.map((d) => {
                            const future = d > today;
                            const n = Number(d.slice(8, 10));
                            return (
                              <th key={d} className={`border-b border-r border-border p-0 ${d === today ? "bg-primary/15" : ""}`}>
                                <button type="button" className="w-full min-w-[1.75rem] py-1.5 font-semibold disabled:font-normal disabled:text-muted-foreground" disabled={future || !canRecord || grid.equipment.status !== "active"} aria-label={`Record ${d}`} onClick={() => openRecord(d)} data-testid={`stain-day-${n}`}>{n}</button>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {grid.rows.map((r) => (
                          <tr key={r.id} data-testid={`stain-row-${r.id}`}>
                            <th className="sticky left-0 z-10 bg-card text-left font-normal px-2 py-1 border-b border-r border-border align-top">
                              <div className="font-medium">{r.name}{!r.active ? <span className="text-muted-foreground font-normal"> (retired)</span> : null}</div>
                              <div className="text-[10px] text-muted-foreground">{rowScheduleLabel(r)}</div>
                              {r.current_lot && <div className={`text-[10px] ${expiredNow(r) ? "font-semibold text-red-700 dark:text-red-400" : "text-muted-foreground"}`} data-testid={`stain-lot-${r.id}`}>Lot {r.current_lot.lot_number}, exp {r.current_lot.expiration_date}</div>}
                            </th>
                            {days.map((d) => {
                              const cellEntries = cells.get(`${r.id}|${d}`) ?? [];
                              const flagged = cellEntries.some((e) => e.code === "PROBLEM" || e.lot_expired);
                              const short = shortByRow.get(r.id)?.has(d);
                              const tone = flagged ? "bg-red-50 text-red-700 font-semibold dark:bg-red-950/40 dark:text-red-300" : short ? "bg-amber-50 dark:bg-amber-950/40" : d === today ? "bg-primary/5" : "";
                              const title = cellEntries.map((e) => `${CODE_LABELS[e.code]} by ${e.initials}${e.lot_number ? `, lot ${e.lot_number}, exp ${e.expiration_date}` : ""}${e.corrective_action ? `. ${e.corrective_action}` : ""}`).join("\n") || (short ? `No ${r.required_code ?? "entry"} recorded on a day the instrument was used` : "");
                              return (
                                <td key={d} className={`border-b border-r border-border p-0 text-center align-middle ${tone}`}>
                                  <button type="button" className="w-full min-w-[1.75rem] min-h-[2.1rem] px-0.5 leading-tight disabled:cursor-default" disabled={d > today || !canRecord || grid.equipment.status !== "active" || !r.active} title={title} aria-label={`${r.name}, ${d}${cellEntries.length ? `: ${cellEntries.map((e) => CODE_LABELS[e.code]).join(", ")}` : ""}`} onClick={() => openRecord(d)} data-testid={`stain-cell-${r.id}-${Number(d.slice(8, 10))}`}>
                                    {cellEntries.map((e) => codeMark(e.code)).join(" ")}
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                        <tr data-testid="stain-initials-row">
                          <th className="sticky left-0 z-10 bg-muted text-left px-2 py-1 border-r border-border">Initials</th>
                          {days.map((d) => <td key={d} className="bg-muted border-r border-border text-center text-[10px] px-0.5 py-1 leading-tight" data-testid={`stain-initials-${Number(d.slice(8, 10))}`}>{(initialsByDay.get(d) ?? []).join(" ")}</td>)}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2" data-testid="stain-legend">
                    {STAIN_CODES.map((c) => `${c} ${CODE_LABELS[c].toLowerCase()}`).join(" · ")} · {codeMark("OK")} acceptable · {codeMark("PROBLEM")} problem. Amber: nothing recorded on a daily row on a day the instrument was used.
                  </p>
                </>
              )}

              {(grid.problems.length > 0 || grid.notes.length > 0) && (
                <div className="mt-3 text-xs" data-testid="stain-findings">
                  <div className="font-medium mb-0.5">What the records show</div>
                  {grid.problems.map((p) => <div key={p} className="font-medium text-red-700 dark:text-red-400">{p}</div>)}
                  <div className="text-muted-foreground">{grid.notes.join(" · ")}</div>
                </div>
              )}
              <div className="mt-3 text-xs" data-testid="stain-review-line">
                <span className="font-medium">Monthly review: </span>
                <span className={grid.review ? "text-green-800 dark:text-green-300" : "text-amber-800 dark:text-amber-300"}>{reviewLine(grid.review)}</span>
                {!grid.review && <> · <Link href={labRoute("/equipment-app")} className="underline">Monthly record review</Link></>}
              </div>

              {detailEntries.length > 0 && (
                <div className="mt-4 overflow-x-auto">
                  <div className="text-sm font-medium mb-1">Lots and corrective actions</div>
                  <table className="w-full text-xs" data-testid="stain-details">
                    <thead><tr className="text-left uppercase text-muted-foreground border-b"><th className="py-1 pr-2">Date</th><th className="py-1 pr-2">Row</th><th className="py-1 pr-2">Code</th><th className="py-1 pr-2">Lot</th><th className="py-1 pr-2">Expiration</th><th className="py-1 pr-2">Initials</th><th className="py-1">Corrective action</th></tr></thead>
                    <tbody>
                      {detailEntries.map((e) => (
                        <tr key={e.id} className="border-b last:border-0 align-top">
                          <td className="py-1 pr-2 whitespace-nowrap">{e.log_date}</td><td className="py-1 pr-2">{rowNameOf(e.row_id)}</td><td className="py-1 pr-2">{codeMark(e.code)}</td>
                          <td className="py-1 pr-2 font-mono">{e.lot_number ?? ""}</td>
                          <td className={`py-1 pr-2 whitespace-nowrap ${e.lot_expired ? "font-semibold text-red-700 dark:text-red-400" : ""}`}>{e.expiration_date ?? ""}{e.lot_expired ? " (expired)" : ""}</td>
                          <td className="py-1 pr-2" title={e.recorded_by_name ?? ""}>{e.initials}</td><td className="py-1 whitespace-pre-wrap">{e.corrective_action ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {grid.voided.length > 0 && (
                <div className="mt-4 overflow-x-auto" data-testid="stain-voided">
                  <div className="text-sm font-medium mb-1">Voided entries</div>
                  <ul className="text-xs space-y-0.5">
                    {grid.voided.map((e) => <li key={e.id}><span className="line-through">{e.log_date} {rowNameOf(e.row_id)} {codeMark(e.code)} ({e.initials})</span> · voided {labDayOf(e.voided_at)}{e.voided_by_name ? ` by ${e.voided_by_name}` : ""}: {e.void_reason}</li>)}
                  </ul>
                </div>
              )}
              {grid.solution_events.length > 0 && (
                <div className="mt-4" data-testid="stain-history-events">
                  <div className="text-sm font-medium mb-1">Solution changes on this instrument's history</div>
                  <ul className="text-xs space-y-0.5 text-muted-foreground">
                    {grid.solution_events.map((e, i) => <li key={i}>{e.event_date}{e.performed_by ? ` by ${e.performed_by}` : ""}: {e.notes}</li>)}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {manual && (
          <Card data-testid="manual-card">
            <CardHeader className="pb-2"><CardTitle className="text-base">Manual stain log</CardTitle></CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">One line for each manual stain, such as a frozen section or a touch preparation. {STAIN_NO_PHI_NOTICE}</p>
              {manual.entries.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="manual-empty">No manual stains recorded this month.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="manual-table">
                    <thead><tr className="text-left text-xs uppercase text-muted-foreground border-b"><th className="py-2 pr-2">Date</th><th className="py-2 pr-2">Specimen type</th><th className="py-2 pr-2">Stain</th><th className="py-2 pr-2">Test slide</th><th className="py-2 pr-2">Initials</th><th className="py-2 pr-2">Comments or corrective action</th><th className="py-2"></th></tr></thead>
                    <tbody>
                      {manual.entries.map((e) => (
                        <tr key={e.id} className={`border-b last:border-0 align-top ${e.result === "problem" ? "bg-red-50 dark:bg-red-950/30" : ""}`} data-testid={`manual-row-${e.id}`}>
                          <td className="py-1.5 pr-2 whitespace-nowrap">{e.log_date}</td><td className="py-1.5 pr-2">{e.specimen_type}</td>
                          <td className={`py-1.5 pr-2 ${e.result === "problem" ? "font-semibold text-red-700 dark:text-red-400" : ""}`}>{e.result === "problem" ? "Problem" : "Good"}</td>
                          <td className="py-1.5 pr-2">{e.test_slide ? "Yes" : ""}</td><td className="py-1.5 pr-2" title={e.recorded_by_name ?? ""}>{e.initials}</td><td className="py-1.5 pr-2 min-w-[14rem] whitespace-pre-wrap">{e.comments ?? ""}</td>
                          <td className="py-1.5 text-right">{canVoid(e.recorded_by_user_id) && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openVoid(`${base}/manual/${e.id}/void`, `${e.log_date}, ${e.specimen_type}`)} data-testid={`manual-void-${e.id}`}>Void</Button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {manual.notes.length > 0 && manual.entries.length > 0 && <div className="mt-3 text-xs text-muted-foreground" data-testid="manual-notes">{manual.notes.join(" · ")}</div>}
              <div className="mt-3 text-xs" data-testid="manual-review-line">
                <span className="font-medium">Monthly review: </span>
                <span className={manual.review ? "text-green-800 dark:text-green-300" : "text-amber-800 dark:text-amber-300"}>{reviewLine(manual.review)}</span>
                {!manual.review && <> · <Link href={labRoute("/equipment-app")} className="underline">Monthly record review</Link></>}
              </div>
              {manual.voided.length > 0 && (
                <div className="mt-4" data-testid="manual-voided">
                  <div className="text-sm font-medium mb-1">Voided entries</div>
                  <ul className="text-xs space-y-0.5">
                    {manual.voided.map((e) => <li key={e.id}><span className="line-through">{e.log_date} {e.specimen_type} ({e.initials})</span> · voided {labDayOf(e.voided_at)}{e.voided_by_name ? ` by ${e.voided_by_name}` : ""}: {e.void_reason}</li>)}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* The printed page: the same records, laid out for paper. Only this part prints (index.css #compliance-print-area). */}
      <div id="compliance-print-area" className="hidden print:block" style={P.page} data-testid="stain-print-area">
        <h1 style={P.h1}>{grid ? `Stain log: ${grid.equipment.name}` : "Manual stain log"}</h1>
        <p style={P.sub}>Month: {month} | {lab?.name ?? ""} | CLIA: {lab?.clia || "Not on file"}{grid?.equipment.location ? ` | ${grid.equipment.location}` : ""}{grid?.equipment.serial_number ? ` | SN ${grid.equipment.serial_number}` : ""}</p>
        {grid && (
          <>
            <table style={P.table}>
              <colgroup><col style={{ width: "1.45in" }} />{days.map((d) => <col key={d} />)}</colgroup>
              <thead><tr><th style={P.thLeft}>Row</th>{days.map((d) => <th key={d} style={P.th}>{Number(d.slice(8, 10))}</th>)}</tr></thead>
              <tbody>
                {grid.rows.map((r) => (
                  <tr key={r.id}>
                    <td style={P.tdLeft}><strong>{r.name}</strong> ({rowScheduleLabel(r)})</td>
                    {days.map((d) => <td key={d} style={P.td}>{(cells.get(`${r.id}|${d}`) ?? []).map((e) => codeMark(e.code)).join(" ")}</td>)}
                  </tr>
                ))}
                <tr><td style={P.tdLeft}><strong>Initials</strong></td>{days.map((d) => <td key={d} style={{ ...P.td, fontSize: "7.5px" }}>{(initialsByDay.get(d) ?? []).join(" ")}</td>)}</tr>
              </tbody>
            </table>
            <p style={P.line}>{STAIN_CODES.map((c) => `${c} = ${CODE_LABELS[c]}`).join("   ")}   {codeMark("OK")} = Acceptable   {codeMark("PROBLEM")} = Problem</p>
            {detailEntries.length > 0 && (
              <>
                <h2 style={P.h2}>Lots and corrective actions</h2>
                <table style={P.table}>
                  <colgroup><col style={{ width: "0.8in" }} /><col style={{ width: "1.5in" }} /><col style={{ width: "0.4in" }} /><col style={{ width: "1.1in" }} /><col style={{ width: "0.85in" }} /><col style={{ width: "0.5in" }} /><col /></colgroup>
                  <thead><tr>{["Date", "Row", "Code", "Lot", "Expiration", "Initials", "Corrective action"].map((h) => <th key={h} style={P.thLeft}>{h}</th>)}</tr></thead>
                  <tbody>{detailEntries.map((e) => <tr key={e.id}><td style={P.tdLeft}>{e.log_date}</td><td style={P.tdLeft}>{rowNameOf(e.row_id)}</td><td style={P.tdLeft}>{codeMark(e.code)}</td><td style={P.tdLeft}>{e.lot_number ?? ""}</td><td style={P.tdLeft}>{e.expiration_date ?? ""}{e.lot_expired ? " (expired)" : ""}</td><td style={P.tdLeft}>{e.initials}</td><td style={P.tdLeft}>{e.corrective_action ?? ""}</td></tr>)}</tbody>
                </table>
              </>
            )}
            {(grid.problems.length > 0 || grid.notes.length > 0) && (
              <>
                <h2 style={P.h2}>What the records show</h2>
                {grid.problems.map((p) => <p key={p} style={{ ...P.line, fontWeight: 700 }}>{p}</p>)}
                <p style={P.line}>{grid.notes.join("; ")}</p>
              </>
            )}
            {grid.voided.length > 0 && (
              <>
                <h2 style={P.h2}>Voided entries</h2>
                {grid.voided.map((e) => <p key={e.id} style={P.line}>{e.log_date} {rowNameOf(e.row_id)} {codeMark(e.code)} ({e.initials}), voided {labDayOf(e.voided_at)}: {e.void_reason}</p>)}
              </>
            )}
            <p style={{ ...P.line, marginTop: "6px" }}><strong>Monthly review:</strong> {reviewLine(grid.review)}</p>
          </>
        )}
        {manual && (
          <>
            <p style={P.line}>No patient information and no specimen numbers on this log. The link to the patient stays in the LIS.</p>
            <table style={{ ...P.table, marginTop: "4px" }}>
              <colgroup><col style={{ width: "0.8in" }} /><col style={{ width: "1.8in" }} /><col style={{ width: "0.6in" }} /><col style={{ width: "0.6in" }} /><col style={{ width: "0.55in" }} /><col /></colgroup>
              <thead><tr>{["Date", "Specimen type", "Stain", "Test slide", "Initials", "Comments or corrective action"].map((h) => <th key={h} style={P.thLeft}>{h}</th>)}</tr></thead>
              <tbody>
                {manual.entries.length === 0 && <tr><td colSpan={6} style={P.tdLeft}>No manual stains recorded this month.</td></tr>}
                {manual.entries.map((e) => <tr key={e.id}><td style={P.tdLeft}>{e.log_date}</td><td style={P.tdLeft}>{e.specimen_type}</td><td style={P.tdLeft}>{e.result === "problem" ? "Problem" : "Good"}</td><td style={P.tdLeft}>{e.test_slide ? "Yes" : ""}</td><td style={P.tdLeft}>{e.initials}</td><td style={P.tdLeft}>{e.comments ?? ""}</td></tr>)}
              </tbody>
            </table>
            {manual.voided.length > 0 && (
              <>
                <h2 style={P.h2}>Voided entries</h2>
                {manual.voided.map((e) => <p key={e.id} style={P.line}>{e.log_date} {e.specimen_type} ({e.initials}), voided {labDayOf(e.voided_at)}: {e.void_reason}</p>)}
              </>
            )}
            <p style={{ ...P.line, marginTop: "6px" }}><strong>Monthly review:</strong> {reviewLine(manual.review)}</p>
          </>
        )}
        <p style={{ ...P.line, marginTop: "8px", fontSize: "8px" }}>VeritaAssure&reg; | VeritaMaintain&#8482; | Confidential, for internal lab use only | Printed {today}</p>
      </div>

      {/* Record a day */}
      <Dialog open={recOpen} onOpenChange={setRecOpen}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto" data-testid="stain-record-dialog">
          <DialogHeader>
            <DialogTitle>Record {shortDate(recDate)}{grid ? `: ${grid.equipment.name}` : ""}</DialogTitle>
            <DialogDescription>Mark what was done. Leave a row alone if nothing was done to it.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 min-w-0">
            <div><Label htmlFor="sr-date">Date</Label><Input id="sr-date" type="date" value={recDate} min={`${month}-01`} max={days[days.length - 1] < today ? days[days.length - 1] : today} onChange={(e) => e.target.value && setRecDate(e.target.value)} data-testid="stain-date" /></div>
            <div><Label htmlFor="sr-init">Initials <span className="text-red-600">*</span></Label><Input id="sr-init" value={recInitials} maxLength={8} onChange={(e) => setRecInitials(e.target.value)} data-testid="stain-initials" /></div>
          </div>
          <div className="space-y-2 min-w-0">
            {activeRows.map((r) => {
              const d = draftOf(r.id);
              const showLot = r.row_kind !== "check" && d.codes.some((c) => c === "C" || c === "TO");
              const lotRequired = d.codes.some((c) => needsLot(r.row_kind, c));
              const expired = !!d.expiration && d.expiration < recDate;
              const showAction = d.codes.includes("PROBLEM") || (showLot && expired);
              const existing = cells.get(`${r.id}|${recDate}`) ?? [];
              return (
                <div key={r.id} className="rounded-md border border-border p-2" data-testid={`stain-draft-${r.id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{r.name}</div>
                      <div className="text-[11px] text-muted-foreground">{rowScheduleLabel(r)}</div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {codesForKind(r.row_kind).map((c) => (
                        <button key={c} type="button" aria-pressed={d.codes.includes(c)} title={CODE_LABELS[c]} onClick={() => toggleCode(r, c)} data-testid={`stain-code-${r.id}-${c}`}
                          className={`h-8 min-w-[2.25rem] rounded-md border px-2 text-xs font-semibold ${d.codes.includes(c) ? (c === "PROBLEM" ? "border-red-600 bg-red-600 text-white" : "border-primary bg-primary text-primary-foreground") : "border-border bg-background hover:bg-muted"}`}>
                          {r.row_kind === "check" ? CODE_LABELS[c] : c}
                        </button>
                      ))}
                    </div>
                  </div>
                  {existing.length > 0 && (
                    <ul className="mt-1 text-[11px] text-muted-foreground" data-testid={`stain-existing-${r.id}`}>
                      {existing.map((e) => (
                        <li key={e.id} className="flex flex-wrap items-center gap-1">
                          <span>On file: {CODE_LABELS[e.code]} by {e.initials}{e.lot_number ? `, lot ${e.lot_number}, exp ${e.expiration_date}` : ""}</span>
                          {canVoid(e.recorded_by_user_id) && <button type="button" className="underline" onClick={() => openVoid(`${base}/${grid!.equipment.id}/entries/${e.id}/void`, `${r.name}, ${e.log_date}, ${CODE_LABELS[e.code]}`)} data-testid={`stain-void-${e.id}`}>Void</button>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {showLot && (
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <div><Label className="text-xs" htmlFor={`sr-lot-${r.id}`}>Lot number{lotRequired && <span className="text-red-600"> *</span>}</Label><Input id={`sr-lot-${r.id}`} value={d.lot} maxLength={60} onChange={(e) => patchDraft(r.id, { lot: e.target.value })} data-testid={`stain-lot-input-${r.id}`} /></div>
                      <div><Label className="text-xs" htmlFor={`sr-exp-${r.id}`}>Expiration{lotRequired && <span className="text-red-600"> *</span>}</Label><Input id={`sr-exp-${r.id}`} type="date" value={d.expiration} onChange={(e) => patchDraft(r.id, { expiration: e.target.value })} data-testid={`stain-exp-input-${r.id}`} /></div>
                    </div>
                  )}
                  {showAction && (
                    <div className="mt-2" data-testid={`stain-action-wrap-${r.id}`}>
                      <p className="text-xs font-medium text-red-700 dark:text-red-400 mb-1">{d.codes.includes("PROBLEM") ? "Problem. Record the corrective action taken." : "That lot is past its expiration. Record the corrective action taken."}</p>
                      <Textarea rows={2} value={d.action} maxLength={2000} onChange={(e) => patchDraft(r.id, { action: e.target.value })} data-testid={`stain-action-${r.id}`} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">{STAIN_NO_PHI_NOTICE}</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRecOpen(false)} disabled={recSaving}>Cancel</Button>
            <Button onClick={saveDay} disabled={recSaving} data-testid="stain-save">{recSaving ? "Saving..." : "Save"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Void */}
      <Dialog open={!!voidFor} onOpenChange={(o) => { if (!o) setVoidFor(null); }}>
        <DialogContent className="max-w-md" data-testid="stain-void-dialog">
          <DialogHeader>
            <DialogTitle>Void this entry</DialogTitle>
            <DialogDescription>{voidFor?.label}. It comes off the log and stays on the record with your reason.</DialogDescription>
          </DialogHeader>
          <div><Label htmlFor="sr-void">Why <span className="text-red-600">*</span></Label><Input id="sr-void" value={voidReason} maxLength={500} onChange={(e) => setVoidReason(e.target.value)} data-testid="stain-void-reason" /></div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setVoidFor(null)} disabled={voidSaving}>Cancel</Button>
            <Button onClick={saveVoid} disabled={voidSaving} data-testid="stain-void-save">{voidSaving ? "Saving..." : "Void entry"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Set up rows */}
      <Dialog open={setupOpen} onOpenChange={setSetupOpen}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto" data-testid="stain-setup-dialog">
          <DialogHeader>
            <DialogTitle>Stain log rows{grid ? `: ${grid.equipment.name}` : ""}</DialogTitle>
            <DialogDescription>One row for each stain, rinse and check, in the order you work them. The names are yours.</DialogDescription>
          </DialogHeader>
          {allRows.length > 0 && (
            <ul className="divide-y divide-border rounded-md border border-border min-w-0" data-testid="stain-setup-rows">
              {allRows.map((r, i) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm" data-testid={`stain-setup-row-${r.id}`}>
                  <div className="min-w-0">
                    <div className="font-medium">{r.name}{!r.active ? <span className="font-normal text-muted-foreground"> (retired)</span> : null}</div>
                    <div className="text-xs text-muted-foreground">{ROW_KINDS.find((k) => k.value === r.row_kind)?.label} · {rowScheduleLabel(r)}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label={`Move ${r.name} up`} disabled={i === 0} onClick={() => moveRow(i, -1)} data-testid={`stain-up-${r.id}`}><ArrowUp className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label={`Move ${r.name} down`} disabled={i === allRows.length - 1} onClick={() => moveRow(i, 1)} data-testid={`stain-down-${r.id}`}><ArrowDown className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => startRow(r)} data-testid={`stain-edit-${r.id}`}>Edit</Button>
                    {r.active
                      ? (r.entry_count > 0
                        ? <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => setRowActive(r, false)} data-testid={`stain-retire-${r.id}`}>Retire</Button>
                        : <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => removeRow(r)} data-testid={`stain-remove-${r.id}`}>Remove</Button>)
                      : <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setRowActive(r, true)} data-testid={`stain-restore-${r.id}`}>Restore</Button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="rounded-md border border-border p-3 space-y-3 min-w-0">
            <div className="text-sm font-medium">{editRow ? `Edit ${editRow.name}` : "Add a row"}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2"><Label htmlFor="sr-name">Name <span className="text-red-600">*</span></Label><Input id="sr-name" value={rowName} maxLength={80} onChange={(e) => setRowName(e.target.value)} placeholder="e.g. Hematoxylin, Rinse, Slide quality check" data-testid="stain-row-name" /></div>
              <div>
                <Label htmlFor="sr-kind">Type</Label>
                <select id="sr-kind" className={fieldClass} value={rowKind} disabled={!!editRow && editRow.entry_count > 0} onChange={(e) => setRowKind(e.target.value)} data-testid="stain-row-kind">
                  {ROW_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
                <p className="text-[11px] text-muted-foreground mt-1">{ROW_KINDS.find((k) => k.value === rowKind)?.hint}</p>
              </div>
              <div>
                <Label htmlFor="sr-freq">How often</Label>
                <select id="sr-freq" className={fieldClass} value={rowFrequency} onChange={(e) => setRowFrequency(e.target.value)} data-testid="stain-row-frequency">
                  {ROW_FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>
              {rowKind !== "check" && rowFrequency !== "as_needed" && (
                <div>
                  <Label htmlFor="sr-code">Code it needs</Label>
                  <select id="sr-code" className={fieldClass} value={rowCode} onChange={(e) => setRowCode(e.target.value)} data-testid="stain-row-code">
                    {STAIN_CODES.map((c) => <option key={c} value={c}>{c}: {CODE_LABELS[c]}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              {editRow && <Button variant="outline" size="sm" onClick={() => startRow(null)} disabled={rowSaving}>Cancel edit</Button>}
              <Button size="sm" onClick={saveRow} disabled={rowSaving} data-testid="stain-row-save">{rowSaving ? "Saving..." : editRow ? "Save row" : "Add row"}</Button>
            </div>
          </div>
          <div className="flex justify-end"><Button variant="outline" onClick={() => setSetupOpen(false)} data-testid="stain-setup-done">Done</Button></div>
        </DialogContent>
      </Dialog>

      {/* Manual stain */}
      <Dialog open={manOpen} onOpenChange={setManOpen}>
        <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto" data-testid="manual-dialog">
          <DialogHeader>
            <DialogTitle>Add manual stain</DialogTitle>
            <DialogDescription>{STAIN_NO_PHI_NOTICE}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
            <div><Label htmlFor="sm-date">Date</Label><Input id="sm-date" type="date" value={manDate} min={`${month}-01`} max={days[days.length - 1] < today ? days[days.length - 1] : today} onChange={(e) => e.target.value && setManDate(e.target.value)} data-testid="manual-date" /></div>
            <div><Label htmlFor="sm-init">Initials <span className="text-red-600">*</span></Label><Input id="sm-init" value={manInitials} maxLength={8} onChange={(e) => setManInitials(e.target.value)} data-testid="manual-initials" /></div>
            <div className="sm:col-span-2">
              <Label htmlFor="sm-type">Specimen type <span className="text-red-600">*</span></Label>
              <Input id="sm-type" list="sm-type-list" value={manType} maxLength={80} onChange={(e) => setManType(e.target.value)} placeholder="e.g. Frozen section" data-testid="manual-type" />
              <datalist id="sm-type-list">{MANUAL_TYPE_SUGGESTIONS.map((t) => <option key={t} value={t} />)}</datalist>
            </div>
            <div>
              <Label>Stain quality <span className="text-red-600">*</span></Label>
              <div className="flex gap-1 mt-1">
                {(["good", "problem"] as const).map((v) => (
                  <button key={v} type="button" aria-pressed={manResult === v} onClick={() => setManResult(v)} data-testid={`manual-result-${v}`}
                    className={`h-9 flex-1 rounded-md border px-3 text-sm font-medium ${manResult === v ? (v === "problem" ? "border-red-600 bg-red-600 text-white" : "border-primary bg-primary text-primary-foreground") : "border-border bg-background hover:bg-muted"}`}>
                    {v === "good" ? "Good" : "Problem"}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm self-end pb-2"><input type="checkbox" checked={manTest} onChange={(e) => setManTest(e.target.checked)} data-testid="manual-test" /> Test slide</label>
            <div className="sm:col-span-2">
              <Label htmlFor="sm-comments">{manResult === "problem" ? <>Corrective action taken <span className="text-red-600">*</span></> : "Comments"}</Label>
              <Textarea id="sm-comments" rows={3} value={manComments} maxLength={2000} onChange={(e) => setManComments(e.target.value)} data-testid="manual-comments" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setManOpen(false)} disabled={manSaving}>Cancel</Button>
            <Button onClick={saveManual} disabled={manSaving} data-testid="manual-save">{manSaving ? "Saving..." : "Save"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
