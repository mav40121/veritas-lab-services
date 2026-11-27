// client/src/components/FindingIndicatorsCard.tsx
//
// The VeritaQA indicator months linked to a VeritaResponse finding (B15; server/qualityFindings.ts). They are linked and unlinked
// from VeritaQA. Someone who may not read VeritaQA in this laboratory gets no card.
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";

interface Row { link_id: number; name: string; department: string | null; year: number; month: number; value_text: string; target_text: string; status: "green" | "yellow" | "red" | null }
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WORD: Record<string, string> = { green: "Met", yellow: "Watch", red: "Missed" };
const COLOR: Record<string, string> = { green: "text-[#437A22] dark:text-green-300", yellow: "text-[#964219] dark:text-amber-300", red: "text-[#A12C7B] dark:text-pink-300" };

export function FindingIndicatorsCard({ labId, findingId }: { labId: number; findingId: string | number }) {
  const url = `/api/labs/${labId}/findings/${findingId}/indicators`;
  const { data } = useQuery<{ indicators: Row[] }>({
    queryKey: [url], refetchOnMount: "always", retry: false,
    queryFn: async () => {
      const r = await fetch(`${API_BASE}${url}`, { headers: authHeaders() });
      return r.ok ? r.json() : { indicators: [] };
    },
  });
  const rows = data?.indicators ?? [];
  if (!rows.length) return null;
  return (
    <Card data-testid="finding-indicators">
      <CardHeader className="py-3 px-4 border-b"><CardTitle className="text-base font-semibold">VeritaQA™ indicators</CardTitle></CardHeader>
      <CardContent className="p-4 space-y-1.5">
        {rows.map((r) => (
          <div key={r.link_id} className="rounded-md border border-border p-2.5 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{r.name}</span>
              <span className="text-xs text-muted-foreground">{[r.department, `${MONTHS[r.month - 1]} ${r.year}`].filter(Boolean).join(", ")}</span>
            </div>
            <div className="text-xs">
              {r.value_text || "No value"}, target {r.target_text.charAt(0).toLowerCase() + r.target_text.slice(1)}
              {r.status && <span className={`ml-2 font-semibold ${COLOR[r.status]}`}>{WORD[r.status]}</span>}
            </div>
          </div>
        ))}
        <Link href={`/labs/${labId}/veritabench/pi`} className="inline-block text-xs text-teal-700 dark:text-teal-400 hover:underline">Open VeritaQA™</Link>
      </CardContent>
    </Card>
  );
}
