// client/src/components/digest/DigestIssueSheet.tsx
//
// The compliance digest's reader view of one issue (Michael 2026-11-11, Q281 = 1; PR 4 of 5; the approved screen mock of
// 2026-11-10, without its SAMPLE banner, Download PDF button or bell, which are PR 5's or the spec's own). The header
// block, the note from the medical director or designee, "This month at a glance" (one card per section the issue
// includes) and a slot for the reader's status card. Every number comes from the issue's counts: frozen at publish, live
// on a draft. The change lines compare with GET issues/:id `previous` (shared/digestCards.ts changeLine); none is drawn
// when there is no prior issue or it didn't hold the section. No person's name is on this sheet.
import type { ReactNode } from "react";
import { Link } from "wouter";
import {
  DIGEST_CARDS, cardBody, changeLine, issueCardKeys, periodTitle, periodFrequency, priorPeriodLabel, formatDay, formatMomentDay,
  DIGEST_AUDIENCE_LABELS, digestVersionLabel, type DigestCardKey, type DigestChangeKind, type DigestCountsLike,
} from "@shared/digestCards";

export interface DigestIssueDetail {
  id: number;
  lab_id: number;
  period_start: string;
  period_end: string;
  status: "draft" | "published" | "withdrawn";
  note: string | null;
  sections: string[];
  audience: "leadership" | "staff" | "groups";
  audience_group_ids: number[];
  audience_groups?: Array<{ id: number; name: string; retired: boolean }>;
  ack_requested: boolean;
  review_box: boolean;
  counts_as_of: string | null;
  created_at: string;
  published_at: string | null;
  withdrawn_at: string | null;
  withdrawn_reason: string | null;
  counts: DigestCountsLike | null;
  counts_live: boolean;
  previous: { id: number; period_start: string; period_end: string; counts_as_of: string | null; counts: Record<string, any> } | null;
  mine: { read_at: string | null; acknowledged_at: string | null };
  can_edit: boolean;
}

// The mock's colors (#437A22 better, #A12C7B worse, #7A7974 same and info), with lighter shades on a dark page.
const CHANGE_CLASS: Record<DigestChangeKind, string> = {
  better: "text-[#437A22] dark:text-[#9CCB7E]",
  worse: "text-[#A12C7B] dark:text-[#EE9BD2]",
  same: "text-[#7A7974] dark:text-[#BAB7AF]",
  info: "text-[#7A7974] dark:text-[#BAB7AF]",
};
const TEAL = "text-[#01696F] dark:text-[#5FC4C9]";
const DEEP = "text-[#0A3A3D] dark:text-[#D5ECEC]";
// The mock's secondary text (#4A4740), lighter on a dark page so a detail line still reads at 4.5:1 or better.
export const DIGEST_SUB = "text-[#4A4740] dark:text-[#B4BAC2]";
// The mock sets its headings in the page's sans; the app's global h1/h2 are serif.
const SANS = { fontFamily: "inherit" } as const;

function ChangeIcon({ kind }: { kind: DigestChangeKind }) {
  if (kind === "better") return <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 10 L1.5 4 H10.5 Z" fill="currentColor" /></svg>;
  if (kind === "worse") return <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2 L10.5 8 H1.5 Z" fill="currentColor" /></svg>;
  if (kind === "same") return <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="3.5" width="9" height="1.8" fill="currentColor" /><rect x="1.5" y="6.7" width="9" height="1.8" fill="currentColor" /></svg>;
  return <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4" fill="currentColor" /></svg>;
}

function DigestCard({ k, issue, labId }: { k: DigestCardKey; issue: DigestIssueDetail; labId: number }) {
  const meta = DIGEST_CARDS[k];
  const section = issue.counts ? (issue.counts as any)[k] : null;
  const body = cardBody(k, section, { start: issue.period_start, end: issue.period_end, asOf: issue.counts?.asOf ?? null });
  const change = body.available ? changeLine(k, section, issue.previous, issue) : null;
  return (
    <div
      className={`rounded-[7px] border border-border border-t-[3px] border-t-[#01696F] dark:border-t-[#3FA7AC] bg-card px-3.5 pt-2.5 pb-2.5 flex flex-col ${meta.wide ? "sm:col-span-2" : ""}`}
      data-testid={`digest-card-${k}`}
    >
      <div className="flex-1">
      <div className="flex items-baseline gap-2">
        <div className="font-bold text-[14.5px] leading-snug">{meta.title}</div>
        <div className={`ml-auto text-xs font-semibold whitespace-nowrap ${TEAL}`}>{meta.module}</div>
      </div>
      {body.available ? (
        <div className="flex items-baseline gap-2 mt-0.5">
          <span className={`text-[30px] font-bold leading-tight ${DEEP}`} data-testid={`digest-card-${k}-number`}>{body.big}</span>
          <span className="text-sm font-semibold">{body.unit}</span>
        </div>
      ) : (
        <div className={`mt-1.5 mb-0.5 text-base font-semibold ${DIGEST_SUB}`} data-testid={`digest-card-${k}-na`}>Not available</div>
      )}
      <div className={`text-[13px] leading-snug ${DIGEST_SUB}`} data-testid={`digest-card-${k}-detail`}>{body.detail}</div>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2 pt-1.5 border-t border-border/70 text-[12.5px]">
        {change && (
          <span className={`inline-flex items-center gap-1.5 font-semibold ${CHANGE_CLASS[change.kind]}`} data-testid={`digest-card-${k}-change`} data-kind={change.kind}>
            <ChangeIcon kind={change.kind} />
            {change.label && <span className="font-bold">{change.label}</span>}{change.label ? " " : ""}
            <span>{change.text}</span>
          </span>
        )}
        <Link href={`/labs/${labId}${meta.path}`} className={`ml-auto font-semibold underline whitespace-nowrap ${TEAL}`} data-testid={`digest-card-${k}-link`}>
          View in {meta.module} {"›"}
        </Link>
      </div>
    </div>
  );
}

export function sentToLabel(issue: Pick<DigestIssueDetail, "audience" | "audience_groups">): string {
  if (issue.audience === "groups") {
    const names = (issue.audience_groups || []).map((g) => g.name);
    return names.length ? `Lab groups: ${names.join(", ")}` : DIGEST_AUDIENCE_LABELS.groups;
  }
  return DIGEST_AUDIENCE_LABELS[issue.audience] || issue.audience;
}

export function DigestIssueSheet({ issue, labId, labName, cliaNumber, readerCount, statusCard }: {
  issue: DigestIssueDetail;
  labId: number;
  labName: string | null;
  cliaNumber: string | null;
  readerCount?: number | null; // the owner and admins only: how many people the audience reaches
  statusCard?: ReactNode;
}) {
  const tz = issue.counts?.timeZone ?? null;
  const keys = issueCardKeys(issue.sections);
  const quarter = periodFrequency(issue.period_start, issue.period_end) === "quarterly";
  const prior = issue.previous ? priorPeriodLabel(issue.previous, issue) : null;
  const readers = readerCount == null ? "" : ` (${readerCount} ${readerCount === 1 ? "reader" : "readers"})`;
  return (
    <div className="text-[14px] leading-[1.35]" data-testid="digest-sheet">
      <div className="rounded-lg border border-border bg-card px-[18px] py-3" data-testid="digest-header">
        <div className={`font-bold text-xs tracking-[.8px] uppercase ${TEAL}`} data-testid="digest-eyebrow">Compliance Digest | {digestVersionLabel(issue.audience)}</div>
        <h1 className={`mt-0.5 mb-1 text-[25px] font-bold ${DEEP}`} style={SANS} data-testid="digest-title">{periodTitle(issue.period_start, issue.period_end)}</h1>
        <div className="text-sm font-semibold" data-testid="digest-lab">
          {labName || `Lab ${labId}`} {" | "} <span className="whitespace-nowrap">{cliaNumber ? `CLIA ${cliaNumber}` : "CLIA: Not on file. Enter it in account settings."}</span>
        </div>
        {/* One item per line on a phone; on a wider screen one line with the mock's separators, each kept with the item after it. */}
        <div className={`mt-1.5 text-[12.5px] ${DIGEST_SUB} flex flex-col sm:flex-row sm:flex-wrap gap-y-0.5`} data-testid="digest-meta">
          <span><b className="text-foreground">Numbers as of</b> {issue.counts?.asOf ? `${formatDay(issue.counts.asOf)} (lab time${issue.counts_live ? ", live" : ""})` : "not taken"}</span>
          <span><span aria-hidden="true" className="hidden sm:inline mx-2">|</span>
            {issue.status === "published" && <><b className="text-foreground">Published</b> {formatMomentDay(issue.published_at, tz)}</>}
            {issue.status === "draft" && <><b className="text-foreground">Draft</b>, not published</>}
            {issue.status === "withdrawn" && <><b className="text-foreground">Withdrawn</b> {formatMomentDay(issue.withdrawn_at, tz)}</>}
          </span>
          <span><span aria-hidden="true" className="hidden sm:inline mx-2">|</span>
            <span data-testid="digest-sent-to"><b className="text-foreground">{issue.status === "draft" ? "Goes to" : "Sent to"}</b> {sentToLabel(issue)}{readers}</span>
          </span>
        </div>
      </div>

      {issue.note && (
        <div className="mt-3 rounded-md border-l-[5px] border-l-[#01696F] dark:border-l-[#3FA7AC] bg-[#E6F2F2] dark:bg-[#0F2D30] px-4 pt-[11px] pb-3" data-testid="digest-note">
          <div className="flex flex-wrap items-baseline gap-x-2.5">
            <span className={`font-bold text-[15px] ${TEAL}`}>A note from the medical director or designee</span>
            <span className={`text-xs ${DIGEST_SUB}`}>Written by the lab before publishing</span>
          </div>
          <p className="mt-1.5 whitespace-pre-wrap" data-testid="digest-note-text">{issue.note}</p>
        </div>
      )}

      {issue.counts ? (
        <>
          <div className="flex flex-wrap items-baseline gap-x-3 mt-3.5 mb-2 mx-0.5">
            <h2 className={`text-base font-bold ${DEEP}`} style={SANS}>This {quarter ? "quarter" : "month"} at a glance</h2>
            <span className={`sm:ml-auto text-xs ${DIGEST_SUB}`} data-testid="digest-glance-note">
              Counts only: no patient information and no staff names.{prior ? ` Change shown against ${prior}.` : ""}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5" data-testid="digest-cards">
            {keys.map((k) => <DigestCard key={k} k={k} issue={issue} labId={labId} />)}
          </div>
        </>
      ) : (
        <div className={`mt-3 rounded-lg border border-border bg-card px-4 py-3 text-sm ${DIGEST_SUB}`} data-testid="digest-no-counts">
          This issue was withdrawn before it was published, so it holds no numbers.
        </div>
      )}

      {statusCard}

      <div className={`mt-2.5 px-0.5 text-[11.5px] ${DIGEST_SUB}`} data-testid="digest-footer">
        VeritaAssure{"®"} | Compliance Digest | Confidential, For Internal Lab Use Only
      </div>
    </div>
  );
}
