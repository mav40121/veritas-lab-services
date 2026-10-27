// shared/competencyObserver.ts
//
// BUG-075 (2026-10-27): how a saved observer value is matched to a VeritaStaff person, used by the pick list
// (client/src/components/ObserverInitialsField.tsx) and the server check (server/competencyObserver.ts) so both agree.
// Observers are stored as initials computed from the VeritaStaff name (first + middle + last initial); a person with a
// middle initial also matches on first + last, the form most paper records carry.

/** Initials compared letters only, upper case: "j.s." and "JS" are the same observer. */
export function normInitials(v: unknown): string {
  return String(v ?? "").toUpperCase().replace(/[^A-Z]/g, "");
}

/** Every initials form an observer is accepted under. */
export function observerForms(o: { initials: string }): string[] {
  const full = normInitials(o.initials);
  return full.length === 3 ? [full, full[0] + full[2]] : full ? [full] : [];
}

/** The first observer a saved value matches, or undefined. */
export function matchObserver<T extends { initials: string }>(observers: T[], value: unknown): T | undefined {
  const v = normInitials(value);
  if (!v) return undefined;
  return observers.find((o) => observerForms(o).includes(v));
}
