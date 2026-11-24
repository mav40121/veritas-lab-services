// client/src/components/DocumentLinkedFrom.tsx
//
// On a VeritaDC document: the VeritaScan items and VeritaResponse findings that link to it (B8, 2026-11-24;
// server/inspectionLinks.ts). Shows nothing when nothing links to it, or when the reader may not read the list.

import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useLabRoute } from "@/hooks/useLabRoute";

interface LinkedFrom {
  scanItems: Array<{ item_id: number; question: string }>;
  findings: Array<{ id: number; finding_number: string | null; accreditor: string; source_type: string; standard_ref: string | null; status: string }>;
}

export function DocumentLinkedFrom({ labId, documentId }: { labId: number | null; documentId: number }) {
  const labRoute = useLabRoute();
  const { data } = useQuery<LinkedFrom | null>({
    queryKey: [`/api/labs/${labId}/veritapolicy/documents/${documentId}/linked-from`],
    enabled: !!labId,
    refetchOnMount: "always",
    retry: false,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/labs/${labId}/veritapolicy/documents/${documentId}/linked-from`, { headers: authHeaders() });
      return res.ok ? res.json() : null;
    },
  });
  if (!data || (data.scanItems.length === 0 && data.findings.length === 0)) return null;
  return (
    <div className="rounded border bg-muted/30 p-2 text-xs space-y-1" data-testid="document-linked-from">
      <div className="font-medium flex items-center gap-1"><ClipboardList size={14} /> Linked from</div>
      <ul className="space-y-0.5">
        {data.findings.map((f) => (
          <li key={`f${f.id}`}>
            <Link href={labRoute(`/veritaresponse/${f.id}`)} className="text-primary hover:underline">VeritaResponse™ finding {f.finding_number || `#${f.id}`}</Link>
            {f.standard_ref ? <span className="text-muted-foreground"> {f.standard_ref}</span> : null}
          </li>
        ))}
        {data.scanItems.map((i) => <li key={`i${i.item_id}`}>VeritaScan® item: <span className="text-muted-foreground">{i.question}</span></li>)}
      </ul>
    </div>
  );
}
