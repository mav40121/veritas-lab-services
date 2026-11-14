// Everyone on the VeritaStaff roster and whether they have signed this document's current version (Michael 2026-11-04, Q161; CAP GEN.75400
// asks for a roster with dates). It counts both ways of signing and shows the people nobody assigned it to. Step D adds who it is assigned to and
// how each lab group stands, so an owner or editor can see who owes it, by group. Server: server/policySignatureStatus.ts.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { labDayOf } from "@/lib/labDate";

type RosterPerson = {
  employee_id: number; name: string; title: string | null; has_login: boolean;
  status: "signed" | "older_version" | "not_signed";
  signed_at: string | null; version_label: string | null; carried_forward: boolean; how: string | null;
  assigned: boolean; owes: boolean; groups: string[]; group_ids: number[];
  // Signed in the lab's prior system and carried over, not signed in VeritaAssure.
  prior_system?: { system: string; version: string; signed_on: string } | null;
};
type PriorHistory = { name: string; credentials: string | null; version: string; signed_on: string; system: string; state: string };
type RosterGroup = { id: number; name: string; total: number; signed: number; assigned: boolean };
type RosterStatus = {
  people: RosterPerson[];
  prior_history?: PriorHistory[];
  groups: RosterGroup[];
  assigned_to: string[];
  summary: { total: number; signed: number; older_version: number; not_signed: number; no_login: number; assigned: number; assigned_signed: number; owes: number };
  read_and_sign_required: boolean;
  approved: boolean;
};

const day = (s: string | null) => labDayOf(s);

export function DocumentSignatureRoster({ labId, documentId }: { labId: number; documentId: number }) {
  const [openOnly, setOpenOnly] = useState(false);
  const [groupId, setGroupId] = useState<string>("all");
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
  const inGroup = groupId === "all" ? data.people : data.people.filter((p) => p.group_ids.includes(Number(groupId)));
  const people = openOnly ? inGroup.filter((p) => p.owes) : inGroup;
  return (
    <div className="min-w-0" data-testid="signature-roster">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="text-sm font-medium" data-testid="roster-count">
            {data.summary.signed} of {data.summary.total} on the roster have signed this version
          </div>
          <div className="text-xs text-muted-foreground [overflow-wrap:anywhere]" data-testid="roster-assigned">
            {data.summary.assigned === 0
              ? "Nobody is assigned this document yet."
              : `Assigned to ${data.summary.assigned}: ${data.summary.assigned_signed} signed, ${data.summary.owes} still owe it.${data.assigned_to.length ? ` Goes to ${data.assigned_to.join(", ")}.` : ""}`}
          </div>
        </div>
        <label className="text-xs text-muted-foreground flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} data-testid="roster-open-only" />
          Only who still owes it ({data.summary.owes})
        </label>
      </div>
      {!data.approved && <p className="text-xs text-muted-foreground mb-2">This document isn't approved yet, so staff can't sign it.</p>}
      {data.summary.no_login > 0 && (
        <p className="text-xs text-amber-800 dark:text-amber-300 mb-2" data-testid="roster-no-login">
          {data.summary.no_login} {data.summary.no_login === 1 ? "person has" : "people have"} no login, so they can't sign until they get one.
        </p>
      )}
      {data.groups.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-2" data-testid="roster-groups">
          <button type="button" onClick={() => setGroupId("all")} data-testid="roster-group-all"
            className={`rounded-full border px-2.5 py-0.5 text-xs ${groupId === "all" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
            Everyone
          </button>
          {data.groups.map((g) => (
            <button key={g.id} type="button" onClick={() => setGroupId(String(g.id))} data-testid={`roster-group-${g.id}`}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${groupId === String(g.id) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
              title={g.assigned ? "Assigned this document" : "Not assigned this document"}>
              {g.name}: {g.signed} of {g.total}{g.assigned ? "" : ", not assigned"}
            </button>
          ))}
        </div>
      )}
      <div className="border rounded divide-y max-h-64 overflow-y-auto">
        {people.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">{openOnly ? "Nobody here still owes this version." : "Nobody here."}</div>}
        {people.map((p) => (
          <div key={p.employee_id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-3 py-1.5 text-sm" data-testid={`roster-row-${p.employee_id}`}>
            <span className="font-medium min-w-0 break-words">
              {p.name}
              {p.title && <span className="ml-1 text-xs font-normal text-muted-foreground">{p.title}</span>}
              {!p.has_login && <span className="ml-1 text-xs font-normal text-amber-800 dark:text-amber-300">No login</span>}
              {p.groups.length > 0 && <span className="block text-xs font-normal text-muted-foreground" data-testid="roster-person-groups">{p.groups.join(", ")}</span>}
            </span>
            {p.status === "signed" && p.prior_system ? (
              <span className="text-xs text-green-800 dark:text-green-300" data-testid="roster-status">
                Signed {day(p.prior_system.signed_on)} on v{p.prior_system.version} in {p.prior_system.system}, carried over
              </span>
            ) : p.status === "signed" ? (
              <span className="text-xs text-green-800 dark:text-green-300" data-testid="roster-status">
                Signed {day(p.signed_at)}{p.carried_forward ? ` on v${p.version_label}, carried forward` : ""} ({p.how})
              </span>
            ) : p.status === "older_version" ? (
              <span className={`text-xs ${p.assigned ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground"}`} data-testid="roster-status">
                Signed v{p.version_label} on {day(p.signed_at)}{p.assigned ? ", needs this version" : ", not assigned this version"}
              </span>
            ) : p.assigned ? (
              <span className="text-xs font-medium text-red-700 dark:text-red-400" data-testid="roster-status">Not signed</span>
            ) : (
              <span className="text-xs text-muted-foreground" data-testid="roster-status">Not assigned</span>
            )}
          </div>
        ))}
      </div>
      {(data.prior_history?.length ?? 0) > 0 && (
        <details className="mt-2 border rounded" data-testid="roster-prior-history">
          <summary className="px-3 py-1.5 text-xs font-medium cursor-pointer">
            Signed in {data.prior_history![0].system}, not on your active roster ({data.prior_history!.length})
          </summary>
          <div className="px-3 pb-2 text-xs text-muted-foreground">
            History carried over from the prior system. These people didn't sign in VeritaAssure, have no login from it, and owe nothing.
          </div>
          <div className="divide-y border-t max-h-40 overflow-y-auto">
            {data.prior_history!.map((h, i) => (
              <div key={`${h.name}-${h.signed_on}-${i}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-3 py-1.5 text-sm" data-testid="roster-prior-row">
                <span className="min-w-0 break-words">{h.name}{h.credentials && <span className="ml-1 text-xs text-muted-foreground">{h.credentials}</span>}</span>
                <span className="text-xs text-muted-foreground">Signed {day(h.signed_on)} on v{h.version}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
