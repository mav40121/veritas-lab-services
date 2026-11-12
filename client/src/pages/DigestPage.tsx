// client/src/pages/DigestPage.tsx
//
// The compliance digest's screens (Michael 2026-11-11, Q281 = 1; PR 4 of 5; the approved screen mock of 2026-11-10 and the
// spec of the same day). A feature of VeritaAssure®, not a module: it is reached from Inspection Readiness and gated by the
// same explicit plan allowlist the server's routes use (server/digestIssues.ts DIGEST_PLANS). The routes are PR 3's:
//   /labs/:labId/digest            the issue list; for the owner or an admin also "Draft an issue" and the settings card
//   /labs/:labId/digest/:issueId   one issue as its readers see it (client/src/components/digest/DigestIssueSheet.tsx); for the
//                                  owner or an admin also the draft editor, Publish, Withdraw and who has read it
// Anyone the issue's audience doesn't reach gets the same "not available" as an id that doesn't exist (the server's 404).
// A reader sees only their own read status; the roster, which names lab members, is the owner's and admins' only, as the
// route enforces. No bell here (the spec's own).
// PR 5: a published issue's header carries Download PDF (GET issues/:id/pdf, fetched with the sign-in header and saved, as the
// tissue record button does), for anyone who can open the issue; and the owner or an admin gets the Notice email card:
// the count before sending (GET issues/:id/notice), Send notice with a confirm naming that count (POST, sent as
// expectedCount), and the sent date and count after. Publishing sends nothing; the notice goes once per issue.
// The daily draft job (server/digestIssues.ts runDigestAutoDrafts): the settings card's "Draft each issue automatically" toggle
// is digest_settings.enabled, and the owner's list marks an issue the job drafted "Drafted automatically on <date>".
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthContext";
import { useMemberships } from "@/hooks/useMemberships";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { pickCurrentMembership } from "@/lib/currentLab";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Lock, Loader2, Newspaper, Check, ChevronLeft, Download, Mail } from "lucide-react";
import { DigestIssueSheet, DIGEST_SUB, sentToLabel, type DigestIssueDetail } from "@/components/digest/DigestIssueSheet";
import {
  DIGEST_CARD_KEYS, DIGEST_CARDS, DIGEST_AUDIENCE_LABELS, draftablePeriods, periodTitle, formatDay, formatMomentDay,
  type DigestCardKey, type DigestFrequencyLike,
} from "@shared/digestCards";

// Included in every subscription plan (Q281 = 1): the same explicit allowlist as the server's DIGEST_PLANS and the readiness dashboard.
const DIGEST_PLANS = ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "clinic", "waived", "community", "hospital", "large_hospital", "enterprise"];
const NOTE_MAX = 4000;

interface DigestSettings {
  enabled: boolean;
  frequency: DigestFrequencyLike;
  sections: string[];
  audience: "leadership" | "staff" | "groups";
  audience_group_ids: number[];
  ack_default: boolean;
  review_box: boolean;
  can_edit: boolean;
  default_period: { start: string; end: string };
  groups?: Array<{ id: number; name: string }>;
}
// created_by_job: the owner's and admins' list only (the daily draft job made the issue).
type IssueSummary = Omit<DigestIssueDetail, "note" | "counts" | "counts_live" | "previous" | "audience_groups" | "can_edit"> & { created_by_job?: boolean };
interface Acks {
  issue_id: number;
  ack_requested: boolean;
  mine: { read_at: string | null; acknowledged_at: string | null };
  totals?: { audience: number; read: number; not_read: number; acknowledged: number | null; not_acknowledged: number | null };
  roster?: Array<{ user_id: number; name: string; in_audience: boolean; read_at: string | null; acknowledged_at: string | null }>;
}
interface Reply<T> { ok: boolean; status: number; body: T & { error?: string; code?: string } }

async function api<T = any>(method: string, path: string, body?: unknown): Promise<Reply<T>> {
  const r = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { ...authHeaders(), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let j: any = {};
  try { j = await r.json(); } catch { /* no body */ }
  return { ok: r.ok, status: r.status, body: j };
}
const useDigestQuery = <T,>(key: unknown[], path: string | null, enabled = true) =>
  useQuery<Reply<T>>({ queryKey: key, enabled: enabled && !!path, queryFn: () => api<T>("GET", path!), staleTime: 0, refetchOnMount: "always" });

const sectionLabel = (k: DigestCardKey) => `${DIGEST_CARDS[k].title} (${DIGEST_CARDS[k].module})${DIGEST_CARDS[k].optional ? ", optional" : ""}`;
const sameSet = (a: Array<string | number>, b: Array<string | number>) => a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");

function Wall({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="container max-w-2xl mx-auto py-12 px-4">
      <Card className="border-border"><CardContent className="py-10 text-center">
        <Lock className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
        <h2 className="text-lg font-semibold mb-1">{title}</h2>
        {children}
      </CardContent></Card>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "published") return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">Published</Badge>;
  if (status === "draft") return <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30">Draft</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">Withdrawn</Badge>;
}

function ownStatusText(mine: { read_at: string | null; acknowledged_at: string | null }, ackRequested: boolean, tz?: string | null): string {
  if (mine.acknowledged_at) return `acknowledged ${formatMomentDay(mine.acknowledged_at, tz)}`;
  if (mine.read_at) return ackRequested ? `read ${formatMomentDay(mine.read_at, tz)}, not yet acknowledged` : `read ${formatMomentDay(mine.read_at, tz)}`;
  return "not yet read";
}

// ── Settings (owner or admin) ─────────────────────────────────────────────────────────────────────────────────────
function SectionChecklist({ value, onChange, idPrefix }: { value: string[]; onChange: (v: string[]) => void; idPrefix: string }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5" data-testid={`${idPrefix}-sections`}>
      {DIGEST_CARD_KEYS.map((k) => {
        const on = value.includes(k);
        return (
          <label key={k} className="flex items-start gap-2 text-sm cursor-pointer">
            <Checkbox className="mt-0.5" checked={on} data-testid={`${idPrefix}-section-${k}`}
              onCheckedChange={(c) => onChange(c ? DIGEST_CARD_KEYS.filter((x) => x === k || value.includes(x)) : value.filter((x) => x !== k))} />
            <span>{sectionLabel(k)}</span>
          </label>
        );
      })}
    </div>
  );
}

function AudiencePicker({ audience, groupIds, groups, onChange, idPrefix }: {
  audience: string; groupIds: number[]; groups: Array<{ id: number; name: string; retired?: boolean }>;
  onChange: (audience: "leadership" | "staff" | "groups", groupIds: number[]) => void; idPrefix: string;
}) {
  const opts: Array<["leadership" | "staff" | "groups", string, string]> = [
    ["leadership", DIGEST_AUDIENCE_LABELS.leadership, "The owner, admins and the medical director or designee. Counts only, no person names."],
    ["staff", DIGEST_AUDIENCE_LABELS.staff, "Every active member and Staff login of the lab."],
    ["groups", DIGEST_AUDIENCE_LABELS.groups, "The members of the lab groups you pick (the groups VeritaDC™ read-and-sign uses)."],
  ];
  return (
    <div className="space-y-1.5" role="radiogroup" data-testid={`${idPrefix}-audience`}>
      {opts.map(([v, label, hint]) => (
        <label key={v} className="flex items-start gap-2 text-sm cursor-pointer">
          <input type="radio" name={`${idPrefix}-audience`} className="mt-1 accent-[#01696F]" checked={audience === v} data-testid={`${idPrefix}-audience-${v}`}
            onChange={() => onChange(v, v === "groups" ? groupIds : [])} />
          <span><span className="font-medium">{label}</span> <span className="text-muted-foreground text-xs">{hint}</span></span>
        </label>
      ))}
      {audience === "groups" && (
        <div className="ml-6 mt-1 space-y-1" data-testid={`${idPrefix}-groups`}>
          {groups.length ? groups.map((g) => (
            <label key={g.id} className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={groupIds.includes(g.id)} data-testid={`${idPrefix}-group-${g.id}`}
                onCheckedChange={(c) => onChange("groups", c ? [...groupIds, g.id] : groupIds.filter((x) => x !== g.id))} />
              <span>{g.name}{g.retired ? " (no longer in use)" : ""}</span>
            </label>
          )) : <p className="text-xs text-muted-foreground">This lab has no groups yet. Lab groups are set up in VeritaDC{"™"} or VeritaTrack{"™"}.</p>}
        </div>
      )}
    </div>
  );
}

function ToggleRow({ checked, onChange, label, hint, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; testId: string }) {
  return (
    <label className="flex items-start gap-3 text-sm cursor-pointer">
      <Switch checked={checked} onCheckedChange={onChange} data-testid={testId} className="mt-0.5" />
      <span><span className="font-medium">{label}</span>{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span>
    </label>
  );
}

function SettingsCard({ labId, settings, onSaved }: { labId: number; settings: DigestSettings; onSaved: () => void }) {
  const { toast } = useToast();
  const [autoDraft, setAutoDraft] = useState(settings.enabled);
  const [frequency, setFrequency] = useState(settings.frequency);
  const [sections, setSections] = useState<string[]>(settings.sections);
  const [audience, setAudience] = useState(settings.audience);
  const [groupIds, setGroupIds] = useState<number[]>(settings.audience_group_ids);
  const [ack, setAck] = useState(settings.ack_default);
  const [reviewBox, setReviewBox] = useState(settings.review_box);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setAutoDraft(settings.enabled); setFrequency(settings.frequency); setSections(settings.sections); setAudience(settings.audience);
    setGroupIds(settings.audience_group_ids); setAck(settings.ack_default); setReviewBox(settings.review_box);
  }, [settings]);
  const dirty = autoDraft !== settings.enabled || frequency !== settings.frequency || !sameSet(sections, settings.sections) || audience !== settings.audience
    || !sameSet(groupIds, settings.audience_group_ids) || ack !== settings.ack_default || reviewBox !== settings.review_box;

  const save = async () => {
    setSaving(true); setError(null);
    const r = await api("PUT", `/api/labs/${labId}/digest/settings`, { enabled: autoDraft, frequency, sections, audience, audience_group_ids: audience === "groups" ? groupIds : [], ack_default: ack, review_box: reviewBox });
    setSaving(false);
    if (!r.ok) { setError(r.body.error || `Couldn't save (${r.status}).`); return; }
    toast({ title: "Digest settings saved", description: "A new draft takes these settings. Issues already drafted keep their own." });
    onSaved();
  };

  return (
    <Card className="border-border" data-testid="digest-settings">
      <CardContent className="py-4 space-y-4">
        <div>
          <h2 className="text-base font-semibold">Settings for this lab</h2>
          <p className="text-xs text-muted-foreground">Only the lab's owner or an admin changes these. A new draft takes them as they are when it's drafted.</p>
        </div>
        <div>
          <div className="text-sm font-medium mb-1">How often</div>
          <div className="flex gap-4 text-sm" role="radiogroup">
            {(["monthly", "quarterly"] as const).map((f) => (
              <label key={f} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="digest-frequency" className="accent-[#01696F]" checked={frequency === f} onChange={() => setFrequency(f)} data-testid={`settings-frequency-${f}`} />
                {f === "monthly" ? "Monthly" : "Quarterly (calendar quarters)"}
              </label>
            ))}
          </div>
        </div>
        <div>
          <div className="text-sm font-medium mb-1.5">Sections</div>
          <SectionChecklist value={sections} onChange={setSections} idPrefix="settings" />
        </div>
        <div>
          <div className="text-sm font-medium mb-1.5">Audience</div>
          <AudiencePicker audience={audience} groupIds={groupIds} groups={settings.groups || []} idPrefix="settings"
            onChange={(a, g) => { setAudience(a); setGroupIds(g); }} />
        </div>
        <div className="space-y-3">
          <ToggleRow checked={autoDraft} onChange={setAutoDraft} testId="settings-auto-draft" label="Draft each issue automatically when the period ends"
            hint="You still review and publish it. Off by default." />
          <ToggleRow checked={ack} onChange={setAck} testId="settings-ack-default" label="Ask readers to acknowledge each new issue"
            hint="Off by default. Each draft can still turn it on or off before it's published." />
          <ToggleRow checked={reviewBox} onChange={setReviewBox} testId="settings-review-box" label="Print the medical director or designee review box on the PDF"
            hint="Off by default. Each issue keeps the setting it was drafted with." />
        </div>
        {error && <p className="text-sm text-destructive" data-testid="settings-error">{error}</p>}
        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={!dirty || saving} data-testid="settings-save">
            {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Save settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Draft an issue (owner or admin) ───────────────────────────────────────────────────────────────────────────────
function DraftCard({ labId, settings, issues }: { labId: number; settings: DigestSettings; issues: IssueSummary[] }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const periods = useMemo(() => draftablePeriods(settings.default_period, settings.frequency), [settings.default_period, settings.frequency]);
  const taken = new Map(issues.filter((i) => i.status !== "withdrawn").map((i) => [`${i.period_start}|${i.period_end}`, i]));
  const [start, setStart] = useState(settings.default_period.start);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setStart(settings.default_period.start); }, [settings.default_period.start]);

  const draft = async () => {
    setBusy(true);
    const r = await api<DigestIssueDetail>("POST", `/api/labs/${labId}/digest/issues`, { periodStart: start });
    setBusy(false);
    if (!r.ok) {
      toast({ title: "Couldn't draft the issue", description: r.body.error || `HTTP ${r.status}`, variant: "destructive" });
      return;
    }
    qc.invalidateQueries({ queryKey: ["digest", labId] });
    navigate(`/labs/${labId}/digest/${r.body.id}`);
  };

  return (
    <Card className="border-border" data-testid="digest-draft-card">
      <CardContent className="py-4">
        <h2 className="text-base font-semibold">Draft an issue</h2>
        <p className="text-xs text-muted-foreground mb-3">
          The draft fills itself in with live numbers. Nobody sees it until you publish it: review the numbers, write the note, then publish.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm" htmlFor="digest-period">{settings.frequency === "quarterly" ? "Quarter" : "Month"}</label>
          <select id="digest-period" className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={start} onChange={(e) => setStart(e.target.value)} data-testid="draft-period">
            {periods.map((p) => {
              const has = taken.get(`${p.start}|${p.end}`);
              return <option key={p.start} value={p.start} disabled={!!has}>{p.label}{p.start === settings.default_period.start ? " (last finished)" : ""}{has ? ` (${has.status})` : ""}</option>;
            })}
          </select>
          <Button size="sm" onClick={draft} disabled={busy || taken.has(`${start}|${periods.find((p) => p.start === start)?.end}`)} data-testid="draft-create">
            {busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Draft an issue
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── The list ──────────────────────────────────────────────────────────────────────────────────────────────────────
function IssueList({ labId, issues, manager, tz }: { labId: number; issues: IssueSummary[]; manager: boolean; tz?: string | null }) {
  if (!issues.length) {
    return <Card className="border-border" data-testid="digest-issues-empty"><CardContent className="py-6 text-sm text-muted-foreground text-center">
      {manager ? "No issues yet. Draft the first one above." : "No issue has been sent to you yet."}
    </CardContent></Card>;
  }
  return (
    <Card className="border-border" data-testid="digest-issues">
      <CardContent className="py-2 divide-y divide-border">
        {issues.map((i) => {
          // The daily draft job made it: say so, so the owner knows where it came from (the owner's and admins' list only).
          const auto = manager && i.created_by_job
            ? <span data-testid={`issue-row-${i.id}-auto`}>Drafted automatically on {formatMomentDay(i.created_at, tz)}</span>
            : null;
          return (
            <Link key={i.id} href={`/labs/${labId}/digest/${i.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 hover:bg-muted/40 -mx-2 px-2 rounded" data-testid={`issue-row-${i.id}`}>
              <span className="font-medium">{periodTitle(i.period_start, i.period_end)}</span>
              {manager && <StatusBadge status={i.status} />}
              <span className="text-xs text-muted-foreground">{sentToLabel(i as any)}</span>
              {/* Lighter on a dark page (DIGEST_SUB's dark shade): the theme's muted gray reads 4.44:1 on the card at this size. */}
              <span className="ml-auto text-xs text-muted-foreground dark:text-[#B4BAC2]">
                {i.status === "published" ? `Published ${formatMomentDay(i.published_at, tz)}` : i.status === "withdrawn" ? `Withdrawn ${formatMomentDay(i.withdrawn_at, tz)}` : auto ? null : `Drafted ${formatMomentDay(i.created_at, tz)}`}
                {auto && (i.status === "draft" ? auto : <> {"·"} {auto}</>)}
                {i.status === "published" && !manager && <> {"·"} <span data-testid={`issue-row-${i.id}-mine`}>You: {ownStatusText(i.mine, i.ack_requested, tz)}</span></>}
              </span>
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ── One issue: the draft editor (owner or admin) ──────────────────────────────────────────────────────────────────
function WithdrawDialog({ open, onOpenChange, labId, issue, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; labId: number; issue: DigestIssueDetail; onDone: () => void }) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setReason(""); setError(null); } }, [open]);
  const go = async () => {
    setBusy(true); setError(null);
    const r = await api("POST", `/api/labs/${labId}/digest/issues/${issue.id}/withdraw`, { reason });
    setBusy(false);
    if (!r.ok) { setError(r.body.error || `Couldn't withdraw (${r.status}).`); return; }
    toast({ title: "Issue withdrawn", description: "It stays on file with your reason. Readers no longer see it." });
    onOpenChange(false);
    onDone();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="withdraw-dialog">
        <DialogHeader>
          <DialogTitle>Withdraw the {periodTitle(issue.period_start, issue.period_end)} issue?</DialogTitle>
          <DialogDescription>
            {issue.status === "published" ? "Readers stop seeing it. " : ""}The issue stays on file with its numbers and your reason; it isn't deleted. The period can then be drafted again.
          </DialogDescription>
        </DialogHeader>
        <label className="text-sm font-medium" htmlFor="withdraw-reason">Why is it withdrawn? (required)</label>
        <Textarea id="withdraw-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} rows={3} data-testid="withdraw-reason" />
        {error && <p className="text-sm text-destructive" data-testid="withdraw-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" size="sm" onClick={go} disabled={busy || !reason.trim()} data-testid="withdraw-confirm">Withdraw</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DraftEditor({ labId, issue, groups, readerCount, onChanged }: { labId: number; issue: DigestIssueDetail; groups: Array<{ id: number; name: string }>; readerCount: number | null; onChanged: () => void }) {
  const { toast } = useToast();
  const [note, setNote] = useState(issue.note || "");
  const [sections, setSections] = useState<string[]>(issue.sections);
  const [audience, setAudience] = useState(issue.audience);
  const [groupIds, setGroupIds] = useState<number[]>(issue.audience_group_ids);
  const [ack, setAck] = useState(issue.ack_requested);
  const [reviewBox, setReviewBox] = useState(issue.review_box);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  useEffect(() => {
    setNote(issue.note || ""); setSections(issue.sections); setAudience(issue.audience); setGroupIds(issue.audience_group_ids);
    setAck(issue.ack_requested); setReviewBox(issue.review_box);
  }, [issue]);
  // A group the draft names that has since been retired still shows, so the owner can see it and take it off.
  const groupChoices = [...groups, ...(issue.audience_groups || []).filter((g) => !groups.some((x) => x.id === g.id))];
  const dirty = note.trim() !== (issue.note || "") || !sameSet(sections, issue.sections) || audience !== issue.audience
    || !sameSet(groupIds, issue.audience_group_ids) || ack !== issue.ack_requested || reviewBox !== issue.review_box;
  const asOf = issue.counts?.asOf ?? null;

  const save = async () => {
    setSaving(true); setError(null);
    const r = await api<DigestIssueDetail>("PUT", `/api/labs/${labId}/digest/issues/${issue.id}`, {
      note, sections, audience, audience_group_ids: audience === "groups" ? groupIds : [], ack_requested: ack, review_box: reviewBox,
    });
    setSaving(false);
    if (!r.ok) { setError(r.body.error || `Couldn't save (${r.status}).`); return; }
    toast({ title: "Draft saved" });
    onChanged();
  };
  const publish = async () => {
    setPublishing(true);
    const r = await api<DigestIssueDetail>("POST", `/api/labs/${labId}/digest/issues/${issue.id}/publish`, { expectedCountsAsOf: asOf });
    setPublishing(false);
    setConfirmPublish(false);
    if (!r.ok) {
      toast({ title: "Not published", description: r.body.error || `HTTP ${r.status}`, variant: "destructive" });
      onChanged();
      return;
    }
    toast({ title: "Issue published", description: "Its numbers are frozen as of today. Readers in its audience can open it now." });
    onChanged();
  };

  return (
    <Card className="border-border mb-4 border-amber-300/70 dark:border-amber-800/60" data-testid="draft-editor">
      <CardContent className="py-4 space-y-4">
        <div>
          <h2 className="text-base font-semibold">Draft: not published</h2>
          <p className="text-xs text-muted-foreground" data-testid="draft-live-note">
            Readers can't see this yet. The numbers below are live{asOf ? `, as of ${formatDay(asOf)} on the lab's calendar` : ""}; they're taken again and frozen when you publish.
          </p>
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="draft-note">A note from the medical director or designee</label>
          <p className="text-xs text-muted-foreground mb-1">The lab's own words at the top of the issue. Never put patient information here: the save is refused.</p>
          <Textarea id="draft-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={NOTE_MAX} rows={4} data-testid="draft-note" />
          <div className="text-[11px] text-muted-foreground text-right">{note.length} / {NOTE_MAX}</div>
        </div>
        <div>
          <div className="text-sm font-medium mb-1.5">Sections in this issue</div>
          <SectionChecklist value={sections} onChange={setSections} idPrefix="draft" />
        </div>
        <div>
          <div className="text-sm font-medium mb-1.5">Audience</div>
          <AudiencePicker audience={audience} groupIds={groupIds} groups={groupChoices} idPrefix="draft" onChange={(a, g) => { setAudience(a); setGroupIds(g); }} />
        </div>
        <div className="space-y-3">
          <ToggleRow checked={ack} onChange={setAck} testId="draft-ack" label="Ask readers to acknowledge this issue" hint={'Readers see an "I\'ve read this" button, and you see who has.'} />
          <ToggleRow checked={reviewBox} onChange={setReviewBox} testId="draft-review-box" label="Print the medical director or designee review box on the PDF" />
        </div>
        {error && <p className="text-sm text-destructive" data-testid="draft-error">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setWithdrawOpen(true)} data-testid="draft-withdraw">Withdraw draft</Button>
          <span className="ml-auto text-xs text-muted-foreground">{dirty ? "Save your changes before publishing." : ""}</span>
          <Button size="sm" variant="outline" onClick={save} disabled={!dirty || saving} data-testid="draft-save">
            {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Save
          </Button>
          <Button size="sm" onClick={() => setConfirmPublish(true)} disabled={dirty || !asOf} data-testid="draft-publish">Publish</Button>
        </div>
      </CardContent>
      <Dialog open={confirmPublish} onOpenChange={setConfirmPublish}>
        <DialogContent className="max-w-md" data-testid="publish-dialog">
          <DialogHeader>
            <DialogTitle>Publish the {periodTitle(issue.period_start, issue.period_end)} issue?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm" data-testid="publish-dialog-text">
                <p>The numbers are taken as you publish and frozen as of <b className="whitespace-nowrap">{asOf ? formatDay(asOf) : ""}</b>, the lab's today. If the lab's day turns before you confirm, publishing stops so you can look again.</p>
                <p>It goes to {sentToLabel(issue).replace(/^Lab groups:/, "the lab groups")}{readerCount == null ? "" : ` (${readerCount} ${readerCount === 1 ? "reader" : "readers"})`}. Once published it can't be edited, only withdrawn.</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmPublish(false)}>Cancel</Button>
            <Button size="sm" onClick={publish} disabled={publishing} data-testid="publish-confirm">
              {publishing && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Publish
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <WithdrawDialog open={withdrawOpen} onOpenChange={setWithdrawOpen} labId={labId} issue={issue} onDone={onChanged} />
    </Card>
  );
}

// ── One issue: the reader's own status ────────────────────────────────────────────────────────────────────────────
function ReaderStatusCard({ labId, issue, onChanged }: { labId: number; issue: DigestIssueDetail; onChanged: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const tz = issue.counts?.timeZone ?? null;
  const mine = issue.mine;
  const done = issue.ack_requested ? !!mine.acknowledged_at : !!mine.read_at;
  const record = async (what: "read" | "ack") => {
    setBusy(true);
    const r = await api("POST", `/api/labs/${labId}/digest/issues/${issue.id}/${what}`, {});
    setBusy(false);
    if (!r.ok) { toast({ title: "Not recorded", description: r.body.error || `HTTP ${r.status}`, variant: "destructive" }); return; }
    onChanged();
  };
  const status = mine.acknowledged_at
    ? <>acknowledged {formatMomentDay(mine.acknowledged_at, tz)}</>
    : mine.read_at
      ? <>read {formatMomentDay(mine.read_at, tz)}{issue.ack_requested ? <>, <b className="text-[#964219] dark:text-[#E9A56B]">not yet acknowledged</b></> : null}</>
      : <b className="text-[#964219] dark:text-[#E9A56B]">not yet read</b>;
  return (
    <div className="mt-3 rounded-lg border border-border bg-card px-[18px] py-[11px] flex flex-wrap items-center gap-3.5" data-testid="digest-status-card">
      <div className="min-w-0">
        <div className="font-bold text-[14.5px]">{issue.ack_requested ? "Acknowledgment requested for this issue" : "Your copy of this issue"}</div>
        <div className={`text-[12.5px] ${DIGEST_SUB}`} data-testid="digest-my-status">Your status: {status}. Only you and the lab admins see your status.</div>
      </div>
      {!done && (
        <Button className="ml-auto bg-[#01696F] hover:bg-[#015A5F] text-white dark:bg-[#1F8F95] dark:hover:bg-[#1A7A80]" disabled={busy}
          onClick={() => record(issue.ack_requested ? "ack" : "read")} data-testid={issue.ack_requested ? "digest-ack" : "digest-mark-read"}>
          {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Check className="h-4 w-4 mr-1.5" />}
          {issue.ack_requested ? "I've read this" : "Mark as read"}
        </Button>
      )}
    </div>
  );
}

// ── One issue: who has read it (owner or admin) ───────────────────────────────────────────────────────────────────
function RosterCard({ acks, tz }: { acks: Acks; tz?: string | null }) {
  const t = acks.totals;
  if (!t || !acks.roster) return null;
  return (
    <Card className="border-border mt-4" data-testid="digest-roster">
      <CardContent className="py-4">
        <h2 className="text-base font-semibold">Who has read it</h2>
        <p className="text-xs text-muted-foreground mb-2">Only the lab's owner and admins see this list. Each reader sees only their own status.</p>
        <p className="text-sm mb-2" data-testid="digest-roster-totals">
          {t.audience} in the audience {"·"} {t.read} read {"·"} {t.not_read} not read
          {acks.ack_requested && t.acknowledged != null ? <> {"·"} {t.acknowledged} acknowledged {"·"} {t.not_acknowledged} not acknowledged</> : null}
        </p>
        <div className="rounded-md border border-border divide-y divide-border">
          {acks.roster.map((r) => (
            <div key={r.user_id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5 text-sm" data-testid={`roster-row-${r.user_id}`}>
              <span className="font-medium min-w-0">{r.name}{r.in_audience ? "" : <span className="text-xs text-muted-foreground"> (not in the audience)</span>}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {r.read_at ? `Read ${formatMomentDay(r.read_at, tz)}` : "Not read"}
                {acks.ack_requested ? ` · ${r.acknowledged_at ? `Acknowledged ${formatMomentDay(r.acknowledged_at, tz)}` : "Not acknowledged"}` : ""}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── One issue: Download PDF (PR 5; anyone who can open a published issue) ─────────────────────────────────────────
// The route needs the sign-in header, so the page fetches the file and saves it itself, as the tissue record button does; a
// plain link would go out without the header.
function DownloadPdfButton({ labId, issue }: { labId: number; issue: DigestIssueDetail }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const download = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${API_BASE}/api/labs/${labId}/digest/issues/${issue.id}/pdf`, { headers: authHeaders() });
      if (!r.ok) {
        let msg = `The PDF couldn't be downloaded (${r.status}).`;
        try { msg = (await r.json())?.error || msg; } catch { /* not JSON */ }
        throw new Error(msg);
      }
      const name = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") || "")?.[1] || `Compliance_Digest_${issue.period_start.slice(0, 7)}.pdf`;
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e: any) { setErr(e?.message || "The PDF couldn't be downloaded."); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col items-start sm:items-end gap-1">
      <Button variant="outline" onClick={download} disabled={busy} data-testid="digest-download-pdf"
        className="h-auto px-3.5 py-2 text-[14px] font-semibold rounded-md border-[1.5px] border-[#01696F] bg-white text-[#01696F] hover:bg-[#E6F2F2] hover:text-[#015A5F] dark:border-[#5FC4C9] dark:bg-transparent dark:text-[#5FC4C9] dark:hover:bg-[#0F2D30] dark:hover:text-[#8ED8DB]">
        {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}{busy ? "Building the PDF..." : "Download PDF"}
      </Button>
      {err && <p className="text-xs text-destructive" data-testid="digest-download-error">{err}</p>}
    </div>
  );
}

// ── One issue: the notice email (PR 5; owner or admin, published issues) ─────────────────────────────────────────
interface NoticePlan { issue_id: number; status: string; ack_requested: boolean; recipients: number; no_address: number; sent_at: string | null; sent_count: number | null; can_send: boolean }
const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

function NoticeCard({ labId, issue, tz, onChanged }: { labId: number; issue: DigestIssueDetail; tz?: string | null; onChanged: () => void }) {
  const { toast } = useToast();
  const path = `/api/labs/${labId}/digest/issues/${issue.id}/notice`;
  const planQ = useDigestQuery<NoticePlan>(["digest", labId, "notice", issue.id], path);
  const plan = planQ.data?.ok ? planQ.data.body : null;
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState<number | null>(null); // the count the confirm shows, and the send names
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState(false); // the server said it already went out: nothing more to send from this confirm
  const sentAt = issue.notice_sent_at ?? plan?.sent_at ?? null;
  const sentCount = issue.notice_sent_count ?? plan?.sent_count ?? null;

  const openConfirm = async () => {
    setError(null);
    const r = await api<NoticePlan>("GET", path); // the count as it is now, not as the card loaded it
    if (!r.ok) { toast({ title: "Couldn't check who it goes to", description: r.body.error || `HTTP ${r.status}`, variant: "destructive" }); return; }
    if (r.body.sent_at) { onChanged(); return; }
    setCount(r.body.recipients);
    setRefused(false);
    setOpen(true);
  };
  const send = async () => {
    setBusy(true); setError(null);
    const r = await api<{ sending: number; sent_at: string; recipients?: number }>("POST", path, { expectedCount: count });
    setBusy(false);
    if (!r.ok) {
      if (r.body.code === "COUNT_CHANGED" && typeof r.body.recipients === "number") {
        setCount(r.body.recipients);
        setError(`The list changed since you opened this. It now goes to ${people(r.body.recipients)}. Check the count and send again.`);
        return;
      }
      setError(r.body.error || `Couldn't send the notice (${r.status}).`);
      if (r.body.code === "NOTICE_SENT" || r.body.code === "NOT_PUBLISHED") { setRefused(true); onChanged(); }
      return;
    }
    setOpen(false);
    toast({ title: "Notice sent", description: `The email is going to ${people(r.body.sending)} now.` });
    onChanged();
  };

  return (
    <Card className="border-border mt-4" data-testid="digest-notice">
      <CardContent className="py-4 flex flex-wrap items-center gap-3">
        <Mail className="h-5 w-5 text-[#01696F] dark:text-[#5FC4C9] shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">Notice email</h2>
          {sentAt ? (
            <p className="text-sm" data-testid="digest-notice-sent">
              Notice sent {formatMomentDay(sentAt, tz)} to {people(Number(sentCount ?? 0))}. It goes once per issue, so it can't be sent again.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">Publishing doesn't send email. The notice tells the people this issue reaches that it's ready and links to it; it carries no numbers. It goes once per issue.</p>
              <p className="text-sm mt-1" data-testid="digest-notice-count">
                {plan == null ? "Checking who it goes to..." : plan.recipients
                  ? `It would go to ${people(plan.recipients)} who can sign in.`
                  : "Nobody this issue reaches can sign in yet, so there's no one to send it to."}
                {plan && plan.no_address > 0 ? ` ${people(plan.no_address)} it reaches ${plan.no_address === 1 ? "has" : "have"} no email address on file.` : ""}
              </p>
            </>
          )}
        </div>
        {!sentAt && (
          <Button size="sm" onClick={openConfirm} disabled={!plan?.can_send} data-testid="digest-notice-send"
            className="ml-auto bg-[#01696F] hover:bg-[#015A5F] text-white dark:bg-[#1F8F95] dark:hover:bg-[#1A7A80]">
            <Mail className="h-4 w-4 mr-1.5" />Send notice
          </Button>
        )}
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md" data-testid="notice-dialog">
          <DialogHeader>
            <DialogTitle>Send the notice for the {periodTitle(issue.period_start, issue.period_end)} issue?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm" data-testid="notice-dialog-text">
                <p>One email goes to {count === 1 ? "the" : "each of the"} <b data-testid="notice-dialog-count">{people(count ?? 0)}</b> this issue reaches who can sign in.</p>
                <p>It says the issue is ready{issue.ack_requested ? " and asks them to acknowledge it" : ""}, and links to it. It carries no numbers. You can send it once.</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive" data-testid="notice-error">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={send} disabled={busy || !count || refused} data-testid="notice-confirm">
              {busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Send to {people(count ?? 0)}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function IssueView({ labId, issueId, labName, cliaNumber }: { labId: number; issueId: string; labName: string | null; cliaNumber: string | null }) {
  const qc = useQueryClient();
  const issueQ = useDigestQuery<DigestIssueDetail>(["digest", labId, "issue", issueId], `/api/labs/${labId}/digest/issues/${issueId}`);
  const issue = issueQ.data?.ok ? issueQ.data.body : null;
  const manager = !!issue?.can_edit;
  const acksQ = useDigestQuery<Acks>(["digest", labId, "acks", issueId], `/api/labs/${labId}/digest/issues/${issueId}/acks`, manager);
  const settingsQ = useDigestQuery<DigestSettings>(["digest", labId, "settings"], `/api/labs/${labId}/digest/settings`, manager && issue?.status === "draft");
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["digest", labId] });
  const readerCount = manager && acksQ.data?.ok ? acksQ.data.body.totals?.audience ?? null : null;
  // Anyone else only sees an issue its audience reaches. The owner and admins see every issue, so their own read and
  // acknowledgment card shows only when the audience includes them (or they already recorded one).
  const { user } = useAuth();
  const roster = manager && acksQ.data?.ok ? acksQ.data.body.roster : undefined;
  const showMyStatus = !!issue && (!manager || !!issue.mine.read_at || !!roster?.some((r) => r.user_id === Number(user?.id) && r.in_audience));

  const back = (
    <div className="mb-3 flex items-center gap-1 text-sm text-muted-foreground" data-testid="digest-crumb">
      <Link href={`/labs/${labId}/digest`} className="inline-flex items-center gap-1 hover:text-foreground"><ChevronLeft className="h-4 w-4" />Compliance Digest</Link>
      {issue && <span>{"›"} {periodTitle(issue.period_start, issue.period_end)}</span>}
    </div>
  );
  if (issueQ.isLoading) return <div className="container max-w-4xl mx-auto py-8 px-4">{back}<Card className="border-border"><CardContent className="py-8 text-center text-sm text-muted-foreground">Loading the issue...</CardContent></Card></div>;
  if (issueQ.data?.status === 403 && issueQ.data.body.code === "PLAN_REQUIRED") return <Wall title="The compliance digest comes with a VeritaAssure® subscription" />;
  if (!issue) {
    return (
      <div className="container max-w-4xl mx-auto py-8 px-4">
        {back}
        <Card className="border-border" data-testid="digest-not-found"><CardContent className="py-10 text-center">
          <h2 className="text-lg font-semibold mb-1">This issue isn't available</h2>
          <p className="text-sm text-muted-foreground">It may have been withdrawn, or it isn't sent to you. Your list shows every issue you can read.</p>
          <Button asChild size="sm" variant="outline" className="mt-4"><Link href={`/labs/${labId}/digest`}>See your issues</Link></Button>
        </CardContent></Card>
      </div>
    );
  }
  const tz = issue.counts?.timeZone ?? null;
  return (
    <div className="container max-w-4xl mx-auto py-6 px-4">
      {back}
      {manager && issue.status === "draft" && (
        <DraftEditor labId={labId} issue={issue} groups={settingsQ.data?.ok ? settingsQ.data.body.groups || [] : []} readerCount={readerCount} onChanged={refresh} />
      )}
      {manager && issue.status === "withdrawn" && (
        <Card className="border-border mb-4" data-testid="digest-withdrawn"><CardContent className="py-3 text-sm">
          <b>Withdrawn {formatMomentDay(issue.withdrawn_at, tz)}.</b> Readers don't see it. Reason: {issue.withdrawn_reason}
        </CardContent></Card>
      )}
      <DigestIssueSheet issue={issue} labId={labId} labName={labName} cliaNumber={cliaNumber} readerCount={readerCount}
        headerAction={issue.status === "published" ? <DownloadPdfButton labId={labId} issue={issue} /> : null}
        statusCard={issue.status === "published" && showMyStatus ? <ReaderStatusCard labId={labId} issue={issue} onChanged={refresh} /> : null} />
      {manager && issue.status === "published" && <NoticeCard labId={labId} issue={issue} tz={tz} onChanged={refresh} />}
      {manager && issue.status !== "draft" && acksQ.data?.ok && <RosterCard acks={acksQ.data.body} tz={tz} />}
      {manager && issue.status === "published" && (
        <div className="mt-4 flex justify-end">
          <Button size="sm" variant="outline" onClick={() => setWithdrawOpen(true)} data-testid="issue-withdraw">Withdraw this issue</Button>
          <WithdrawDialog open={withdrawOpen} onOpenChange={setWithdrawOpen} labId={labId} issue={issue} onDone={refresh} />
        </div>
      )}
    </div>
  );
}

function DigestHome({ labId, labName, tz }: { labId: number; labName: string | null; tz?: string | null }) {
  const qc = useQueryClient();
  const settingsQ = useDigestQuery<DigestSettings>(["digest", labId, "settings"], `/api/labs/${labId}/digest/settings`);
  const issuesQ = useDigestQuery<{ issues: IssueSummary[]; can_edit: boolean }>(["digest", labId, "issues"], `/api/labs/${labId}/digest/issues`);
  if (settingsQ.data?.status === 403 && settingsQ.data.body.code === "PLAN_REQUIRED") return <Wall title="The compliance digest comes with a VeritaAssure® subscription" />;
  const settings = settingsQ.data?.ok ? settingsQ.data.body : null;
  const issues = issuesQ.data?.ok ? issuesQ.data.body.issues : null;
  const manager = !!settings?.can_edit;
  const failed = (settingsQ.data && !settingsQ.data.ok) || (issuesQ.data && !issuesQ.data.ok) || settingsQ.isError || issuesQ.isError;
  return (
    <div className="container max-w-4xl mx-auto py-8 px-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Newspaper className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Compliance Digest</h1>
        {labName && <span className="text-sm text-muted-foreground">{labName}</span>}
        <Button asChild size="sm" variant="outline" className="ml-auto"><Link href={`/labs/${labId}/readiness`}>Inspection Readiness</Link></Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {manager
          ? "Each issue fills itself in from the lab's modules for one finished month or quarter. You review it, write a short note and publish it; its numbers then stay as they were that day."
          : "The issues your lab has sent to you, newest first. Each one's numbers stay as they were the day it was published."}
      </p>
      {failed ? (
        <Card className="border-border"><CardContent className="py-8 text-center text-sm text-destructive">Couldn't load the digest. Try again in a moment.</CardContent></Card>
      ) : !settings || !issues ? (
        <Card className="border-border"><CardContent className="py-8 text-center text-sm text-muted-foreground">Loading...</CardContent></Card>
      ) : (
        <>
          {manager && <DraftCard labId={labId} settings={settings} issues={issues} />}
          <div>
            <h2 className="text-base font-semibold mb-2">{manager ? "Issues" : "Your issues"}</h2>
            <IssueList labId={labId} issues={issues} manager={manager} tz={tz} />
          </div>
          {manager && <SettingsCard labId={labId} settings={settings} onSaved={() => qc.invalidateQueries({ queryKey: ["digest", labId] })} />}
        </>
      )}
    </div>
  );
}

export default function DigestPage() {
  const { user, isLoggedIn } = useAuth();
  const labId = useActiveLabId();
  const params = useParams<{ issueId?: string }>();
  const { data: memberships, isLoading } = useMemberships();
  const membership = pickCurrentMembership(memberships, labId);
  const hasPlanAccess = !!user && DIGEST_PLANS.includes(user.plan);

  if (!isLoggedIn) {
    return <Wall title="Sign in to read the compliance digest"><Button asChild className="mt-3"><Link href="/login">Sign in</Link></Button></Wall>;
  }
  if (isLoading) return <div className="container max-w-4xl mx-auto py-12 px-4 text-sm text-muted-foreground">Loading...</div>;
  if (!labId) return <Wall title="Select a lab to read its compliance digest" />;
  if (!hasPlanAccess) {
    return <Wall title="The compliance digest comes with a VeritaAssure® subscription">
      <p className="text-sm text-muted-foreground mb-4">A monthly issue filled in from the modules your lab uses, with a note from the medical director or designee.</p>
      <Button asChild><Link href="/pricing">See plans</Link></Button>
    </Wall>;
  }
  const labName = membership?.labId === labId ? membership.labName : null;
  const clia = membership?.labId === labId ? membership.cliaNumber : null;
  if (params.issueId) return <IssueView labId={labId} issueId={params.issueId} labName={labName} cliaNumber={clia} />;
  return <DigestHome labId={labId} labName={labName} tz={membership?.timeZone ?? null} />;
}
