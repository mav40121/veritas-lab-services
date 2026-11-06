// VeritaMaintain stain log, the card on the VeritaMaintain page (Michael Q178 = 1, 2026-11-06). The log itself is client/src/pages/StainLogPage.tsx.
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useLabRoute } from "@/hooks/useLabRoute";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Beaker } from "lucide-react";

type Instrument = { id: number; name: string; location: string | null; status: string; rows: number; entries_today: number };

export function StainLogPanel({ labId }: { labId: number }) {
  const labRoute = useLabRoute();
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [manual, setManual] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`${API_BASE}/api/labs/${labId}/stain-log`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!live || !j) return;
        setInstruments((j.instruments as Instrument[]).filter((i) => i.rows > 0));
        setManual(j.manual_this_month ?? 0);
      })
      .finally(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, [labId]);

  return (
    <Card className="mt-4" data-testid="stain-log-panel">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base flex items-center gap-2"><Beaker className="h-4 w-4 text-primary" /> Stain logs</CardTitle>
        <Button size="sm" asChild><Link href={labRoute("/equipment-app/stain-log")} data-testid="stain-panel-open">Open stain log</Link></Button>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-3">A month grid for each stainer: what was dumped, changed, filtered, topped off or rotated, with the lot and expiration on a stain change. A list for manual stains. Both go through the monthly record review below.</p>
        {loaded && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="stain-panel-table">
              <tbody>
                {instruments.map((i) => (
                  <tr key={i.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-2">
                      <div className="font-medium">{i.name}</div>
                      <div className="text-xs text-muted-foreground">{i.rows} row{i.rows === 1 ? "" : "s"}{i.location ? ` · ${i.location}` : ""}</div>
                    </td>
                    <td className="py-1.5 pr-2 text-xs text-muted-foreground whitespace-nowrap" data-testid={`stain-panel-today-${i.id}`}>{i.entries_today} today</td>
                    <td className="py-1.5 text-right"><Button size="sm" variant="ghost" asChild><Link href={labRoute(`/equipment-app/stain-log?instrument=${i.id}`)}>Open</Link></Button></td>
                  </tr>
                ))}
                <tr className="border-b last:border-0">
                  <td className="py-1.5 pr-2"><div className="font-medium">Manual stain log</div></td>
                  <td className="py-1.5 pr-2 text-xs text-muted-foreground whitespace-nowrap" data-testid="stain-panel-manual">{manual} this month</td>
                  <td className="py-1.5 text-right"><Button size="sm" variant="ghost" asChild><Link href={labRoute("/equipment-app/stain-log?view=manual")}>Open</Link></Button></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
