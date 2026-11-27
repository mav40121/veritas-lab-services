// client/src/hooks/useCompetencySigner.ts
//
// B5 (signatures mock 2, 2026-11-27): who the signed-in person is on this lab's VeritaStaff™ roster, read from the session by
// the server (GET /api/labs/:labId/competency/to-sign), never picked from a list. The sign form (MethodSignOffPanel) reads it
// with ?part=me; the "Waiting for your signature" card (CompetencyToSign) reads the whole list.
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import type { MethodSignState } from "@/components/MethodSignOffPanel";

export interface CompetencyMe { staffEmployeeId: number; name: string; title: string | null; observer: boolean }
export interface ObservationToSign {
  itemId: number; element: number; employeeId: number; employeeName: string; methodName: string; instrumentId: number;
  watched: string; dateObserved: string; result: "pass" | "fail" | null; required: boolean; changedAfterSigning: boolean;
}
export interface CompetencyToSignData {
  me: CompetencyMe | null; canRecordPaper: boolean; observations: ObservationToSign[];
  methods: Array<{ employee: { id: number; name: string; title: string | null }; testSystem: MethodSignState }>;
}

export const competencyToSignUrl = (labId: number | string, meOnly: boolean) => `/api/labs/${labId}/competency/to-sign${meOnly ? "?part=me" : ""}`;

export const getCompetencyJson = async (url: string) => {
  const r = await fetch(`${API_BASE}${url}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

/** Who the signed-in person is here, and whether they may enter a sign-off from paper. */
export function useCompetencySigner(labId: number | string | null | undefined) {
  const url = labId ? competencyToSignUrl(labId, true) : null;
  return useQuery<CompetencyToSignData>({ queryKey: [url ?? "no-signer"], enabled: !!url, queryFn: () => getCompetencyJson(url!), staleTime: 60_000 });
}

/** After any competency signature: the lists and every competency screen read again. */
export function refreshCompetencyReads(qc: QueryClient) {
  qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && /\/competency\//.test(String(q.queryKey[0])) });
}
