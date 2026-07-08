// CoverageAttributionDialog — Phase 2 of "allocation at time of running assay".
// After a coverage-relevant study is saved but the system could not confidently
// attribute it to a map point (custom TEa, a preset that does not corroborate the
// test name, or no unique resolve), this soft-prompts the tech to pick the map
// analyte the study verifies — or dismiss with "not on our map yet". Non-blocking:
// either choice lets the save stand. Picking calls the align endpoint.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type CoverageResp = {
  rows?: { analyte: string }[];
  methodComparisons?: { analyte: string }[];
};

export function CoverageAttributionDialog({
  open, labId, studyId, testName, onClose,
}: {
  open: boolean; labId: number; studyId: number; testName: string; onClose: () => void;
}) {
  const { toast } = useToast();
  const [analyte, setAnalyte] = useState("");
  const [saving, setSaving] = useState(false);

  const coverageUrl = labId ? `/api/labs/${labId}/veritacheck/coverage` : null;
  const { data } = useQuery<CoverageResp>({ queryKey: [coverageUrl], enabled: open && !!coverageUrl });
  const analytes = useMemo(
    () => Array.from(new Set([...(data?.rows || []).map((r) => r.analyte), ...(data?.methodComparisons || []).map((m) => m.analyte)]))
      .filter(Boolean).sort((a, b) => a.localeCompare(b)),
    [data],
  );

  const close = () => { setAnalyte(""); onClose(); };

  const align = async () => {
    if (!analyte || saving) return;
    setSaving(true);
    try {
      await apiRequest("POST", `${coverageUrl}/align`, { studyId, analyte });
      toast({ title: `Matched to ${analyte}` });
      close();
    } catch {
      toast({ title: "Could not match this study", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent data-testid="coverage-attribution-dialog">
        <DialogHeader>
          <DialogTitle>Which map point does this study cover?</DialogTitle>
          <DialogDescription>
            "{testName}" was saved, but its name does not match an analyte on your VeritaMap, so it will not count toward Coverage until it is matched. Pick the map analyte it verifies, or mark it as not on the map yet. This does not change the study or its name.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <Select value={analyte} onValueChange={setAnalyte}>
            <SelectTrigger data-testid="attribution-analyte-select"><SelectValue placeholder="Select a map analyte…" /></SelectTrigger>
            <SelectContent className="max-h-72">
              {analytes.map((a) => <SelectItem key={a} value={a} className="text-sm">{a}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={close} data-testid="attribution-not-on-map">Not on our map yet</Button>
          <Button onClick={align} disabled={!analyte || saving} data-testid="attribution-align">Match to Coverage</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
