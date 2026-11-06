// Who a document, a manual or the whole lab goes to for read-and-sign (Step D of Heywood's move out of MediaLab; server/policyReadSign.ts).
// An editor picks lab groups, named roster people, or everyone in the lab. A manual's assignment covers its sub-manuals and any document
// added later, and a new member of a group picks up what the group owes, because the server works that out when it is read.
// Assigning sends no email. The notice at the bottom is the only mail, and it says what it will do before it does it.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LabGroupsDialog, useLabGroups } from "@/components/LabGroupsDialog";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { Loader2, Mail, Trash2 } from "lucide-react";

export type ReadSignScopeRef = { type: "document" | "manual" | "lab"; id: number | null; name: string };

type Row = {
  id: number; target_type: "group" | "person" | "everyone"; label: string; people: number;
  scope_type: "document" | "manual" | "lab"; scope_label: string; direct: boolean; origin: string;
};
type Payload = {
  scope: { type: string; id: number | null; name: string };
  can_edit: boolean;
  rows: Row[];
  elsewhere: Row[];
  documents: number;
  unassigned_documents: number;
  groups: { id: number; name: string; people: number }[];
  roster: { id: number; name: string; title: string | null; has_login: boolean }[];
};
type TrackerPerson = { employee_id: number; name: string; title: string | null; has_login: boolean; groups: string[]; documents: number; signed: number; owes: number };
type TrackerBucket = { key: string; kind: string; name: string; people: number; documents: number; signed: number; owes: number; employee_ids: number[] };
type Tracker = { documents: number; unassigned_documents: number; groups: TrackerBucket[]; people: TrackerPerson[]; totals: { people: number; signed: number; owes: number; no_login: number } };
type NoticePlan = { recipients: number; no_login_or_address: number; sent_recently_at: string | null; cooldown_hours: number };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// The server answers {"error": "..."} after the status; show the sentence.
function errorSentence(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  const json = raw.slice(raw.indexOf("{"));
  try { return JSON.parse(json)?.error || raw; } catch { return raw; }
}

function WhoOwes({ tracker }: { tracker: Tracker | undefined }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!tracker) return <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="animate-spin" size={14} /> Loading...</div>;
  const byId = new Map(tracker.people.map((p) => [p.employee_id, p]));
  return (
    <div className="space-y-3 min-w-0" data-testid="readsign-tracker">
      <p className="text-sm" data-testid="readsign-tracker-summary">
        {plural(tracker.documents, "document")} {tracker.documents === 1 ? "goes" : "go"} to staff for read-and-sign here.{" "}
        {tracker.unassigned_documents > 0
          ? `${tracker.unassigned_documents} ${tracker.unassigned_documents === 1 ? "isn't" : "aren't"} assigned to anyone yet.`
          : tracker.documents > 0 ? "All of them are assigned." : ""}
      </p>
      {tracker.totals.no_login > 0 && (
        <p className="text-xs text-amber-800 dark:text-amber-300" data-testid="readsign-tracker-no-login">
          {tracker.totals.no_login} {tracker.totals.no_login === 1 ? "person who owes documents has" : "people who owe documents have"} no login, so they can't sign until they get one.
        </p>
      )}
      {tracker.groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody is assigned anything here yet.</p>
      ) : (
        <ul className="border rounded divide-y" data-testid="readsign-groups">
          {tracker.groups.map((g) => (
            <li key={g.key} data-testid={`readsign-group-${g.key}`}>
              <button type="button" className="w-full text-left px-3 py-2 hover:bg-muted/50 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5"
                onClick={() => setOpen(open === g.key ? null : g.key)} aria-expanded={open === g.key} data-testid="readsign-group-toggle">
                <span className="font-medium text-sm min-w-0 [overflow-wrap:anywhere]">{g.name}</span>
                <span className="text-xs text-muted-foreground" data-testid="readsign-group-counts">
                  {plural(g.people, "person", "people")}, {plural(g.documents, "document")}: {g.signed} signed, <span className={g.owes ? "font-medium text-red-700 dark:text-red-400" : ""}>{g.owes} still owed</span>
                </span>
              </button>
              {open === g.key && (
                <ul className="border-t bg-muted/20 divide-y">
                  {g.employee_ids.map((id) => byId.get(id)).filter((p): p is TrackerPerson => !!p).sort((a, b) => b.owes - a.owes || a.name.localeCompare(b.name)).map((p) => (
                    <li key={p.employee_id} className="px-3 py-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-sm" data-testid={`readsign-person-${p.employee_id}`}>
                      <span className="min-w-0 [overflow-wrap:anywhere]">
                        {p.name}
                        {!p.has_login && <span className="ml-1 text-xs text-amber-800 dark:text-amber-300">No login</span>}
                      </span>
                      <span className="text-xs text-muted-foreground">{p.signed} of {p.documents} signed{p.owes ? `, owes ${p.owes}` : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ReadSignDialog({ labId, scope, onClose, onAssignOnePerson }: {
  labId: number;
  scope: ReadSignScopeRef;
  onClose: () => void;
  // For one document: the older per-person assignment, with a due date.
  onAssignOnePerson?: () => void;
}) {
  const qc = useQueryClient();
  const base = `/api/labs/${labId}/veritapolicy`;
  const qs = `scope=${scope.type}${scope.id != null ? `&id=${scope.id}` : ""}`;
  const url = `${base}/read-sign?${qs}`;
  const [tab, setTab] = useState<"assign" | "owes">("assign");
  const [everyone, setEveryone] = useState(false);
  const [groupIds, setGroupIds] = useState<Set<number>>(new Set());
  const [personIds, setPersonIds] = useState<Set<number>>(new Set());
  const [personQ, setPersonQ] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [noticeOpen, setNoticeOpen] = useState(false);

  const { data } = useQuery<Payload>({ queryKey: [url], queryFn: getQueryFn({ on401: "throw" }) });
  // A group built or changed under Manage groups shows up in the picker at once.
  const { data: labGroups } = useLabGroups(base);
  useEffect(() => { qc.invalidateQueries({ queryKey: [url] }); }, [labGroups, qc, url]);
  const { data: tracker } = useQuery<Tracker>({
    queryKey: [`${base}/read-sign/tracker?${qs}`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: tab === "owes",
  });
  const { data: notice, refetch: refetchNotice } = useQuery<NoticePlan>({
    queryKey: [`${base}/read-sign/notice?${qs}`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: noticeOpen,
  });

  const refresh = () => {
    for (const key of [url, `${base}/read-sign/tracker?${qs}`, `${base}/documents`]) qc.invalidateQueries({ queryKey: [key] });
    qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").includes("/signature-status") });
  };
  const assign = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `${base}/read-sign`, {
        scope: scope.type, id: scope.id, everyone, group_ids: Array.from(groupIds), employee_ids: Array.from(personIds),
      });
      return res.json();
    },
    onSuccess: (body: any) => {
      setEveryone(false); setGroupIds(new Set()); setPersonIds(new Set()); setProblem(null);
      setMessage(`${body.added ? `Assigned ${plural(body.added, "new group or person", "new groups or people")}` : "They were already assigned"}. No email was sent.`);
      refresh();
    },
    onError: (e) => { setMessage(null); setProblem(errorSentence(e)); },
  });
  const remove = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `${base}/read-sign/${id}`)).json(),
    onSuccess: () => { setMessage("Taken off. Signatures already on file stay."); setProblem(null); refresh(); },
    onError: (e) => { setMessage(null); setProblem(errorSentence(e)); },
  });
  const sendNotice = useMutation({
    mutationFn: async () => (await apiRequest("POST", `${base}/read-sign/notice`, { scope: scope.type, id: scope.id, confirm_count: notice?.recipients })).json(),
    onSuccess: (body: any) => { setNoticeOpen(false); setProblem(null); setMessage(`Notice going to ${plural(body.sending, "person", "people")}. One email each.`); refetchNotice(); },
    onError: (e) => { setProblem(errorSentence(e)); refetchNotice(); },
  });

  const people = useMemo(() => {
    const q = personQ.trim().toLowerCase();
    const all = data?.roster || [];
    return (q ? all.filter((p) => p.name.toLowerCase().includes(q)) : all).slice(0, 200);
  }, [data, personQ]);
  const chosen = (everyone ? 1 : 0) + groupIds.size + personIds.size;
  const toggle = (set: Set<number>, id: number, on: boolean) => { const next = new Set(set); if (on) next.add(id); else next.delete(id); return next; };
  const direct = (data?.rows || []).filter((r) => r.direct);
  const inherited = (data?.rows || []).filter((r) => !r.direct);
  const coverage = !data ? "" : scope.type === "document"
    ? "This one document."
    : scope.type === "manual"
      ? `${plural(data.documents, "document")} in this manual and its sub-manuals today, and any added later.`
      : `All ${plural(data.documents, "document")} in this lab today, and any added later.`;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="readsign-dialog">
        <DialogHeader>
          <DialogTitle>Read-and-sign</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 min-w-0">
          <div className="min-w-0">
            <div className="font-medium text-sm [overflow-wrap:anywhere]" data-testid="readsign-scope-name">{scope.name}</div>
            <div className="text-xs text-muted-foreground" data-testid="readsign-coverage">{coverage}</div>
          </div>
          <div className="flex gap-1 border-b border-border">
            {([["assign", "Who it goes to"], ["owes", "Who still owes"]] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setTab(key)} data-testid={`readsign-tab-${key}`}
                className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px ${tab === key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                {label}
              </button>
            ))}
          </div>

          {message && <p className="text-sm text-green-800 dark:text-green-300" data-testid="readsign-message">{message}</p>}
          {problem && <p className="text-sm text-destructive" data-testid="readsign-problem">{problem}</p>}

          {tab === "owes" ? <WhoOwes tracker={tracker} /> : !data ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="animate-spin" size={14} /> Loading...</div>
          ) : (
            <>
              <div className="space-y-1.5" data-testid="readsign-current">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{scope.type === "lab" ? "On every document" : "Assigned now"}</div>
                {direct.length === 0 && inherited.length === 0 && (
                  <p className="text-sm text-muted-foreground" data-testid="readsign-none">
                    {scope.type === "lab" ? "Nobody has every document." : "Nobody yet, so staff don't see this in their list."}
                  </p>
                )}
                {direct.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 rounded bg-muted/50 px-3 py-1.5 text-sm" data-testid={`readsign-row-${r.id}`}>
                    <span className="flex-1 min-w-0 [overflow-wrap:anywhere]">
                      <span className="font-medium">{r.label}</span>
                      {r.target_type !== "person" && <span className="ml-1 text-xs text-muted-foreground">{plural(r.people, "person", "people")}</span>}
                      {r.origin === "kept_as_it_was" && <span className="block text-xs text-muted-foreground" data-testid="readsign-kept">Set up for you so your staff keep seeing what they saw before groups were available. Take it off when your groups are ready.</span>}
                    </span>
                    {data.can_edit && (
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0" title={`Take ${r.label} off`} disabled={remove.isPending}
                        onClick={() => remove.mutate(r.id)} data-testid="readsign-remove"><Trash2 size={13} /></Button>
                    )}
                  </div>
                ))}
                {inherited.map((r) => (
                  <div key={r.id} className="rounded border border-border px-3 py-1.5 text-sm" data-testid={`readsign-inherited-${r.id}`}>
                    <span className="font-medium">{r.label}</span>
                    <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">From {r.scope_label}</span>
                  </div>
                ))}
              </div>

              {scope.type === "lab" && data.elsewhere.length > 0 && (
                <div className="space-y-1.5" data-testid="readsign-elsewhere">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">On manuals and single documents</div>
                  <div className="border rounded divide-y max-h-52 overflow-y-auto">
                    {data.elsewhere.map((r) => (
                      <div key={r.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                        <span className="flex-1 min-w-0 [overflow-wrap:anywhere]">
                          <span className="font-medium">{r.label}</span>
                          <span className="block text-xs text-muted-foreground">{r.scope_label}</span>
                        </span>
                        {data.can_edit && (
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0" title={`Take ${r.label} off`} disabled={remove.isPending}
                            onClick={() => remove.mutate(r.id)}><Trash2 size={13} /></Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.can_edit && (
                <div className="space-y-3 rounded-lg border border-border p-3" data-testid="readsign-add">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium">Add</div>
                    <LabGroupsDialog apiBase={base} forApprovals />
                  </div>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} data-testid="readsign-everyone" />
                    Everyone in the lab <span className="text-xs text-muted-foreground">({plural(data.roster.length, "person", "people")} on the roster)</span>
                  </label>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">Groups</div>
                    {data.groups.length === 0 ? (
                      <p className="text-xs text-muted-foreground" data-testid="readsign-no-groups">No groups yet. Build them with Manage groups.</p>
                    ) : (
                      <div className="border rounded divide-y max-h-40 overflow-y-auto" data-testid="readsign-group-picker">
                        {data.groups.map((g) => (
                          <label key={g.id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-muted/40">
                            <input type="checkbox" checked={groupIds.has(g.id)} onChange={(e) => setGroupIds(toggle(groupIds, g.id, e.target.checked))} data-testid={`readsign-pick-group-${g.id}`} />
                            <span className="min-w-0 [overflow-wrap:anywhere]">{g.name}</span>
                            <span className="ml-auto text-xs text-muted-foreground shrink-0">{plural(g.people, "person", "people")}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">Named people</div>
                    <Input value={personQ} onChange={(e) => setPersonQ(e.target.value)} placeholder="Search the roster" className="h-8 text-sm mb-1.5" data-testid="readsign-person-search" />
                    <div className="border rounded divide-y max-h-40 overflow-y-auto" data-testid="readsign-person-picker">
                      {people.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">Nobody on the roster matches.</p>}
                      {people.map((p) => (
                        <label key={p.id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-muted/40">
                          <input type="checkbox" checked={personIds.has(p.id)} onChange={(e) => setPersonIds(toggle(personIds, p.id, e.target.checked))} data-testid={`readsign-pick-person-${p.id}`} />
                          <span className="min-w-0 [overflow-wrap:anywhere]">{p.name}</span>
                          {!p.has_login && <span className="ml-auto text-xs text-amber-800 dark:text-amber-300 shrink-0">No login yet</span>}
                        </label>
                      ))}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground" data-testid="readsign-no-email">
                    Assigning sends no email. People see it on their bell and under My sign-offs the next time they sign in.
                  </p>
                  <Button size="sm" disabled={!chosen || assign.isPending} onClick={() => assign.mutate()} data-testid="readsign-assign">
                    {assign.isPending && <Loader2 className="animate-spin mr-1" size={13} />}Assign{chosen ? ` (${chosen})` : ""}
                  </Button>
                </div>
              )}

              {data.can_edit && (
                <div className="rounded-lg border border-border p-3 space-y-2" data-testid="readsign-notice">
                  {!noticeOpen ? (
                    <Button size="sm" variant="outline" onClick={() => setNoticeOpen(true)} data-testid="readsign-notice-open">
                      <Mail size={13} className="mr-1.5" /> Send a notice
                    </Button>
                  ) : !notice ? (
                    <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="animate-spin" size={14} /> Counting...</div>
                  ) : (
                    <>
                      <p className="text-sm" data-testid="readsign-notice-plan">
                        This emails {plural(notice.recipients, "person", "people")} who {notice.recipients === 1 ? "owes" : "owe"} a signature here. Each gets one email saying how many documents they have waiting, with a link to sign in.
                        {notice.no_login_or_address > 0 && ` ${plural(notice.no_login_or_address, "person", "people")} with no login or address won't get it.`}{" "}
                        Nothing else is sent, and it won't repeat on its own.
                      </p>
                      {notice.sent_recently_at && (
                        <p className="text-xs text-amber-800 dark:text-amber-300" data-testid="readsign-notice-recent">A notice for this already went out in the last {notice.cooldown_hours} hours, so it can't go again yet.</p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" disabled={!notice.recipients || !!notice.sent_recently_at || sendNotice.isPending} onClick={() => sendNotice.mutate()} data-testid="readsign-notice-send">
                          {sendNotice.isPending && <Loader2 className="animate-spin mr-1" size={13} />}Send to {plural(notice.recipients, "person", "people")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setNoticeOpen(false)} data-testid="readsign-notice-cancel">Cancel</Button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-2 flex-wrap">
          {onAssignOnePerson && data?.can_edit && (
            <Button variant="ghost" size="sm" onClick={onAssignOnePerson} data-testid="readsign-one-person" title="The older assignment for one person's login, with a due date. They sign with their password.">
              Assign a login with a due date
            </Button>
          )}
          <Button variant="outline" onClick={onClose} data-testid="readsign-close">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
