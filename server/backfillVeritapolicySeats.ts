/**
 * One-shot backfill: re-key VeritaPolicy seat-user data rows to their owner.
 *
 * Background: PR-fixed VeritaPolicy routes now resolve to req.ownerUserId
 * for all per-user data scoping (matching the convention used by every other
 * module). Before the fix, those routes used req.userId directly, so seat
 * users wrote status / notes / our_policy_name to rows keyed by the SEAT's
 * own user_id rather than the lab owner's. After the route fix, those rows
 * become unreachable (the new queries look for owner_user_id).
 *
 * This routine re-keys orphaned seat-user rows to their owner so the work
 * isn't lost. Idempotent: subsequent boots find no orphan rows and skip.
 *
 * Conflict policy: if the owner already has a row for the same policy that
 * a seat wrote, owner's row wins (the owner is the authoritative editor and
 * the seat's row was written under a broken model). The seat's row is
 * deleted. Conflict count is logged so the operator can audit.
 *
 * Affected tables:
 *   - veritapolicy_master_status (user_id, policy_id, status, is_na, ...)
 *   - veritapolicy_requirement_status (user_id, requirement_id, ...)
 *   - veritapolicy_lab_policies (user_id, ...)
 *   - veritapolicy_settings (user_id, ...)
 *
 * Wrapped in try/catch so failure cannot crash startup.
 */
import { db } from "./db";

interface SeatLink { seat_user_id: number; owner_user_id: number }

export function backfillVeritapolicySeatsOnStartup(): void {
  try {
    const sqlite = (db as any).$client;

    // Collect active seat-user → owner-user mappings
    const seatLinks = sqlite.prepare(
      "SELECT seat_user_id, owner_user_id FROM user_seats WHERE status = 'active'"
    ).all() as SeatLink[];
    if (seatLinks.length === 0) {
      console.log("[backfill-veritapolicy] No active seat users; nothing to re-key.");
      return;
    }

    // Each (table, pk-besides-user_id) shape gets the same treatment:
    //   1. For each seat row, check whether owner already has a row at the same key.
    //   2. If not, UPDATE the seat row's user_id to owner_user_id.
    //   3. If yes, DELETE the seat row (owner-wins on conflict).
    const tables: { name: string; otherKey: string }[] = [
      { name: "veritapolicy_master_status",      otherKey: "policy_id" },
      { name: "veritapolicy_requirement_status", otherKey: "requirement_id" },
    ];

    let totalReKeyed = 0;
    let totalConflicts = 0;

    for (const { name, otherKey } of tables) {
      // Verify table exists (it may not on older deployments)
      const tableExists = sqlite.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
      ).get(name);
      if (!tableExists) continue;

      for (const link of seatLinks) {
        const seatRows = sqlite.prepare(
          `SELECT ${otherKey} FROM ${name} WHERE user_id = ?`
        ).all(link.seat_user_id) as Record<string, any>[];
        if (seatRows.length === 0) continue;

        for (const row of seatRows) {
          const key = row[otherKey];
          const ownerHas = sqlite.prepare(
            `SELECT 1 FROM ${name} WHERE user_id = ? AND ${otherKey} = ? LIMIT 1`
          ).get(link.owner_user_id, key);
          if (ownerHas) {
            // Conflict: owner already has a row. Delete the seat's row (owner wins).
            sqlite.prepare(
              `DELETE FROM ${name} WHERE user_id = ? AND ${otherKey} = ?`
            ).run(link.seat_user_id, key);
            totalConflicts++;
          } else {
            // No conflict: re-key seat's row to owner.
            sqlite.prepare(
              `UPDATE ${name} SET user_id = ? WHERE user_id = ? AND ${otherKey} = ?`
            ).run(link.owner_user_id, link.seat_user_id, key);
            totalReKeyed++;
          }
        }
      }
    }

    // veritapolicy_lab_policies and veritapolicy_settings use user_id as a
    // simple FK with no compound uniqueness. For these, prefer the owner's
    // existing rows and delete any seat-keyed rows (lab policies should be
    // an owner-level concept; settings are inherently owner-scoped).
    const singleKeyTables = ["veritapolicy_lab_policies", "veritapolicy_settings"];
    for (const name of singleKeyTables) {
      const tableExists = sqlite.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
      ).get(name);
      if (!tableExists) continue;

      for (const link of seatLinks) {
        const cnt = sqlite.prepare(
          `SELECT COUNT(*) as c FROM ${name} WHERE user_id = ?`
        ).get(link.seat_user_id) as { c: number };
        if (cnt.c === 0) continue;
        // Delete seat-keyed rows for these owner-level tables.
        const del = sqlite.prepare(`DELETE FROM ${name} WHERE user_id = ?`).run(link.seat_user_id);
        if (del.changes > 0) {
          console.log(`[backfill-veritapolicy] Removed ${del.changes} seat-keyed row(s) from ${name} (seat ${link.seat_user_id} -> owner ${link.owner_user_id})`);
          totalConflicts += del.changes;
        }
      }
    }

    if (totalReKeyed === 0 && totalConflicts === 0) {
      console.log("[backfill-veritapolicy] No seat-keyed VeritaPolicy rows found.");
    } else {
      console.log(`[backfill-veritapolicy] Re-keyed ${totalReKeyed} row(s) to owner; ${totalConflicts} conflict(s) resolved owner-wins.`);
    }
  } catch (err: any) {
    console.error("[backfill-veritapolicy] Backfill failed (non-fatal):", err.message);
  }
}
