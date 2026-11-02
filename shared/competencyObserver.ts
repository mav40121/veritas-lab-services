// shared/competencyObserver.ts
//
// BUG-075 (2026-10-27): how a saved observer value is matched to a VeritaStaff person, used by the pick list
// (client/src/components/ObserverInitialsField.tsx) and the server check (server/competencyObserver.ts) so both agree.
// Observers are stored as initials computed from the VeritaStaff name (first + middle + last initial); a person with a
// middle initial also matches on first + last, the form most paper records carry. A full name typed before the pick list
// existed matches the person it names (observerNameMatches).

/** Initials compared letters only, upper case: "j.s." and "JS" are the same observer. */
export function normInitials(v: unknown): string {
  return String(v ?? "").toUpperCase().replace(/[^A-Z]/g, "");
}

/** Every initials form an observer is accepted under. */
export function observerForms(o: { initials: string }): string[] {
  const full = normInitials(o.initials);
  return full.length === 3 ? [full, full[0] + full[2]] : full ? [full] : [];
}

// Credentials and role letters a typed name may carry ("Michael Veri, TS", "Veri, Michael (LD)"); not part of the name.
const NAME_NOISE = new Set(["ld", "tc", "ts", "gs", "md", "phd", "mls", "mt", "ascp", "cm", "dr"]);
const nameTokens = (v: unknown): string[] =>
  String(v ?? "").toLowerCase().replace(/\([^)]*\)/g, " ").split(/[^a-z]+/).filter((t) => t && !NAME_NOISE.has(t));

/**
 * Michael 2026-11-02: an observer typed as a name before the pick list existed ("Michael Veri, TS") is that person when
 * it carries their first and last name, in either order, with at most one more word (a middle name or initial).
 */
export function observerNameMatches(o: { firstName?: string | null; lastName?: string | null }, value: unknown): boolean {
  const first = nameTokens(o.firstName), last = nameTokens(o.lastName);
  if (!first.length || !last.length) return false;
  const v = nameTokens(value);
  return v.length <= first.length + last.length + 1 && [...first, ...last].every((t) => v.includes(t));
}

/** The first observer a saved value matches (by initials, then by name), or undefined. */
export function matchObserver<T extends { initials: string; firstName?: string | null; lastName?: string | null }>(observers: T[], value: unknown): T | undefined {
  const v = normInitials(value);
  if (!v) return undefined;
  return observers.find((o) => observerForms(o).includes(v)) ?? observers.find((o) => observerNameMatches(o, value));
}
