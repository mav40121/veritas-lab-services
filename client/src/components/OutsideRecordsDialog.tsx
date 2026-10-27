// Record studies the lab performed OUTSIDE VeritaCheck (Q16, 2026-10-24; Lifepoint Georgetown REQ-103: "is there a way
// to put we have completed cal vers and correlations without entering past data?"). One date, where the records are
// kept and who reviewed them, applied to every test picked. Coverage credits each like a signed passing study until
// 6 months after the date performed (server/veritacheckCoverage.ts recordOutsideStudies).
import { useMemo, useState } from "react";
import { labTodayIso } from "@/lib/labDate";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

export type OutsideKind = "cal_ver" | "method_comparison";
export type OutsideCalVerRow = { instrumentTestId: number; analyte: string; instrument: string; specialty: string };
export type OutsideMcRow = { analyte: string; instruments: string[] };

// apiRequest throws "400: {\"error\":\"...\"}"; show just the server's sentence.
const errText = (e: any): string => {
  const body = String(e?.message || "").replace(/^\d+:\s*/, "");
  try { return JSON.parse(body).error || body; } catch { return body; }
};

const KIND_LABEL: Record<OutsideKind, string> = {
  cal_ver: "Calibration Verification / Linearity",
  method_comparison: "Correlation / Method Comparison",
};

export function OutsideRecordsDialog({ open, onOpenChange, coverageUrl, calVerRows, mcRows, initialKind = "cal_ver" }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  coverageUrl: string;
  calVerRows: OutsideCalVerRow[]; // the Cal Ver / Linearity rows that still need a study this cycle
  mcRows: OutsideMcRow[];         // the method comparisons that still need a study this cycle
  initialKind?: OutsideKind;
}) {
  const { toast } = useToast();
  const [kind, setKind] = useState<OutsideKind>(initialKind);
  const [performedOn, setPerformedOn] = useState("");
  const [recordsLocation, setRecordsLocation] = useState("");
  const [reviewedBy, setReviewedBy] = useState("");
  const [notes, setNotes] = useState("");
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  // One list shape for both kinds: key, label, detail.
  const items = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const all = kind === "cal_ver"
      ? calVerRows.map((r) => ({ key: String(r.instrumentTestId), label: r.analyte, detail: `${r.instrument} · ${r.specialty}` }))
      : mcRows.map((m) => ({ key: m.analyte, label: m.analyte, detail: m.instruments.join(", ") }));
    return f ? all.filter((i) => `${i.label} ${i.detail}`.toLowerCase().includes(f)) : all;
  }, [kind, calVerRows, mcRows, filter]);
  const allShownPicked = items.length > 0 && items.every((i) => picked.has(i.key));
  const toggle = (keys: string[], on: boolean) => setPicked((prev) => {
    const next = new Set(prev);
    for (const k of keys) { if (on) next.add(k); else next.delete(k); }
    return next;
  });
  const switchKind = (k: OutsideKind) => { setKind(k); setPicked(new Set()); setFilter(""); };

  const today = labTodayIso();
  const ready = !!performedOn && performedOn <= today && recordsLocation.trim() && reviewedBy.trim() && picked.size > 0;

  const save = useMutation({
    mutationFn: async () => {
      const body: any = { kind, performedOn, recordsLocation: recordsLocation.trim(), reviewedBy: reviewedBy.trim(), notes: notes.trim() };
      if (kind === "cal_ver") body.instrumentTestIds = Array.from(picked).map(Number);
      else body.analytes = Array.from(picked);
      const res = await apiRequest("POST", `${coverageUrl}/outside-records`, body);
      return res.json();
    },
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: [coverageUrl] });
      toast({ title: `Recorded ${r.created} ${r.created === 1 ? "study" : "studies"}${r.skipped ? ` (${r.skipped} already recorded for that date)` : ""}` });
      setPicked(new Set());
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Could not record the studies", description: errText(e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="outside-records-dialog">
        <DialogHeader>
          <DialogTitle>Record studies done outside VeritaCheck™</DialogTitle>
          <DialogDescription>
            For calibration verifications and correlations your lab already performed and documented outside VeritaCheck. Coverage counts each one as current for 6 months from the date performed. The study records stay where you keep them; note the location so a surveyor can find them.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="text-xs">Study type</Label>
            <Select value={kind} onValueChange={(v) => switchKind(v as OutsideKind)}>
              <SelectTrigger className="h-9 text-sm" data-testid="outside-kind"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cal_ver">{KIND_LABEL.cal_ver}</SelectItem>
                <SelectItem value="method_comparison">{KIND_LABEL.method_comparison}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs" htmlFor="outside-date">Date performed</Label>
            <Input id="outside-date" type="date" max={today} value={performedOn} onChange={(e) => setPerformedOn(e.target.value)} className="h-9 text-sm" data-testid="outside-date" />
          </div>
          <div>
            <Label className="text-xs" htmlFor="outside-reviewed">Reviewed and accepted by</Label>
            <Input id="outside-reviewed" value={reviewedBy} onChange={(e) => setReviewedBy(e.target.value)} maxLength={120} placeholder="Medical director or designee" className="h-9 text-sm" data-testid="outside-reviewed" />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs" htmlFor="outside-location">Where the records are kept</Label>
            <Input id="outside-location" value={recordsLocation} onChange={(e) => setRecordsLocation(e.target.value)} maxLength={300} placeholder="e.g. Chemistry cal ver binder, August 2026" className="h-9 text-sm" data-testid="outside-location" />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs" htmlFor="outside-notes">Notes (optional)</Label>
            <Textarea id="outside-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={2} className="text-sm" data-testid="outside-notes" />
          </div>
        </div>

        <div className="mt-2">
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <div className="text-xs font-medium">Tests this covers ({picked.size} picked)</div>
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by test, instrument or specialty" className="h-8 w-64 text-xs" data-testid="outside-filter" />
          </div>
          <div className="rounded-md border border-border max-h-64 overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground">{filter ? "Nothing matches the filter." : "Nothing on Coverage needs this study type right now."}</div>
            ) : (
              <>
                <label className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/40 text-xs cursor-pointer">
                  <Checkbox checked={allShownPicked} onCheckedChange={(v) => toggle(items.map((i) => i.key), !!v)} data-testid="outside-select-all" />
                  Select all {items.length} shown
                </label>
                {items.map((i) => (
                  <label key={i.key} className="flex items-start gap-2 px-3 py-1.5 border-b border-border/50 last:border-b-0 text-sm cursor-pointer hover:bg-muted/30">
                    <Checkbox className="mt-0.5" checked={picked.has(i.key)} onCheckedChange={(v) => toggle([i.key], !!v)} data-testid={`outside-pick-${i.key}`} />
                    <span><span className="font-medium">{i.label}</span><span className="block text-[11px] text-muted-foreground">{i.detail}</span></span>
                  </label>
                ))}
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!ready || save.isPending} onClick={() => save.mutate()} data-testid="outside-save">
            {save.isPending ? "Saving..." : `Record ${picked.size || ""} ${picked.size === 1 ? "study" : "studies"}`.replace("  ", " ")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Remove an outside record from Coverage, with a reason (the record is kept, marked removed).
export function VoidOutsideRecordDialog({ record, onClose, coverageUrl }: {
  record: { id: number; analyte: string; performedOn: string } | null;
  onClose: () => void;
  coverageUrl: string;
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const remove = useMutation({
    mutationFn: async () => (await apiRequest("POST", `${coverageUrl}/outside-records/${record!.id}/void`, { reason: reason.trim() })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [coverageUrl] });
      toast({ title: "Record removed from Coverage" });
      setReason("");
      onClose();
    },
    onError: (e: any) => toast({ title: "Could not remove the record", description: errText(e), variant: "destructive" }),
  });
  return (
    <Dialog open={!!record} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="outside-void-dialog">
        <DialogHeader>
          <DialogTitle>Remove this outside record?</DialogTitle>
          <DialogDescription>
            {record ? `${record.analyte}, performed ${record.performedOn}. ` : ""}Coverage stops counting it. The record is kept with your reason.
          </DialogDescription>
        </DialogHeader>
        <Label className="text-xs" htmlFor="outside-void-reason">Reason</Label>
        <Input id="outside-void-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. entered for the wrong instrument" className="h-9 text-sm" data-testid="outside-void-reason" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={!reason.trim() || remove.isPending} onClick={() => remove.mutate()} data-testid="outside-void-confirm">Remove</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
