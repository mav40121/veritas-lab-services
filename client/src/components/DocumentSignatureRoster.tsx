// Everyone on the VeritaStaff roster and whether they have signed this document's current version (Michael 2026-11-04, Q161; CAP GEN.75400
// asks for a roster with dates). It counts both ways of signing and shows the people nobody assigned it to. Server: server/policySignatureStatus.ts.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

type RosterPerson = {
  employee_id: number; name: string; title: string | null; has_login: boolean;
  status: "signed" | "older_version" | "not_signed";
  signed_at: string | null; version_label: string | null; carried_forward: boolean; how: string | null;
};
type RosterStatus = {
  people: RosterPerson[];
  summary: { total: number; signed: number; older_version: number; not_signed: number; no_login: number };
  read_and_sign_required: boolean;
  approved: boolean;
};

const day = (s: string | null) => (s ? s.slice(0, 10) : "");

export function DocumentSignatureRoster({ labId, documentId }: { labId: number; documentId: number }) {
  const [openOnly, setOpenOnly] = useState(false);
  const { data, isLoading } = useQuery<RosterStatus>({
    queryKey: [`/api/labs/${labId}/veritapolicy/documents/${documentId}/signature-status`],
    queryFn: getQueryFn({ on401: "throw" }),
  });
  if (isLoading || !data) return null;
  if (!data.read_and_sign_required) {
    return <p className="text-sm text-muted-foreground" data-testid="roster-not-required">This document type doesn't go to staff for read-and-sign in this lab.</p>;
  }
  if (data.summary.total === 0) {
    return <p className="text-sm text-muted-foreground" data-testid="roster-empty">No one is on the VeritaStaff™ roster yet. Add staff there to see who has signed.</p>;
  }
  const open = data.summary.total - data.summary.signed;
  const people = openOnly ? data.people.filter((p) => p.status !== "signed") : data.people;
  return (
    <div className="min-w-0" data-testid="signature-roster">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="text-sm font-medium" data-testid="roster-count">
          {data.summary.signed} of {data.summary.total} on the roster have signed this version
        </div>
        <label className="text-xs text-muted-foreground flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} data-testid="roster-open-only" />
          Only who still needs to sign ({open})
        </label>
      </div>
      {!data.approved && <p className="text-xs text-muted-foreground mb-2">This document isn't approved yet, so staff can't sign it.</p>}
      {data.summary.no_login > 0 && (
        <p className="text-xs text-amber-800 dark:text-amber-300 mb-2" data-testid="roster-no-login">
          {data.summary.no_login} {data.summary.no_login === 1 ? "person has" : "people have"} no login, so they can't sign until they get one.
        </p>
      )}
      <div className="border rounded divide-y max-h-64 overflow-y-auto">
        {people.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">Everyone on the roster has signed this version.</div>}
        {people.map((p) => (
          <div key={p.employee_id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-3 py-1.5 text-sm" data-testid={`roster-row-${p.employee_id}`}>
            <span className="font-medium min-w-0 break-words">
              {p.name}
              {p.title && <span className="ml-1 text-xs font-normal text-muted-foreground">{p.title}</span>}
              {!p.has_login && <span className="ml-1 text-xs font-normal text-amber-800 dark:text-amber-300">No login</span>}
            </span>
            {p.status === "signed" ? (
              <span className="text-xs text-green-800 dark:text-green-300" data-testid="roster-status">
                Signed {day(p.signed_at)}{p.carried_forward ? ` on v${p.version_label}, carried forward` : ""} ({p.how})
              </span>
            ) : p.status === "older_version" ? (
              <span className="text-xs text-amber-800 dark:text-amber-300" data-testid="roster-status">Signed v{p.version_label} on {day(p.signed_at)}, needs this version</span>
            ) : (
              <span className="text-xs font-medium text-red-700 dark:text-red-400" data-testid="roster-status">Not signed</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
