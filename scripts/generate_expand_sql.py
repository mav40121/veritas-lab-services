#!/usr/bin/env python3
"""generate_expand_sql.py — emit a deterministic SQL artifact from
expand_michaels_lab.py's seed plan, for the admin endpoint to apply on prod.

Usage:
  python3 scripts/generate_expand_sql.py \
    --in-db /tmp/veritas-seed-test.db \
    --out scripts/seed/michaels_lab_expand_v3_2026_05_03.sql
"""
import argparse
import sqlite3
import sys

SEED_TAG = "[SEED-2026-05-03-EXPAND-V3]"
MICHAEL_USER_ID = 17


def sql_lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return str(v)
    s = str(v).replace("'", "''")
    return f"'{s}'"


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--in-db", required=True)
    p.add_argument("--out", required=True)
    args = p.parse_args()

    conn = sqlite3.connect(args.in_db)
    cur = conn.cursor()

    out = []
    out.append("-- michaels_lab_expand_v3_2026_05_03.sql")
    out.append(f"-- Generated from {args.in_db}")
    out.append(f"-- Seed tag: {SEED_TAG}")
    out.append("")
    out.append("BEGIN;")
    out.append("")

    # Wipe Michael's existing data first (FK-safe order).
    out.append("-- Wipe Michael's existing data --")
    out.append(f"""
DELETE FROM veritamap_test_correlations
 WHERE test_a_id IN (SELECT id FROM veritamap_tests WHERE map_id IN (SELECT id FROM veritamap_maps WHERE user_id = {MICHAEL_USER_ID}))
    OR test_b_id IN (SELECT id FROM veritamap_tests WHERE map_id IN (SELECT id FROM veritamap_maps WHERE user_id = {MICHAEL_USER_ID}));
DELETE FROM veritamap_instrument_tests WHERE map_id IN (SELECT id FROM veritamap_maps WHERE user_id = {MICHAEL_USER_ID});
DELETE FROM veritamap_tests              WHERE map_id IN (SELECT id FROM veritamap_maps WHERE user_id = {MICHAEL_USER_ID});
DELETE FROM veritamap_instruments        WHERE map_id IN (SELECT id FROM veritamap_maps WHERE user_id = {MICHAEL_USER_ID});
DELETE FROM veritamap_maps               WHERE user_id = {MICHAEL_USER_ID} AND id NOT IN (40, 41, 42);
""".strip())
    out.append("")

    # Maps
    out.append("-- Maps --")
    cur.execute("SELECT id, user_id, name, instruments, created_at, updated_at FROM veritamap_maps WHERE user_id = ? ORDER BY id", (MICHAEL_USER_ID,))
    for row in cur.fetchall():
        mid, uid, name, instr, ca, ua = row
        if mid in (40, 41, 42):
            out.append(
                f"UPDATE veritamap_maps SET name = {sql_lit(name)}, instruments = {sql_lit(instr)}, updated_at = {sql_lit(ua)} WHERE id = {mid};"
            )
            # Insert if not exists (handles fresh DBs)
            out.append(
                f"INSERT OR IGNORE INTO veritamap_maps (id, user_id, name, instruments, created_at, updated_at) VALUES ({mid}, {uid}, {sql_lit(name)}, {sql_lit(instr)}, {sql_lit(ca)}, {sql_lit(ua)});"
            )
        else:
            # New maps: don't pin id (let prod allocate)
            out.append(
                f"INSERT INTO veritamap_maps (user_id, name, instruments, created_at, updated_at) VALUES ({uid}, {sql_lit(name)}, {sql_lit(instr)}, {sql_lit(ca)}, {sql_lit(ua)});"
            )
    out.append("")

    # Build a temp table mapping our staging map ids -> target prod map ids
    # by name. We'll use SQL temp variables via subquery lookups.
    # Simpler: we use map name as natural key everywhere.

    # Instruments
    out.append("-- Instruments --")
    cur.execute("""
        SELECT m.name AS map_name, i.instrument_name, i.role, i.category,
               i.created_at, i.serial_number, i.nickname
          FROM veritamap_instruments i
          JOIN veritamap_maps m ON m.id = i.map_id
         WHERE m.user_id = ?
         ORDER BY m.id, i.id
    """, (MICHAEL_USER_ID,))
    for row in cur.fetchall():
        map_name, iname, role, cat, ca, sn, nn = row
        out.append(
            "INSERT INTO veritamap_instruments (map_id, instrument_name, role, category, created_at, serial_number, nickname) "
            f"VALUES ((SELECT id FROM veritamap_maps WHERE user_id = {MICHAEL_USER_ID} AND name = {sql_lit(map_name)}), "
            f"{sql_lit(iname)}, {sql_lit(role)}, {sql_lit(cat)}, {sql_lit(ca)}, {sql_lit(sn)}, {sql_lit(nn)});"
        )
    out.append("")

    # Tests
    out.append("-- Tests --")
    cur.execute("""
        SELECT m.name AS map_name, t.analyte, t.specialty, t.complexity, t.active,
               t.instrument_source, t.last_cal_ver, t.last_method_comp,
               t.last_precision, t.last_sop_review, t.notes, t.updated_at
          FROM veritamap_tests t
          JOIN veritamap_maps m ON m.id = t.map_id
         WHERE m.user_id = ?
         ORDER BY m.id, t.id
    """, (MICHAEL_USER_ID,))
    for row in cur.fetchall():
        (map_name, analyte, specialty, complexity, active, isrc,
         cv, mc, pr, sop, notes, ua) = row
        out.append(
            "INSERT INTO veritamap_tests (map_id, analyte, specialty, complexity, active, "
            "instrument_source, last_cal_ver, last_method_comp, last_precision, "
            "last_sop_review, notes, updated_at) VALUES ("
            f"(SELECT id FROM veritamap_maps WHERE user_id = {MICHAEL_USER_ID} AND name = {sql_lit(map_name)}), "
            f"{sql_lit(analyte)}, {sql_lit(specialty)}, {sql_lit(complexity)}, {active}, "
            f"{sql_lit(isrc)}, {sql_lit(cv)}, {sql_lit(mc)}, {sql_lit(pr)}, "
            f"{sql_lit(sop)}, {sql_lit(notes)}, {sql_lit(ua)});"
        )
    out.append("")

    # Instrument tests
    out.append("-- Instrument tests --")
    cur.execute("""
        SELECT m.name AS map_name, i.instrument_name, i.nickname, i.role,
               it.analyte, it.specialty, it.complexity, it.active
          FROM veritamap_instrument_tests it
          JOIN veritamap_instruments i ON i.id = it.instrument_id
          JOIN veritamap_maps m ON m.id = it.map_id
         WHERE m.user_id = ?
         ORDER BY m.id, i.id, it.id
    """, (MICHAEL_USER_ID,))
    for row in cur.fetchall():
        (map_name, iname, nick, role, analyte, specialty, complexity, active) = row
        nick_clause = (f"AND nickname = {sql_lit(nick)}" if nick else "AND nickname IS NULL")
        out.append(
            "INSERT INTO veritamap_instrument_tests (instrument_id, map_id, analyte, specialty, complexity, active) VALUES ("
            f"(SELECT id FROM veritamap_instruments WHERE map_id = "
            f"(SELECT id FROM veritamap_maps WHERE user_id = {MICHAEL_USER_ID} AND name = {sql_lit(map_name)}) "
            f"AND instrument_name = {sql_lit(iname)} AND role = {sql_lit(role)} {nick_clause} LIMIT 1), "
            f"(SELECT id FROM veritamap_maps WHERE user_id = {MICHAEL_USER_ID} AND name = {sql_lit(map_name)}), "
            f"{sql_lit(analyte)}, {sql_lit(specialty)}, {sql_lit(complexity)}, {active});"
        )
    out.append("")

    # Correlations: must be emitted after tests so that tests have ids.
    # We refer to test ids by (map_name, analyte) lookup.
    out.append("-- Correlations --")
    cur.execute("""
        SELECT ma.name AS map_a, ta.analyte AS analyte_a,
               mb.name AS map_b, tb.analyte AS analyte_b,
               c.correlation_group_id, c.correlation_method, c.acceptable_criteria,
               c.actual_bias_or_sd, c.pass_fail, c.work_performed_date,
               c.signoff_date, c.signoff_by_user_id, c.signoff_by_name,
               c.next_due, c.notes, c.created_at, c.updated_at
          FROM veritamap_test_correlations c
          JOIN veritamap_tests ta ON ta.id = c.test_a_id
          JOIN veritamap_maps ma  ON ma.id = ta.map_id
          JOIN veritamap_tests tb ON tb.id = c.test_b_id
          JOIN veritamap_maps mb  ON mb.id = tb.map_id
         WHERE ma.user_id = ? AND mb.user_id = ?
         ORDER BY c.id
    """, (MICHAEL_USER_ID, MICHAEL_USER_ID))
    for row in cur.fetchall():
        (map_a, analyte_a, map_b, analyte_b, gid, method, criteria,
         bias, pf, wpd, sd, sby_uid, sby_name, nd, notes, ca, ua) = row
        a_lookup = (
            f"(SELECT id FROM veritamap_tests WHERE analyte = {sql_lit(analyte_a)} "
            f"AND map_id = (SELECT id FROM veritamap_maps WHERE user_id = {MICHAEL_USER_ID} AND name = {sql_lit(map_a)}))"
        )
        b_lookup = (
            f"(SELECT id FROM veritamap_tests WHERE analyte = {sql_lit(analyte_b)} "
            f"AND map_id = (SELECT id FROM veritamap_maps WHERE user_id = {MICHAEL_USER_ID} AND name = {sql_lit(map_b)}))"
        )
        out.append(
            "INSERT INTO veritamap_test_correlations (test_a_id, test_b_id, correlation_group_id, "
            "correlation_method, acceptable_criteria, actual_bias_or_sd, pass_fail, "
            "work_performed_date, signoff_date, signoff_by_user_id, signoff_by_name, "
            f"next_due, notes, created_at, updated_at) VALUES ({a_lookup}, {b_lookup}, "
            f"{sql_lit(gid)}, {sql_lit(method)}, {sql_lit(criteria)}, {sql_lit(bias)}, {sql_lit(pf)}, "
            f"{sql_lit(wpd)}, {sql_lit(sd)}, {sql_lit(sby_uid)}, {sql_lit(sby_name)}, "
            f"{sql_lit(nd)}, {sql_lit(notes)}, {sql_lit(ca)}, {sql_lit(ua)});"
        )
    out.append("")
    out.append("COMMIT;")
    out.append("")

    with open(args.out, "w") as f:
        f.write("\n".join(out))

    print(f"Wrote {args.out} ({len(out)} lines)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
