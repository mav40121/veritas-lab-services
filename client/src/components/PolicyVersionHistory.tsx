// PolicyVersionHistory.tsx
//
// The version list on a VeritaDC document's view, and what an earlier version or an archived document wears while someone reads
// it (B13; shared/policyVersionStanding.ts has the words, server/policyVersionStanding.ts decides which is which). Editors and the
// approvers on its route open an earlier version in the same viewer, read-only: a note above it says what it is and an
// uncontrolled-copy mark runs across it. Everyone else sees the list and opens nothing from it.

import { ArrowLeft, Eye, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ARCHIVED_WATERMARK, NOT_APPROVED_WATERMARK, STANDING_LABEL, SUPERSEDED_WATERMARK, standingNote, type VersionStanding,
} from "@shared/policyVersionStanding";

export interface PolicyVersionRow {
  id: number;
  version_number: number;
  version_label?: string | null;
  file_format: string | null;
  file_hash_sha256: string | null;
  change_summary: string | null;
  uploaded_at: string | null;
  standing?: VersionStanding;
  in_use_label?: string | null;
}

export const versionName = (v: PolicyVersionRow) => v.version_label ?? String(v.version_number);

const CHIP: Record<VersionStanding, string> = {
  current: "bg-sky-100 text-sky-900 border-sky-300 dark:bg-sky-900/30 dark:text-sky-200 dark:border-sky-700",
  in_effect: "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-700",
  superseded: "bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-600",
  not_approved: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-700",
};

/** The mark across what is being read, or null when it is the version in use. */
export function watermarkFor(version: PolicyVersionRow | null, archived: boolean): string | null {
  if (archived) return ARCHIVED_WATERMARK;
  if (version?.standing === "superseded") return SUPERSEDED_WATERMARK;
  if (version?.standing === "not_approved") return NOT_APPROVED_WATERMARK;
  return null;
}

export function PolicyVersionHistory({ versions, canOpen, viewingId, fmtDate, onOpen }: {
  versions: PolicyVersionRow[];
  canOpen: boolean;
  // The version on screen when it isn't the document's own.
  viewingId: number | null;
  fmtDate: (s: string | null) => string;
  onOpen: (v: PolicyVersionRow) => void;
}) {
  if (versions.length < 2) return null;
  return (
    <div className="rounded border bg-muted/30 p-2 text-xs space-y-1" data-testid="version-history">
      <div className="font-medium flex items-center gap-1">
        <FileText size={14} /> Version history ({versions.length})
      </div>
      <ul className="space-y-1">
        {versions.map((v) => {
          const standing = v.standing ?? "superseded";
          const reading = viewingId == null ? standing === "current" : viewingId === v.id;
          return (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1" data-testid={`version-row-${v.id}`}>
              <span className="min-w-0 flex-1 basis-56">
                <span className="font-medium">v{versionName(v)}</span>
                {canOpen && <span className={`ml-2 inline-flex px-1.5 rounded text-[10px] border ${CHIP[standing]}`}>{STANDING_LABEL[standing]}</span>}
                <span className="ml-2 text-muted-foreground">{v.file_format?.toUpperCase()}</span>
                <span className="ml-2 text-muted-foreground">uploaded {fmtDate(v.uploaded_at)}</span>
                {v.change_summary && <span className="ml-2 italic text-muted-foreground">- {v.change_summary}</span>}
              </span>
              <span className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-muted-foreground">{v.file_hash_sha256?.slice(0, 12)}…</span>
                {!canOpen ? null : reading ? (
                  <span className="text-[11px] text-muted-foreground w-16 text-center">Reading</span>
                ) : (
                  <Button size="sm" variant="outline" className="h-6 px-2 text-[11px] w-16" onClick={() => onOpen(v)} data-testid={`version-open-${v.id}`}>
                    <Eye size={11} className="mr-1" /> Open
                  </Button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Above an earlier version while it is read: what it is, and the way back. */
export function VersionBanner({ version, onBack }: { version: PolicyVersionRow; onBack: () => void }) {
  const standing = version.standing ?? "superseded";
  if (standing === "current") return null;
  const note = standingNote(versionName(version), { standing, in_use_label: version.in_use_label ?? null });
  const inEffect = standing === "in_effect";
  return (
    <div
      className={`rounded border p-2 text-sm flex flex-wrap items-center justify-between gap-2 ${
        inEffect
          ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200"
          : "border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
      }`}
      role="status"
      data-testid="version-banner"
    >
      <span className="min-w-0 flex-1 basis-64"><span className="font-semibold">{STANDING_LABEL[standing]}.</span> {note}</span>
      <Button size="sm" variant="outline" className="h-7" onClick={onBack} data-testid="version-back">
        <ArrowLeft size={12} className="mr-1" /> Back to the current version
      </Button>
    </div>
  );
}

/** The document on screen, with the mark across it when it isn't the procedure in use. The mark never blocks scrolling or selecting. */
export function MarkedDocument({ mark, children }: { mark: string | null; children: React.ReactNode }) {
  if (!mark) return <>{children}</>;
  return (
    <div className="relative overflow-hidden min-w-0" data-testid="marked-document">
      {children}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-around overflow-hidden" aria-hidden="true" data-testid="document-watermark">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="-rotate-[24deg] whitespace-nowrap text-lg sm:text-3xl font-bold tracking-wider text-red-600/40 select-none">{mark}</span>
        ))}
      </div>
    </div>
  );
}
