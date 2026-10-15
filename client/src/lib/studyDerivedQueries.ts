// Screens that summarize VeritaCheck studies saved on another page: the VeritaMap map grid and its
// intelligence panel (the server stamps last_method_comp / last_cal_ver / last_precision when a study
// is saved), VeritaCheck Coverage and its dashboard card, and VeritaTrack. With the app-wide
// staleTime Infinity these kept the answer cached before the study existed until a full reload
// (BUG-053: a finished Sodium correlation still read Missing / unchecked). queryClient.ts re-reads
// these from the server each time a screen using them opens.
const STUDY_DERIVED_KEY = /\/veritamap(\/|$)|\/veritacheck\/coverage|\/veritatrack/;

export function isStudyDerivedQuery(queryKey: readonly unknown[]): boolean {
  const k = queryKey[0];
  return typeof k === "string" && STUDY_DERIVED_KEY.test(k);
}
