// shared/competencyQuizGroups.ts
//
// A quiz follows the lab's method group (REQ-131, Cathy Thornton at Redington, 2026-11-05: she grouped PATHFAST on the
// Method groups tab and the quiz's method group option didn't change).
//
// Two lists stay separate. competency_instrument_groups is the tab: lab-wide, by analyzer, the lab's own decision that
// analyzers share a competency. competency_method_groups is per program, and it is what a quiz is labeled with
// (method_group_ids) and what an assessment is filled out against. A row joins a tab group when it names one of the
// group's analyzers, matched by whole name the way programNamedInstrumentIds matches them, and the join happens at read
// time, so a group's new analyzer, new name or split shows at once and no existing quiz needs its label rewritten.
//
// Nothing is written onto the row. Its `instruments` decides what a competency record credits (methodGroupCoversInstrument,
// programNamedInstrumentIds; BUG-043, BUG-120): adding PATHFAST there would credit assessments already on file with an
// analyzer nobody was assessed on.

export type LabGroupRef = { id: number; name: string; members: string[] };
export type QuizGroupRow = { id: number; name?: string | null; instruments?: string | null; labGroups?: LabGroupRef[] };
export type QuizLabel = { method_group_id?: number | null; method_group_ids?: string | null; method_group_name?: string | null };

const nameKey = (s: unknown) => String(s ?? "").trim().toLowerCase();

function rowInstrumentNames(instruments: string | null | undefined): string[] {
  try {
    const v = JSON.parse(instruments || "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return []; // malformed group JSON names nothing
  }
}

/** The lab's tab groups this program row belongs to: the ones holding an analyzer the row names. */
export function labGroupsForRow(instruments: string | null | undefined, groups: LabGroupRef[]): LabGroupRef[] {
  const named = new Set(rowInstrumentNames(instruments).map(nameKey).filter(Boolean));
  return groups.filter((g) => g.members.some((m) => named.has(nameKey(m))));
}

/** The analyzers the row's tab groups add to what the row itself names. */
export function rowGroupOthers(row: QuizGroupRow): string[] {
  const own = new Set(rowInstrumentNames(row.instruments).map(nameKey));
  const others = new Map<string, string>();
  for (const g of row.labGroups || []) for (const m of g.members) if (!own.has(nameKey(m))) others.set(nameKey(m), m);
  return Array.from(others.values());
}

/** The line under a method group option on the quiz form, or null when the row is in no tab group. */
export function rowGroupNote(row: QuizGroupRow): string | null {
  const groups = row.labGroups || [];
  if (!groups.length) return null;
  const others = rowGroupOthers(row);
  const named = groups.map((g) => `"${g.name}"`).join(" and ");
  return `In group ${named}${others.length ? ` with ${others.join(", ")}` : ""}`;
}

/** The program rows a quiz is labeled with: its id list, or the older single id. */
export function quizLabelRowIds(quiz: QuizLabel): number[] {
  if (quiz.method_group_ids) {
    try {
      const ids = JSON.parse(quiz.method_group_ids);
      if (Array.isArray(ids) && ids.length) return ids.map(Number).filter(Number.isFinite);
    } catch { /* falls to the single id, as the quiz form does */ }
  }
  return quiz.method_group_id ? [quiz.method_group_id] : [];
}

/** The line on a quiz's card: each tab group its labeled rows belong to, with the group's analyzers as they are now. */
export function quizFollowsLine(quiz: QuizLabel, rows: QuizGroupRow[]): string | null {
  const ids = new Set(quizLabelRowIds(quiz));
  const groups = new Map<number, LabGroupRef>();
  for (const r of rows) if (ids.has(r.id)) for (const g of r.labGroups || []) groups.set(g.id, g);
  if (!groups.size) return null;
  return Array.from(groups.values()).map((g) => `Follows method group "${g.name}": ${g.members.join(", ")}`).join("; ");
}

/**
 * The quiz the Element 6 picker offers on one program row. The first three steps are the picker as it always was, in the
 * same order, so a row that already found a quiz finds the same one:
 *   1. Exact match on the older single method_group_id (seeded system quizzes that target one group).
 *   2. method_group_ids contains this row (quizzes authored on the Quizzes tab).
 *   3. Fuzzy match on method_group_name.
 * Step 4 is the only thing a tab group adds: a row with no quiz of its own takes a quiz labeled on another row in the same
 * tab group, because the lab has said those analyzers share a competency.
 */
export function findQuizForMethodGroup<Q extends QuizLabel>(quizzes: Q[], mg: QuizGroupRow, rows: QuizGroupRow[]): Q | null {
  const byId = quizzes.find((q) => q.method_group_id === mg.id);
  if (byId) return byId;
  const byArray = quizzes.find((q) => {
    if (!q.method_group_ids) return false;
    try {
      const ids: number[] = JSON.parse(q.method_group_ids);
      return Array.isArray(ids) && ids.includes(mg.id);
    } catch { return false; }
  });
  if (byArray) return byArray;
  const mn = String(mg.name ?? "").toLowerCase();
  const byName = quizzes.find((q) => {
    if (!q.method_group_name) return false;
    const qn = q.method_group_name.toLowerCase();
    return qn.includes("vitros 5600") && mn.includes("vitros 5600") || qn.includes(mn) || mn.includes(qn);
  });
  if (byName) return byName;
  const own = new Set((mg.labGroups || []).map((g) => g.id));
  if (!own.size) return null;
  const rowsById = new Map(rows.map((r) => [r.id, r]));
  return quizzes.find((q) => quizLabelRowIds(q).some((id) => (rowsById.get(id)?.labGroups || []).some((g) => own.has(g.id)))) || null;
}
