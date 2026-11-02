// client/src/components/SignedEntries.tsx
//
// Read-only view of what a method was signed on (Michael 2026-11-02: "Once it is signed, the supporting documentation
// is no longer visible. Is there another way to get to it?"). Signing freezes the method's entries under the sign-off;
// this shows them as they were signed: each element's data or N/A reason, the Element 5 samples, the observers named,
// and for a waived method the four methods with evidence, date and initials. Opened from MethodSignOffPanel on the
// person page and the By-instrument page. Nothing here edits; Unlock stays the only way to change a signed set.
import { Badge } from "@/components/ui/badge";
import { ELEMENT_NAMES, ELEMENT_FIELDS, fmtDate } from "@/lib/competencyElements";
import type { MethodSignoff } from "@/components/MethodSignOffPanel";

function statusBadge(status: string) {
  const cls = status === "pass" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
    : status === "fail" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
    : status === "na" || status === "unused" ? "bg-muted text-muted-foreground"
    : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
  const label = status === "pass" ? "PASS" : status === "fail" ? "FAIL" : status === "na" ? "N/A" : status === "unused" ? "Not used" : "Incomplete";
  return <Badge className={`text-[10px] shrink-0 ${cls}`}>{label}</Badge>;
}

const show = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[120px]">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-xs font-medium break-words">{value || <span className="text-muted-foreground font-normal">Not entered</span>}</div>
    </div>
  );
}

export default function SignedEntries({ signoff, waived }: { signoff: MethodSignoff; waived?: boolean }) {
  const testId = `signed-entries-${signoff.id ?? "legacy"}`;
  if (!signoff.hasEntries) {
    return (
      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground" data-testid={testId}>
        {signoff.imported
          ? `This sign-off was imported from ${signoff.importedFrom || "an earlier program"}; its element entries are kept in that record, not on this page.`
          : "No element entries are stored with this sign-off."}
        {signoff.documentation ? ` Documentation: ${signoff.documentation}` : ""}
      </div>
    );
  }
  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2" data-testid={testId}>
      <div className="text-[11px] text-muted-foreground">
        Entries as signed (read only).{signoff.documentation ? ` Documentation: ${signoff.documentation}` : ""}
      </div>
      {waived ? (
        (signoff.waivedMethods || []).length ? (signoff.waivedMethods || []).map((m) => (
          <div key={m.num} className="rounded-md border bg-background p-2.5" data-testid="signed-waived-method">
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <div className="text-xs font-semibold">Method {m.num}: {m.name}</div>
              {statusBadge(m.status)}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              <Fact label="Evidence" value={show(m.evidence)} />
              <Fact label="Date performed" value={fmtDate(m.date)} />
              <Fact label="Evaluator initials" value={show(m.initials)} />
            </div>
          </div>
        )) : <div className="text-xs text-muted-foreground">No waived methods recorded.</div>
      ) : (
        (signoff.elements || []).map((el) => {
          const fields = ELEMENT_FIELDS[el.num] || [];
          const samples = el.num === 5 && Array.isArray(el.samples) && el.samples.length ? el.samples : null;
          return (
            <div key={el.num} className="rounded-md border bg-background p-2.5" data-testid={`signed-element-${el.num}`}>
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="text-xs font-semibold">Element {el.num}: {ELEMENT_NAMES[el.num]}</div>
                {statusBadge(el.na ? "na" : el.status)}
              </div>
              {el.na ? (
                <div className="text-xs"><span className="text-muted-foreground">N/A reason: </span>{show(el.naJustification) || "Not entered"}</div>
              ) : samples ? (
                <div className="space-y-1">
                  {samples.map((s: any, i: number) => (
                    <div key={i} className="flex flex-wrap gap-x-4 gap-y-1.5" data-testid="signed-sample">
                      <Fact label={samples.length > 1 ? `Sample ${i + 1} type` : "Sample type"} value={show(s.sampleType)} />
                      <Fact label="Sample ID" value={show(s.sampleId)} />
                      <Fact label="Acceptable" value={s.acceptable == null ? "" : s.acceptable ? "Yes" : "No"} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {fields.map((f) => {
                    const raw = el[f.key];
                    const value = f.type === "date" ? fmtDate(raw)
                      : f.type === "bool" ? (raw == null || raw === "" ? "" : raw ? "Yes" : "No")
                      : f.type === "observer" && raw ? `${show(raw)}${el.observerName ? ` (${el.observerName})` : ""}`
                      : show(raw);
                    return <Fact key={f.key} label={f.label} value={value} />;
                  })}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
