// Shared pieces of the VeritaPT tabs (B11, 2026-11-24): the request helper, the status badge and small form parts.
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { API_BASE, responseErrorText } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { PT_STATUSES, PT_STATUS_LABEL, type PtStatus } from "@shared/ptEvents";

export async function ptRequest(path: string, init: { method?: string; json?: unknown; body?: BodyInit } = {}): Promise<any> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: init.method ?? "GET",
    headers: { ...authHeaders(), ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  if (!r.ok) throw new Error(await responseErrorText(r));
  return r.json();
}

/** A download fetched with the sign-in header; the server names the file. */
export async function ptDownload(path: string, fallback: string): Promise<void> {
  const r = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(await responseErrorText(r));
  const blob = await r.blob();
  const named = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") || "")?.[1];
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = named || fallback;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/** Every VeritaPT read of this lab is stale after a save, and so is anything worked out from it. */
export function usePtChanged(labId: number) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith(`/api/labs/${labId}/pt/`) });
}

const STATUS_CLASS: Record<PtStatus, string> = {
  acceptable: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  unacceptable: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  ungraded: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  not_graded: "bg-muted text-muted-foreground",
};

export function PtStatusBadge({ status, count }: { status: PtStatus; count?: number }) {
  return (
    <Badge className={`${STATUS_CLASS[status]} text-xs whitespace-nowrap font-medium`} data-testid={`pt-status-${status}`}>
      {count != null ? `${count} ` : ""}{PT_STATUS_LABEL[status]}
    </Badge>
  );
}

export function PtStatusBadges({ counts }: { counts: Record<PtStatus, number> }) {
  return <span className="flex flex-wrap gap-1">{PT_STATUSES.filter((s) => counts[s] > 0).map((s) => <PtStatusBadge key={s} status={s} count={counts[s]} />)}</span>;
}

export const ptInputClass = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground";
export const ptSelectClass = "h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground max-w-full";

export function PtField({ label, children, hint, className }: { label: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="block text-xs font-medium mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground mt-1">{hint}</span>}
    </label>
  );
}

export function PtError({ error }: { error: string | null }) {
  if (!error) return null;
  return <p role="alert" className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-800 px-3 py-2 text-sm text-red-800 dark:text-red-300" data-testid="pt-error">{error}</p>;
}

/** A number as entered, or nothing. */
export const ptNum = (v: number | null | undefined): string => (v == null ? "" : String(v));
/** The program's own range for a result, when the event carries one. */
export const ptRange = (low: number | null, high: number | null): string =>
  low != null && high != null ? `${low} to ${high}` : low != null ? `${low} or above` : high != null ? `${high} or below` : "";
