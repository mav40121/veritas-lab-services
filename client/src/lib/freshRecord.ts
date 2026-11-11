import { useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";

// An edit form's record (Sampson 2026-11-11). queryClient.ts keeps every read fresh forever (staleTime Infinity)
// and holds it for 5 minutes after the screen closes. A form that fills itself once from a record read by its own
// key, reopened inside those minutes, filled from the copy read before the last save, and saving that form wrote
// the old copy back over everything saved since (a VeritaCheck draft lost its newer pairs that way).
//
// The rule: the form's query sets refetchOnMount: "always" and the form fills only from useFreshRecord, which gives
// nothing until a read made after the screen opened has come back (a failed read gives nothing too, so the form
// never fills from the old copy). Every save also drops or invalidates the record's own key, not just the list.
export function useFreshRecord<T>(query: { data: T | undefined; dataUpdatedAt: number }): T | undefined {
  const openedAt = useRef(Date.now());
  return query.data !== undefined && query.dataUpdatedAt >= openedAt.current ? query.data : undefined;
}

const queryKeyText = (key: readonly unknown[]): string => (typeof key[0] === "string" ? key[0] : "");

// A VeritaCheck study's own reads (the edit page's and the results page's, lab-scoped in any lab or the older
// /api/studies/:id) and the study lists (the dashboard's, active or archived).
const studyOwnKey = (studyId: number) => new RegExp(`^/api/(labs/\\d+/)?studies/${studyId}$`);
const STUDY_LIST_KEY = /^\/api\/(labs\/\d+\/)?studies(\?|$)/;
const validId = (studyId: unknown): number | null => { const id = Number(studyId); return Number.isInteger(id) && id > 0 ? id : null; };

// After a save that leaves the page (Save Draft, Run Study): the study's own cached reads go, so the next screen reads
// the server instead of showing an older copy first, and every study list is marked stale.
export function dropSavedStudy(queryClient: QueryClient, studyId: number | string | null | undefined): void {
  const id = validId(studyId);
  if (id !== null) queryClient.removeQueries({ predicate: (q) => studyOwnKey(id).test(queryKeyText(q.queryKey)) });
  queryClient.invalidateQueries({ predicate: (q) => STUDY_LIST_KEY.test(queryKeyText(q.queryKey)) });
}

// After a write on a page that stays open on the study (sign-off, excluded points, AMR, censoring, archive): its own
// reads and the lists are marked stale, and the open page reads again.
export function refreshSavedStudy(queryClient: QueryClient, studyId: number | string | null | undefined): void {
  const id = validId(studyId);
  queryClient.invalidateQueries({ predicate: (q) => STUDY_LIST_KEY.test(queryKeyText(q.queryKey)) || (id !== null && studyOwnKey(id).test(queryKeyText(q.queryKey))) });
}
