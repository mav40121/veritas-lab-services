// client/src/components/FindingTypeDetails.tsx
//
// The type-specific card on a VeritaResponse finding (entry-type templates, Michael 2026-10-26, mock D1-D7): the PT
// investigation checklist, NCE event details, QC look-back, alternative-assessment verification, FDA disposition.
// Fields come from shared/findingTypes.ts, the same list the server sanitizes against. A field with `column` reads
// and writes the finding column of that name; the rest live in findings.type_details.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CHECKLIST_ANSWERS, findingTemplate, parseTypeDetails, type DetailField } from "@shared/findingTypes";

interface Props {
  finding: any;
  setField: (key: string, value: any) => void;
  readOnly?: boolean;
}

export function FindingTypeDetails({ finding, setField, readOnly }: Props) {
  const tpl = findingTemplate(finding?.source_type);
  if (!tpl.detailsTitle || tpl.details.length === 0) return null;
  const details = parseTypeDetails(finding.type_details);
  const valueOf = (f: DetailField) => ((f as any).column ? finding[f.key] : details[f.key]);
  const setValue = (f: DetailField, v: any) => {
    if ((f as any).column) setField(f.key, v);
    else setField("type_details", { ...details, [f.key]: v });
  };
  const wide = (f: DetailField) => f.kind === "checklist" || (f.kind === "text" && f.long);

  return (
    <Card data-testid="finding-type-details">
      <CardHeader className="py-3 px-4 border-b">
        <CardTitle className="text-base font-semibold">{tpl.detailsTitle}</CardTitle>
      </CardHeader>
      <CardContent className="p-4 grid grid-cols-2 gap-3">
        {tpl.details.map((f) => {
          const v = valueOf(f);
          const id = `detail-${f.key}`;
          if (f.kind === "checklist") {
            const rows = (v && typeof v === "object") ? v : {};
            return (
              <div key={f.key} className="col-span-2 space-y-2" data-testid={id}>
                <Label className="text-xs">{f.label}</Label>
                {f.items.map((it) => {
                  const row = rows[it.value] || { answer: "", note: "" };
                  const setRow = (patch: any) => setValue(f, { ...rows, [it.value]: { ...row, ...patch } });
                  return (
                    <div key={it.value} className="grid grid-cols-1 sm:grid-cols-[1fr_7rem] gap-2 rounded-md border p-2">
                      <div>
                        <div className="text-sm font-medium">{it.label}</div>
                        <div className="text-xs text-muted-foreground">{it.hint}</div>
                      </div>
                      <Select value={row.answer || ""} onValueChange={(a) => setRow({ answer: a })} disabled={readOnly}>
                        <SelectTrigger className="h-8 text-sm" data-testid={`${id}-${it.value}`}><SelectValue placeholder="Answer" /></SelectTrigger>
                        <SelectContent>
                          {CHECKLIST_ANSWERS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Input
                        className="h-8 text-sm sm:col-span-2"
                        value={row.note || ""}
                        onChange={(e) => setRow({ note: e.target.value })}
                        placeholder="Note (what was checked, what was found)"
                        disabled={readOnly}
                      />
                    </div>
                  );
                })}
              </div>
            );
          }
          return (
            <div key={f.key} className={`space-y-1 ${wide(f) ? "col-span-2" : ""}`}>
              <Label className="text-xs" htmlFor={id}>{f.label}</Label>
              {f.kind === "enum" ? (
                <Select value={v || ""} onValueChange={(nv) => setValue(f, nv)} disabled={readOnly}>
                  <SelectTrigger id={id} className="h-9 text-sm" data-testid={id}><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {f.options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : f.kind === "date" ? (
                <Input id={id} type="date" className="h-9 text-sm" value={v || ""} onChange={(e) => setValue(f, e.target.value)} disabled={readOnly} data-testid={id} />
              ) : f.kind === "int" ? (
                <Input id={id} type="number" min={0} className="h-9 text-sm" value={v ?? ""} placeholder={f.placeholder}
                  onChange={(e) => setValue(f, e.target.value === "" ? "" : Number(e.target.value))} disabled={readOnly} data-testid={id} />
              ) : f.long ? (
                <Textarea id={id} className="text-sm min-h-[60px]" value={v || ""} placeholder={f.placeholder} onChange={(e) => setValue(f, e.target.value)} disabled={readOnly} data-testid={id} />
              ) : (
                <Input id={id} className="h-9 text-sm" value={v || ""} placeholder={f.placeholder} onChange={(e) => setValue(f, e.target.value)} disabled={readOnly} data-testid={id} />
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
