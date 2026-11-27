// server/veritaqaLabColumn.ts
//
// VeritaQA rows belong to a laboratory (B15). The PI tables were stored per owner account, so an account with several
// laboratories saw one set in all of them. This adds lab_id (and, for an organization's indicators, the columns an entry keeps:
// its numerator and denominator and the kind and target in force when it was entered) and assigns the rows already on file once,
// the boot that adds the column:
//   the account owns exactly one laboratory that isn't retired and isn't a repository   its rows get that laboratory
//   anything else                                                                        lab_id stays NULL: account-wide
// It never chooses between laboratories and never copies a row. It runs once rather than at every boot, so an account that goes
// from three laboratories to one doesn't have its account-wide rows moved without anyone asking. What does run at every boot is
// not a choice: an entry, a priority and a review follow the indicator or plan they hang on (a seed writes them without the
// column). Counts only in the log.

export const VERITAQA_LAB_TABLES = ["pi_departments", "pi_metrics", "pi_entries", "pi_plan", "pi_plan_priority", "pi_plan_review"] as const;

/** The account's one laboratory that isn't retired and isn't a repository, or null when it owns none or several. */
export function onlyLabOfAccount(sqlite: any, accountId: number): number | null {
  const rows = sqlite.prepare("SELECT id FROM labs WHERE owner_user_id = ? AND retired_at IS NULL AND COALESCE(is_repository, 0) = 0 ORDER BY id LIMIT 2").all(accountId) as { id: number }[];
  return rows.length === 1 ? Number(rows[0].id) : null;
}

export function ensureVeritaQaLabColumns(sqlite: any): { assigned: Record<string, number>; accountWide: Record<string, number> } | null {
  const cols = (t: string) => (sqlite.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
  let result: { assigned: Record<string, number>; accountWide: Record<string, number> } | null = null;
  sqlite.transaction(() => {
    const added: string[] = [];
    for (const t of VERITAQA_LAB_TABLES) {
      const have = cols(t);
      if (have.length && !have.includes("lab_id")) { sqlite.exec(`ALTER TABLE ${t} ADD COLUMN lab_id INTEGER`); added.push(t); }
    }
    if (!cols("pi_metrics").includes("org_indicator_id")) sqlite.exec("ALTER TABLE pi_metrics ADD COLUMN org_indicator_id INTEGER");
    const entryCols = cols("pi_entries");
    for (const [c, ddl] of [["numerator", "REAL"], ["denominator", "REAL"], ["entry_kind", "TEXT"], ["entry_unit", "TEXT"], ["target_value", "REAL"], ["target_direction", "TEXT"], ["org_version", "INTEGER"]] as const) {
      if (!entryCols.includes(c)) sqlite.exec(`ALTER TABLE pi_entries ADD COLUMN ${c} ${ddl}`);
    }

    if (added.length) {
      const assigned: Record<string, number> = {}, accountWide: Record<string, number> = {};
      for (const t of added) {
        assigned[t] = 0;
        const accounts = sqlite.prepare(`SELECT DISTINCT account_id AS id FROM ${t} WHERE lab_id IS NULL`).all() as { id: number }[];
        for (const a of accounts) {
          const lab = onlyLabOfAccount(sqlite, a.id);
          if (lab != null) assigned[t] += sqlite.prepare(`UPDATE ${t} SET lab_id = ? WHERE account_id = ? AND lab_id IS NULL`).run(lab, a.id).changes;
        }
        accountWide[t] = Number((sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE lab_id IS NULL`).get() as any).n);
      }
      result = { assigned, accountWide };
    }

    // A child follows its parent.
    for (const [t, col, parent] of [["pi_entries", "metric_id", "pi_metrics"], ["pi_plan_priority", "plan_id", "pi_plan"], ["pi_plan_review", "plan_id", "pi_plan"]] as const) {
      sqlite.prepare(
        `UPDATE ${t} SET lab_id = (SELECT p.lab_id FROM ${parent} p WHERE p.id = ${t}.${col})
          WHERE EXISTS (SELECT 1 FROM ${parent} p WHERE p.id = ${t}.${col} AND p.lab_id IS NOT ${t}.lab_id)`
      ).run();
    }
  })();
  for (const t of VERITAQA_LAB_TABLES) sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_${t}_lab ON ${t}(lab_id)`);
  if (result) {
    const r = result as { assigned: Record<string, number>; accountWide: Record<string, number> };
    const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
    if (sum(r.assigned) + sum(r.accountWide) > 0) console.log(`[veritaqa] laboratory column added: assigned ${JSON.stringify(r.assigned)}; left account-wide ${JSON.stringify(r.accountWide)}`);
  }
  return result;
}
