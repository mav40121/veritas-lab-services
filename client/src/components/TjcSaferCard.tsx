// client/src/components/TjcSaferCard.tsx
//
// SAFER placement on a TJC survey finding (Lifepoint ask, Michael 2026-11-19). The Joint Commission places each
// Requirement for Improvement on its SAFER matrix: likelihood to harm (Low, Moderate, High) by scope (Limited,
// Pattern, Widespread). The grid sets both; a placement in the High row opens leadership involvement and preventive
// analysis, which the ESC then requires (shared/findingTypes.ts validateTjcEscFields, the same rule the PDF gate uses).
// Values live in findings.type_details and are saved with the page's Save.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SAFER_LIKELIHOOD, SAFER_SCOPE, parseTypeDetails, saferPlacement } from "@shared/findingTypes";

interface Props {
  finding: any;
  setField: (key: string, value: any) => void;
  readOnly?: boolean;
}

// The matrix reads as TJC draws it: High at the top, Low at the bottom.
const ROWS = [...SAFER_LIKELIHOOD].reverse();

export function TjcSaferCard({ finding, setField, readOnly }: Props) {
  const details = parseTypeDetails(finding.type_details);
  const placement = saferPlacement(details);
  const setDetails = (patch: Record<string, unknown>) => setField("type_details", { ...details, ...patch });
  const showHigh = !!placement?.highRow || !!details.leadership_involvement || !!details.preventive_analysis;

  return (
    <Card data-testid="tjc-safer-card">
      <CardHeader className="py-3 px-4 border-b">
        <CardTitle className="text-base font-semibold">SAFER placement</CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        <div className="text-xs text-muted-foreground">
          Place the finding where the surveyor's report puts it. A placement in the High row adds leadership involvement and a preventive analysis to the Evidence of Standards Compliance.
        </div>
        <div className="overflow-x-auto">
          <table className="text-sm border-collapse" data-testid="tjc-safer-grid">
            <thead>
              <tr>
                <th className="p-1 text-xs font-medium text-muted-foreground text-left">Likelihood to harm</th>
                {SAFER_SCOPE.map((s) => (
                  <th key={s.value} className="p-1 text-xs font-medium text-muted-foreground text-center min-w-[6.5rem]">{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((l) => (
                <tr key={l.value}>
                  <th scope="row" className="p-1 text-xs font-medium text-left pr-3">{l.label}</th>
                  {SAFER_SCOPE.map((s) => {
                    const on = placement?.likelihood === l.value && placement?.scope === s.value;
                    return (
                      <td key={s.value} className="p-1">
                        <button
                          type="button"
                          disabled={readOnly}
                          aria-pressed={on}
                          aria-label={`${l.label} likelihood to harm, ${s.label} scope`}
                          data-testid={`safer-${l.value}-${s.value}`}
                          onClick={() => setDetails({ safer_likelihood: l.value, safer_scope: s.value })}
                          className={`w-full h-10 rounded-md border text-xs transition-colors ${
                            on
                              ? "bg-[#01696F] border-[#01696F] text-white font-semibold"
                              : l.value === "high"
                                ? "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-900/50"
                                : "border-border bg-background hover:bg-muted"
                          } disabled:cursor-not-allowed disabled:opacity-70`}
                        >
                          {`${l.label} / ${s.label}`}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-sm" data-testid="tjc-safer-current">
          {placement ? <>Placement: <span className="font-semibold">{placement.label}</span></> : <span className="text-muted-foreground">Not placed yet.</span>}
        </div>
        {showHigh && (
          <div className="grid grid-cols-1 gap-3" data-testid="tjc-safer-high">
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="tjc-leadership">
                Leadership involvement{placement?.highRow ? " (required for a High likelihood to harm)" : ""}
              </Label>
              <Textarea
                id="tjc-leadership"
                data-testid="tjc-leadership"
                value={details.leadership_involvement || ""}
                onChange={(e) => setDetails({ leadership_involvement: e.target.value })}
                className="text-sm min-h-[70px]"
                placeholder="Which leaders, by role, took part in the corrective action and how they will oversee it. No patient names or record numbers."
                disabled={readOnly}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="tjc-preventive-analysis">
                Preventive analysis{placement?.highRow ? " (required for a High likelihood to harm)" : ""}
              </Label>
              <Textarea
                id="tjc-preventive-analysis"
                data-testid="tjc-preventive-analysis"
                value={details.preventive_analysis || ""}
                onChange={(e) => setDetails({ preventive_analysis: e.target.value })}
                className="text-sm min-h-[70px]"
                placeholder="Where else the same failure could happen, what was checked, and what changed so it does not recur."
                disabled={readOnly}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
