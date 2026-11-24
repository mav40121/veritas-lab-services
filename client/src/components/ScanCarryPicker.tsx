// client/src/components/ScanCarryPicker.tsx
//
// The items of a scan whose answers can be carried into a new one (B7, 2026-11-24; server/veritascanCarry.ts):
// ticked by the person, Compliant and N/A to start with. Used when a new scan begins from an earlier one, and when a system's
// owner or admin copies a scan's answers to another lab of the organization.

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { API_BASE, responseErrorText } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { DOMAINS, STATUS_COLORS, type ScanStatus } from "@/lib/veritaScanData";

interface CarryItem { item_id: number; status: ScanStatus; notes: string | null; owner: string | null; due_date: string | null; domain: string | null; question: string | null }
interface CarryPreview { scan: { id: number; name: string; date: string }; items: CarryItem[]; notCopied: { automatic: number; unreviewed: number } }

export function ScanCarryPicker({ labId, scanId, selected, onChange }: { labId: number; scanId: number; selected: Set<number>; onChange: (ids: Set<number>) => void }) {
  const url = `/api/labs/${labId}/veritascan/scans/${scanId}/carry-preview`;
  const [filled, setFilled] = useState<number | null>(null);
  const { data, isLoading, error, isFetchedAfterMount } = useQuery<CarryPreview>({
    queryKey: [url],
    refetchOnMount: "always",
    queryFn: async () => {
      const res = await fetch(`${API_BASE}${url}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(await responseErrorText(res, "Could not read that scan"));
      return res.json();
    },
  });
  const items = data?.items ?? [];
  // Compliant and N/A to start with, once per scan, from a read made after this opened.
  useEffect(() => {
    if (!data || !isFetchedAfterMount || filled === scanId) return;
    setFilled(scanId);
    onChange(new Set(data.items.filter((i) => i.status === "Compliant" || i.status === "N/A").map((i) => i.item_id)));
  }, [data, isFetchedAfterMount, filled, scanId, onChange]);
  const groups = useMemo(() => DOMAINS.map((d) => ({ domain: d, items: items.filter((i) => i.domain === d) })).filter((g) => g.items.length), [items]);
  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next);
  };
  if (isLoading) return <p className="text-xs text-muted-foreground py-4 text-center">Reading that scan…</p>;
  if (error) return <p className="text-xs text-destructive py-4 text-center">{(error as Error).message}</p>;
  const left = [
    data?.notCopied.automatic ? `${data.notCopied.automatic} marked automatically by VeritaCheck® or VeritaComp™` : null,
    data?.notCopied.unreviewed ? `${data.notCopied.unreviewed} carried there and never reviewed` : null,
  ].filter(Boolean);
  return (
    <div className="space-y-2" data-testid="carry-picker">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium" data-testid="carry-count">{selected.size} of {items.length} ticked</span>
        <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => onChange(new Set(items.filter((i) => i.status === "Compliant" || i.status === "N/A").map((i) => i.item_id)))}>Compliant and N/A</Button>
        <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => onChange(new Set(items.map((i) => i.item_id)))} data-testid="carry-all">All</Button>
        <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => onChange(new Set())} data-testid="carry-none">None</Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Status, notes, owner and due date are carried. Each carried answer is marked not yet reviewed and counts as Not Assessed until someone reviews it.
        Teaching notes and your custom questions are not carried.{left.length > 0 && ` Not carried: ${left.join("; ")}.`}
      </p>
      <div className="max-h-[38vh] overflow-y-auto rounded-md border border-border p-2 space-y-3">
        {groups.map((g) => (
          <div key={g.domain}>
            <div className="text-[11px] font-semibold text-muted-foreground mb-1">{g.domain}</div>
            {g.items.map((i) => (
              <label key={i.item_id} className="flex items-start gap-2 py-1 cursor-pointer">
                <Checkbox className="mt-0.5" checked={selected.has(i.item_id)} onCheckedChange={() => toggle(i.item_id)} data-testid={`carry-item-${i.item_id}`} />
                <span className="flex-1 min-w-0">
                  <span className="block text-xs leading-snug">{i.question}</span>
                  <span className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5">
                    <span className={`rounded border px-1 ${STATUS_COLORS[i.status]}`}>{i.status}</span>
                    {i.owner && <span>{i.owner}</span>}
                    {i.due_date && <span>due {i.due_date}</span>}
                    {i.notes && <span>has notes</span>}
                  </span>
                </span>
              </label>
            ))}
          </div>
        ))}
        {items.length === 0 && <p className="text-xs text-muted-foreground italic py-4 text-center">That scan has no answers to carry.</p>}
      </div>
    </div>
  );
}
