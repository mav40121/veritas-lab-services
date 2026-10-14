// shared/competencyGrouping.ts
//
// Lab-chosen method grouping for VeritaComp (Michael 2026-10-13: "the lab should be able to group them into one
// competency if they choose ... if they decide that the EXL and the EXL 200 are functionally identical for competency
// purposes, that is acceptable as well"; mock approved 2026-10-14, Q168 = 1). Every analyzer is its own method until
// the lab groups it; one competency and one sign-off then cover every analyzer in the group. VeritaComp only SUGGESTS
// groups (same make and model family); it never groups anything on its own. Two limits come from the unique-skills
// rule (reference: "a different platform or a manual method brings unique skills"; BUG-043):
//   - analyzers in a group share the same complexity (a waived device keeps its own competency);
//   - a manual method (manual differential, tube method, microscopy, smears, stains) never joins a group.

export interface GroupableInstrument { id: number; name: string; category: string | null; complexity: string }

// A manual method: VeritaMap has no flag for it, so it is read from the department and the name.
export function isManualMethod(name: string | null | undefined, category: string | null | undefined): boolean {
  if (String(category || "").trim().toLowerCase() === "manual procedures") return true;
  const n = String(name || "").toLowerCase();
  return /\bmanual\b|\btube (method|testing)\b|microscop|\bsmear\b|\bstain\b|\bwet (mount|prep)\b|\bcell count\b|^all\b|\bprocedures?\b/.test(n);
}

const NOISE = new Set(["primary", "backup", "back", "up", "with", "lm", "unicel", "analyzer", "analyser", "system", "the", "and", "1", "2", "a", "b"]);

// The make-and-model tokens of an analyzer name: parentheticals and brackets dropped, "Primary"/"Backup" and similar
// noise dropped, and model numbers on hyphenated codes dropped (XN-1000 and XN-450 are both "xn"; CA-660 is "ca").
export function familyTokens(name: string): string[] {
  const s = String(name || "").toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/[^a-z0-9\- ]/g, " ");
  const out: string[] = [];
  for (const raw of s.split(/\s+/).filter(Boolean)) {
    const t = /^[a-z]+-\d+[a-z]*$/.test(raw) ? raw.replace(/-\d+[a-z]*$/, "") : raw;
    if (!t || NOISE.has(t)) continue;
    out.push(t);
  }
  return Array.from(new Set(out));
}

// Two analyzers look like the same model family when their make-and-model tokens are the same (XN-1000 and XN-450 are
// both "xn"), or when one name's tokens contain the other's and the shorter has at least two tokens (so a one-word
// name such as "Sofia 2" does not match every longer Sofia name).
export function sameFamily(a: string, b: string): boolean {
  const ta = familyTokens(a), tb = familyTokens(b);
  if (!ta.length || !tb.length) return false;
  if (ta.length === tb.length && ta.every((t) => tb.includes(t))) return true;
  const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (small.length < 2) return false;
  return small.every((t) => big.includes(t));
}

// Why a set of analyzers cannot be grouped, or null when it can.
export function groupProblem(members: GroupableInstrument[]): string | null {
  if (members.length < 2) return "A group needs at least two analyzers.";
  const manual = members.find((m) => isManualMethod(m.name, m.category));
  if (manual) return `${manual.name} is a manual method; a manual method keeps its own competency.`;
  const cx = new Set(members.map((m) => String(m.complexity || "").toUpperCase()));
  if (cx.size > 1) {
    const waived = members.find((m) => String(m.complexity).toUpperCase() === "WAIVED");
    if (waived) return `${waived.name} is waived and the others are not; a waived device keeps its own competency.`;
    return "These analyzers have different complexity; a group needs one complexity.";
  }
  if (cx.has("UNSPECIFIED")) return "Set each analyzer's complexity in VeritaMap before grouping.";
  return null;
}

// Suggested groups: analyzers of one complexity whose names look like the same model family, not manual methods, not
// already grouped, and not a pair the lab chose to keep separate. Connected pairs merge into one suggestion.
export function suggestGroups(instruments: GroupableInstrument[], groupedIds: Set<number>, dismissedKeys: Set<string>): GroupableInstrument[][] {
  const pool = instruments.filter((i) => !groupedIds.has(i.id) && !isManualMethod(i.name, i.category) && String(i.complexity).toUpperCase() !== "UNSPECIFIED");
  const parent = new Map<number, number>(pool.map((i) => [i.id, i.id]));
  const find = (x: number): number => { while (parent.get(x) !== x) x = parent.get(x)!; return x; };
  for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
    const a = pool[i], b = pool[j];
    if (String(a.complexity).toUpperCase() !== String(b.complexity).toUpperCase()) continue;
    if (!sameFamily(a.name, b.name)) continue;
    parent.set(find(a.id), find(b.id));
  }
  const sets = new Map<number, GroupableInstrument[]>();
  for (const i of pool) { const r = find(i.id); sets.set(r, [...(sets.get(r) || []), i]); }
  return Array.from(sets.values()).filter((s) => s.length > 1 && !dismissedKeys.has(groupKey(s.map((m) => m.id))));
}

export function groupKey(ids: number[]): string {
  return Array.from(new Set(ids)).sort((a, b) => a - b).join(",");
}

// A starting name for a suggested group: the words the analyzer names share ("Ortho 5600 Primary" + "Ortho 5600 Backup"
// -> "Ortho 5600"), or, when they share one word or less, the names side by side ("Sysmex CA-660 / CA-620"). The lab can
// change it before grouping.
export function suggestGroupName(names: string[]): string {
  const clean = names.map((n) => String(n || "").replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim());
  const words = clean.map((n) => n.split(" "));
  let k = 0;
  while (words.every((w) => w[k] !== undefined && w[k].toLowerCase() === words[0][k].toLowerCase())) k++;
  const prefix = words[0].slice(0, k).filter((w) => !/^(primary|backup|with)$/i.test(w)).join(" ");
  if (k >= 2 && prefix) return prefix;
  const rests = words.map((w) => w.slice(k).join(" ")).filter(Boolean);
  return [prefix, rests.join(" / ")].filter(Boolean).join(" ").trim() || clean[0];
}
